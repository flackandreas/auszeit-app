const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const path = require('path');
const crypto = require('crypto');
const speicher = require('./speicher');
const { erstelleAdmin, TOKEN_MINDESTLAENGE } = require('./admin');
const { erstelleSitzungen } = require('./sitzungen');
const { liesKeks } = require('./kekse');
const { konfigurationAusUmgebung, erstellePortal } = require('./portal');

const { normalisiereSchulcode, PIN_MINDESTLAENGE } = speicher;

const app = express();
app.use(express.json());

// Vor Auszeit stehen Caddy und im Betrieb Cloudflare. Vertraut wird nur
// Proxys aus dem eigenen Netz - einem Absender aus dem Internet glaubt Express
// keinen X-Forwarded-For-Kopf.
app.set('trust proxy', 'loopback, linklocal, uniquelocal');

// --- Mandanten ---
//
// Ohne Trennung sieht jede Lehrkraft alle angemeldeten Lehrkraefte, auch die
// fremder Schulen: verwirrende Listen, und ein Schueler laesst sich versehentlich
// an eine fremde Schule schicken - erst dadurch traegt sein Name ueber die
// Grenze. Der Mandant steckt in der Adresse (/s/<code>), damit die Anmeldung
// ohne zusaetzliches Feld auskommt.
//
// Bewusst eine feste Liste statt Selbstbedienung: ein Tippfehler soll eine
// klare Fehlermeldung geben und keinen stillen, leeren Mandanten, in dem man
// allein sitzt und sich ueber die fehlenden Kollegen wundert.
const STANDARD_SCHULE = 'standard';

// --- Beitrittscode je Schule ---
//
// Der Code ist ein gemeinsames Geheimnis des Kollegiums, vergleichbar mit einem
// WLAN-Schluessel - kein persoenliches Passwort. Er steht im Klartext in der
// Konfiguration und wird nie an einen Client gesendet.
//
// Gegen das Durchprobieren hilft keine Sperre, sondern eine wachsende
// Verzoegerung: Eine Sperre liesse sich von aussen ausloesen, um ein Kollegium
// auszusperren. Die Verzoegerung bremst nur, und die ersten Fehlversuche - also
// das normale Vertippen - bleiben ohne Wartezeit.
const PIN_FREIVERSUCHE = 3;
const PIN_MAX_VERZOEGERUNG_MS = 5000;
const PIN_VERGESSEN_NACH_MS = 10 * 60 * 1000;
const PIN_MAX_JE_VERBINDUNG = 10;

const pinFehler = new Map(); // schulId -> { anzahl, letzter }

function pinVerzoegerung(schulId) {
  const eintrag = pinFehler.get(schulId);
  if (!eintrag) return 0;
  if (Date.now() - eintrag.letzter > PIN_VERGESSEN_NACH_MS) {
    pinFehler.delete(schulId);
    return 0;
  }
  if (eintrag.anzahl <= PIN_FREIVERSUCHE) return 0;
  return Math.min(PIN_MAX_VERZOEGERUNG_MS, 250 * 2 ** (eintrag.anzahl - PIN_FREIVERSUCHE));
}

function merkePinFehler(schulId) {
  const eintrag = pinFehler.get(schulId);
  const frisch = !eintrag || Date.now() - eintrag.letzter > PIN_VERGESSEN_NACH_MS;
  pinFehler.set(schulId, {
    anzahl: frisch ? 1 : eintrag.anzahl + 1,
    letzter: Date.now()
  });
}

