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
const nameGruppe = document.getElementById('name-gruppe');
const raumGruppe = document.getElementById('raum-gruppe');
const btnPortal = document.getElementById('btn-portal');
const portalTrenner = document.getElementById('portal-trenner');
const abmeldeFormular = document.getElementById('abmelde-formular');

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
const namensfeld = document.getElementById('namensfeld');
const schuelerAuswahl = document.getElementById('schueler-auswahl');
const schuelerGewaehlt = document.getElementById('schueler-gewaehlt');
const schuelerSuche = document.getElementById('schueler-suche');
const klassenLeiste = document.getElementById('klassen-leiste');
const schuelerRaster = document.getElementById('schueler-raster');
const listeLeer = document.getElementById('liste-leer');

// Schuelerliste einfuegen
const schuelerView = document.getElementById('schueler-view');
const btnSchuelerliste = document.getElementById('btn-schuelerliste');
const btnZurueckListe = document.getElementById('btn-zurueck-liste');
const listeStand = document.getElementById('liste-stand');
const listeEingabe = document.getElementById('liste-eingabe');
const btnVorschau = document.getElementById('btn-vorschau');
const vorschauKarte = document.getElementById('vorschau');
const vorschauInhalt = document.getElementById('vorschau-inhalt');
const btnUebernehmen = document.getElementById('btn-uebernehmen');

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

