// Dauerhafte Ablage der Mandanten.
//
// Bis hierher war die Vergesslichkeit der App ein Entwurfsprinzip: alles lag im
// Arbeitsspeicher, ein Neustart raeumte auf. Sobald Schulen aber ueber eine
// Oberflaeche angelegt werden, muessen sie den naechsten Deploy ueberleben -
// sonst ist die Schule nach dem Ausrollen weg.
//
// Bewusst eine JSON-Datei und keine Datenbank: es geht um ein paar Dutzend
// Eintraege, die selten geaendert werden. Eine Datenbank waere hier Aufwand
// ohne Gegenwert, und die Datei laesst sich zur Not per SSH lesen und
// reparieren.
const fs = require('fs');
const path = require('path');

const PIN_MINDESTLAENGE = 4;
const DATEI = process.env.AUSZEIT_DATEN
  ? path.resolve(process.env.AUSZEIT_DATEN)
  : path.join(__dirname, '..', 'daten', 'schulen.json');

function normalisiereSchulcode(wert) {
  if (typeof wert !== 'string') return null;
  const code = wert.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(code) ? code : null;
}

// Eine Schule auf ihre erlaubten Felder zurechtstutzen. Alles, was von aussen
// kommt - Datei wie Formular - laeuft hier durch.
function bereinigeSchule(roh, id) {
  const pin = roh && roh.pin != null ? String(roh.pin).trim() : '';
  if (pin && pin.length < PIN_MINDESTLAENGE) {
    console.error(`Code fuer "${id}" ist kuerzer als ${PIN_MINDESTLAENGE} Zeichen - Mandant laeuft ohne Code.`);
  }
  return {
    name: String((roh && roh.name) || id).trim().slice(0, 80) || id,
    demo: Boolean(roh && roh.demo),
    // Ein gemeinsamer Beitrittscode fuer das Kollegium, kein persoenliches
    // Passwort. Er verlaesst den Server nie.
    pin: pin.length >= PIN_MINDESTLAENGE ? pin : '',
    // Deaktivieren statt loeschen: laufende Auszeiten sollen nicht mitten in
    // der Stunde verschwinden.
    aktiv: roh && roh.aktiv === false ? false : true
  };
}

function ausUmgebung() {
  const schulen = new Map();
  try {
    const roh = JSON.parse(process.env.AUSZEIT_SCHULEN || '{}');
    for (const [code, wert] of Object.entries(roh)) {
      const id = normalisiereSchulcode(code);
      if (id) schulen.set(id, bereinigeSchule(wert, id));
    }
  } catch (err) {
    console.error('AUSZEIT_SCHULEN ist kein gueltiges JSON - wird uebergangen.');
  }
  return schulen;
}

function lesen() {
  const inhalt = fs.readFileSync(DATEI, 'utf8');
  const roh = JSON.parse(inhalt);
  const schulen = new Map();
  for (const [code, wert] of Object.entries(roh.schulen || {})) {
    const id = normalisiereSchulcode(code);
    if (id) schulen.set(id, bereinigeSchule(wert, id));
  }
  return { schulen, standard: normalisiereSchulcode(roh.standard) };
}

// Atomar schreiben: erst daneben, dann umbenennen. Ein Absturz mitten im
// Schreiben laesst sonst eine halbe Datei zurueck, und beim naechsten Start
// waeren alle Schulen weg.
function schreiben(schulen, standard) {
  const roh = { version: 1, standard: standard || null, schulen: {} };
  for (const [id, schule] of schulen) roh.schulen[id] = schule;

  fs.mkdirSync(path.dirname(DATEI), { recursive: true });
  const temp = `${DATEI}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(roh, null, 2), 'utf8');
  fs.renameSync(temp, DATEI);
  return fs.statSync(DATEI).mtimeMs;
}

// Beim Start: Datei bevorzugen, sonst die Umgebung uebernehmen und festhalten.
// Damit laeuft eine bestehende Installation unveraendert weiter und bekommt
// ihre Konfiguration einmalig in die Datei geschrieben.
function laden(standardSchule, standardName) {
  let schulen = new Map();
  let standard = null;
  let quelle = 'datei';

  try {
    ({ schulen, standard } = lesen());
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error(`Mandantendatei ${DATEI} nicht lesbar (${err.message}) - nutze die Umgebung.`);
    }
    schulen = ausUmgebung();
    standard = normalisiereSchulcode(process.env.AUSZEIT_STANDARD_SCHULE);
    quelle = 'umgebung';
  }

  if (schulen.size === 0) {
    schulen.set(standardSchule, bereinigeSchule({ name: standardName }, standardSchule));
  }
  if (standard && !schulen.has(standard)) standard = null;

  let mtimeMs = 0;
  if (quelle === 'umgebung') {
    try {
      mtimeMs = schreiben(schulen, standard);
    } catch (err) {
      // Ohne beschreibbares Verzeichnis laeuft die App wie bisher rein im
      // Speicher weiter. Nur die Oberflaeche kann dann nichts festhalten.
      console.error(`Mandanten nicht speicherbar (${err.message}) - Aenderungen ueberleben keinen Neustart.`);
    }
  } else {
    try { mtimeMs = fs.statSync(DATEI).mtimeMs; } catch (err) { mtimeMs = 0; }
  }

  return { schulen, standard, mtimeMs };
}

// Wurde die Datei von aussen geaendert (etwa per SSH), damit eine Korrektur
// auch ohne Oberflaeche und ohne Neustart wirkt?
function fremdGeaendert(bekannteMtimeMs) {
  try {
    return fs.statSync(DATEI).mtimeMs !== bekannteMtimeMs;
  } catch (err) {
    return false;
  }
}

module.exports = {
  DATEI, PIN_MINDESTLAENGE,
  normalisiereSchulcode, bereinigeSchule,
  laden, lesen, schreiben, fremdGeaendert
};