// Zeitkonstanter Vergleich: ein frueher Abbruch bei der ersten falschen Stelle
// verriete ueber die Laufzeit, wie viel vom Code schon stimmt. Der Umweg ueber
// den Hash haelt beide Seiten gleich lang, sodass auch die Laenge nichts sagt.
function gleichwertig(a, b) {
  const hash = (wert) => crypto.createHash('sha256')
    .update(String(wert == null ? '' : wert), 'utf8').digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Die Mandanten liegen jetzt in einer Datei statt nur in der Umgebung. Die Map
// bleibt dieselbe Instanz und wird im Betrieb umbefuellt - dadurch wirkt eine
// Aenderung sofort, ohne Neustart. Bisher war das ein Container-Neustart, der
// alle Angemeldeten hinauswarf und laufende Auszeiten verlor.
const SCHULEN = new Map();
let standardSchule = null;
let datenStand = 0;

function uebernehmeMandanten(schulen, standard, mtimeMs) {
  SCHULEN.clear();
  for (const [id, schule] of schulen) SCHULEN.set(id, schule);
  standardSchule = standard;
  if (typeof mtimeMs === 'number') datenStand = mtimeMs;
}

{
  const start = speicher.laden(STANDARD_SCHULE, 'Auszeit-Betreuung');
  uebernehmeMandanten(start.schulen, start.standard, start.mtimeMs);
  console.log(`Mandanten: ${[...SCHULEN.keys()].join(', ')} (Datei: ${speicher.DATEI})`);
}

// Aenderungen an der Datei von aussen - etwa eine Reparatur per SSH - sollen
// ebenfalls ohne Neustart greifen.
const mandantenWache = setInterval(() => {
  if (!speicher.fremdGeaendert(datenStand)) return;
  try {
    const { schulen, standard } = speicher.lesen();
    if (schulen.size === 0) return;
    uebernehmeMandanten(schulen, standard, null);
    datenStand = require('fs').statSync(speicher.DATEI).mtimeMs;
    console.log('Mandantendatei wurde ausserhalb geaendert - neu eingelesen.');
  } catch (err) {
    console.error('Geaenderte Mandantendatei ist unbrauchbar - behalte den bisherigen Stand.');
  }
}, 10 * 1000);
if (typeof mandantenWache.unref === 'function') mandantenWache.unref();

// Wird von der Admin-Oberflaeche nach jeder Aenderung aufgerufen.
function speichereMandanten() {
  datenStand = speicher.schreiben(SCHULEN, standardSchule);
}

// Fehlt der Code und gibt es nur einen Mandanten, ist er gemeint. Ein
// angegebener, aber unbekannter Code wird nie stillschweigend ersetzt.
function schuleAufloesen(wunsch) {
  const code = normalisiereSchulcode(wunsch);
  if (code) return SCHULEN.has(code) ? code : null;
  // Ohne Code greift der Standardmandant. Damit bleibt ein blanker Link
  // (und jedes bestehende Lesezeichen) gueltig, auch wenn weitere Schulen
  // eigene Adressen bekommen.
  if (standardSchule && SCHULEN.has(standardSchule)) return standardSchule;
  return SCHULEN.size === 1 ? [...SCHULEN.keys()][0] : null;
}

// Lebenszeichen fuer den Verbund. Das Portal fragt hier, ob es die Kachel
// zeigen darf, und erwartet genau 200 mit {"status":"ok"}. Bewusst ohne
// Version, Mandanten oder Zahlen: der Endpunkt ist ohne Anmeldung erreichbar
// und soll nichts verraten, was bei der Suche nach Luecken hilft.
app.get('/healthz', (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json({ status: 'ok', modul: 'auszeit' });
});

// Erlaubt dem Client, Name und Betriebsart vor der Anmeldung zu erfragen -
// ein falscher Link faellt so sofort auf, nicht erst nach dem Ausfuellen.
app.get('/api/schule', (req, res) => {
  const id = schuleAufloesen(req.query.code);
  const schule = id ? SCHULEN.get(id) : null;
  // Ein stillgelegter Mandant verhaelt sich nach aussen wie ein unbekannter.
  if (!schule || !schule.aktiv) return res.status(404).json({ fehler: 'unbekannte_schule' });
  // Der Code selbst geht nie nach aussen - nur die Auskunft, dass es einen gibt.
  res.json({
    id,
    name: schule.name,
    demo: schule.demo,
    pinNoetig: Boolean(schule.pin) && !PORTAL.nurPortal,
    portal: Boolean(portal),
    nurPortal: PORTAL.nurPortal
  });
});

// Das gebaute Frontend wird vom selben Server ausgeliefert wie die
// Socket-Verbindung. Dadurch braucht der Client keine feste Backend-Adresse
// und die App laeuft lokal, im Container und hinter einem Reverse Proxy
// gleichermassen. express.static liefert index.html fuer "/" automatisch aus.
const DIST = path.join(__dirname, '..', 'frontend', 'dist');
app.use(express.static(DIST));

// Der Mandantenpfad liefert dieselbe Anwendung aus; den Code liest der Client
// selbst aus der Adresse. Die Verweise auf /assets/... bleiben dabei gueltig.
app.get('/s/:code', (req, res) => res.sendFile(path.join(DIST, 'index.html')));


const server = http.createServer(app);

// Das Frontend kommt vom selben Server, CORS wird also im Normalbetrieb gar
// nicht gebraucht - ohne Angabe laesst Socket.IO nur die gleiche Herkunft zu.
// "*" hiess: jede beliebige Seite durfte sich verbinden. Fuer den getrennten
// Vite-Dev-Server laesst sich die Herkunft ueber AUSZEIT_ORIGIN nachreichen
// (kommagetrennt).
const ERLAUBTE_HERKUNFT = (process.env.AUSZEIT_ORIGIN || '')
  .split(',').map(s => s.trim()).filter(Boolean);

// Herkunftspruefung beim Handshake. CORS allein genuegt nicht: es regelt nur
// die Abfragen per XHR, nicht den Aufbau einer WebSocket-Verbindung. Seit der
// Handshake das Sitzungscookie der Portal-Anmeldung liest, koennte sonst eine
// fremde Seite unter derselben Domain - etwa ein anderes Modul mit einer Luecke
// - eine Verbindung im Namen der Lehrkraft aufbauen; der Browser schickt das
// Cookie (SameSite=Lax) innerhalb derselben Domain mit. Ohne Origin-Kopf ist
// es kein Browser, und der traegt auch kein fremdes Cookie mit sich.
function herkunftErlaubt(anfrage) {
  const herkunft = anfrage.headers.origin;
  if (!herkunft) return true;
  if (ERLAUBTE_HERKUNFT.includes(herkunft)) return true;
  try {
    return new URL(herkunft).host === anfrage.headers.host;
  } catch (err) {
    return false;
  }
}

const io = new Server(server, {
  ...(ERLAUBTE_HERKUNFT.length > 0
    ? { cors: { origin: ERLAUBTE_HERKUNFT, methods: ['GET', 'POST'] } }
    : {}),
  allowRequest: (anfrage, antwort) => antwort(null, herkunftErlaubt(anfrage))
});

// --- Datenhaltung (In-Memory) ---
//
// Lehrkraefte haengen an einer stabilen Kennung, nicht an der socket.id. Die
// socket.id wechselt bei jedem Reconnect - Bildschirmsperre, Tab im
// Hintergrund, WLAN-Wechsel beim Gang durchs Gebaeude. Zwischen Hinweg und
// Rueckkehr eines Schuelers liegen 20 bis 45 Minuten, in denen genau das
// laufend passiert; an der socket.id waeren die Vorfaelle danach verwaist.
//
// Die Kennung ist oeffentlich, sie steht in jeder Kollegenliste. Den Weg
// zurueck in die Sitzung oeffnet deshalb nur das geheime Token (sitzungen.js).
const teachers = new Map();        // teacherId -> Lehrkraft
const socketToTeacher = new Map(); // socket.id -> teacherId
const incidents = [];

// Mindestens ein Schultag, damit niemand mitten im Unterricht den Code erneut
// eingeben muss - aber nicht laenger: auf einem Raum-PC, an dem sich niemand
// abmeldet, ist die Sitzung am naechsten Morgen sonst noch offen.
const SITZUNG_GUELTIG_MS = dauerAusUmgebung('AUSZEIT_SITZUNG_TTL_MS', 14 * 60 * 60 * 1000);
const sitzungen = erstelleSitzungen({ gueltigMs: SITZUNG_GUELTIG_MS });

// --- Anmeldung ueber das SchulOS-Portal ---
//
// Ohne PORTAL_ISSUER bleibt alles wie bisher. Im Verbund gilt: ein Portal ist
// eine Schule, die Lehrkraefte landen im Standardmandanten.
const PORTAL = konfigurationAusUmgebung();
const portal = PORTAL.aktiv ? erstellePortal(PORTAL) : null;

// Das Cookie traegt dasselbe Token wie bei der Anmeldung mit Code, nur dass
// das Browser-JavaScript es nie zu sehen bekommt (HttpOnly).
const SITZUNGS_KEKS = 'auszeit_sitzung';
const VORGANGS_KEKS = 'auszeit_vorgang';

if (PORTAL.fehlend.length > 0) {
  console.error(`Portal-Anbindung unvollstaendig, es fehlt: ${PORTAL.fehlend.join(', ')} - Anmeldung ueber das Portal ist aus.`);
}
if (portal) {
  console.log(`Anmeldung ueber das Portal: ${PORTAL.aussteller}${PORTAL.intern ? ` (intern ${PORTAL.intern})` : ''}`);
}
// Bewusst strenger als die PHP-Module: Dort gilt PORTAL_NUR_SSO nur bei
// vollstaendiger Portal-Konfiguration. Hier bleibt die Anmeldung mit Code
// trotzdem zu - im Verbund laeuft Auszeit ohne Beitrittscode, und ein
// vergessenes Geheimnis oeffnete sonst die Tuer fuer jede und jeden.
if (PORTAL.nurPortal && !portal) {
  console.error('PORTAL_NUR_SSO=1, aber die Portal-Anbindung ist aus - niemand kann sich anmelden.');
}

// Zustaende eines Vorfalls. Hin- und Rueckweg sind derselbe zweistufige
// Handschlag mit vertauschten Rollen: erst "ist unterwegs", dann bestaetigt
// die Person, in deren Raum der Schueler eintrifft.
//
//   [-] --request_help--> unterwegs --confirm_arrival--> betreut
//                                                           |
//                                              send_back    v
//                          zurueck <--confirm_return-- auf_dem_rueckweg
//
// Daneben steht "abgebrochen": der einseitige Abschluss, wenn die Gegenseite
// offline ist und den Vorfall nicht mehr weiterdrehen kann. Bewusst ein eigener
// Endzustand - "zurueck" wuerde behaupten, die Rueckkehr sei bestaetigt worden.
const UNTERWEGS = 'unterwegs';
const BETREUT = 'betreut';
const AUF_DEM_RUECKWEG = 'auf_dem_rueckweg';
const ZURUECK = 'zurueck';
const ABGEBROCHEN = 'abgebrochen';

const ABGESCHLOSSEN = new Set([ZURUECK, ABGEBROCHEN]);


// Aufraeumfristen. Der Schuelername ist die eigentliche personenbezogene
// Angabe - fuer das Protokoll genuegen Zeitpunkt und beteiligte Lehrkraefte.
// Er faellt deshalb deutlich frueher weg als der Vorfall selbst.
// Ueber Umgebungsvariablen einstellbar: Aufbewahrungsfristen sind eine
// Schulentscheidung, keine Programmierentscheidung.
const NAME_LOESCHEN_NACH_MS = dauerAusUmgebung("AUSZEIT_NAME_TTL_MS", 2 * 60 * 60 * 1000);
const VORFALL_LOESCHEN_NACH_MS = dauerAusUmgebung("AUSZEIT_VORFALL_TTL_MS", 12 * 60 * 60 * 1000);
// Fuer nie geschlossene Vorfaelle - sonst bleiben sie fuer immer liegen.
const VORFALL_HOECHSTALTER_MS = dauerAusUmgebung("AUSZEIT_MAX_ALTER_MS", 24 * 60 * 60 * 1000);

const MAX_PLAETZE = 3;
let vorfallZaehler = 0;

// --- Kleine Helfer ---

// Positive Ganzzahl aus der Umgebung, sonst der Vorgabewert.
function dauerAusUmgebung(name, vorgabe) {
  const zahl = Number.parseInt(process.env[name], 10);
  return Number.isFinite(zahl) && zahl > 0 ? zahl : vorgabe;
}

// Nur das Format, das der Server fuer Kennungen erzeugt. Haelt fremde
// Schluessel aus der Map und begrenzt die Laenge dessen, was wir annehmen.
function normalisiereId(wert) {
  if (typeof wert !== 'string') return null;
  const id = wert.trim();
  return /^[0-9a-zA-Z_-]{8,64}$/.test(id) ? id : null;
}

// Oeffentliche Kennung einer Lehrkraft: Sie adressiert Verweisungen und steht
// deshalb in der Kollegenliste. Der Server vergibt sie, damit kein Client eine
// bestimmte Kennung fuer sich beanspruchen kann - frueher erzeugte der Browser
// sie selbst und konnte also auch eine fremde vorzeigen.
function neueKennung() {
  let id;
  do {
    id = crypto.randomBytes(12).toString('base64url');
  } while (teachers.has(id));
  return id;
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
// beste verfuegbare Auskunft stehen. Die Erreichbarkeit geht mit, weil der
// Client daran entscheidet, ob er den einseitigen Abschluss anbietet.
function fuerClient(incident) {
  const sender = teachers.get(incident.senderId);
  const receiver = teachers.get(incident.receiverId);
  return {
    ...incident,
    senderRaum: sender && sender.online ? sender.room : incident.senderRaum,
    receiverRaum: receiver && receiver.online ? receiver.room : incident.receiverRaum,
    senderOnline: Boolean(sender && sender.online),
    receiverOnline: Boolean(receiver && receiver.online)
  };
}

// Der Platz gehoert zum Vorfall, nicht zum Zustand: er wird frei, sobald der
// Schueler den Raum verlaesst - egal ob regulaer oder per Abbruch.
function gibPlatzFrei(incident) {
  const receiver = teachers.get(incident.receiverId);
  if (!receiver) return false;
  const vorher = receiver.betreut.length;
  receiver.betreut = receiver.betreut.filter(id => id !== incident.id);
  return receiver.betreut.length !== vorher;
}

// Sendet nur an den eigenen Mandanten. Das war die einzige Stelle, die
// ueberhaupt global gesendet hat - alle uebrigen Meldungen gehen ohnehin
// gezielt an eine einzelne Lehrkraft.
function broadcastAvailableTeachers(schulId) {
  if (!schulId) return;
  const available = [];
  for (const teacher of teachers.values()) {
    if (teacher.schulId === schulId && istAufnahmebereit(teacher)) {
      available.push(oeffentlich(teacher));
    }
  }
  io.to(`schule:${schulId}`).emit('available_teachers', available);
}

// Alle Geraete derselben Lehrkraft liegen im Raum ihrer teacherId. io.to()
// erreicht damit auch den Tab, der zwischenzeitlich neu verbunden hat.
function syncUserIncidents(teacherId) {
  if (!teachers.has(teacherId)) return;
  const userIncidents = incidents
    .filter(i => i.senderId === teacherId || i.receiverId === teacherId)
    .map(fuerClient);
  io.to(teacherId).emit('sync_incidents', userIncidents);
}

// Die Erreichbarkeit ist Teil dessen, was die Gegenseite sieht: daran haengen
// der Hinweis "nicht erreichbar" und der einseitige Abschluss. Beim Wechsel
// online/offline muessen deren Listen deshalb mitlaufen - sonst sehen sie den
// alten Stand, bis zufaellig ein anderes Ereignis einen Sync ausloest.
function syncGegenseiten(teacherId) {
  const andere = new Set();
  for (const v of incidents) {
    if (ABGESCHLOSSEN.has(v.status)) continue;
    if (v.senderId === teacherId) andere.add(v.receiverId);
    else if (v.receiverId === teacherId) andere.add(v.senderId);
  }
  for (const id of andere) syncUserIncidents(id);
}

// --- Portal-Anmeldung: Routen ---

function escapeHtml(wert) {
  return String(wert == null ? '' : wert).replace(/[&<>"']/g, z => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]
  ));
}

// Schlichte Seite fuer alles, was beim Weg ueber das Portal schiefgeht. Sie
// nennt nie den technischen Grund - der steht im Log -, sondern was die
// Lehrkraft jetzt tun kann.
function fehlerseite(res, status, titel, text) {
  const portalLink = portal ? `<a href="${escapeHtml(portal.aussteller)}">Zum Portal</a>` : '';
  res.status(status).set('Cache-Control', 'no-store').type('html').send(`<!doctype html>
<html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titel)} · Auszeit</title>
<style>body{font-family:system-ui,sans-serif;background:#f0fdf4;color:#062f22;margin:0;padding:16px}
main{max-width:28rem;margin:12vh auto;background:#fff;border-radius:16px;padding:24px;box-shadow:0 4px 24px rgba(6,47,34,.08)}
h1{font-size:1.25rem;margin:0 0 .75rem}p{line-height:1.5}a{color:#b45309;font-weight:600;margin-right:1rem}</style>
</head><body><main><h1>${escapeHtml(titel)}</h1><p>${escapeHtml(text)}</p>
<p><a href="/sso/start">Erneut anmelden</a>${portalLink}</p></main></body></html>`);
}

function keksOptionen(maxAge) {
  return { httpOnly: true, sameSite: 'lax', secure: Boolean(portal && portal.sicher), path: '/', maxAge };
}

// Die Sitzung zum Cookie dieser Anfrage, nur wenn sie ueber das Portal
// entstanden ist.
function portalSitzung(anfrage) {
  const sitzung = sitzungen.sitzung(liesKeks(anfrage, SITZUNGS_KEKS));
  return sitzung && sitzung.portal ? sitzung : null;
}

// Eine Lehrkraft je Portalkonto, gefunden ueber sub - nicht ueber das Kuerzel,
// das nach Jahren neu vergeben wird, und nicht ueber die Sitzung: Laeuft die
// ab oder meldet sich die Lehrkraft am Tablet zusaetzlich an, findet sie ihre
// laufenden Auszeiten trotzdem wieder.
function lehrkraftFuerPortal(identitaet, schulId) {
  for (const teacher of teachers.values()) {
    if (teacher.sub === identitaet.sub && teacher.schulId === schulId) {
      // Das Portal ist die fuehrende Quelle: Wer dort umbenannt oder aus der
      // Schulleitung genommen wird, ist es hier ab der naechsten Anmeldung
      // auch.
      teacher.name = identitaet.name || teacher.name;
      teacher.kuerzel = identitaet.kuerzel;
      teacher.verwaltung = portal.istVerwaltung(identitaet);
      return teacher;
    }
  }
  const teacher = {
    id: neueKennung(),
    sub: identitaet.sub,
    kuerzel: identitaet.kuerzel,
    schulId,
    name: identitaet.name || identitaet.kuerzel,
    room: '',
    isAvailable: false,
    plaetze: 0,
    betreut: [],
    online: false,
    // Wer sich anmeldet, aber nie verbindet, faellt mit dem Aufraeumen weg.
    offlineSeit: Date.now(),
    // Rolle "Verwaltung" aus den Portalgruppen - gebraucht fuer den Import
    // der Schuelerliste.
    verwaltung: portal.istVerwaltung(identitaet)
  };
  teachers.set(teacher.id, teacher);
  return teacher;
}

// Beendet eine Sitzung und meldet alle Tabs ab, die an ihr haengen. Gemeinsam
// fuer den Abmeldeknopf (mit Code und ueber das Portal) und fuer die Abmeldung,
// die das Portal ueber den Vorderkanal schickt.
function beendeSitzung(schluessel, ausloeser = null) {
  const sitzung = sitzungen.widerrufen(schluessel);
  for (const tab of io.sockets.sockets.values()) {
    if (tab.data.sitzung !== schluessel) continue;
    // Nicht an den Tab, der abmeldet: Der hat sich schon selbst
    // zurueckgesetzt und meldet sich womoeglich gleich neu an.
    if (tab !== ausloeser) tab.emit('logged_out');
    delete tab.data.portalToken;
    // Mit dem letzten Tab geht die Lehrkraft offline, und die Kollegenliste
    // wird neu verschickt.
    loeseVerbindung(tab);
  }
  // Wer sich abmeldet, nimmt niemanden mehr auf - es sei denn, sie ist am
  // Tablet noch angemeldet.
  const teacher = sitzung ? teachers.get(sitzung.teacherId) : undefined;
  if (teacher && !teacher.online) teacher.isAvailable = false;
}

// Hinweg zum Portal.
app.get('/sso/start', async (req, res) => {
  if (!portal) return res.redirect(303, '/');
  try {
    const { kennung, adresse } = await portal.beginne();
    res.cookie(VORGANGS_KEKS, kennung, { ...keksOptionen(10 * 60 * 1000), path: '/sso' });
    res.redirect(303, adresse);
  } catch (err) {
    console.error('Anmeldung am Portal nicht startbar:', err.message);
    fehlerseite(res, 503, 'Portal nicht erreichbar', 'Das SchulOS-Portal antwortet gerade nicht. Bitte gleich noch einmal versuchen.');
  }
});

// Rueckweg vom Portal: Code einloesen, Lehrkraft zuordnen, Sitzung beginnen.
app.get('/sso/rueckweg', async (req, res) => {
  if (!portal) return res.redirect(303, '/');
  const kennung = liesKeks(req, VORGANGS_KEKS);
  res.clearCookie(VORGANGS_KEKS, { ...keksOptionen(), path: '/sso' });

  let ergebnis;
  try {
    const suche = new URL(req.originalUrl, 'http://auszeit.invalid').search;
    ergebnis = await portal.schliesseAb(kennung, suche);
  } catch (err) {
    // openid-client nennt den eigentlichen Grund oft erst in err.cause - etwa
    // bei einer falschen Signatur. Ins Log gehoert er, auf die Seite nicht.
    const grund = err.cause && err.cause.message ? ` (${err.cause.message})` : '';
    console.error('Anmeldung ueber das Portal gescheitert:', err.code || '', err.message + grund);
    return fehlerseite(res, 400, 'Anmeldung nicht abgeschlossen',
      'Die Anmeldung über das Portal konnte nicht abgeschlossen werden. Bitte erneut versuchen.');
  }

  const { identitaet, idToken } = ergebnis;
  if (!portal.hatZugang(identitaet)) {
    console.log(`Zugang verweigert fuer ${identitaet.kuerzel || identitaet.sub} - nicht in PORTAL_ZUGANG_GRUPPEN.`);
    return fehlerseite(res, 403, 'Kein Zugang',
      'Für Ihr Konto ist Auszeit nicht freigegeben. Die Schulleitung kann das im Portal ändern.');
  }

  const schulId = schuleAufloesen(undefined);
  if (!schulId) {
    console.error('Portal-Anmeldung ohne Standardmandant - AUSZEIT_STANDARD_SCHULE setzen.');
    return fehlerseite(res, 503, 'Auszeit ist nicht eingerichtet',
      'Für diese Installation ist keine Schule hinterlegt. Bitte an die Administration wenden.');
  }

  const teacher = lehrkraftFuerPortal(identitaet, schulId);

  // Gehoerte die bisherige Sitzung dieses Browsers einer anderen Lehrkraft -
  // auf einem Raum-PC der Normalfall -, endet sie jetzt samt ihren Tabs. Bei
  // derselben Lehrkraft (Kachel ein zweites Mal geoeffnet) laufen die offenen
  // Tabs weiter.
  const alt = sitzungen.sitzung(liesKeks(req, SITZUNGS_KEKS));
  if (alt && alt.teacherId !== teacher.id) beendeSitzung(alt.schluessel);
  const token = sitzungen.ausstellen(teacher.id, { portal: true, sid: identitaet.sid, idToken });
  res.cookie(SITZUNGS_KEKS, token, keksOptionen(SITZUNG_GUELTIG_MS));
  res.redirect(303, '/');
});

// Abmeldung ueber den Vorderkanal: Das Portal laedt diese Adresse beim
// Abmelden in einem unsichtbaren Rahmen. Beendet werden alle Sitzungen dieser
// Portalsitzung (sid) - die Tabs dieses Browsers, nicht die am Tablet.
app.get('/sso/abmelden', (req, res) => {
  res.set('Cache-Control', 'no-store');
  // Nur das Portal darf die Seite einrahmen.
  res.set('Content-Security-Policy', `default-src 'none'; frame-ancestors ${portal ? portal.ursprung : "'none'"}`);
  const sid = portal ? portal.istVorderkanalAbmeldung(req.query) : null;
  if (sid) {
    for (const schluessel of sitzungen.schluesselWo(s => s.portal && s.sid === sid)) beendeSitzung(schluessel);
    res.clearCookie(SITZUNGS_KEKS, keksOptionen());
  }
  // Immer 204: ob hier eine Sitzung bestand, geht den Aufrufer nichts an.
  res.status(204).end();
});

// Der Abmeldeknopf bei Anmeldung ueber das Portal. POST, damit kein Bild und
// kein Link einer fremden Seite die Lehrkraft abmelden kann; das Cookie kommt
// bei einem fremden POST ohnehin nicht mit (SameSite=Lax).
app.post('/abmelden', async (req, res) => {
  const sitzung = portalSitzung(req);
  res.clearCookie(SITZUNGS_KEKS, keksOptionen());
  if (!sitzung) return res.redirect(303, '/');
  beendeSitzung(sitzung.schluessel);
  // Weiter zum Portal: Das beendet seine eigene Sitzung und meldet dann alle
  // anderen Module ab. Sonst bliebe man dort angemeldet - auf einem geteilten
  // Geraet genau das, was nicht passieren soll.
  try {
    res.redirect(303, await portal.abmeldeAdresse(sitzung.idToken));
  } catch (err) {
    console.error('Abmeldung beim Portal nicht moeglich:', err.message);
    res.redirect(303, '/');
  }
});

// Wer ist ueber das Portal angemeldet? Fuer die Anmeldemaske: Name und
// Kuerzel stehen schon fest, gefragt wird nur noch der Raum.
app.get('/api/sitzung', (req, res) => {
  res.set('Cache-Control', 'no-store');
  const sitzung = portalSitzung(req);
  const teacher = sitzung ? teachers.get(sitzung.teacherId) : undefined;
  if (!teacher) return res.status(401).json({ fehler: 'keine_sitzung' });
  res.json({ name: teacher.name, kuerzel: teacher.kuerzel, raum: teacher.room });
});

// Beim Handshake das Sitzungscookie lesen. Damit steht serverseitig fest, wer
// die Lehrkraft ist; der Client kann es nicht behaupten.
io.use((socket, next) => {
  const token = liesKeks(socket.request, SITZUNGS_KEKS);
  if (token && portal) socket.data.portalToken = token;
  next();
});

io.on('connection', (socket) => {
  console.log('A user connected:', socket.id);
  let pinVersucheDieserVerbindung = 0;

  // Anmeldung auf zwei Wegen. Mit Token nimmt eine Lehrkraft ihre Sitzung
  // wieder auf, etwa nach einem Verbindungsabbruch - ohne Code, sonst muesste
  // der Browser ihn dafuer aufbewahren. Ohne Token meldet sie sich neu an.
  // Eine Kennung allein genuegt nie: die kennt jede Kollegin aus der Liste.
  socket.on('login', (data) => {
    // Unbekannter oder fehlender Mandant: keine Anmeldung. Sonst landete die
    // Lehrkraft in einer fremden oder leeren Schule.
    const schulId = schuleAufloesen(data && data.schulId);
    if (!schulId) {
      socket.emit('login_failed', { grund: 'unbekannte_schule' });
      return;
    }
    const schule = SCHULEN.get(schulId);

    if (data && data.portal) {
      ueberPortalAnmelden(data, schule, schulId);
      return;
    }
    // Mit PORTAL_NUR_SSO fuehrt jeder Weg hinein ueber das Portal - auch ein
    // altes Token aus einer Code-Anmeldung zaehlt dann nicht mehr.
    if (PORTAL.nurPortal) {
      socket.emit('login_failed', { grund: 'nur_portal' });
      return;
    }
    if (data && data.token != null) {
      wiederanmelden(data, schule, schulId);
    } else {
      erstanmelden(data, schule, schulId);
    }
  });

  // Wer die Lehrkraft ist, steht schon fest: Der Handshake hat das
  // Sitzungscookie gelesen. Der Client schickt nur noch den Raum - Name und
  // Kuerzel kommen aus dem Portal, nicht aus einem Formular.
  function ueberPortalAnmelden(data, schule, schulId) {
    const sitzung = socket.data.portalToken ? sitzungen.sitzung(socket.data.portalToken) : null;
    const teacher = sitzung && sitzung.portal ? teachers.get(sitzung.teacherId) : undefined;
    if (!teacher) {
      socket.emit('login_failed', { grund: 'portal_sitzung_fehlt' });
      return;
    }
    if (teacher.schulId !== schulId) {
      socket.emit('login_failed', { grund: 'kennung_fremder_schule' });
      return;
    }

    const room = text(data.room, 30);
    if (room) teacher.room = room;
    if (!teacher.room) {
      socket.emit('login_failed', { grund: 'raum_fehlt' });
      return;
    }
    teacher.online = true;
    teacher.offlineSeit = null;
    verbinde(teacher, schule, { schluessel: sitzung.schluessel });
  }

  function wiederanmelden(data, schule, schulId) {
    const sitzung = sitzungen.sitzung(data.token);
    // Ein Portal-Token gehoert ins Cookie, nicht in die Nachricht.
    const teacher = sitzung && !sitzung.portal ? teachers.get(sitzung.teacherId) : undefined;
    // Abgelaufen, widerrufen oder nach einem Neustart unbekannt - fuer den
    // Client laeuft alles auf dasselbe hinaus: neu anmelden.
    if (!teacher) {
      socket.emit('login_failed', { grund: 'sitzung_ungueltig' });
      return;
    }
    // Eine Sitzung gehoert dauerhaft zu einer Schule. Wer denselben Browser an
    // einem fremden Link benutzt, meldet sich dort eigens an.
    if (teacher.schulId !== schulId) {
      socket.emit('login_failed', { grund: 'kennung_fremder_schule' });
      return;
    }

    // Aufnahmebereitschaft, Belegung und laufende Vorfaelle bleiben stehen -
    // der Server ist die Wahrheit, nicht der alte Schalter im Browser. Nur den
    // Raum nimmt er an: den kann die Lehrkraft geaendert haben, waehrend die
    // Verbindung weg war. Ein stillgelegter Mandant laesst die Wiederanmeldung
    // bewusst zu, sonst verschwaenden laufende Auszeiten mitten in der Stunde.
    const room = text(data.room, 30);
    if (room) teacher.room = room;
    teacher.online = true;
    teacher.offlineSeit = null;
    verbinde(teacher, schule, { schluessel: sitzung.schluessel });
  }

  function erstanmelden(data, schule, schulId) {
    const name = text(data && data.name, 60);
    if (!name) return;

    // Stillgelegt: keine neuen Anmeldungen mehr.
    if (!schule.aktiv) {
      socket.emit('login_failed', { grund: 'unbekannte_schule' });
      return;
    }

    if (schule.pin) {
      if (++pinVersucheDieserVerbindung > PIN_MAX_JE_VERBINDUNG) {
        socket.disconnect(true);
        return;
      }
      if (!gleichwertig(text(data && data.pin, 64), schule.pin)) {
        // Warten, bevor geantwortet wird - das bremst das Durchprobieren,
        // ohne jemanden auszusperren.
        const warten = pinVerzoegerung(schulId);
        merkePinFehler(schulId);
        setTimeout(() => socket.emit('login_failed', { grund: 'pin_falsch' }), warten);
        return;
      }
      pinFehler.delete(schulId);
    }

    // Eine mitgeschickte teacherId wird nicht mehr beachtet. Wer sich neu
    // anmeldet, ist eine neue Lehrkraft mit eigener Kennung - auch ein
    // aelterer Client, der noch eine Kennung aus dem Browser vorzeigt.
    const teacher = {
      id: neueKennung(),
      schulId,
      name,
      room: text(data && data.room, 30),
      isAvailable: false,
      plaetze: 0,
      betreut: [],   // ids der laufenden Vorfaelle
      online: true,
      offlineSeit: null
    };
    teachers.set(teacher.id, teacher);
    const token = sitzungen.ausstellen(teacher.id);
    verbinde(teacher, schule, { token, schluessel: sitzungen.sitzung(token).schluessel });
  }

  // Bindet diesen Socket an Lehrkraft und Sitzung. Die Sitzung merkt er sich,
  // damit eine Abmeldung genau die Tabs dieses Browsers trifft.
  function verbinde(teacher, schule, { token = null, schluessel }) {
    // Derselbe Tab kann sich ein zweites Mal anmelden, etwa nach einem
    // Doppelklick auf "Starten". Die erste Zuordnung muss dann geloest werden,
    // sonst bliebe deren Lehrkraft ohne Verbindung fuer immer "online".
    const vorher = socketToTeacher.get(socket.id);
    if (vorher && vorher !== teacher.id) loeseVerbindung(socket);

    socketToTeacher.set(socket.id, teacher.id);
    socket.data.sitzung = schluessel;
    socket.join(teacher.id);
    socket.join(`schule:${teacher.schulId}`);

    socket.emit('login_success', {
      ...oeffentlich(teacher),
      isAvailable: teacher.isAvailable,
      plaetze: teacher.plaetze,
      schulId: teacher.schulId,
      schulName: schule.name,
      demo: schule.demo,
      // Nur bei der Erstanmeldung und nur an dieses eine Geraet - nie an den
      // Raum der Lehrkraft, nie in eine Liste.
      ...(token ? { token } : {})
    });

    broadcastAvailableTeachers(teacher.schulId);
    syncUserIncidents(teacher.id);
    syncGegenseiten(teacher.id);
  }

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
    broadcastAvailableTeachers(teacher.schulId);
  });

  // Schueler zu einer Kollegin oder einem Kollegen schicken.
  socket.on('request_help', (data) => {
    const sender = aktuelleLehrkraft(socket);
    if (!sender) return;

    const receiverId = normalisiereId(data && data.receiverId);
    const kandidat = receiverId ? teachers.get(receiverId) : undefined;

    // Nie ueber die Mandantengrenze - auch nicht mit erratener Kennung. Eine
    // Lehrkraft einer fremden Schule gilt schlicht als nicht vorhanden; nach
    // aussen ist das nicht zu unterscheiden und verraet ihre Existenz nicht.
    const receiver = (kandidat && kandidat.schulId === sender.schulId) ? kandidat : undefined;

    if (!receiver || receiver.id === sender.id || !istAufnahmebereit(receiver)) {
      socket.emit('help_requested', { success: false, message: 'Kollege nicht mehr verfügbar.' });
      return;
    }

    const incident = {
      id: `v${++vorfallZaehler}`,
      schulId: sender.schulId,
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

    io.to(receiver.id).emit('incoming_student', fuerClient(incident));
    socket.emit('help_requested', { success: true, incident: fuerClient(incident) });

    syncUserIncidents(sender.id);
    syncUserIncidents(receiver.id);
    broadcastAvailableTeachers(sender.schulId);
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

    io.to(incident.senderId).emit('student_arrived', fuerClient(incident));
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
    gibPlatzFrei(incident);

    const angereichert = fuerClient(incident);
    io.to(incident.senderId).emit('student_returning', angereichert);
    socket.emit('send_back_ok', angereichert);

    syncUserIncidents(incident.senderId);
    syncUserIncidents(teacher.id);
    broadcastAvailableTeachers(teacher.schulId);
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

    io.to(incident.receiverId).emit('return_confirmed', fuerClient(incident));
    syncUserIncidents(incident.senderId);
    syncUserIncidents(incident.receiverId);
  });

  // Sendende Lehrkraft moechte den Schueler zurueck. Bewusst nur ein Wunsch und
  // kein Zustandswechsel: wann das Kind den Raum verlaesst, entscheidet weiter
  // die aufnehmende Lehrkraft, die den Schueler vor sich hat.
  socket.on('request_return', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    const incident = findeVorfall(data && data.incidentId);
    if (!teacher || !incident) return;
    if (incident.senderId !== teacher.id) return;
    if (incident.status !== BETREUT || incident.rueckholwunsch) return;

    incident.rueckholwunsch = true;
    incident.rueckholwunschSeit = new Date();

    io.to(incident.receiverId).emit('return_requested', fuerClient(incident));
    syncUserIncidents(incident.senderId);
    syncUserIncidents(incident.receiverId);
  });

  // Einseitiger Abschluss. Nur erlaubt, solange die Gegenseite offline ist -
  // ist sie erreichbar, koennte man ihr sonst einen laufenden Vorgang unter den
  // Haenden wegbeenden. Der Vorfall endet als "abgebrochen", nicht als
  // "zurueck": niemand hat die Rueckkehr bestaetigt.
  socket.on('close_incident', (data) => {
    const teacher = aktuelleLehrkraft(socket);
    const incident = findeVorfall(data && data.incidentId);
    if (!teacher || !incident) return;

    const binSender = incident.senderId === teacher.id;
    if (!binSender && incident.receiverId !== teacher.id) return;
    if (ABGESCHLOSSEN.has(incident.status)) return;

    const gegenseite = teachers.get(binSender ? incident.receiverId : incident.senderId);
    if (gegenseite && gegenseite.online) return;

    incident.status = ABGEBROCHEN;
    incident.beendetAm = new Date();
    incident.beendetVon = teacher.id;
    gibPlatzFrei(incident);

    syncUserIncidents(incident.senderId);
    syncUserIncidents(incident.receiverId);
    broadcastAvailableTeachers(teacher.schulId);
  });

  // Abmeldung: Die Sitzung dieses Browsers endet, und zwar fuer alle seine
  // Tabs - sonst bliebe auf dem Raum-PC ein zweiter Tab angemeldet. Der
  // Datensatz der Lehrkraft bleibt, solange sie noch jemanden betreut oder ein
  // Vorfall offen ist; die Gegenseite sieht sie als nicht erreichbar und kann
  // einseitig abschliessen.
  socket.on('logout', (data) => {
    // War der Tab beim Abmelden ohne Verbindung, kommt die Abmeldung erst nach
    // dem Reconnect an - auf einem Socket, der noch keiner Sitzung gehoert.
    // Dann weist das mitgeschickte Token aus, welche Sitzung endet. Sonst
    // bliebe es gueltig, obwohl der Browser es laengst verworfen hat.
    let schluessel = socket.data.sitzung;
    if (!schluessel && data && data.token) {
      const sitzung = sitzungen.sitzung(data.token);
      if (sitzung) schluessel = sitzung.schluessel;
    }
    if (schluessel) beendeSitzung(schluessel, socket);
  });

  // Der Datensatz bleibt: die Verbindung faellt staendig kurz weg, die
  // laufenden Vorfaelle sollen das ueberleben. Nur eine Wiederanmeldung setzt
  // "online" wieder auf true.
  socket.on('disconnect', () => {
    console.log('User disconnected:', socket.id);
    loeseVerbindung(socket);
  });
});

