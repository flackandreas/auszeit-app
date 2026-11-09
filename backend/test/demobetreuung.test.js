// Demo-Betreuung: Wer Auszeit in einem Demo-Mandanten allein ausprobiert, hat
// trotzdem jemanden in der Liste. Die virtuelle Betreuung nimmt den Schueler
// auf und schickt ihn zurueck - in Schulmandanten gibt es sie nicht.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');

let testserver;
const clients = [];

test.before(async () => {
  process.env.AUSZEIT_DEMO_ANKUNFT_MS = '150';
  process.env.AUSZEIT_DEMO_RUECKWEG_MS = '250';
  testserver = await starteTestserver({
    standard: 'demo',
    schulen: {
      demo: { name: 'Demo', demo: true },
      schule: { name: 'Testschule' }
    }
  });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
});

async function lehrkraft(schulId, name) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const liste = warteAuf(client, 'available_teachers');
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId, name, room: '104' });
  const daten = await da;
  return { client, daten, liste: await liste };
}

test('Im Demo-Mandanten steht die Demo-Betreuung bereit und arbeitet den Ablauf ab', async () => {
  const lehrerin = await lehrkraft('demo', 'Frau Beispiel');
  const betreuung = lehrerin.liste.find(t => t.id === 'demobetreuung_demo');
  assert.ok(betreuung, 'Demo-Betreuung fehlt in der Liste');
  assert.equal(betreuung.room, 'E 012');

  const angekommen = warteAuf(lehrerin.client, 'student_arrived');
  const zurueck = warteAuf(lehrerin.client, 'student_returning');
  const ok = warteAuf(lehrerin.client, 'help_requested');
  lehrerin.client.emit('request_help', { receiverId: 'demobetreuung_demo', studentName: 'Max Muster' });
  assert.equal((await ok).success, true);
  assert.equal((await angekommen).status, 'betreut');
  assert.equal((await zurueck).status, 'auf_dem_rueckweg');
});

test('Im Schulmandanten gibt es keine Demo-Betreuung', async () => {
  const lehrer = await lehrkraft('schule', 'Herr Beispiel');
  assert.equal(lehrer.liste.some(t => String(t.id).startsWith('demobetreuung_')), false);

  const ok = warteAuf(lehrer.client, 'help_requested');
  lehrer.client.emit('request_help', { receiverId: 'demobetreuung_demo', studentName: 'Max Muster' });
  assert.equal((await ok).success, false, 'Ueber die Mandantengrenze darf niemand verweisen');
});

test('Die Demo-Betreuung landet nie in der Ablage', async () => {
  await testserver.instanz.ablage.leeren();
  const lehrkraefte = testserver.instanz.ablage.inhalt().lehrkraefte || [];
  assert.equal(lehrkraefte.some(z => String(z.kennung).startsWith('demobetreuung_')), false);
});