// Sitzungsnachweis dieses Geraets. Der Server stellt das Token bei der
// Anmeldung aus; damit kommt der Tab nach einem Reconnect wieder in seine
// Sitzung. Frueher erzeugte der Browser stattdessen selbst eine Kennung und
// zeigte sie als Nachweis vor - dieselbe Kennung, die jede Kollegin in der
// Liste der aufnahmebereiten Lehrkraefte sieht.
//
// Der Schluessel haengt am Mandanten: wer denselben Browser am Link einer
// anderen Schule benutzt, meldet sich dort eigens an.
function tokenSchluessel() {
  return `auszeit_token${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

// Name und Raum, nur zum Vorbelegen der Anmeldemaske. Sie weisen nichts nach.
function sitzungsSchluessel() {
  return `auszeit_user${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

function gespeicherteAngaben() {
  try {
    return JSON.parse(localStorage.getItem(sitzungsSchluessel()) || 'null');
  } catch (err) {
    return null;
  }
}

// Der Beitrittscode bleibt nur bis zur erfolgreichen Anmeldung in der Seite,
// nie im Browser. Frueher lag er dauerhaft im localStorage - auf einem Raum-PC
// fuer jede Person lesbar, die nach einem an den Rechner kommt. Die
// Wiederanmeldung nach einem Verbindungsabbruch braucht ihn nicht mehr, die
// erledigt das Token.
let anmeldePin = '';

// Aeltere Versionen haben Code und Kennung dauerhaft abgelegt. Beides
// verschwindet hier. Den Code dieser Schule nimmt die Seite ein letztes Mal
// fuer die Anmeldung mit, damit nach dem Update niemand nachfragen muss.
(function altlastenEntfernen() {
  const alterPin = localStorage.getItem(`auszeit_pin${SCHULCODE ? ':' + SCHULCODE : ''}`);
  if (alterPin) anmeldePin = alterPin;
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const schluessel = localStorage.key(i) || '';
    if (schluessel.startsWith('auszeit_pin') || schluessel.startsWith('auszeit_teacher_id')) {
      localStorage.removeItem(schluessel);
    }
  }
})();

// Falscher Link oder Kennung aus einer anderen Schule: klar sagen, statt die
// Person raten zu lassen, warum keine Kollegen erscheinen.
const ABWEISUNG = {
  pin_falsch: 'Der Code stimmt nicht. Bitte beim Kollegium nachfragen.',
  unbekannte_schule: 'Dieser Link gehört zu keiner eingerichteten Schule. Bitte den Link der eigenen Schule verwenden.',
  kennung_fremder_schule: 'Dieses Gerät ist bereits bei einer anderen Schule angemeldet.',
  sitzung_ungueltig: 'Die Anmeldung ist abgelaufen. Bitte den Code der Schule erneut eingeben.',
  nur_portal: 'An dieser Schule läuft die Anmeldung über das SchulOS-Portal.',
  portal_sitzung_fehlt: 'Die Anmeldung ist abgelaufen. Bitte erneut über das Portal anmelden.',
  raum_fehlt: 'Bitte den aktuellen Raum eingeben.',
  portal_schleife: 'Die Anmeldung über das Portal hat nicht geklappt. Bitte erneut versuchen.'
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

// --- Anmeldung ueber das SchulOS-Portal ---
//
// Haengt Auszeit am Portal, kommen Name und Kuerzel von dort, gefragt wird nur
// noch der Raum. Wer die Lehrkraft ist, steht in einem Cookie, das dieses
// Skript nie zu sehen bekommt (HttpOnly) - der Server liest es selbst.
let portalAktiv = false;
let nurPortal = false;
let portalIch = null; // { name, kuerzel, raum } bei bestehender Portalsitzung

async function portalSitzungLaden() {
  portalIch = null;
  if (!portalAktiv) return;
  try {
    const antwort = await fetch('/api/sitzung', { cache: 'no-store' });
    if (antwort.ok) portalIch = await antwort.json();
  } catch (err) {
    console.warn('Portalsitzung nicht abrufbar:', err);
  }
}

// Welche Teile der Anmeldemaske gebraucht werden. Das Codefeld ist sichtbar,
// sobald die Schule einen Code verlangt; gebraucht wird er bei jeder
// Neuanmeldung, nicht bei der stillen Wiederanmeldung nach einem Abbruch.
function zeigeAnmeldeweg() {
  const ueberPortal = Boolean(portalAktiv && portalIch);
  const mitCode = !nurPortal && !ueberPortal;

  btnPortal.classList.toggle('hidden', !portalAktiv || ueberPortal);
  portalTrenner.classList.toggle('hidden', !(portalAktiv && mitCode));
  nameGruppe.classList.toggle('hidden', !ueberPortal && !mitCode);
  raumGruppe.classList.toggle('hidden', !ueberPortal && !mitCode);
  btnLogin.classList.toggle('hidden', !ueberPortal && !mitCode);
  pinGruppe.classList.toggle('hidden', !mitCode || !pinNoetig);

  // Der Name kommt aus dem Portal und laesst sich hier nicht aendern.
  inputName.readOnly = ueberPortal;
  if (ueberPortal) inputName.value = portalIch.name;
}

// Mit PORTAL_NUR_SSO gibt es nur diesen einen Weg - also gleich dorthin. Kommt
// der Browser binnen einer Minute ohne Sitzung zurueck, stimmt etwas nicht
// (etwa ein Cookie, das nicht ankommt); dann bleibt die Seite stehen, statt
// im Kreis zu laufen.
const UMLEITUNG = 'auszeit_portal_umleitung';

function zumPortal() {
  let zuletzt = 0;
  try { zuletzt = Number(sessionStorage.getItem(UMLEITUNG)) || 0; } catch (err) { /* ohne Speicher: einmal versuchen */ }
  if (Date.now() - zuletzt < 60 * 1000) {
    zeigeSchulfehler(ABWEISUNG.portal_schleife);
    return;
  }
  try { sessionStorage.setItem(UMLEITUNG, String(Date.now())); } catch (err) { /* siehe oben */ }
  location.assign('/sso/start');
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
    portalAktiv = Boolean(schule.portal);
    nurPortal = Boolean(schule.nurPortal);
    await portalSitzungLaden();
    zeigeAnmeldeweg();
    if (nurPortal && !portalIch) zumPortal();
    return schule;
  } catch (err) {
    // Ohne Antwort nicht blockieren - die Socket-Anmeldung entscheidet dann.
    console.warn('Schulangaben nicht abrufbar:', err);
    return null;
  }
}

function schuelerName(incident) {
  if (!incident.studentName) return 'Ein Schüler';
  return incident.klasse ? `${incident.studentName} (${incident.klasse})` : incident.studentName;
}

// --- Schuelerliste ---
//
// Im Schulbetrieb waehlt die Lehrkraft den Schueler aus der Liste statt den
// Namen zu tippen: Freitext machte das Protokoll unbrauchbar. Ziel sind zwei
// Tipps mitten in der Stunde - die zuletzt genutzte Klasse ist vorausgewaehlt,
// dann der Schueler, dann die Kollegin.
let listenModus = false;
let istVerwaltung = false;
let schuelerliste = [];
let gewaehlt = null; // ein Schueler, 'ohne' oder null
let aktiveKlasse = '';

function klassenSchluessel() {
  return `auszeit_klasse${SCHULCODE ? ':' + SCHULCODE : ''}`;
}

function klassenDerListe() {
  return [...new Set(schuelerliste.map(s => s.klasse))];
}

// Fuer die Suche: Gross/klein, Umlaute und Akzente zaehlen nicht.
function suchform(text) {
  return String(text).toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
}

function zeigeGewaehlt() {
  if (gewaehlt === 'ohne') {
    schuelerGewaehlt.textContent = 'ohne Namen';
  } else if (gewaehlt) {
    schuelerGewaehlt.textContent = `${gewaehlt.vorname} ${gewaehlt.nachname} · ${gewaehlt.klasse}`;
  } else {
    schuelerGewaehlt.textContent = schuelerliste.length ? 'bitte antippen' : '';
  }
  schuelerGewaehlt.classList.toggle('gewaehlt', Boolean(gewaehlt));
}

function schuelerKnopf(text, unterzeile, istGewaehlt, beimTippen, still = false) {
  const knopf = document.createElement('button');
  knopf.type = 'button';
  knopf.className = `schueler-knopf${istGewaehlt ? ' gewaehlt' : ''}${still ? ' still' : ''}`;
  knopf.textContent = text;
  if (unterzeile) {
    const marke = document.createElement('span');
    marke.className = 'klasse-marke';
    marke.textContent = unterzeile;
    knopf.appendChild(marke);
  }
  knopf.addEventListener('click', beimTippen);
  return knopf;
}

function zeichneAuswahl() {
  namensfeld.classList.toggle('hidden', listenModus);
  schuelerAuswahl.classList.toggle('hidden', !listenModus);
  if (!listenModus) return;

  const leer = schuelerliste.length === 0;
  listeLeer.classList.toggle('hidden', !leer);
  schuelerSuche.classList.toggle('hidden', leer);
  zeigeGewaehlt();

  const klassen = klassenDerListe();
  if (!klassen.includes(aktiveKlasse)) aktiveKlasse = klassen[0] || '';
  const suche = suchform(schuelerSuche.value.trim());

  klassenLeiste.innerHTML = '';
  for (const klasse of klassen) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = `chip${!suche && klasse === aktiveKlasse ? ' aktiv' : ''}`;
    chip.textContent = klasse;
    chip.setAttribute('role', 'tab');
    chip.setAttribute('aria-selected', String(!suche && klasse === aktiveKlasse));
    chip.addEventListener('click', () => {
      aktiveKlasse = klasse;
      try { localStorage.setItem(klassenSchluessel(), klasse); } catch (err) { /* nur Bequemlichkeit */ }
      schuelerSuche.value = '';
      zeichneAuswahl();
    });
    klassenLeiste.appendChild(chip);
  }

  // Mit Suchbegriff ueber alle Klassen, sonst die gewaehlte Klasse.
  const treffer = suche
    ? schuelerliste.filter(s => suchform(`${s.vorname} ${s.nachname}`).includes(suche))
    : schuelerliste.filter(s => s.klasse === aktiveKlasse);

  schuelerRaster.innerHTML = '';
  for (const s of treffer) {
    schuelerRaster.appendChild(schuelerKnopf(
      `${s.vorname} ${s.nachname}`,
      suche ? s.klasse : '',
      gewaehlt && gewaehlt !== 'ohne' && gewaehlt.kennung === s.kennung,
      () => { gewaehlt = s; zeichneAuswahl(); }
    ));
  }
  // Fuer jemanden, der (noch) nicht auf der Liste steht.
  if (!leer) {
    schuelerRaster.appendChild(schuelerKnopf('Ohne Namen', '', gewaehlt === 'ohne',
      () => { gewaehlt = 'ohne'; zeichneAuswahl(); }, true));
  }
}