// Ist noch ein anderer Tab derselben Lehrkraft verbunden?
function hatWeitereVerbindung(teacherId) {
  for (const id of socketToTeacher.values()) {
    if (id === teacherId) return true;
  }
  return false;
}

// Loest einen Socket von seiner Lehrkraft. War es ihre letzte Verbindung, gilt
// sie als offline - die Gegenseiten ihrer Vorfaelle sehen das sofort.
function loeseVerbindung(socket) {
  const teacherId = socketToTeacher.get(socket.id);
  socketToTeacher.delete(socket.id);
  delete socket.data.sitzung;
  if (!teacherId) return;

  socket.leave(teacherId);
  const teacher = teachers.get(teacherId);
  if (!teacher) return;
  socket.leave(`schule:${teacher.schulId}`);

  if (!hatWeitereVerbindung(teacherId)) {
    teacher.online = false;
    teacher.offlineSeit = Date.now();
    syncGegenseiten(teacherId);
    broadcastAvailableTeachers(teacher.schulId);
  }
}

// Aufraeumen: Lehrkraefte, die lange offline sind und weder jemanden betreuen
// noch einen offenen Vorfall haben, fallen aus dem Speicher. Ohne das waechst
// die Map ueber den Schultag, seit der Datensatz einen Verbindungsabbruch
// ueberlebt.
const AUFRAEUM_INTERVALL_MS = dauerAusUmgebung("AUSZEIT_AUFRAEUM_MS", 30 * 60 * 1000);
const OFFLINE_GNADENFRIST_MS = 12 * 60 * 60 * 1000;

