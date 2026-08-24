const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');

const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Das gebaute Frontend wird vom selben Server ausgeliefert wie die
// Socket-Verbindung. Dadurch braucht der Client keine feste Backend-Adresse
// und die App laeuft lokal, im Container und hinter einem Reverse Proxy
// gleichermassen. express.static liefert index.html fuer "/" automatisch aus.
app.use(express.static(path.join(__dirname, '..', 'frontend', 'dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- Datenhaltung (In-Memory) ---
//
// Lehrkraefte haengen an einer stabilen Kennung aus dem localStorage des
// Browsers, nicht mehr an der socket.id. Die socket.id wechselt bei jedem
// Reconnect - Bildschirmsperre, Tab im Hintergrund, WLAN-Wechsel beim Gang
// durchs Gebaeude. Zwischen Hinweg und Rueckkehr eines Schuelers liegen 20 bis
// 45 Minuten, in denen genau das laufend passiert; an der socket.id waeren die
// Vorfaelle danach verwaist.
const teachers = new Map();        // teacherId -> Lehrkraft
const socketToTeacher = new Map(); // socket.id -> teacherId
const incidents = [];

// Zustaende eines Vorfalls. Hin- und Rueckweg sind derselbe zweistufige
// Handschlag mit vertauschten Rollen: erst "ist unterwegs", dann bestaetigt
// die Person, in deren Raum der Schueler eintrifft.
//
//   [-] --request_help--> unterwegs --confirm_arrival--> betreut
//                                                           |
//                                              send_back    v
//                          zurueck <--confirm_return-- auf_dem_rueckweg
const UNTERWEGS = 'unterwegs';
const BETREUT = 'betreut';
const AUF_DEM_RUECKWEG = 'auf_dem_rueckweg';
const ZURUECK = 'zurueck';

const MAX_PLAETZE = 3;
let vorfallZaehler = 0;

// --- Kleine Helfer ---

// Nur das Format, das der Client erzeugt. Haelt fremde Schluessel aus der Map
// und begrenzt die Laenge dessen, was wir im Speicher behalten.
function normalisiereId(wert) {
  if (typeof wert !== 'string') return null;
  const id = wert.trim();
  return /^[0-9a-zA-Z_-]{8,64}$/.test(id) ? id : null;
}

function text(wert, maxLaenge) {
  return String(wert == null ? '' : wert).trim().slice(0, maxLaenge);
}

function begrenzePlaetze(wert) {
  const zahl = Number.parseInt(wert, 10);
  if (!Number.isFinite(zahl) || zahl < 0) return 0;
  return Math.min(zahl, MAX_PLAETZE);
}

function aktuelleLehrkraft(socket) {
  const teacherId = socketToTeacher.get(socket.id);
  return teacherId ? teachers.get(teacherId) : undefined;
}

function findeVorfall(id) {
  return incidents.find(i => i.id === id);
}

// Freie Plaetze werden abgeleitet, nicht mitgezaehlt: "plaetze" ist, was die
// Lehrkraft anbietet, "betreut" sind die laufenden Vorfaelle. Dadurch kommt der
// Platz beim Zurueckschicken von selbst zurueck, statt an vier Stellen richtig
// hoch- und runtergezaehlt werden zu muessen.
function freiePlaetze(teacher) {
  return Math.max(0, teacher.plaetze - teacher.betreut.length);
}

function istAufnahmebereit(teacher) {
  return teacher.online && teacher.isAvailable && freiePlaetze(teacher) > 0;
}

// Nach aussen geht nur, was die Liste braucht - nicht die Belegungsliste.
function oeffentlich(teacher) {
  return {
    id: teacher.id,
    name: teacher.name,
    room: teacher.room,
    capacity: freiePlaetze(teacher)
  };
}

// Der Zielraum einer Rueckkehr ist der Raum, in dem die Gegenseite *jetzt*
// steht, nicht der von vorhin: nach 45 Minuten unterrichtet sie in aller Regel
// woanders. Ist sie offline, bleibt der Raum vom Zeitpunkt der Verweisung als
// beste verfuegbare Auskunft stehen.
function mitAktuellenRaeumen(incident) {
  const sender = teachers.get(incident.senderId);
  const receiver = teachers.get(incident.receiverId);
  return {
    ...incident,
    senderRaum: sender && sender.online ? sender.room : incident.senderRaum,
    receiverRaum: receiver && receiver.online ? receiver.room : incident.receiverRaum
  };
}

function broadcastAvailableTeachers() {
  const available = [];
  for (const teacher of teachers.values()) {
    if (istAufnahmebereit(teacher)) available.push(oeffentlich(teacher));
  }
  io.emit('available_teachers', available);
}

// Alle Geraete derselben Lehrkraft liegen im Raum ihrer teacherId. io.to()
// erreicht damit auch den Tab, der zwischenzeitlich neu verbunden hat.
function syncUserIncidents(teacherId) {
  if (!teachers.has(teacherId)) return;
  const userIncidents = incidents
    .filter(i => i.senderId === teacherId || i.receiverId === teacherId)
    .map(mitAktuellenRaeumen);
  io.to(teacherId).emit('sync_incidents', userIncidents);
}

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);

  // Anmeldung - und zugleich die Wiederanmeldung nach einem Reconnect.
  socket.on('login', (data) => {
    const name = text(data && data.name, 60);
    if (!name) return;

    const teacherId = normalisiereId(data && data.teacherId) || socket.id;
    const room = text(data && data.room, 30);

    let teacher = teachers.get(teacherId);
    if (teacher) {
      // Wiederanmeldung: Aufnahmebereitschaft, Belegung und laufende Vorfaelle
      // bleiben stehen. Der Server ist die Wahrheit, nicht der alte Schalter
      // im Browser.
      teacher.name = name;
      teacher.room = room || teacher.room;
      teacher.online = true;
      teacher.offlineSeit = null;
    } else {
      teacher = {
        id: teacherId,
        name,
        room,
        isAvailable: false,
        plaetze: 0,
        betreut: [],   // ids der laufenden Vorfaelle
        online: true,
        offlineSeit: null
      };
      teachers.set(teacherId, teacher);
    }

    socketToTeacher.set(socket.id, teacherId);
    socket.join(teacherId);

    socket.emit('login_success', {
      ...oeffentlich(teacher),
      isAvailable: teacher.isAvailable,
      plaetze: teacher.plaetze
    });

    broadcastAvailableTeachers();
    syncUserIncidents(teacherId);
  });

  // Aufnahmebereitschaft, angebotene Plaetze und Raum aktualisieren.
  socket.on('update_status', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    if (!teacher) return;

    teacher.isAvailable = Boolean(data && data.isAvailable);
    teacher.plaetze = begrenzePlaetze(data && data.capacity);
    const room = text(data && data.room, 30);
    if (room) teacher.room = room;

    // Der eigene Zustand kann sich geaendert haben (etwa der Raum), also auch
    // an die eigenen Geraete zurueckspiegeln.
    io.to(teacher.id).emit('status_updated', {
      ...oeffentlich(teacher),
      isAvailable: teacher.isAvailable,
      plaetze: teacher.plaetze
    });
    broadcastAvailableTeachers();
  });

  // Schueler zu einer Kollegin oder einem Kollegen schicken.
  socket.on('request_help', (data) => {
    const sender = aktuelleLehrkraft(socket);
    if (!sender) return;

    const receiverId = normalisiereId(data && data.receiverId);
    const receiver = receiverId ? teachers.get(receiverId) : undefined;

    if (!receiver || receiver.id === sender.id || !istAufnahmebereit(receiver)) {
      socket.emit('help_requested', { success: false, message: 'Kollege nicht mehr verfügbar.' });
      return;
    }

    const incident = {
      id: `v${++vorfallZaehler}`,
      senderId: sender.id,
      senderName: sender.name,
      senderRaum: sender.room,
      receiverId: receiver.id,
      receiverName: receiver.name,
      receiverRaum: receiver.room,
      studentName: text(data && data.studentName, 60),
      status: UNTERWEGS,
      timestamp: new Date()
    };
    incidents.push(incident);

    // Der Platz ist ab jetzt belegt, nicht erst bei der Ankunft: sonst sehen
    // zwei Kolleginnen im selben Moment denselben letzten freien Platz und
    // schicken beide einen Schueler dorthin.
    receiver.betreut.push(incident.id);

    io.to(receiver.id).emit('incoming_student', mitAktuellenRaeumen(incident));
    socket.emit('help_requested', { success: true, incident: mitAktuellenRaeumen(incident) });

    syncUserIncidents(sender.id);
    syncUserIncidents(receiver.id);
    broadcastAvailableTeachers();
  });

  // Aufnehmende Lehrkraft bestaetigt das Eintreffen.
  socket.on('confirm_arrival', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    const incident = findeVorfall(data && data.incidentId);
    if (!teacher || !incident) return;
    if (incident.receiverId !== teacher.id) return;
    // Jeder Uebergang ist idempotent: im Schul-WLAN tippen beide Seiten gern
    // zweimal, und ein zweiter Klick darf den Vorfall nicht weiterdrehen.
    if (incident.status !== UNTERWEGS) return;

    incident.status = BETREUT;
    incident.angekommenAm = new Date();

    io.to(incident.senderId).emit('student_arrived', mitAktuellenRaeumen(incident));
    syncUserIncidents(incident.senderId);
    syncUserIncidents(teacher.id);
  });

  // Aufnehmende Lehrkraft schickt den Schueler zurueck.
  socket.on('send_back', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    const incident = findeVorfall(data && data.incidentId);
    if (!teacher || !incident) return;
    if (incident.receiverId !== teacher.id) return;
    if (incident.status !== BETREUT) return;

    incident.status = AUF_DEM_RUECKWEG;
    incident.rueckwegSeit = new Date();

    // Der Platz wird sofort frei - der Schueler hat den Raum verlassen.
    teacher.betreut = teacher.betreut.filter(id => id !== incident.id);

    const angereichert = mitAktuellenRaeumen(incident);
    io.to(incident.senderId).emit('student_returning', angereichert);
    socket.emit('send_back_ok', angereichert);

    syncUserIncidents(incident.senderId);
    syncUserIncidents(teacher.id);
    broadcastAvailableTeachers();
  });

  // Sendende Lehrkraft bestaetigt die Rueckkehr - der Vorfall ist beendet.
  socket.on('confirm_return', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    const incident = findeVorfall(data && data.incidentId);
    if (!teacher || !incident) return;
    if (incident.senderId !== teacher.id) return;
    if (incident.status !== AUF_DEM_RUECKWEG) return;

    incident.status = ZURUECK;
    incident.beendetAm = new Date();

    io.to(incident.receiverId).emit('return_confirmed', mitAktuellenRaeumen(incident));
    syncUserIncidents(incident.senderId);
    syncUserIncidents(incident.receiverId);
  });

  // Abmeldung: die Lehrkraft loest ihre Kennung, bleibt aber als Datensatz
  // bestehen, solange sie noch jemanden betreut oder ein Vorfall offen ist.
  socket.on('logout', () => {
    const teacher = aktuelleLehrkraft(socket);
    socketToTeacher.delete(socket.id);
    if (!teacher) return;

    socket.leave(teacher.id);
    teacher.isAvailable = false;
    if (!hatWeitereVerbindung(teacher.id)) {
      teacher.online = false;
      teacher.offlineSeit = Date.now();
    }
    broadcastAvailableTeachers();
  });

  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    const teacherId = socketToTeacher.get(socket.id);
    socketToTeacher.delete(socket.id);
    if (!teacherId) return;

    const teacher = teachers.get(teacherId);
    // Der Datensatz bleibt: die Verbindung faellt staendig kurz weg, die
    // laufenden Vorfaelle sollen das ueberleben. Nur ein Reconnect setzt
    // "online" wieder auf true.
    if (teacher && !hatWeitereVerbindung(teacherId)) {
      teacher.online = false;
      teacher.offlineSeit = Date.now();
      broadcastAvailableTeachers();
    }
  });
});