function auswahlZuruecksetzen() {
  gewaehlt = null;
  schuelerSuche.value = '';
  try { aktiveKlasse = localStorage.getItem(klassenSchluessel()) || aktiveKlasse; } catch (err) { /* siehe oben */ }
  zeichneAuswahl();
}

schuelerSuche.addEventListener('input', zeichneAuswahl);

socket.on('schuelerliste', (liste) => {
  schuelerliste = Array.isArray(liste) ? liste : [];
  // Wurde der gewaehlte Schueler gerade archiviert, gilt die Wahl nicht mehr.
  if (gewaehlt && gewaehlt !== 'ohne' && !schuelerliste.some(s => s.kennung === gewaehlt.kennung)) gewaehlt = null;
  zeichneAuswahl();
  zeichneListenStand();
});

// --- Schuelerliste einfuegen (Rolle Verwaltung) ---

function zeichneListenStand() {
  if (schuelerliste.length === 0) {
    listeStand.textContent = 'Noch keine Schülerliste.';
    return;
  }
  const jeKlasse = klassenDerListe()
    .map(k => `${k}: ${schuelerliste.filter(s => s.klasse === k).length}`).join(' · ');
  listeStand.textContent = `Aktuell ${schuelerliste.length} Schüler – ${jeKlasse}`;
}