// Loescht Schuelernamen aus laengst beendeten Vorfaellen und entfernt die
// Vorfaelle danach ganz. Gibt die betroffenen Lehrkraefte zurueck, damit ihre
// Listen nicht veraltet stehenbleiben.
function raeumeVorfaelleAuf() {
  const jetzt = Date.now();
  const betroffen = new Set();
  const schulen = new Set();

  for (let i = incidents.length - 1; i >= 0; i--) {
    const v = incidents[i];
    const begonnen = new Date(v.timestamp).getTime();
    const beendet = v.beendetAm ? new Date(v.beendetAm).getTime() : null;
    const fertig = ABGESCHLOSSEN.has(v.status);

    const zuAlt = jetzt - begonnen > VORFALL_HOECHSTALTER_MS;
    const langeFertig = fertig && beendet !== null
      && jetzt - beendet > VORFALL_LOESCHEN_NACH_MS;

    if (zuAlt || langeFertig) {
      if (gibPlatzFrei(v)) schulen.add(v.schulId);
      incidents.splice(i, 1);
      betroffen.add(v.senderId).add(v.receiverId);
      continue;
    }

    if (fertig && beendet !== null && v.studentName
        && jetzt - beendet > NAME_LOESCHEN_NACH_MS) {
      v.studentName = '';
      betroffen.add(v.senderId).add(v.receiverId);
    }
  }
  return { betroffen, schulen };
}

