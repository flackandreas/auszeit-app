// Schuelerliste ueber die Socket-Verbindung: einfuegen, abgleichen, waehlen.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { starteTestportal } = require('./testportal');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab, ueberPortal } = require('./hilfen');

const GEMISCHT = fs.readFileSync(path.join(__dirname, 'beispiele', 'schuelerliste-gemischt.txt'), 'utf8');

let testportal;
let testserver;
const clients = [];

test.before(async () => {
  testportal = await starteTestportal();
  Object.assign(process.env, {
    PORTAL_ISSUER: testportal.aussteller,
    PORTAL_CLIENT_ID: testportal.clientId,
    PORTAL_CLIENT_SECRET: testportal.geheimnis,
    PORTAL_REDIRECT_URI: 'http://auszeit.invalid/sso/rueckweg',
    PORTAL_INTERN: testportal.intern,
    PORTAL_ADMIN_GRUPPEN: 'Schulleitung, Sekretariat'
  });
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: {
      rstn: { name: 'Testschule', pin: '4711' },
      demo: { name: 'Offene Demo', demo: true }
    }
  });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
  testportal.beenden();
});

async function ueberPortalAngemeldet(kuerzel, gruppen) {
  const anmeldung = await ueberPortal(testserver.adresse, testportal,
    { sub: `sub-${kuerzel}`, sid: `sid-${kuerzel}`, kuerzel, name: `Lehrkraft ${kuerzel}`, gruppen });
  const client = await tab(testserver.adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const liste = warteAuf(client, 'schuelerliste');
  const da = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: kuerzel });
  return { client, daten: await da, liste: await liste };
}

async function mitCode(name, schulId = '') {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId, name, room: '1', pin: '4711' });
  return { client, daten: await da };
}

async function inAblage() {
  await testserver.instanz.ablage.leeren();
  return testserver.instanz.ablage.inhalt();
}

let verwaltung;
let kennungen = new Map();

test('Nur die Rolle Verwaltung darf eine Liste einfuegen', async () => {
  verwaltung = await ueberPortalAngemeldet('SL', ['Schulleitung']);
  assert.equal(verwaltung.daten.verwaltung, true);
  assert.equal(verwaltung.daten.listenModus, true);
  assert.deepEqual(verwaltung.liste, []);

  const kollegin = await ueberPortalAngemeldet('KO', ['Kollegium']);
  assert.equal(kollegin.daten.verwaltung, false);
  assert.deepEqual(await kollegin.client.emitWithAck('schueler_vorschau', { text: GEMISCHT }),
    { ok: false, grund: 'keine_berechtigung' });

  const mitCodeAngemeldet = await mitCode('Gast');
  assert.deepEqual(await mitCodeAngemeldet.client.emitWithAck('schueler_uebernehmen', { text: GEMISCHT }),
    { ok: false, grund: 'keine_berechtigung' });
  assert.equal((await inAblage()).schueler.length, 0);
});

test('Vorschau aendert nichts, Uebernehmen legt rund 30 Schueler an', async () => {
  const antwort = await verwaltung.client.emitWithAck('schueler_vorschau', { text: GEMISCHT });
  assert.equal(antwort.ok, true);
  const { vorschau } = antwort;
  assert.equal(vorschau.neu.length, 30);
  assert.equal(vorschau.bleibt, 0);
  assert.deepEqual(vorschau.archiviert, []);
  assert.deepEqual(vorschau.fehler.map(f => f.grund),
    ['Doppelt in der Liste', 'Keine Klasse erkannt', 'Vor- und Nachname noetig']);
  assert.deepEqual(vorschau.jeKlasse.map(k => `${k.klasse}:${k.anzahl}`), ['7a:12', '7b:10', '8c:6', 'J1:2']);
  assert.equal((await inAblage()).schueler.length, 0, 'die Vorschau hat schon gespeichert');

  // Alle Geraete der Schule bekommen die neue Auswahl - auch mit Code angemeldete.
  const kollege = await mitCode('Kollege');
  const beimKollegen = warteAuf(kollege.client, 'schuelerliste', l => l.length > 0);
  const ergebnis = await verwaltung.client.emitWithAck('schueler_uebernehmen', { text: GEMISCHT });
  assert.deepEqual(ergebnis, { ok: true, ergebnis: { neu: 30, reaktiviert: 0, archiviert: 0, bleibt: 0 } });

  const liste = await beimKollegen;
  assert.equal(liste.length, 30);
  assert.deepEqual(Object.keys(liste[0]).sort(), ['kennung', 'klasse', 'nachname', 'vorname']);
  // Sortiert nach Klasse, dann Nachname.
  assert.deepEqual(liste.slice(0, 3).map(s => s.nachname), ['Becker', 'Hoffmann', 'Klein']);
  assert.equal((await inAblage()).schueler.length, 30);
  kennungen = new Map(liste.map(s => [`${s.klasse} ${s.vorname} ${s.nachname}`, s.kennung]));
});

test('Ein zweiter Import derselben Liste erzeugt keine Dubletten', async () => {
  const ergebnis = await verwaltung.client.emitWithAck('schueler_uebernehmen', { text: GEMISCHT });
  assert.deepEqual(ergebnis.ergebnis, { neu: 0, reaktiviert: 0, archiviert: 0, bleibt: 30 });
  assert.equal((await inAblage()).schueler.length, 30);
});