function vorschauGruppe(titel, eintraege, warnung = false) {
  if (eintraege.length === 0) return null;
  const gruppe = document.createElement('div');
  gruppe.className = `vorschau-gruppe${warnung ? ' warnung' : ''}`;
  const kopf = document.createElement('h4');
  kopf.textContent = `${titel} (${eintraege.length})`;
  const liste = document.createElement('ul');
  for (const text of eintraege) {
    const punkt = document.createElement('li');
    punkt.textContent = text;
    liste.appendChild(punkt);
  }
  gruppe.append(kopf, liste);
  return gruppe;
}

function zeigeVorschau(v) {
  vorschauInhalt.innerHTML = '';
  const zahlen = document.createElement('div');
  zahlen.className = 'vorschau-zahlen';
  const zahl = (text, warnung = false) => {
    const el = document.createElement('span');
    el.className = `vorschau-zahl${warnung ? ' warnung' : ''}`;
    el.textContent = text;
    zahlen.appendChild(el);
  };
  zahl(`${v.neu.length} neu`);
  zahl(`${v.bleibt} unverändert`);
  if (v.reaktiviert.length) zahl(`${v.reaktiviert.length} wieder aufgenommen`);
  if (v.archiviert.length) zahl(`${v.archiviert.length} archiviert`, true);
  if (v.fehler.length) zahl(`${v.fehler.length} nicht erkannt`, true);

  const klassen = document.createElement('p');
  klassen.className = 'liste-hinweis';
  klassen.textContent = `Klassen im Import: ${v.jeKlasse.map(k => `${k.klasse} (${k.anzahl})`).join(', ')}`;

  const name = e => `${e.klasse} · ${e.name}`;
  vorschauInhalt.append(...[
    zahlen,
    klassen,
    // Archivieren zuerst: eine unvollstaendige Liste archiviert den Rest der
    // Klasse - das soll niemand uebersehen.
    vorschauGruppe('Wird archiviert', v.archiviert.map(name), true),
    vorschauGruppe('Nicht erkannt', v.fehler.map(f => `Zeile ${f.zeile}: ${f.text} – ${f.grund}`), true),
    vorschauGruppe('Neu', v.neu.map(name)),
    vorschauGruppe('Wieder aufgenommen', v.reaktiviert.map(name))
  ].filter(Boolean));
  vorschauKarte.classList.remove('hidden');
}

