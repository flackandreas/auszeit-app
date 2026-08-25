import { io } from 'socket.io-client';

// Konstanten & DOM Elemente
// Ohne Argument verbindet sich Socket.IO mit der Herkunft, von der die Seite
// geladen wurde. Damit entfaellt die fest verdrahtete Adresse, die im
// Produktivbetrieb auf den Rechner der Besucherin zeigte.
const socket = io();

// Views
const loginView = document.getElementById('login-view');
const dashboardView = document.getElementById('dashboard-view');
const emergencyView = document.getElementById('emergency-view');
const notificationLayer = document.getElementById('notification-layer');

// Login Elements
const inputName = document.getElementById('teacher-name');
const inputRoom = document.getElementById('teacher-room');
const btnLogin = document.getElementById('btn-login');
const pinGruppe = document.getElementById('pin-gruppe');
const inputPin = document.getElementById('schul-pin');

// Dashboard Elements
const displayName = document.getElementById('display-name');
const displayRoom = document.getElementById('display-room');
const raumEingabe = document.getElementById("raum-eingabe");
const btnLogout = document.getElementById('btn-logout');
const statusToggle = document.getElementById('status-toggle');
const statusText = document.getElementById('status-text');
const capacitySelector = document.getElementById('capacity-selector');
const capBtns = document.querySelectorAll('.cap-btn');
const belegungText = document.getElementById('belegung');
const btnEmergency = document.getElementById('btn-emergency');

// Emergency Elements
const btnBackDashboard = document.getElementById('btn-back-dashboard');
const inputStudentName = document.getElementById('student-name');
const teachersList = document.getElementById('available-teachers-list');
const demoHinweis = document.getElementById('demo-hinweis');

// Mandanten-Anzeige
const schulName = document.getElementById('schul-name');
const schulFehler = document.getElementById('schul-fehler');
const schulKennzeichen = document.getElementById('schul-kennzeichen');

// Notification Elements
const notificationTitle = document.getElementById('notification-title');
const notificationText = document.getElementById('notification-text');
const btnNotificationAction = document.getElementById('btn-notification-action');
const toast = document.getElementById('toast');

// State
let currentUser = null;
let meinePlaetze = 0;
let availableTeachers = [];
let meineVorfaelle = [];
let overlayQueue = [];

// Zustaende eines Vorfalls. Der Hinweg und der Rueckweg sind derselbe
// zweistufige Handschlag mit vertauschten Rollen; welche Seite handeln darf,
// steht in "rolle". Ein weiterer Zustand ist damit eine Zeile, keine neue
// Verzweigung im Rendern.
const ZUSTAND = {
  unterwegs: {
    text: 'Auf dem Weg',
    klasse: 'unterwegs'
  },
  betreut: {
    text: 'In Betreuung',
    klasse: 'betreut',
    aktionen: [
      { rolle: 'empfaenger', label: 'Zurückschicken', event: 'send_back' },
      // Nur ein Wunsch: wann das Kind geht, entscheidet die aufnehmende Seite.
      // Ist sie nicht erreichbar, kaeme der Wunsch nie an - dann bleibt nur
      // der einseitige Abschluss, der ohnehin danebensteht.
      { rolle: 'sender', label: 'Zurückholen', event: 'request_return',
        nurWenn: inc => !inc.rueckholwunsch && inc.receiverOnline !== false }
    ]
  },
  auf_dem_rueckweg: {
    text: 'Auf dem Rückweg',
    klasse: 'rueckweg',
    aktionen: [
      { rolle: 'sender', label: 'Ist zurück', event: 'confirm_return' }
    ]
  },
  zurueck: {
    text: 'Zurück',
    klasse: 'zurueck'
  },
  abgebrochen: {
    text: 'Einseitig beendet',
    klasse: 'abgebrochen'
  }
};

// Endzustaende - danach ist am Vorfall nichts mehr zu tun.
const ERLEDIGT = new Set(['zurueck', 'abgebrochen']);

// Der einseitige Abschluss haengt nicht am Zustand, sondern daran, ob die
// Gegenseite ueberhaupt noch reagieren kann. Deshalb steht er neben der
// Tabelle statt in jedem Zustand wiederholt zu werden.
function darfEinseitigSchliessen(inc, binSender) {
  if (ERLEDIGT.has(inc.status)) return false;
  return binSender ? inc.receiverOnline === false : inc.senderOnline === false;
}

