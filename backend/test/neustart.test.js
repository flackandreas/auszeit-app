// Neustart waehrend einer laufenden Auszeit.
//
// Der Server wird im selben Prozess neu geladen: leerer Speicher, dieselbe
// Ablage - wie ein neuer Container, der dieselbe Datenbank vorfindet. Gegen
// MariaDB laeuft derselbe Ablauf in der Abnahme mit Docker (README).
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestportal } = require('./testportal');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab, ueberPortal } = require('./hilfen');

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
    PORTAL_INTERN: testportal.intern
  });
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: { rstn: { name: 'Testschule', pin: '4711' } }
  });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
  testportal.beenden();
});

async function mitCode(name, room) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId: '', name, room, pin: '4711' });
  return { client, daten: await da };
}

async function mitToken(token, room) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const vorfaelle = warteAuf(client, 'sync_incidents');
  // Bei einer Abweisung kommt keine Liste - das Warten darf dann ins Leere laufen.
  vorfaelle.catch(() => {});
  const da = Promise.race([
    warteAuf(client, 'login_success'),
    warteAuf(client, 'login_failed').then(f => ({ abgewiesen: f.grund }))
  ]);
  client.emit('login', { schulId: '', token, room });
  const daten = await da;
  return { client, daten, vorfaelle: daten.abgewiesen ? null : await vorfaelle };
}

async function bereit(client, plaetze) {
  const ok = warteAuf(client, 'status_updated');
  client.emit('update_status', { isAvailable: true, capacity: plaetze });
  await ok;
}

// Mit Portal-Anmeldung ist das Schulbetrieb: Schueler kommen aus der Liste.
// Die fuegt eine Lehrkraft mit der Rolle Verwaltung ein.
let liste = new Map();

async function listeEinfuegen(text) {
  const anmeldung = await ueberPortal(testserver.adresse, testportal,
    { sub: 'sub-sl', sid: 'sid-sl', kuerzel: 'SL', name: 'Schulleitung', gruppen: ['Schulleitung'] });
  const client = await tab(testserver.adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: 'SL' });
  await da;
  const neueListe = warteAuf(client, 'schuelerliste', l => l.length > 0);
  const ergebnis = await client.emitWithAck('schueler_uebernehmen', { text });
  assert.equal(ergebnis.ok, true);
  liste = new Map((await neueListe).map(s => [`${s.vorname} ${s.nachname}`, s.kennung]));
}

async function schicke(sender, empfaengerId, studentName) {
  const ok = warteAuf(sender, 'help_requested');
  sender.emit('request_help', { receiverId: empfaengerId, schuelerKennung: liste.get(studentName) });
  const ergebnis = await ok;
  assert.equal(ergebnis.success, true);
  return ergebnis.incident;
}

async function neustarten() {
  for (const client of clients.splice(0)) client.close();
  await testserver.neustarten();
}

test('Neustart waehrend einer laufenden Auszeit: Vorfall und Belegung sind danach unveraendert da', async () => {
  await listeEinfuegen('7a; Muster, Max\n7b Lena Beispiel');
  const anna = await mitCode('Anna', '101');
  await bereit(anna.client, 2);
  const bernd = await mitCode('Bernd', '202');

  const max = await schicke(bernd.client, anna.daten.id, 'Max Muster');
  const angekommen = warteAuf(bernd.client, 'student_arrived');
  anna.client.emit('confirm_arrival', { incidentId: max.id });
  await angekommen;
  const lena = await schicke(bernd.client, anna.daten.id, 'Lena Beispiel');

  await neustarten();

  // Beide kommen mit ihrem Token zurueck - ohne Code.
  const annaWieder = await mitToken(anna.daten.token, '101');
  assert.equal(annaWieder.daten.id, anna.daten.id);
  const stand = new Map(annaWieder.vorfaelle.map(v => [v.id, v]));
  assert.equal(stand.get(max.id).status, 'betreut');
  // Der Name kommt nach dem Neustart aus der Liste - im Protokoll steht nur
  // die Kennung.
  assert.equal(stand.get(max.id).studentName, 'Max Muster');
  assert.equal(stand.get(max.id).klasse, '7a');
  assert.ok(stand.get(max.id).angekommenAm, 'Zeitpunkt der Ankunft fehlt');
  assert.equal(stand.get(lena.id).status, 'unterwegs');

  // Aufnahmebereitschaft ist Laufzeitzustand und beginnt von vorn.
  assert.equal(annaWieder.daten.isAvailable, false);

  // Die Belegung aber steht: Bei drei angebotenen Plaetzen ist einer frei.
  const berndWieder = await mitToken(bernd.daten.token, '202');
  const liste = warteAuf(berndWieder.client, 'available_teachers', l => l.some(t => t.id === anna.daten.id));
  await bereit(annaWieder.client, 3);
  assert.equal((await liste).find(t => t.id === anna.daten.id).capacity, 1);

  // Und der Handschlag geht weiter, wo er stand.
  const lenaDa = warteAuf(berndWieder.client, 'student_arrived');
  annaWieder.client.emit('confirm_arrival', { incidentId: lena.id });
  assert.equal((await lenaDa).id, lena.id);
});

test('Portal-Lehrkraft: Sitzung und Kennung ueberstehen den Neustart', async () => {
  const person = { sub: 'sub-pn', sid: 'sid-pn-1', kuerzel: 'PN', name: 'Paula Neu', gruppen: ['Kollegium'] };
  const anmeldung = await ueberPortal(testserver.adresse, testportal, person);
  const client = await tab(testserver.adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const vorher = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: 'P1' });
  const id = (await vorher).id;

  await neustarten();

  // Das Cookie gilt weiter.
  const auskunft = await fetch(`${testserver.adresse}/api/sitzung`, {
    headers: { cookie: `auszeit_sitzung=${anmeldung.sitzung}` }
  });
  assert.equal(auskunft.status, 200);
  assert.equal((await auskunft.json()).raum, 'P1');

  // Und eine neue Anmeldung ueber das Portal findet dieselbe Lehrkraft.
  const neu = await ueberPortal(testserver.adresse, testportal, { ...person, sid: 'sid-pn-2' });
  const zweiter = await tab(testserver.adresse, { sitzung: neu.sitzung, sammlung: clients });
  const nachher = warteAuf(zweiter, 'login_success');
  zweiter.emit('login', { portal: true, schulId: '', room: 'P1' });
  assert.equal((await nachher).id, id);
});

test('Eine beendete Sitzung bleibt auch nach dem Neustart beendet', async () => {
  const eva = await mitCode('Eva', '303');
  // Ein zweiter Tab derselben Sitzung zeigt, dass der Server die Abmeldung
  // verarbeitet hat.
  const zweiterTab = await mitToken(eva.daten.token, '303');
  const abgemeldet = warteAuf(zweiterTab.client, 'logged_out');
  eva.client.emit('logout');
  await abgemeldet;
  // In der Ablage muss sie angekommen sein, bevor der Server faellt - genau
  // dafuer wartet das Herunterfahren auf die Warteschlange.
  await neustarten();

  const wieder = await mitToken(eva.daten.token, '303');
  assert.equal(wieder.daten.abgewiesen, 'sitzung_ungueltig');
});