const LISTE_GRUND = {
  keine_berechtigung: 'Die Schülerliste darf nur die Verwaltung ändern.',
  leer: 'In der Liste wurde keine Zeile erkannt.'
};

btnVorschau.addEventListener('click', async () => {
  btnVorschau.disabled = true;
  try {
    const antwort = await socket.timeout(10000).emitWithAck('schueler_vorschau', { text: listeEingabe.value });
    if (antwort.ok) zeigeVorschau(antwort.vorschau);
    else showToast(LISTE_GRUND[antwort.grund] || 'Vorschau nicht möglich.');
  } catch (err) {
    showToast('Keine Antwort vom Server.');
  } finally {
    btnVorschau.disabled = false;
  }
});

btnUebernehmen.addEventListener('click', async () => {
  btnUebernehmen.disabled = true;
  try {
    const antwort = await socket.timeout(10000).emitWithAck('schueler_uebernehmen', { text: listeEingabe.value });
    if (antwort.ok) {
      const e = antwort.ergebnis;
      showToast(`Übernommen: ${e.neu} neu, ${e.archiviert} archiviert, ${e.bleibt + e.reaktiviert} bestätigt.`);
      listeEingabe.value = '';
      vorschauKarte.classList.add('hidden');
    } else {
      showToast(LISTE_GRUND[antwort.grund] || 'Übernehmen nicht möglich.');
    }
  } catch (err) {
    showToast('Keine Antwort vom Server.');
  } finally {
    btnUebernehmen.disabled = false;
  }
});

// Eine geaenderte Liste macht die Vorschau ungueltig - uebernommen wird nur,
// was vorher zu sehen war.
listeEingabe.addEventListener('input', () => vorschauKarte.classList.add('hidden'));

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

  // Die Maske vorbelegen: Klappt die Wiederanmeldung nicht, steht sie schon
  // ausgefuellt da, und es fehlt hoechstens der Code.
  const gespeichert = gespeicherteAngaben();
  if (gespeichert) {
    if (!inputName.readOnly) inputName.value = gespeichert.name || '';
    inputRoom.value = gespeichert.room || '';
  }

  // Ueber das Portal: Wer die Lehrkraft ist, weiss der Server aus dem Cookie.
  // Fehlt beim ersten Mal noch der Raum, bleibt es bei der Maske.
  if (portalIch) {
    const raum = inputRoom.value.trim() || portalIch.raum;
    if (raum) socket.emit('login', { portal: true, schulId: SCHULCODE, room: raum });
    return;
  }
  if (nurPortal) return;

  // Greift auch nach einem Reconnect: die Wiederanmeldung stellt die Zuordnung
  // Socket -> Lehrkraft wieder her, damit Meldungen ankommen. Den Raum schickt
  // sie mit, falls er waehrend des Abbruchs geaendert wurde.
  const token = localStorage.getItem(tokenSchluessel());
  if (token) {
    socket.emit('login', { token, schulId: SCHULCODE, room: gespeichert ? gespeichert.room : '' });
    return;
  }

  // Ohne Sitzung still neu anmelden, wenn alles da ist. Fehlt der Code, bleibt
  // es bei der ausgefuellten Maske: die Person ergaenzt ihn und drueckt selbst
  // auf Starten.
  if (!gespeichert) return;
  if (pinNoetig && !anmeldePin) return;
  anmelden();
});