// --- Helper Functions ---
function switchView(viewElement) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active-view'));
  viewElement.classList.add('active-view');
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// Namen kommen von anderen Lehrkraeften und landen in innerHTML.
function escapeHtml(wert) {
  return String(wert == null ? '' : wert).replace(/[&<>"']/g, z => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]
  ));
}

// Der Mandant steckt in der Adresse: /s/<code>. Damit bleibt die Anmeldung
// bei Name und Raum - kein zusaetzliches Feld.
function schulcodeAusAdresse() {
  const treffer = location.pathname.match(/^\/s\/([A-Za-z0-9-]{2,32})\/?$/);
  return treffer ? treffer[1].toLowerCase() : '';
}

const SCHULCODE = schulcodeAusAdresse();

// Stabile Kennung des Geraets. Sie ueberlebt Reconnects und das Schliessen des
// Tabs - anders als die socket.id, an der die Vorfaelle frueher hingen.
//
// Der Schluessel haengt am Mandanten: wer denselben Browser am Link einer
// anderen Schule benutzt, bekommt dort eine eigene Kennung. Sonst truege er
// seine Kennung ueber die Grenze, und der Server wiese ihn ab.
function kennungsSchluessel() {
  return `auszeit_teacher_id${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

// Der Code liegt im Browser und geht bei jeder Anmeldung mit. Das ist noetig,
// weil die stille Wiederanmeldung nach einem Verbindungsabbruch sonst jedes Mal
// nachfragen muesste - und der Code ist ein gemeinsamer Beitrittscode des
// Kollegiums, kein persoenliches Passwort.
function pinSchluessel() {
  return `auszeit_pin${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

function gemerkterPin() {
  return localStorage.getItem(pinSchluessel()) || '';
}

function sitzungsSchluessel() {
  return `auszeit_user${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

function meineKennung() {
  const schluessel = kennungsSchluessel();
  let id = localStorage.getItem(schluessel);
  if (!id) {
    id = (crypto && typeof crypto.randomUUID === 'function')
      ? crypto.randomUUID()
      : `t-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(schluessel, id);
  }
  return id;
}

// Falscher Link oder Kennung aus einer anderen Schule: klar sagen, statt die
// Person raten zu lassen, warum keine Kollegen erscheinen.
const ABWEISUNG = {
  pin_falsch: 'Der Code stimmt nicht. Bitte beim Kollegium nachfragen.',
  unbekannte_schule: 'Dieser Link gehört zu keiner eingerichteten Schule. Bitte den Link der eigenen Schule verwenden.',
  kennung_fremder_schule: 'Dieses Gerät ist bereits bei einer anderen Schule angemeldet.'
};

function zeigeSchule(daten) {
  if (!daten || !daten.schulName) return;
  schulName.textContent = daten.schulName;
  schulName.classList.remove('hidden');
  schulKennzeichen.textContent = daten.schulName;
  schulKennzeichen.classList.remove('hidden');
  demoHinweis.classList.toggle('hidden', !daten.demo);
}

let pinNoetig = false;

// Nur zeigen, wenn die Schule einen Code verlangt und keiner gemerkt ist.
function zeigePinFeld() {
  pinGruppe.classList.toggle('hidden', !(pinNoetig && !gemerkterPin()));
}

function zeigeSchulfehler(text) {
  schulFehler.textContent = text;
  schulFehler.classList.remove('hidden');
  schulName.classList.add('hidden');
  btnLogin.disabled = true;
}

// Vor der Anmeldung fragen, wozu dieser Link gehoert. Ein falscher Link soll
// nicht erst nach dem Ausfuellen auffallen - und schon gar nicht als stille
// leere Kollegenliste.
async function schulePruefen() {
  try {
    const antwort = await fetch(`/api/schule${SCHULCODE ? '?code=' + encodeURIComponent(SCHULCODE) : ''}`);
    if (!antwort.ok) {
      zeigeSchulfehler(ABWEISUNG.unbekannte_schule);
      return null;
    }
    const schule = await antwort.json();
    zeigeSchule({ schulName: schule.name, demo: schule.demo });
    pinNoetig = Boolean(schule.pinNoetig);
    zeigePinFeld();
    return schule;
  } catch (err) {
    // Ohne Antwort nicht blockieren - die Socket-Anmeldung entscheidet dann.
    console.warn('Schulangaben nicht abrufbar:', err);
    return null;
  }
}

function schuelerName(incident) {
  return incident.studentName || 'Ein Schüler';
}

// --- Overlay-Warteschlange ---
// Frueher merkte sich der Client genau einen Vorfall. Kamen zwei Meldungen
// kurz hintereinander, ueberschrieb die zweite die erste, und der erste
// Vorfall liess sich nie mehr bestaetigen. Mit dem Rueckweg gibt es eine
// zweite Sorte Meldung, die zusaetzlich kollidieren kann.
function zeigeOverlay(eintrag) {
  if (overlayQueue.some(e => e.incidentId === eintrag.incidentId)) return;
  overlayQueue.push(eintrag);
  if (overlayQueue.length === 1) naechstesOverlay();
}

function naechstesOverlay() {
  const eintrag = overlayQueue[0];
  if (!eintrag) {
    notificationLayer.classList.add('hidden');
    return;
  }
  notificationTitle.textContent = eintrag.titel;
  notificationText.innerHTML = eintrag.text;
  btnNotificationAction.textContent = eintrag.buttonLabel;
  btnNotificationAction.disabled = false;
  notificationLayer.classList.remove('hidden');

  if (navigator.vibrate) navigator.vibrate(eintrag.vibration);
}

btnNotificationAction.addEventListener('click', () => {
  const eintrag = overlayQueue.shift();
  if (eintrag) socket.emit(eintrag.event, { incidentId: eintrag.incidentId });
  naechstesOverlay();
});

// Die Abfrage laeuft schon beim Laden los. Die Verbindung wartet sie ab, sonst
// meldete sie sich an, bevor bekannt ist, ob ein Code noetig ist - und der
// Fehlversuch liefe in die Drosselung.
const schuleGeprueft = schulePruefen();

// --- Socket.io Events ---
socket.on('connect', async () => {
  console.log('Connected to server');
  await schuleGeprueft;

  // Greift auch nach einem Reconnect: die Anmeldung stellt die Zuordnung
  // Socket -> Lehrkraft wieder her, damit Meldungen ankommen.
  const savedUser = localStorage.getItem(sitzungsSchluessel());
  if (!savedUser) return;

  const user = JSON.parse(savedUser);
  inputName.value = user.name;
  inputRoom.value = user.room;

  // Fehlt der Code, bleibt es bei der ausgefuellten Anmeldemaske: die Person
  // ergaenzt ihn und drueckt selbst auf Starten.
  if (pinNoetig && !gemerkterPin()) return;
  anmelden();
});

socket.on('login_failed', (antwort) => {
  const grund = antwort && antwort.grund;
  zeigeSchulfehler(ABWEISUNG[grund] || 'Anmeldung nicht möglich.');

  if (grund === 'pin_falsch') {
    // Der gemerkte Code taugt nicht mehr - etwa weil die Schule ihn geaendert
    // hat. Feld wieder zeigen und erneut fragen.
    localStorage.removeItem(pinSchluessel());
    pinNoetig = true;
    zeigePinFeld();
    btnLogin.disabled = false;
    inputPin.value = '';
    inputPin.focus();
  }

  localStorage.removeItem(sitzungsSchluessel());
  switchView(loginView);
});

socket.on('login_success', (user) => {
  btnLogin.disabled = false;
  schulFehler.classList.add('hidden');

  if (inputPin.value.trim()) {
    localStorage.setItem(pinSchluessel(), inputPin.value.trim());
    inputPin.value = '';
  }
  pinGruppe.classList.add('hidden');
  currentUser = user;
  localStorage.setItem(sitzungsSchluessel(), JSON.stringify({ name: user.name, room: user.room }));
  displayName.textContent = user.name;
  displayRoom.textContent = `Raum ${user.room}`;
  uebernehmeStatus(user);
  zeigeSchule(user);

  // Nach einem Reconnect nicht aus der Ansicht reissen, in der die Lehrkraft
  // gerade arbeitet.
  if (loginView.classList.contains('active-view')) switchView(dashboardView);
});

// Der Server ist die Wahrheit ueber Aufnahmebereitschaft und Plaetze, nicht
// der Schalter im Browser. Frueher lief beides auseinander, sobald der Server
// die Kapazitaet selbst veraenderte.
socket.on('status_updated', (user) => {
  currentUser = { ...currentUser, ...user };
  displayRoom.textContent = `Raum ${user.room}`;
  uebernehmeStatus(user);
});

function uebernehmeStatus(user) {
  meinePlaetze = user.plaetze || 0;
  statusToggle.checked = Boolean(user.isAvailable);
  capBtns.forEach(b => b.classList.toggle('selected', Number(b.dataset.cap) === meinePlaetze));
  zeichneStatus();
}

socket.on('available_teachers', (teachers) => {
  // Filtere mich selbst heraus
  availableTeachers = teachers.filter(t => !currentUser || t.id !== currentUser.id);
  renderTeachersList();
});

socket.on('incoming_student', (incident) => {
  zeigeOverlay({
    titel: 'Schüler auf dem Weg!',
    text: `<strong>${escapeHtml(incident.senderName)}</strong> schickt `
      + `<strong>${escapeHtml(schuelerName(incident))}</strong> zu dir.`,
    buttonLabel: 'Schüler ist angekommen',
    event: 'confirm_arrival',
    incidentId: incident.id,
    vibration: [200, 100, 200, 100, 500]
  });
});

socket.on('student_returning', (incident) => {
  zeigeOverlay({
    titel: 'Schüler kommt zurück',
    text: `<strong>${escapeHtml(incident.receiverName)}</strong> schickt `
      + `<strong>${escapeHtml(schuelerName(incident))}</strong> zu dir zurück.`,
    buttonLabel: 'Ist wieder da',
    event: 'confirm_return',
    incidentId: incident.id,
    vibration: [200, 100, 200]
  });
});

socket.on('help_requested', (response) => {
  if (response.success) {
    showToast(`Schüler auf dem Weg zu ${response.incident.receiverName}`);
    inputStudentName.value = '';
    switchView(dashboardView);
  } else {
    showToast(response.message || 'Fehler beim Senden.');
  }
});

socket.on('student_arrived', (incident) => {
  showToast(`${schuelerName(incident)} ist sicher bei ${incident.receiverName} angekommen.`);
  if (navigator.vibrate) navigator.vibrate(200);
});

// Die aufnehmende Lehrkraft muss dem Schueler sagen koennen, wohin er geht -
// und das ist der Raum, in dem die Kollegin *jetzt* unterrichtet.
// Kein Overlay: der Rueckholwunsch ist nicht dringend, und die aufnehmende
// Lehrkraft steht im Unterricht. Die Karte traegt die Marke dauerhaft.
socket.on('return_requested', (incident) => {
  showToast(`${incident.senderName} möchte ${schuelerName(incident)} zurück.`);
  if (navigator.vibrate) navigator.vibrate([120, 80, 120]);
});

socket.on('send_back_ok', (incident) => {

  const ziel = incident.senderRaum ? `, Raum ${incident.senderRaum}` : '';
  showToast(`${schuelerName(incident)} geht zurück zu ${incident.senderName}${ziel}.`);
});

socket.on('return_confirmed', (incident) => {
  showToast(`${schuelerName(incident)} ist wieder bei ${incident.senderName} angekommen.`);
});

socket.on('sync_incidents', (incidents) => {
  meineVorfaelle = incidents;
  renderVorfaelle();
  zeichneStatus();
  raeumeOverlayAuf();
});

// Ein Vorfall kann von der anderen Seite weitergedreht worden sein, waehrend
// das Overlay noch offen stand - dann hat es sich erledigt.
function raeumeOverlayAuf() {
  const vorher = overlayQueue.length;
  overlayQueue = overlayQueue.filter(eintrag => {
    const vorfall = meineVorfaelle.find(i => i.id === eintrag.incidentId);
    if (!vorfall) return true;
    const erwartet = eintrag.event === 'confirm_arrival' ? 'unterwegs' : 'auf_dem_rueckweg';
    return vorfall.status === erwartet;
  });
  if (overlayQueue.length !== vorher) naechstesOverlay();
}

// --- Rendern ---

function renderVorfaelle() {
  const container = document.getElementById('incidents-container');
  const list = document.getElementById('incidents-list');

  if (!currentUser || meineVorfaelle.length === 0) {
    container.classList.add('hidden');
    return;
  }

  container.classList.remove('hidden');
  list.innerHTML = '';

  // Laufende Vorfaelle zuerst, innerhalb der Gruppen die neuesten oben.
  const sortiert = [...meineVorfaelle].sort((a, b) => {
    const offenA = ERLEDIGT.has(a.status) ? 1 : 0;
    const offenB = ERLEDIGT.has(b.status) ? 1 : 0;
    if (offenA !== offenB) return offenA - offenB;
    return new Date(b.timestamp) - new Date(a.timestamp);
  });

  sortiert.forEach(inc => list.appendChild(vorfallKarte(inc)));
}

function vorfallKarte(inc) {
  const binSender = inc.senderId === currentUser.id;
  const zustand = ZUSTAND[inc.status] || ZUSTAND.unterwegs;

  const zeit = new Date(inc.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const gegenueberName = binSender ? inc.receiverName : inc.senderName;
  const gegenueberRaum = binSender ? inc.receiverRaum : inc.senderRaum;
  const richtung = binSender ? 'An' : 'Von';
  const raum = gegenueberRaum ? ` · Raum ${escapeHtml(gegenueberRaum)}` : '';

  // Der Rueckholwunsch ist bewusst nur eine Marke auf der Karte: die
  // aufnehmende Lehrkraft unterrichtet gerade, ein Vollbild waere zu viel.
  const wunschMarke = (inc.rueckholwunsch && inc.status === 'betreut')
    ? `<span class="status-badge wunsch">${binSender ? 'Rückholung angefragt' : 'Soll zurückkommen'}</span>`
    : '';

  // Macht sichtbar, warum der einseitige Abschluss angeboten wird.
  const gegenseiteOffline = binSender ? inc.receiverOnline === false : inc.senderOnline === false;
  const offlineMarke = (gegenseiteOffline && !ERLEDIGT.has(inc.status))
    ? '<span class="status-badge offline">nicht erreichbar</span>'
    : '';


  const el = document.createElement('div');
  el.className = `incident-item ${binSender ? 'sent' : 'received'}`;
  el.innerHTML = `
    <div class="incident-meta">
      <span>${richtung}: ${escapeHtml(gegenueberName)}${raum}</span>
      <span>${zeit}</span>
    </div>
    <div><strong>${escapeHtml(schuelerName(inc))}</strong></div>
    <div class="incident-meta mt-1">
      <span class="status-badge ${zustand.klasse}">${zustand.text}</span>
      ${wunschMarke}${offlineMarke}
    </div>
  `;

  // Handeln darf nur, wen der Zustand vorsieht - die sendende Seite bestaetigt
  // die Rueckkehr, die aufnehmende schickt zurueck.
  const aktionen = (zustand.aktionen || []).filter(a =>
    (a.rolle === 'sender') === binSender && (!a.nurWenn || a.nurWenn(inc))
  );

  if (darfEinseitigSchliessen(inc, binSender)) {
    aktionen.push({ label: 'Einseitig abschließen', event: 'close_incident', still: true });
  }

  if (aktionen.length > 0) {
    const leiste = document.createElement('div');
    leiste.className = 'incident-aktionen';
    aktionen.forEach(aktion => {
      const btn = document.createElement('button');
      btn.className = `btn btn-klein${aktion.still ? ' btn-still' : ''}`;
      btn.textContent = aktion.label;
      btn.addEventListener('click', () => {
        leiste.querySelectorAll('button').forEach(b => { b.disabled = true; });
        socket.emit(aktion.event, { incidentId: inc.id });
      });
      leiste.appendChild(btn);
    });
    el.appendChild(leiste);
  }

  return el;
}

function belegtePlaetze() {
  if (!currentUser) return 0;
  return meineVorfaelle.filter(i =>
    i.receiverId === currentUser.id && (i.status === 'unterwegs' || i.status === 'betreut')
  ).length;
}

// Zeigt Bereitschaft und Belegung zusammen an. Ohne das bleibt unklar, warum
// man trotz gruenem Schalter nicht mehr in der Liste der anderen auftaucht.
function zeichneStatus() {
  const belegt = belegtePlaetze();

  if (statusToggle.checked) {
    statusText.textContent = 'Bereit zur Aufnahme';
    statusText.className = 'status-text text-green';
    capacitySelector.classList.remove('hidden');
  } else {
    statusText.textContent = 'Keine Aufnahme';
    statusText.className = 'status-text text-red';
    capacitySelector.classList.add('hidden');
  }

  if (belegt > 0) {
    const frei = Math.max(0, meinePlaetze - belegt);
    belegungText.textContent = `${belegt} von ${meinePlaetze} Plätzen belegt`
      + (statusToggle.checked && frei === 0 ? ' — aktuell kein freier Platz' : '');
    belegungText.classList.remove('hidden');
  } else {
    belegungText.textContent = "";
    belegungText.classList.add("hidden");
  }
}

function renderTeachersList() {
  teachersList.innerHTML = '';
  if (availableTeachers.length === 0) {
    teachersList.innerHTML = '<div class="empty-state">Aktuell keine Kollegen verfügbar.</div>';
    return;
  }

  availableTeachers.forEach(teacher => {
    const el = document.createElement('div');
    el.className = 'teacher-item';
    el.innerHTML = `
      <div class="t-info">
        <span class="t-name">${escapeHtml(teacher.name)}</span>
        <span class="t-room">Raum ${escapeHtml(teacher.room)}</span>
      </div>
      <div class="t-cap">${teacher.capacity} Platz</div>
    `;

    el.addEventListener('click', () => {
      socket.emit('request_help', {
        studentName: inputStudentName.value.trim(),
        receiverId: teacher.id
      });
    });

    teachersList.appendChild(el);
  });
}

// --- UI Event Listeners ---

function anmelden() {
  const name = inputName.value.trim();
  const room = inputRoom.value.trim();
  if (name && room) {
    socket.emit('login', {
      teacherId: meineKennung(),
      schulId: SCHULCODE,
      pin: inputPin.value.trim() || gemerkterPin(),
      name,
      room
    });
  } else {
    showToast('Bitte Name und Raum eingeben.');
  }
}

btnLogin.addEventListener('click', anmelden);

// Logout
btnLogout.addEventListener('click', () => {
  socket.emit('logout');
  localStorage.removeItem(sitzungsSchluessel());
  // Die Geraetekennung bleibt bewusst stehen: sie identifiziert das Geraet,
  // nicht die Person, und wird bei der naechsten Anmeldung wiederverwendet.
  currentUser = null;
  meineVorfaelle = [];
  meinePlaetze = 0;
  overlayQueue = [];
  notificationLayer.classList.add('hidden');
  statusToggle.checked = false;
  capBtns.forEach(b => b.classList.remove('selected'));
  zeichneStatus();
  renderVorfaelle();
  switchView(loginView);
});

// Status Toggle
statusToggle.addEventListener('change', () => {
  if (statusToggle.checked && meinePlaetze === 0) {
    // Voreinstellung: ein Platz.
    capBtns[0].click();
    return;
  }
  if (!statusToggle.checked) meinePlaetze = 0;
  capBtns.forEach(b => b.classList.toggle('selected', Number(b.dataset.cap) === meinePlaetze));
  zeichneStatus();
  updateStatusOnServer();
});

// Capacity Buttons
capBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    meinePlaetze = parseInt(btn.dataset.cap, 10);
    capBtns.forEach(b => b.classList.toggle('selected', b === btn));
    zeichneStatus();
    updateStatusOnServer();
  });
});

