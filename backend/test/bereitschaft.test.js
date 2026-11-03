// Bereitschaft bis zum Stundenende und die Schuleinstellungen dazu.
//
// Wer sich bereit meldet, ist es bis zum Ende der laufenden Stunde - oder der
// danach, fuer die Doppelstunde. Ohne Klingelplan gilt eine pauschale Frist.
// Danach springt der Schalter von selbst um: niemand steht morgens mit dem Raum
// von gestern in der Liste.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestportal } = require('./testportal');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab, ueberPortal } = require('./hilfen');

// Kurz, damit der Test den Ablauf abwarten kann.
const PAUSCHAL_MS = 300;

let testportal;
let testserver;
const clients = [];

test.before(async () => {
  testportal = await starteTestportal();
  Object.assign(process.env, {
    AUSZEIT_BEREIT_PAUSCHAL_MS: String(PAUSCHAL_MS),
    PORTAL_ISSUER: testportal.aussteller,
    PORTAL_CLIENT_ID: testportal.clientId,
    PORTAL_CLIENT_SECRET: testportal.geheimnis,
    PORTAL_REDIRECT_URI: 'http://auszeit.invalid/sso/rueckweg',
    PORTAL_INTERN: testportal.intern,
    PORTAL_ADMIN_GRUPPEN: 'Schulleitung'
  });
  testserver = await starteTestserver({ standard: 'rstn', schulen: { rstn: { name: 'Testschule', pin: '4711' } } });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
  testportal.beenden();
});

async function mitCode(name) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId: '', name, room: '101', pin: '4711' });
  return { client, daten: await da };
}

async function ueberPortalAngemeldet(kuerzel, gruppen) {
  const anmeldung = await ueberPortal(testserver.adresse, testportal,
    { sub: `sub-${kuerzel}`, sid: `sid-${kuerzel}`, kuerzel, name: `Lehrkraft ${kuerzel}`, gruppen });
  const client = await tab(testserver.adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: kuerzel });
  return { client, daten: await da };
}

async function bereitMelden(lehrkraft, felder = {}) {
  const ok = warteAuf(lehrkraft.client, 'status_updated');
  lehrkraft.client.emit('update_status', { isAvailable: true, capacity: 1, ...felder });
  return ok;
}

const warte = ms => new Promise(resolve => setTimeout(resolve, ms));

test('Ohne Klingelplan gilt die pauschale Frist, auf Wunsch doppelt', async () => {
  const anna = await mitCode('Anna Auf');
  const optionen = (await anna.client.emitWithAck('bereit_optionen', {})).optionen;
  assert.deepEqual(optionen.map(o => [o.stunden, o.nachPlan]), [[1, false], [2, false]]);
  assert.ok(Math.abs(optionen[1].bis - optionen[0].bis - PAUSCHAL_MS) < 50);

  const vorher = Date.now();
  const stand = await bereitMelden(anna, { stunden: 2 });
  assert.equal(stand.isAvailable, true);
  assert.ok(stand.bereitBis >= vorher + 2 * PAUSCHAL_MS && stand.bereitBis <= Date.now() + 2 * PAUSCHAL_MS);

  // Andere Plaetze anbieten verlaengert nichts.
  const nachher = await bereitMelden(anna, { capacity: 2 });
  assert.equal(nachher.bereitBis, stand.bereitBis);
});

test('Mit dem Ende ist die Lehrkraft nicht mehr aufnahmebereit, und der Schalter springt um', async () => {
  const bernd = await mitCode('Bernd Auf');
  const carla = await mitCode('Carla Ab');
  const inListe = warteAuf(carla.client, 'available_teachers', l => l.some(t => t.id === bernd.daten.id));
  const stand = await bereitMelden(bernd);
  assert.ok(stand.bereitBis);
  await inListe;

  await warte(PAUSCHAL_MS + 100);
  // Schon vor dem naechsten Durchlauf: keine Verweisung mehr.
  const abgelehnt = warteAuf(carla.client, 'help_requested');
  carla.client.emit('request_help', { receiverId: bernd.daten.id, studentName: 'Max' });
  assert.equal((await abgelehnt).success, false);

  const aus = warteAuf(bernd.client, 'status_updated');
  const ausListe = warteAuf(carla.client, 'available_teachers', l => !l.some(t => t.id === bernd.daten.id));
  testserver.instanz.pruefeBereitschaft();
  const neu = await aus;
  assert.equal(neu.isAvailable, false);
  assert.equal(neu.bereitBis, null);
  await ausListe;
});