// Ist noch ein anderer Tab derselben Lehrkraft verbunden?
function hatWeitereVerbindung(teacherId) {
  for (const id of socketToTeacher.values()) {
    if (id === teacherId) return true;
  }
  return false;
}

// Aufraeumen: Lehrkraefte, die lange offline sind und weder jemanden betreuen
// noch einen offenen Vorfall haben, fallen aus dem Speicher. Ohne das waechst
// die Map ueber den Schultag, seit der Datensatz einen Verbindungsabbruch
// ueberlebt.
const AUFRAEUM_INTERVALL_MS = 30 * 60 * 1000;
const OFFLINE_GNADENFRIST_MS = 12 * 60 * 60 * 1000;

const aufraeumer = setInterval(() => {
  const jetzt = Date.now();
  for (const [id, teacher] of teachers) {
    if (teacher.online || teacher.betreut.length > 0) continue;
    if (jetzt - (teacher.offlineSeit || jetzt) < OFFLINE_GNADENFRIST_MS) continue;

    const hatOffenenVorfall = incidents.some(
      i => (i.senderId === id || i.receiverId === id) && i.status !== ZURUECK
    );
    if (!hatOffenenVorfall) teachers.delete(id);
  }
}, AUFRAEUM_INTERVALL_MS);
if (typeof aufraeumer.unref === 'function') aufraeumer.unref();

const PORT = process.env.PORT || 4000;
server.listen(PORT, () => {
  console.log(`Server listening on port ${PORT}`);
});