const aufraeumer = setInterval(() => {
  const jetzt = Date.now();

  // Erst die Vorfaelle: der Lehrkraft-Durchlauf darunter prueft, ob noch ein
  // offener Vorfall an ihr haengt.
  const { betroffen, schulen } = raeumeVorfaelleAuf();

  for (const [id, teacher] of teachers) {
    if (teacher.online || teacher.betreut.length > 0) continue;
    if (jetzt - (teacher.offlineSeit || jetzt) < OFFLINE_GNADENFRIST_MS) continue;

    const hatOffenenVorfall = incidents.some(
      i => (i.senderId === id || i.receiverId === id) && !ABGESCHLOSSEN.has(i.status)
    );
    if (!hatOffenenVorfall) {
      schulen.add(teacher.schulId);
      teachers.delete(id);
      // Ein Token, das auf niemanden mehr zeigt, darf nicht liegenbleiben.
      sitzungen.widerrufeFuer(id);
    }
  }
  sitzungen.aufraeumen();

  for (const id of betroffen) syncUserIncidents(id);
  // Nur die Mandanten auffrischen, in denen sich wirklich etwas geaendert hat.
  for (const schulId of schulen) broadcastAvailableTeachers(schulId);
}, AUFRAEUM_INTERVALL_MS);
if (typeof aufraeumer.unref === 'function') aufraeumer.unref();