test('Die Schuleinstellungen aendert nur die Verwaltung', async () => {
  const kollegin = await ueberPortalAngemeldet('KO', ['Kollegium']);
  assert.deepEqual(await kollegin.client.emitWithAck('einstellungen_laden', {}), { ok: false, grund: 'keine_berechtigung' });
  assert.deepEqual(await kollegin.client.emitWithAck('einstellungen_speichern', { klingelplan: '7:45 - 8:30' }),
    { ok: false, grund: 'keine_berechtigung' });

  const mitCodeAngemeldet = await mitCode('Dirk Code');
  assert.equal((await mitCodeAngemeldet.client.emitWithAck('einstellungen_laden', {})).grund, 'keine_berechtigung');

  const leitung = await ueberPortalAngemeldet('SL', ['Schulleitung']);
  assert.deepEqual(await leitung.client.emitWithAck('einstellungen_laden', {}), { ok: true, klingelplan: [], hinweisNiemand: '' });

  // Ein kaputter Plan wird nicht gespeichert; die Antwort nennt die Zeile.
  const kaputt = await leitung.client.emitWithAck('einstellungen_speichern', { klingelplan: '7:45 - 8:30\n8:30', hinweisNiemand: 'x' });
  assert.equal(kaputt.ok, false);
  assert.equal(kaputt.grund, 'klingelplan');
  assert.equal(kaputt.fehler[0].zeile, 2);
  assert.equal((await leitung.client.emitWithAck('einstellungen_laden', {})).hinweisNiemand, '');
});

function hhmm(minuten) {
  return `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;
}

test('Mit Klingelplan endet die Bereitschaft zum Stundenende, und der Hinweis erreicht alle', async (t) => {
  const jetzt = new Date();
  const minuten = jetzt.getHours() * 60 + jetzt.getMinutes();
  // Eine Stunde, die gerade laeuft, und die danach. Kurz vor Mitternacht
  // passt das nicht mehr in einen Tag.
  if (minuten < 15 || minuten > 22 * 60) {
    t.skip('zu nah an Mitternacht');
    return;
  }
  const plan = [
    { beginn: hhmm(minuten - 10), ende: hhmm(minuten + 20) },
    { beginn: hhmm(minuten + 20), ende: hhmm(minuten + 65) }
  ];
  const leitung = await ueberPortalAngemeldet('SL2', ['Schulleitung']);
  const eva = await mitCode('Eva Auf');
  const hinweis = warteAuf(eva.client, 'schulhinweise');
  const gespeichert = await leitung.client.emitWithAck('einstellungen_speichern', {
    klingelplan: plan.map((s, i) => `${i + 1}. Stunde ${s.beginn} - ${s.ende}`).join('\n'),
    hinweisNiemand: '  Bitte die Schulleitung informieren.  '
  });
  assert.deepEqual(gespeichert, { ok: true, klingelplan: plan, hinweisNiemand: 'Bitte die Schulleitung informieren.' });
  assert.deepEqual(await hinweis, { hinweisNiemand: 'Bitte die Schulleitung informieren.' });

  const ende = (hm) => {
    const d = new Date();
    const [h, m] = hm.split(':').map(Number);
    d.setHours(h, m, 0, 0);
    return d.getTime();
  };
  const optionen = (await eva.client.emitWithAck('bereit_optionen', {})).optionen;
  assert.deepEqual(optionen, [
    { stunden: 1, bis: ende(plan[0].ende), nachPlan: true },
    { stunden: 2, bis: ende(plan[1].ende), nachPlan: true }
  ]);
  assert.equal((await bereitMelden(eva)).bereitBis, ende(plan[0].ende));

  // Wer sich neu anmeldet, bekommt den Hinweis gleich mit.
  const frank = await mitCode('Frank Neu');
  assert.equal(frank.daten.hinweisNiemand, 'Bitte die Schulleitung informieren.');

  // Die Einstellungen ueberstehen einen Neustart.
  for (const client of clients.splice(0)) client.close();
  await testserver.neustarten();
  const nachNeustart = await mitCode('Gabi Spaeter');
  assert.equal(nachNeustart.daten.hinweisNiemand, 'Bitte die Schulleitung informieren.');
  const optionenDanach = (await nachNeustart.client.emitWithAck('bereit_optionen', {})).optionen;
  assert.equal(optionenDanach[0].bis, ende(plan[0].ende));
});