function updateStatusOnServer() {
  socket.emit('update_status', {
    isAvailable: statusToggle.checked,
    capacity: meinePlaetze,
    room: currentUser && currentUser.room
  });
}

// --- Raumwechsel ---
// Die Lehrkraft unterrichtet naechste Stunde woanders. Ohne diese Moeglichkeit
// bliebe der Raum auf dem Stand der Anmeldung - und die Rueckmeldung schickte
// den Schueler dorthin zurueck.
displayRoom.addEventListener("click", () => {
  if (!currentUser) return;
  raumEingabe.value = currentUser.room || "";
  displayRoom.classList.add("hidden");
  raumEingabe.classList.remove("hidden");
  raumEingabe.focus();
  raumEingabe.select();
});

function raumBearbeitungBeenden() {
  raumEingabe.classList.add("hidden");
  displayRoom.classList.remove("hidden");
}

function raumUebernehmen() {
  if (raumEingabe.classList.contains("hidden")) return;
  const neu = raumEingabe.value.trim();
  raumBearbeitungBeenden();
  if (!neu || !currentUser || neu === currentUser.room) return;

  currentUser.room = neu;
  displayRoom.textContent = `Raum `;
  localStorage.setItem(sitzungsSchluessel(), JSON.stringify({ name: currentUser.name, room: neu }));
  updateStatusOnServer();
}

raumEingabe.addEventListener("blur", raumUebernehmen);
raumEingabe.addEventListener("keydown", (e) => {
  if (e.key === "Enter") raumUebernehmen();
  if (e.key === "Escape") raumBearbeitungBeenden();
});

// Emergency Navigation
btnEmergency.addEventListener('click', () => {
  switchView(emergencyView);
  // Optional: Auto-focus Name input, but on mobile it brings up keyboard and hides list
});

btnBackDashboard.addEventListener('click', () => {
  switchView(dashboardView);
});