test('Auswahl: Im Protokoll steht die Kennung, angezeigt werden Name und Klasse', async () => {
  const aufnehmend = await mitCode('Aufnehmend');
  const bereit = warteAuf(aufnehmend.client, 'status_updated');
  aufnehmend.client.emit('update_status', { isAvailable: true, capacity: 3 });
  await bereit;
  const schickend = await mitCode('Schickend');

  const kommt = warteAuf(aufnehmend.client, 'incoming_student');
  const geschickt = warteAuf(schickend.client, 'help_requested');
  schickend.client.emit('request_help', {
    receiverId: aufnehmend.daten.id,
    schuelerKennung: kennungen.get('7a Anna Müller'),
    // Freitext zaehlt im Schulbetrieb nicht.
    studentName: 'untergeschoben'
  });
  const vorfall = (await geschickt).incident;
  const angekommen = await kommt;
  assert.equal(angekommen.studentName, 'Anna Müller');
  assert.equal(angekommen.klasse, '7a');

  const zeile = (await inAblage()).vorfaelle.find(v => v.id === vorfall.id);
  assert.equal(zeile.schueler_kennung, kennungen.get('7a Anna Müller'));
  assert.equal(zeile.schueler_name, '', 'der Name gehoert in die Liste, nicht ins Protokoll');

  // Ohne Auswahl geht es auch - Freitext wird dabei verworfen.
  const ohne = warteAuf(schickend.client, 'help_requested');
  schickend.client.emit('request_help', { receiverId: aufnehmend.daten.id, studentName: 'Freitext' });
  assert.equal((await ohne).incident.studentName, '');

  // Eine fremde oder erfundene Kennung nicht.
  const falsch = warteAuf(schickend.client, 'help_requested');
  schickend.client.emit('request_help', { receiverId: aufnehmend.daten.id, schuelerKennung: 'gibtesnicht' });
  assert.equal((await falsch).success, false);
});

test('Wer in einer eingefuegten Klasse fehlt, wird archiviert - die anderen Klassen bleiben', async () => {
  const siebenA = GEMISCHT.split('\n').filter(z => /\b0?7a\b/i.test(z) && !z.includes('Müller')).join('\n');
  const vorschau = (await verwaltung.client.emitWithAck('schueler_vorschau', { text: siebenA })).vorschau;
  assert.deepEqual(vorschau.archiviert, [{ klasse: '7a', name: 'Anna Müller' }]);

  const neueListe = warteAuf(verwaltung.client, 'schuelerliste', l => l.length === 29);
  const ergebnis = await verwaltung.client.emitWithAck('schueler_uebernehmen', { text: siebenA });
  assert.deepEqual(ergebnis.ergebnis, { neu: 0, reaktiviert: 0, archiviert: 1, bleibt: 11 });
  await neueListe;

  // Archiviert heisst: noch da, aber nicht mehr waehlbar.
  const zeile = (await inAblage()).schueler.find(s => s.kennung === kennungen.get('7a Anna Müller'));
  assert.ok(zeile.archiviert_am);
  const schickend = await mitCode('Schickend 2');
  const aufnehmend = await mitCode('Aufnehmend 2');
  const bereit = warteAuf(aufnehmend.client, 'status_updated');
  aufnehmend.client.emit('update_status', { isAvailable: true, capacity: 1 });
  await bereit;
  const abgelehnt = warteAuf(schickend.client, 'help_requested');
  schickend.client.emit('request_help', { receiverId: aufnehmend.daten.id, schuelerKennung: kennungen.get('7a Anna Müller') });
  assert.equal((await abgelehnt).success, false);

  // Mit dem naechsten vollstaendigen Import kommt sie zurueck - mit derselben Kennung.
  const zurueck = await verwaltung.client.emitWithAck('schueler_uebernehmen', { text: GEMISCHT });
  assert.equal(zurueck.ergebnis.reaktiviert, 1);
  assert.equal((await inAblage()).schueler.length, 30);
});

test('Demo-Mandant: Namensfeld statt Liste', async () => {
  const demo = await mitCode('Demo-Lehrkraft', 'demo');
  assert.equal(demo.daten.listenModus, false);
  const andere = await mitCode('Demo-Kollegin', 'demo');
  const bereit = warteAuf(andere.client, 'status_updated');
  andere.client.emit('update_status', { isAvailable: true, capacity: 1 });
  await bereit;
  const geschickt = warteAuf(demo.client, 'help_requested');
  demo.client.emit('request_help', { receiverId: andere.daten.id, studentName: 'Testname' });
  assert.equal((await geschickt).incident.studentName, 'Testname');
});

test('Zum Schuljahreswechsel faellt die Liste weg', async () => {
  const naechstes = testserver.instanz.ablage.inhalt().schueler[0].schuljahr + 1;
  const geloescht = await testserver.instanz.pruefeJahreswechsel(new Date(naechstes, 7, 1, 0, 0, 1));
  assert.equal(geloescht.schueler, 30);
  assert.equal((await inAblage()).schueler.length, 0);
});