socket.on('login_failed', (antwort) => {
  const grund = antwort && antwort.grund;
  // Ein abgewiesenes Token taugt nicht mehr, gleich aus welchem Grund.
  localStorage.removeItem(tokenSchluessel());

  if (grund === 'portal_sitzung_fehlt') {
    // Abgelaufen, im Portal abgemeldet oder der Server wurde neu gestartet.
    portalIch = null;
    zurAnmeldung();
    if (nurPortal) {
      zumPortal();
    } else {
      zeigeSchulfehler(ABWEISUNG.portal_sitzung_fehlt);
      btnLogin.disabled = false;
    }
    return;
  }

  if (grund === 'raum_fehlt') {
    zeigeSchulfehler(ABWEISUNG.raum_fehlt);
    btnLogin.disabled = false;
    switchView(loginView);
    inputRoom.focus();
    return;
  }

  if (grund === 'sitzung_ungueltig') {
    // Abgelaufen, anderswo abgemeldet oder der Server wurde neu gestartet. Der
    // alte Stand gehoert zur alten Sitzung und wird verworfen.
    zuruecksetzen();
    // Ohne Code geht es still mit einer neuen Anmeldung weiter, wie bisher.
    if (inputName.value.trim() && inputRoom.value.trim() && (!pinNoetig || anmeldePin)) {
      anmelden();
      return;
    }
    // Mit Code muss die Lehrkraft ihn erneut eingeben - er liegt ja nicht
    // mehr im Browser. Name und Raum bleiben stehen.
    zeigeSchulfehler(ABWEISUNG.sitzung_ungueltig);
    btnLogin.disabled = false;
    switchView(loginView);
    inputPin.focus();
    return;
  }

  zeigeSchulfehler(ABWEISUNG[grund] || 'Anmeldung nicht möglich.');

  if (grund === 'pin_falsch') {
    // Der Code taugt nicht - vertippt, oder die Schule hat ihn geaendert.
    // Feld wieder zeigen und erneut fragen.
    anmeldePin = '';
    pinNoetig = true;
    zeigeAnmeldeweg();
    btnLogin.disabled = false;
    inputPin.value = '';
    inputPin.focus();
  }

  localStorage.removeItem(sitzungsSchluessel());
  zurAnmeldung();
});

socket.on('login_success', (antwort) => {
  btnLogin.disabled = false;
  schulFehler.classList.add('hidden');

  // Das Token kommt nur bei der Erstanmeldung. Ab jetzt weist es dieses
  // Geraet aus; der Code hat seinen Dienst getan und wird vergessen.
  const { token, ...user } = antwort;
  if (token) localStorage.setItem(tokenSchluessel(), token);
  anmeldePin = '';
  inputPin.value = '';
  pinGruppe.classList.add('hidden');
  try { sessionStorage.removeItem(UMLEITUNG); } catch (err) { /* nichts zu tun */ }
  currentUser = user;
  localStorage.setItem(sitzungsSchluessel(), JSON.stringify({ name: user.name, room: user.room }));
  displayName.textContent = user.name;
  displayRoom.textContent = `Raum ${user.room}`;
  uebernehmeStatus(user);
  zeigeSchule(user);
  listenModus = Boolean(user.listenModus);
  istVerwaltung = Boolean(user.verwaltung);
  btnSchuelerliste.classList.toggle('hidden', !(listenModus && istVerwaltung));
  zeichneAuswahl();

  // Nach einem Reconnect nicht aus der Ansicht reissen, in der die Lehrkraft
  // gerade arbeitet.
  if (loginView.classList.contains('active-view')) switchView(dashboardView);
});

// Ein anderer Tab dieser Sitzung hat sich abgemeldet - das Token ist damit
// widerrufen. Dieser Tab darf nicht angemeldet weiterlaufen. Den Browser hat
// der andere Tab schon aufgeraeumt.
socket.on('logged_out', async () => {
  // Kam die Abmeldung aus dem Portal, hat in diesem Browser niemand
  // aufgeraeumt. Der Name der Lehrkraft soll auf einem Raum-PC nicht fuer
  // die naechste Person in der Maske stehen bleiben.
  if (portalIch) {
    localStorage.removeItem(sitzungsSchluessel());
    inputName.value = '';
  }
  zurAnmeldung();
  // Bei einer Abmeldung im Portal ist auch das Cookie weg - die Maske zeigt
  // dann wieder den Weg ueber das Portal.
  await portalSitzungLaden();
  zeigeAnmeldeweg();
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
    auswahlZuruecksetzen();
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
      if (listenModus) {
        // Ohne Wahl wird nicht geschickt: ein versehentlicher Tipp auf die
        // Kollegin soll keine Auszeit ohne Namen ausloesen.
        if (schuelerliste.length > 0 && !gewaehlt) {
          showToast('Bitte zuerst den Schüler antippen – oder „Ohne Namen“.');
          return;
        }
        socket.emit('request_help', {
          receiverId: teacher.id,
          ...(gewaehlt && gewaehlt !== 'ohne' ? { schuelerKennung: gewaehlt.kennung } : {})
        });
        return;
      }
      socket.emit('request_help', {
        studentName: inputStudentName.value.trim(),
        receiverId: teacher.id
      });
    });

    teachersList.appendChild(el);
  });
}

