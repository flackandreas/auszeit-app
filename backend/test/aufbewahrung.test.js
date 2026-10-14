// Aufbewahrung im Schulbetrieb und bei Demo-Mandanten, mit vorgegebener Uhr.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');
const { schuljahrVon } = require('../schuljahr');

const STUNDE = 60 * 60 * 1000;

let testserver;
const clients = [];

test.before(async () => {
  testserver = await starteTestserver({
    standard: 'schule',
    schulen: {
      schule: { name: 'Schulbetrieb' },
      demo: { name: 'Offene Demo', demo: true }
    }
  });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
});

async function lehrkraft(schulId, name) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId, name, room: '1' });
  return { client, daten: await da };
}

// Zwei Lehrkraefte einer Schule, die eine schickt der anderen jemanden.
async function vorfall(schulId, studentName, { beenden = false } = {}) {
  const aufnehmend = await lehrkraft(schulId, `Auf-${studentName}`);
  const ok = warteAuf(aufnehmend.client, 'status_updated');
  aufnehmend.client.emit('update_status', { isAvailable: true, capacity: 1 });
  await ok;
  const schickend = await lehrkraft(schulId, `Ab-${studentName}`);
  const geschickt = warteAuf(schickend.client, 'help_requested');
  schickend.client.emit('request_help', { receiverId: aufnehmend.daten.id, studentName });
  const v = (await geschickt).incident;

  if (beenden) {
    const da = warteAuf(schickend.client, 'student_arrived');
    aufnehmend.client.emit('confirm_arrival', { incidentId: v.id });
    await da;
    const unterwegs = warteAuf(schickend.client, 'student_returning');
    aufnehmend.client.emit('send_back', { incidentId: v.id });
    await unterwegs;
    const zurueck = warteAuf(aufnehmend.client, 'return_confirmed');
    schickend.client.emit('confirm_return', { incidentId: v.id });
    await zurueck;
  }
  return { v, aufnehmend, schickend };
}

async function inAblage(id) {
  await testserver.instanz.ablage.leeren();
  return testserver.instanz.ablage.inhalt().vorfaelle.find(z => z.id === id);
}

test('Schulbetrieb: Ein nie beendeter Vorfall wird nach einem Tag als abgebrochen geschlossen, nicht geloescht', async () => {
  const { v, aufnehmend } = await vorfall('schule', 'Ole Offen');
  const liste = warteAuf(aufnehmend.client, 'sync_incidents', l => l.some(x => x.id === v.id && x.status === 'abgebrochen'));

  testserver.instanz.raeumeAuf(Date.now() + 25 * STUNDE);

  const zeile = await inAblage(v.id);
  assert.equal(zeile.status, 'abgebrochen');
  assert.equal(zeile.abschluss, 'abgebrochen');
  assert.ok(zeile.beendet_am);
  assert.equal(zeile.schueler_name, 'Ole Offen');
  // Auch die Lehrkraft sieht es - und der Platz ist wieder frei.
  await liste;
});

test('Schulbetrieb: Beendete Vorfaelle verschwinden aus der Anzeige, bleiben aber im Protokoll', async () => {
  const { v, schickend } = await vorfall('schule', 'Bea Beendet', { beenden: true });
  const zeile = await inAblage(v.id);
  assert.equal(zeile.abschluss, 'zurueck');
  assert.ok(zeile.angekommen_am && zeile.zurueckgeschickt_am && zeile.zurueck_am, 'Zeitpunkte je Zustandswechsel');

  const ohne = warteAuf(schickend.client, 'sync_incidents', l => !l.some(x => x.id === v.id));
  testserver.instanz.raeumeAuf(Date.now() + 13 * STUNDE);
  await ohne;

  const danach = await inAblage(v.id);
  assert.ok(danach, 'aus dem Protokoll verschwunden');
  assert.equal(danach.schueler_name, 'Bea Beendet');
});

test('Demo: Der Name faellt nach zwei Stunden weg, der Vorfall nach zwoelf', async () => {
  const { v } = await vorfall('demo', 'Dora Demo', { beenden: true });

  testserver.instanz.raeumeAuf(Date.now() + 3 * STUNDE);
  assert.equal((await inAblage(v.id)).schueler_name, '');

  testserver.instanz.raeumeAuf(Date.now() + 13 * STUNDE);
  assert.equal(await inAblage(v.id), undefined);
});

test('Demo: Ein nie beendeter Vorfall wird nach einem Tag geloescht', async () => {
  const { v } = await vorfall('demo', 'Nils Nie');
  testserver.instanz.raeumeAuf(Date.now() + 25 * STUNDE);
  assert.equal(await inAblage(v.id), undefined);
});

test('Schuljahreswechsel mit vorgegebener Uhrzeit', async () => {
  const { v } = await vorfall('schule', 'Jana Jahr');
  const schuljahr = schuljahrVon(new Date());
  assert.equal((await inAblage(v.id)).schuljahr, schuljahr);

  // Am letzten Abend des Schuljahres passiert nichts.
  const vorher = await testserver.instanz.pruefeJahreswechsel(new Date(schuljahr + 1, 6, 31, 23, 59, 59));
  assert.equal(vorher, 0);
  assert.ok(await inAblage(v.id));

  // Ab Mitternacht des Stichtags faellt alles aus dem alten Schuljahr weg.
  const imAltenJahr = testserver.instanz.ablage.inhalt().vorfaelle.filter(z => z.schuljahr === schuljahr).length;
  const geloescht = await testserver.instanz.pruefeJahreswechsel(new Date(schuljahr + 1, 7, 1, 0, 0, 1));
  assert.equal(geloescht, imAltenJahr);
  assert.equal(await inAblage(v.id), undefined);
  assert.ok(
    testserver.protokoll.some(z => z.includes(`Schuljahreswechsel: ${imAltenJahr} Vorfaelle`)),
    'Anzahl steht nicht im Log'
  );

  // Ein zweiter Lauf am selben Tag findet nichts mehr.
  assert.equal(await testserver.instanz.pruefeJahreswechsel(new Date(schuljahr + 1, 7, 1, 12, 0)), 0);
});
