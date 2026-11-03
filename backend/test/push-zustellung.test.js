// Wer bekommt wann eine Benachrichtigung - und was steht darin.
//
// Statt an echte Push-Dienste geht der Versand an eine Attrappe, die
// mitschreibt. Verschluesselung und Zustellung sind Sache der Bibliothek
// web-push; hier geht es darum, was Auszeit ihr uebergibt.
const test = require('node:test');
const assert = require('node:assert/strict');
const webpush = require('web-push');
const { ersetzeVersand } = require('../push');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');

const vapid = webpush.generateVAPIDKeys();
const versendet = [];
const antworten = new Map(); // Adresse -> Fehler, den der Dienst meldet

let testserver;
const clients = [];

test.before(async () => {
  Object.assign(process.env, {
    AUSZEIT_VAPID_PUBLIC: vapid.publicKey,
    AUSZEIT_VAPID_PRIVATE: vapid.privateKey,
    AUSZEIT_VAPID_SUBJECT: 'mailto:it@schule.invalid',
    // Kurz, damit der Test den Ablauf abwarten kann.
    AUSZEIT_BEREIT_OHNE_VERBINDUNG_MS: '1500'
  });
  ersetzeVersand(async (abo, nutzlast, optionen) => {
    versendet.push({ adresse: abo.endpoint, nachricht: JSON.parse(nutzlast), optionen });
    const fehler = antworten.get(abo.endpoint);
    if (fehler) throw fehler;
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

async function lehrkraft(name, { plaetze = 0, abo = null, sichtbar = false } = {}) {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { schulId: '', name, room: '1' });
  const daten = await da;
  client.emit('sichtbarkeit', { sichtbar });
  if (plaetze) {
    const ok = warteAuf(client, 'status_updated');
    client.emit('update_status', { isAvailable: true, capacity: plaetze });
    await ok;
  }
  if (abo) assert.deepEqual(await client.emitWithAck('push_abo', abo), { ok: true });
  return { client, daten };
}

async function schicke(sender, empfaengerId, studentName = 'Max Muster') {
  const ok = warteAuf(sender.client, 'help_requested');
  sender.client.emit('request_help', { receiverId: empfaengerId, studentName });
  return (await ok).incident;
}

// Der Versand laeuft hinter dem Ereignis - kurz warten, bis er durch ist.
const kurz = () => new Promise(resolve => setTimeout(resolve, 50));

test('Der oeffentliche Schluessel steht in /api/schule', async () => {
  const schule = await (await fetch(`${testserver.adresse}/api/schule`)).json();
  assert.equal(schule.pushSchluessel, vapid.publicKey);
});

test('Liegt die App im Hintergrund, kommt eine Benachrichtigung - ohne Namen', async () => {
  const anna = await lehrkraft('Anna Auf', { plaetze: 2, abo: geraet('anna') });
  const bernd = await lehrkraft('Bernd Ab', { sichtbar: true });
  versendet.length = 0;

  const vorfall = await schicke(bernd, anna.daten.id, 'Max Muster');
  await kurz();
  assert.equal(versendet.length, 1);
  const [push] = versendet;
  assert.equal(push.adresse, geraet('anna').endpoint);
  assert.equal(push.nachricht.titel, 'Schüler auf dem Weg zu dir');
  assert.equal(push.nachricht.tag, vorfall.id);
  assert.equal(push.nachricht.ziel, '/');
  // Kein Schuelername - und auch kein Lehrername.
  const text = JSON.stringify(push.nachricht);
  for (const name of ['Max', 'Muster', 'Bernd', 'Anna']) assert.ok(!text.includes(name), `"${name}" in der Benachrichtigung`);
  assert.equal(push.optionen.urgency, 'high');
  assert.equal(push.optionen.topic, vorfall.id);
  assert.ok(push.optionen.TTL <= 15 * 60);
  assert.equal(push.optionen.vapidDetails.publicKey, vapid.publicKey);
});

test('Ist die App im Vordergrund, reicht das Overlay', async () => {
  const carla = await lehrkraft('Carla Auf', { plaetze: 1, abo: geraet('carla'), sichtbar: true });
  const dirk = await lehrkraft('Dirk Ab');
  versendet.length = 0;
  await schicke(dirk, carla.daten.id);
  await kurz();
  assert.equal(versendet.length, 0);

  // Wechselt sie in den Hintergrund, kommt die naechste Meldung als Push.
  carla.client.emit('sichtbarkeit', { sichtbar: false });
  const ruecklauf = warteAuf(dirk.client, 'help_requested');
  const ok = warteAuf(carla.client, 'status_updated');
  carla.client.emit('update_status', { isAvailable: true, capacity: 2 });
  await ok;
  dirk.client.emit('request_help', { receiverId: carla.daten.id, studentName: 'Lena' });
  await ruecklauf;
  await kurz();
  assert.deepEqual(versendet.map(p => p.adresse), [geraet('carla').endpoint]);
});

test('Gesperrter Bildschirm: Ohne Verbindung, aber mit Abo bleibt sie aufnahmebereit', async () => {
  const eva = await lehrkraft('Eva Auf', { plaetze: 1, abo: geraet('eva') });
  const frank = await lehrkraft('Frank Ab');
  const nochDa = warteAuf(frank.client, 'available_teachers', l => l.some(t => t.id === eva.daten.id));
  eva.client.close();
  await nochDa;

  versendet.length = 0;
  const vorfall = await schicke(frank, eva.daten.id);
  await kurz();
  assert.deepEqual(versendet.map(p => p.adresse), [geraet('eva').endpoint]);
  // Fuer die Gegenseite gilt sie als erreichbar - kein einseitiger Abschluss.
  assert.equal(vorfall.receiverOnline, true);
});

test('Ohne Abo verschwindet eine Lehrkraft ohne Verbindung aus der Liste', async () => {
  const olaf = await lehrkraft('Olaf Auf', { plaetze: 1 });
  const paula = await lehrkraft('Paula Ab');
  const weg = warteAuf(paula.client, 'available_teachers', l => !l.some(t => t.id === olaf.daten.id));
  olaf.client.close();
  await weg;
});

test('Die Bereitschaft ohne Verbindung verfaellt nach der eingestellten Zeit', async () => {
  const quirin = await lehrkraft('Quirin Auf', { plaetze: 1, abo: geraet('quirin') });
  const rita = await lehrkraft('Rita Ab');
  quirin.client.close();
  await new Promise(resolve => setTimeout(resolve, 1600));
  const abgelehnt = warteAuf(rita.client, 'help_requested');
  rita.client.emit('request_help', { receiverId: quirin.daten.id, studentName: 'Spaet' });
  assert.equal((await abgelehnt).success, false);
});

test('Zurueckschicken benachrichtigt die abgebende, der Rueckholwunsch die aufnehmende Lehrkraft', async () => {
  const gabi = await lehrkraft('Gabi Auf', { plaetze: 1, abo: geraet('gabi'), sichtbar: true });
  const hans = await lehrkraft('Hans Ab', { abo: geraet('hans'), sichtbar: true });
  const vorfall = await schicke(hans, gabi.daten.id);
  const da = warteAuf(hans.client, 'student_arrived');
  gabi.client.emit('confirm_arrival', { incidentId: vorfall.id });
  await da;

  versendet.length = 0;
  gabi.client.emit('sichtbarkeit', { sichtbar: false });
  const wunsch = warteAuf(gabi.client, 'return_requested');
  hans.client.emit('request_return', { incidentId: vorfall.id });
  await wunsch;
  await kurz();
  assert.deepEqual(versendet.map(p => [p.adresse, p.nachricht.titel]), [[geraet('gabi').endpoint, 'Rückholwunsch']]);

  versendet.length = 0;
  hans.client.emit('sichtbarkeit', { sichtbar: false });
  const zurueck = warteAuf(hans.client, 'student_returning');
  gabi.client.emit('send_back', { incidentId: vorfall.id });
  await zurueck;
  await kurz();
  assert.deepEqual(versendet.map(p => [p.adresse, p.nachricht.titel]), [[geraet('hans').endpoint, 'Dein Schüler kommt zurück']]);
});

test('Nach dem Abmelden bekommt das Geraet nichts mehr', async () => {
  const ida = await lehrkraft('Ida Auf', { plaetze: 1, abo: geraet('ida') });
  const zweiterTab = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(zweiterTab, 'login_success');
  zweiterTab.emit('login', { schulId: '', token: ida.daten.token, room: '1' });
  await da;
  const abgemeldet = warteAuf(zweiterTab, 'logged_out');
  ida.client.emit('logout');
  await abgemeldet;

  await testserver.instanz.ablage.leeren();
  assert.ok(!testserver.instanz.ablage.inhalt().pushAbos.some(a => a.endpunkt === geraet('ida').endpoint),
    'das Abo steht noch in der Ablage');
});

test('Meldet der Dienst 410, verschwindet das Abo', async () => {
  const jana = await lehrkraft('Jana Auf', { plaetze: 3, abo: geraet('jana') });
  const kai = await lehrkraft('Kai Ab');
  antworten.set(geraet('jana').endpoint, Object.assign(new Error('Gone'), { statusCode: 410 }));
  versendet.length = 0;
  await schicke(kai, jana.daten.id);
  await kurz();
  assert.equal(versendet.length, 1);

  versendet.length = 0;
  await schicke(kai, jana.daten.id);
  await kurz();
  assert.equal(versendet.length, 0, 'an ein erloschenes Abo wird weiter geschickt');
  await testserver.instanz.ablage.leeren();
  assert.ok(!testserver.instanz.ablage.inhalt().pushAbos.some(a => a.endpunkt === geraet('jana').endpoint));
});

test('Abos an fremde Adressen werden abgelehnt', async () => {
  const lena = await lehrkraft('Lena Test');
  const antwort = await lena.client.emitWithAck('push_abo', { ...geraet('x'), endpoint: 'https://portal/oidc/token' });
  assert.deepEqual(antwort, { ok: false, grund: 'ungueltig' });
});

test('Rueckgaengig ersetzt den Alarm auf dem gesperrten Bildschirm', async () => {
  const ute = await lehrkraft('Ute Auf', { plaetze: 1, abo: geraet('ute') });
  const veit = await lehrkraft('Veit Ab', { sichtbar: true });
  const vorfall = await schicke(veit, ute.daten.id);
  await kurz();
  versendet.length = 0;

  assert.deepEqual(await veit.client.emitWithAck('rueckgaengig', { incidentId: vorfall.id }), { ok: true });
  await kurz();
  assert.equal(versendet.length, 1);
  const [push] = versendet;
  assert.equal(push.adresse, geraet('ute').endpoint);
  assert.equal(push.nachricht.titel, 'Verweisung zurückgenommen');
  // Dieselbe Kennung wie der Alarm: Die Benachrichtigung wird ersetzt, und
  // eine noch nicht zugestellte ersetzt schon der Push-Dienst.
  assert.equal(push.nachricht.tag, vorfall.id);
  assert.equal(push.optionen.topic, vorfall.id);
  assert.ok(!JSON.stringify(push.nachricht).includes('Veit'));
});

test('Der Selbsttest geht an genau dieses Geraet, auch bei offener App', async () => {
  const wolf = await lehrkraft('Wolf Test', { abo: geraet('wolf'), sichtbar: true });
  await lehrkraft('Xenia Andere', { abo: geraet('xenia') });
  versendet.length = 0;

  assert.deepEqual(await wolf.client.emitWithAck('push_test', { endpoint: geraet('wolf').endpoint }), { ok: true });
  assert.deepEqual(versendet.map(p => [p.adresse, p.nachricht.titel]), [[geraet('wolf').endpoint, 'Auszeit erreicht dich']]);
  assert.ok(!JSON.stringify(versendet[0].nachricht).includes('Wolf'));

  // Nicht im Sekundentakt - und nur an das eigene Geraet.
  assert.deepEqual(await wolf.client.emitWithAck('push_test', { endpoint: geraet('wolf').endpoint }), { ok: false, grund: 'zu_schnell' });
  assert.deepEqual(await wolf.client.emitWithAck('push_test', { endpoint: geraet('xenia').endpoint }), { ok: false, grund: 'kein_abo' });
  assert.equal(versendet.length, 1);
});

test('Lehnt der Dienst ein Abo ab, muss der Browser ein neues anlegen', async () => {
  const yara = await lehrkraft('Yara Auf', { plaetze: 1, abo: geraet('yara-alt') });
  const zeno = await lehrkraft('Zeno Ab');
  // Das Abo gehoert zu einem frueheren Schluessel des Servers.
  antworten.set(geraet('yara-alt').endpoint, Object.assign(new Error('Forbidden'), { statusCode: 403 }));
  versendet.length = 0;
  await schicke(zeno, yara.daten.id);
  await kurz();
  assert.equal(versendet.length, 1);
  await testserver.instanz.ablage.leeren();
  assert.ok(!testserver.instanz.ablage.inhalt().pushAbos.some(a => a.endpunkt === geraet('yara-alt').endpoint),
    'das abgelehnte Abo steht noch in der Ablage');

  // Nach der naechsten Anmeldung zeigt der Browser dasselbe tote Abo vor.
  // Eingetragen wird es nicht wieder, sonst stuende in der App "an".
  assert.deepEqual(await yara.client.emitWithAck('push_abo', geraet('yara-alt')), { ok: false, grund: 'erneuern' });
  assert.deepEqual(await yara.client.emitWithAck('push_abo', geraet('yara-neu')), { ok: true });
});

test('Der Selbsttest sagt, woran es haengt', async () => {
  const arne = await lehrkraft('Arne Test', { abo: geraet('arne') });
  const bea = await lehrkraft('Bea Test', { abo: geraet('bea') });
  const cem = await lehrkraft('Cem Test', { abo: geraet('cem') });

  // Abgelehnt: Das Abo muss neu angelegt werden.
  antworten.set(geraet('arne').endpoint, Object.assign(new Error('Forbidden'), { statusCode: 403 }));
  assert.deepEqual(await arne.client.emitWithAck('push_test', { endpoint: geraet('arne').endpoint }), { ok: false, grund: 'erneuern' });

  // Nicht erreichbar, etwa wegen einer Firewall: Bis wieder ein Versand
  // gelingt, sagt die App "gestoert" statt "an".
  antworten.set(geraet('bea').endpoint, Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' }));
  assert.deepEqual(await bea.client.emitWithAck('push_test', { endpoint: geraet('bea').endpoint }),
    { ok: false, grund: 'dienst_nicht_erreichbar' });
  assert.ok(testserver.fehler.some(z => z.includes('Push nicht zugestellt (ETIMEDOUT)')), 'kein Hinweis im Log');
  assert.deepEqual(await bea.client.emitWithAck('push_abo', geraet('bea')), { ok: true, stoerung: true });

  // Eine Stoerung beim Dienst selbst ist keine Stoerung des Weges nach draussen.
  antworten.set(geraet('cem').endpoint, Object.assign(new Error('Service Unavailable'), { statusCode: 503 }));
  assert.deepEqual(await cem.client.emitWithAck('push_test', { endpoint: geraet('cem').endpoint }), { ok: false, grund: 'fehler' });

  antworten.delete(geraet('cem').endpoint);
  const neuerTab = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(neuerTab, 'login_success');
  neuerTab.emit('login', { schulId: '', token: cem.daten.token, room: '1' });
  await da;
  assert.deepEqual(await neuerTab.emitWithAck('push_test', { endpoint: geraet('cem').endpoint }), { ok: true });
  assert.deepEqual(await bea.client.emitWithAck('push_abo', geraet('bea')), { ok: true });
});

test('Ein Abo uebersteht den Neustart', async () => {
  const mia = await lehrkraft('Mia Auf', { plaetze: 1, abo: geraet('mia') });
  for (const client of clients.splice(0)) client.close();
  await testserver.neustarten();

  // Mia ist nach dem Neustart nicht verbunden - ein Push muss trotzdem kommen.
  const nils = await lehrkraft('Nils Ab');
  const wieder = await tab(testserver.adresse, { sammlung: clients });
  const da = warteAuf(wieder, 'login_success');
  wieder.emit('login', { schulId: '', token: mia.daten.token, room: '1' });
  await da;
  const ok = warteAuf(wieder, 'status_updated');
  wieder.emit('update_status', { isAvailable: true, capacity: 1 });
  await ok;
  wieder.close();

  versendet.length = 0;
  await schicke(nils, mia.daten.id);
  await kurz();
  assert.deepEqual(versendet.map(p => p.adresse), [geraet('mia').endpoint]);
});
