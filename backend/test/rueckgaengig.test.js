// Rueckgaengig: der Fehltipp auf die falsche Kollegin.
//
// Kurz nach dem Absenden darf die abgebende Lehrkraft die Verweisung
// zuruecknehmen - solange der Schueler nicht angekommen ist. Der Vorfall
// verschwindet dann ganz, auch aus der Ablage, und der Platz ist wieder frei.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');

// Kurz, damit der Test den Ablauf der Frist abwarten kann. Der Server laesst
// die Haelfte obendrauf gelten, also 600 ms.
const RUECKGAENGIG_MS = 400;

let testserver;
const clients = [];

test.before(async () => {
  process.env.AUSZEIT_RUECKGAENGIG_MS = String(RUECKGAENGIG_MS);
  testserver = await starteTestserver({ standard: 'schule', schulen: { schule: { name: 'Testschule' } } });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
});

async function lehrkraft(name, plaetze = 0) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId: '', name, room: '1' });
  const daten = await da;
  if (plaetze) {
    const ok = warteAuf(client, 'status_updated');
    client.emit('update_status', { isAvailable: true, capacity: plaetze });
    await ok;
  }
  return { client, daten };
}

async function schicke(sender, empfaenger) {
  const kommt = warteAuf(empfaenger.client, 'incoming_student');
  const ok = warteAuf(sender.client, 'help_requested');
  sender.client.emit('request_help', { receiverId: empfaenger.daten.id, studentName: 'Max Muster' });
  const antwort = await ok;
  await kommt;
  assert.equal(antwort.success, true);
  return antwort;
}

function nimmZurueck(lehrkraft, vorfall) {
  return lehrkraft.client.timeout(2000).emitWithAck('rueckgaengig', { incidentId: vorfall.id });
}

async function inAblage(id) {
  await testserver.instanz.ablage.leeren();
  return testserver.instanz.ablage.inhalt().vorfaelle.find(z => z.id === id);
}

test('Rueckgaengig nimmt die Verweisung ganz zurueck und gibt den Platz frei', async () => {
  const anna = await lehrkraft('Anna Auf', 1);
  const bernd = await lehrkraft('Bernd Ab');
  const { incident: vorfall, rueckgaengigMs } = await schicke(bernd, anna);
  // So lange zeigt der Client den Knopf.
  assert.equal(rueckgaengigMs, RUECKGAENGIG_MS);
  assert.ok(await inAblage(vorfall.id), 'Vorfall fehlt vor dem Zuruecknehmen in der Ablage');

  const zurueckgenommen = warteAuf(anna.client, 'verweisung_zurueckgenommen');
  const wiederFrei = warteAuf(bernd.client, 'available_teachers',
    l => l.some(t => t.id === anna.daten.id && t.capacity === 1));
  const leerBeiAnna = warteAuf(anna.client, 'sync_incidents', l => !l.some(v => v.id === vorfall.id));
  assert.deepEqual(await nimmZurueck(bernd, vorfall), { ok: true });

  const meldung = await zurueckgenommen;
  assert.equal(meldung.incidentId, vorfall.id);
  assert.equal(meldung.senderName, 'Bernd Ab');
  await wiederFrei;
  await leerBeiAnna;
  // Ein Fehltipp ist keine Auszeit - auch das Protokoll kennt ihn nicht.
  assert.equal(await inAblage(vorfall.id), undefined);

  // Einmal zurueckgenommen, ist nichts mehr zurueckzunehmen.
  assert.equal((await nimmZurueck(bernd, vorfall)).grund, 'unbekannt');
});

test('Ist der Schueler angekommen, gibt es kein Zuruecknehmen mehr', async () => {
  const carla = await lehrkraft('Carla Auf', 1);
  const dirk = await lehrkraft('Dirk Ab');
  const { incident: vorfall } = await schicke(dirk, carla);

  const angekommen = warteAuf(dirk.client, 'student_arrived');
  carla.client.emit('confirm_arrival', { incidentId: vorfall.id });
  await angekommen;

  assert.deepEqual(await nimmZurueck(dirk, vorfall), { ok: false, grund: 'angekommen' });
  assert.equal((await inAblage(vorfall.id)).status, 'betreut');
});

test('Zuruecknehmen kann nur die abgebende Lehrkraft', async () => {
  const eva = await lehrkraft('Eva Auf', 1);
  const frank = await lehrkraft('Frank Ab');
  const greta = await lehrkraft('Greta Fremd');
  const { incident: vorfall } = await schicke(frank, eva);

  assert.deepEqual(await nimmZurueck(eva, vorfall), { ok: false, grund: 'unbekannt' });
  assert.deepEqual(await nimmZurueck(greta, vorfall), { ok: false, grund: 'unbekannt' });
  assert.equal((await inAblage(vorfall.id)).status, 'unterwegs');
});

test('Nach Ablauf der Frist ist es zu spaet', async () => {
  const hanna = await lehrkraft('Hanna Auf', 1);
  const ingo = await lehrkraft('Ingo Ab');
  const { incident: vorfall } = await schicke(ingo, hanna);

  await new Promise(resolve => setTimeout(resolve, RUECKGAENGIG_MS * 1.5 + 150));
  assert.deepEqual(await nimmZurueck(ingo, vorfall), { ok: false, grund: 'zu_spaet' });
  assert.equal((await inAblage(vorfall.id)).status, 'unterwegs');
});
