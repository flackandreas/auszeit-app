// Noch nicht angekommen: Kein Schueler soll unbemerkt zwischen zwei Raeumen
// verloren gehen.
//
// Ist ein Schueler nach der eingestellten Zeit nicht als angekommen
// bestaetigt, steht "ueberfaellig" am Vorfall, beide Seiten bekommen den
// Abgleich und - ohne offene App - eine Benachrichtigung. Einmal je Weg.
const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { ersetzeVersand } = require('../push');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');

// Kurz, damit der Test den Ablauf abwarten kann.
const UEBERFAELLIG_MS = 200;
const vapid = webpush.generateVAPIDKeys();
const versendet = [];

let testserver;
const clients = [];

test.before(async () => {
  Object.assign(process.env, {
    AUSZEIT_UEBERFAELLIG_MS: String(UEBERFAELLIG_MS),
    AUSZEIT_VAPID_PUBLIC: vapid.publicKey,
    AUSZEIT_VAPID_PRIVATE: vapid.privateKey,
    AUSZEIT_VAPID_SUBJECT: 'mailto:it@schule.invalid'
  });
  ersetzeVersand(async (abo, nutzlast) => {
    versendet.push({ adresse: abo.endpoint, nachricht: JSON.parse(nutzlast) });
  });
  testserver = await starteTestserver({ standard: 'schule', schulen: { schule: { name: 'Testschule' } } });
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
});

function geraet(name) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: `B${'A'.repeat(86)}`, auth: 'abcdefghijklmnopqrstuv' }
  };
}

async function lehrkraft(name, { plaetze = 0, abo = null } = {}) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId: '', name, room: '1' });
  const daten = await da;
  // Die App liegt im Hintergrund - sonst reichte das Overlay.
  client.emit('sichtbarkeit', { sichtbar: false });
  if (plaetze) {
    const ok = warteAuf(client, 'status_updated');
    client.emit('update_status', { isAvailable: true, capacity: plaetze });
    await ok;
  }
  if (abo) assert.deepEqual(await client.emitWithAck('push_abo', abo), { ok: true });
  return { client, daten };
}

async function schicke(sender, empfaenger) {
  const ok = warteAuf(sender.client, 'help_requested');
  sender.client.emit('request_help', { receiverId: empfaenger.daten.id, studentName: 'Max Muster' });
  const antwort = await ok;
  assert.equal(antwort.success, true);
  assert.equal(antwort.incident.ueberfaellig, false);
  return antwort.incident;
}

const warte = ms => new Promise(resolve => setTimeout(resolve, ms));
const kurz = () => warte(50);

function ueberfaelligBei(lehrkraft, vorfall) {
  return warteAuf(lehrkraft.client, 'sync_incidents', l => l.some(v => v.id === vorfall.id && v.ueberfaellig));
}

test('Nicht angekommen: Beide Seiten erfahren es, einmal', async () => {
  const anna = await lehrkraft('Anna Auf', { plaetze: 1, abo: geraet('anna') });
  const bernd = await lehrkraft('Bernd Ab', { abo: geraet('bernd') });
  const vorfall = await schicke(bernd, anna);

  const beiAnna = ueberfaelligBei(anna, vorfall);
  const beiBernd = ueberfaelligBei(bernd, vorfall);
  await warte(UEBERFAELLIG_MS + 100);
  versendet.length = 0;
  testserver.instanz.pruefeUeberfaellige();
  await beiAnna;
  await beiBernd;
  await kurz();

  // Wer den Schueler erwartet, soll bestaetigen; wer ihn geschickt hat,
  // nachsehen. Ohne Namen, und mit der Kennung des Vorfalls, damit der Alarm
  // die Benachrichtigung "kommt" ersetzt.
  const nachAdresse = Object.fromEntries(versendet.map(p => [p.adresse, p.nachricht]));
  assert.equal(nachAdresse[geraet('anna').endpoint].titel, 'Ist der Schüler bei dir angekommen?');
  assert.equal(nachAdresse[geraet('bernd').endpoint].titel, 'Schüler noch nicht angekommen');
  for (const nachricht of Object.values(nachAdresse)) {
    assert.equal(nachricht.tag, vorfall.id);
    assert.ok(!/Max|Muster|Anna|Bernd/.test(JSON.stringify(nachricht)));
  }
  assert.equal(versendet.length, 2);

  // Kein zweiter Alarm fuer denselben Weg.
  versendet.length = 0;
  testserver.instanz.pruefeUeberfaellige();
  await kurz();
  assert.equal(versendet.length, 0);

  // Bestaetigt Anna, ist der Vorfall nicht mehr ueberfaellig.
  const angekommen = warteAuf(bernd.client, 'sync_incidents', l => l.some(v => v.id === vorfall.id && v.status === 'betreut'));
  anna.client.emit('confirm_arrival', { incidentId: vorfall.id });
  const stand = (await angekommen).find(v => v.id === vorfall.id);
  assert.equal(stand.ueberfaellig, false);
});

test('Rechtzeitig bestaetigt: kein Alarm', async () => {
  const carla = await lehrkraft('Carla Auf', { plaetze: 1, abo: geraet('carla') });
  const dirk = await lehrkraft('Dirk Ab', { abo: geraet('dirk') });
  const vorfall = await schicke(dirk, carla);
  const angekommen = warteAuf(dirk.client, 'student_arrived');
  carla.client.emit('confirm_arrival', { incidentId: vorfall.id });
  await angekommen;

  await warte(UEBERFAELLIG_MS + 100);
  versendet.length = 0;
  testserver.instanz.pruefeUeberfaellige();
  await kurz();
  assert.equal(versendet.length, 0);
});

test('Auf dem Rueckweg gilt dasselbe mit vertauschten Rollen', async () => {
  const eva = await lehrkraft('Eva Auf', { plaetze: 1, abo: geraet('eva') });
  const frank = await lehrkraft('Frank Ab', { abo: geraet('frank') });
  const vorfall = await schicke(frank, eva);
  const angekommen = warteAuf(frank.client, 'student_arrived');
  eva.client.emit('confirm_arrival', { incidentId: vorfall.id });
  await angekommen;

  // Der Hinweg war rechtzeitig - waehrend der Betreuung gibt es keinen Alarm,
  // egal wie lange sie dauert.
  await warte(UEBERFAELLIG_MS + 100);
  versendet.length = 0;
  testserver.instanz.pruefeUeberfaellige();
  await kurz();
  assert.equal(versendet.length, 0);

  const unterwegs = warteAuf(frank.client, 'student_returning');
  eva.client.emit('send_back', { incidentId: vorfall.id });
  await unterwegs;

  const beiFrank = ueberfaelligBei(frank, vorfall);
  await warte(UEBERFAELLIG_MS + 100);
  versendet.length = 0;
  testserver.instanz.pruefeUeberfaellige();
  await beiFrank;
  await kurz();
  const nachAdresse = Object.fromEntries(versendet.map(p => [p.adresse, p.nachricht.titel]));
  // Jetzt erwartet Frank den Schueler zurueck, Eva hat ihn geschickt.
  assert.deepEqual(nachAdresse, {
    [geraet('frank').endpoint]: 'Ist der Schüler bei dir angekommen?',
    [geraet('eva').endpoint]: 'Schüler noch nicht angekommen'
  });
});