// --- UI Event Listeners ---

// Neuanmeldung mit Name, Raum und Code. Eine Kennung schickt der Client nicht
// mehr mit - die vergibt der Server.
function anmelden() {
  const name = inputName.value.trim();
  const room = inputRoom.value.trim();
  if (portalIch) {
    if (room) socket.emit('login', { portal: true, schulId: SCHULCODE, room });
    else showToast('Bitte den Raum eingeben.');
    return;
  }
  if (name && room) {
    // Der Code wird gebraucht, bis die Anmeldung durch ist - auch ueber einen
    // Verbindungsabbruch hinweg. Danach vergisst ihn die Seite.
    const pin = inputPin.value.trim();
    if (pin) anmeldePin = pin;
    socket.emit('login', { schulId: SCHULCODE, pin: anmeldePin, name, room });
  } else {
    showToast('Bitte Name und Raum eingeben.');
  }
}

btnLogin.addEventListener('click', anmelden);

// Verwirft alles, was zur bisherigen Sitzung gehoert.
function zuruecksetzen() {
  currentUser = null;
  listenModus = false;
  istVerwaltung = false;
  schuelerliste = [];
  gewaehlt = null;
  btnSchuelerliste.classList.add('hidden');
  meineVorfaelle = [];
  meinePlaetze = 0;
  overlayQueue = [];
  notificationLayer.classList.add('hidden');
  statusToggle.checked = false;
  capBtns.forEach(b => b.classList.remove('selected'));
  zeigeAnmeldeweg();
  zeichneStatus();
  renderVorfaelle();
}

function zurAnmeldung() {
  zuruecksetzen();
  switchView(loginView);
}

// Logout
btnLogout.addEventListener('click', () => {
  // Ueber das Portal angemeldet: Der Server beendet die Sitzung und schickt
  // den Browser weiter zum Portal, das dann auch alle anderen Module abmeldet.
  // Dafuer braucht es eine echte Navigation, keine Socket-Nachricht.
  if (portalIch) {
    localStorage.removeItem(sitzungsSchluessel());
    abmeldeFormular.submit();
    return;
  }
  // Das Token geht mit: Ist die Verbindung gerade weg, kommt die Abmeldung
  // erst nach dem Reconnect an, und erst das Token sagt dem Server, wessen
  // Sitzung er widerrufen soll.
  socket.emit('logout', { token: localStorage.getItem(tokenSchluessel()) });
  // Die naechste Anmeldung auf diesem Geraet ist eine neue. Auf einem Raum-PC
  // soll niemand die Sitzung der Kollegin vor ihm weiterfuehren.
  localStorage.removeItem(tokenSchluessel());
  localStorage.removeItem(sitzungsSchluessel());
  zurAnmeldung();
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
  auswahlZuruecksetzen();
  switchView(emergencyView);
  // Optional: Auto-focus Name input, but on mobile it brings up keyboard and hides list
});

btnSchuelerliste.addEventListener('click', () => {
  zeichneListenStand();
  switchView(schuelerView);
});

btnZurueckListe.addEventListener('click', () => {
  switchView(dashboardView);
});

btnBackDashboard.addEventListener('click', () => {
  switchView(dashboardView);
});