// --- Admin-Oberflaeche ---
//
// Nur Zahlen, keine Inhalte: die Verwaltung ist die einzige Stelle, an der
// Daten aller Mandanten zusammenlaufen.
function mandantZaehler(schulId) {
  let lehrkraefte = 0;
  for (const teacher of teachers.values()) {
    if (teacher.schulId === schulId && teacher.online) lehrkraefte += 1;
  }
  let auszeiten = 0;
  for (const vorfall of incidents) {
    if (vorfall.schulId === schulId && !ABGESCHLOSSEN.has(vorfall.status)) auszeiten += 1;
  }
  return { lehrkraefte, auszeiten };
}

const adminRouter = erstelleAdmin({
  schulen: SCHULEN,
  standard: () => standardSchule,
  setzeStandard: (id) => { standardSchule = id; },
  speichern: speichereMandanten,
  zaehler: mandantZaehler,
  speicher
});

if (adminRouter) {
  const adminPort = Number.parseInt(process.env.AUSZEIT_ADMIN_PORT, 10);
  if (Number.isFinite(adminPort) && adminPort > 0) {
    // Eigener Port: der Tunnel veroeffentlicht nur den Anwendungsport, die
    // Verwaltung bleibt damit auf das Hausnetz beschraenkt. Verwaltung braucht
    // keinen oeffentlichen Zugang, und was nicht erreichbar ist, kann nicht
    // angegriffen werden.
    const adminApp = express();
    adminApp.use('/admin', adminRouter);
    adminApp.get('/', (req, res) => res.redirect('/admin'));
    http.createServer(adminApp).listen(adminPort, () => {
      console.log(`Admin-Oberflaeche auf Port ${adminPort} (nicht veroeffentlicht)`);
    });
  } else {
    app.use('/admin', adminRouter);
    console.log('Admin-Oberflaeche unter /admin - erreichbar, wo auch die App erreichbar ist.');
  }
} else {
  console.log(`Admin-Oberflaeche abgeschaltet (AUSZEIT_ADMIN_TOKEN fehlt oder ist unter ${TOKEN_MINDESTLAENGE} Zeichen).`);
}

const PORT = process.env.PORT || 4000;

// Nur beim direkten Start lauschen. Die Tests laden den Server als Modul und
// waehlen selbst einen freien Port.
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`Server listening on port ${PORT}`);
  });
}

module.exports = { server, io };
