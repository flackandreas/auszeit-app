// Anmeldung und Wiederanmeldung ueber echte Socket-Verbindungen.
const test = require('node:test');
const assert = require('node:assert/strict');
const { io: verbindeClient } = require('socket.io-client');
const { starteTestserver } = require('./testserver');
const { warteAuf } = require('./hilfen');

let testserver;
let adresse;
const clients = [];

test.before(async () => {
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: {
      rstn: { name: 'Testschule', pin: '4711' },
      andere: { name: 'Andere Schule' }
    }
  });
  adresse = testserver.adresse;
});

test.after(() => {
  for (const client of clients) client.close();
  testserver.beenden();
});

// Ein Tab. Ohne automatische Wiederverbindung: den Reconnect spielen die
// Tests selbst nach, mit einer neuen Verbindung.
function tab() {
  const client = verbindeClient(adresse, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false
  });
  clients.push(client);
  return new Promise(resolve => client.once('connect', () => resolve(client)));
}

async function anmelden(client, felder) {
  const antwort = Promise.race([
    warteAuf(client, 'login_success'),
    warteAuf(client, 'login_failed').then(f => { throw new Error(`Anmeldung abgewiesen: ${f.grund}`); })
  ]);
  client.emit('login', { schulId: 'rstn', pin: '4711', room: '101', ...felder });
  return antwort;
}

async function bereitMelden(client, plaetze) {
  const antwort = warteAuf(client, 'status_updated');
  client.emit('update_status', { isAvailable: true, capacity: plaetze });
  return antwort;
}

async function schicke(sender, empfaengerId, studentName) {
  const antwort = warteAuf(sender, 'help_requested');
  sender.emit('request_help', { receiverId: empfaengerId, studentName });
  const ergebnis = await antwort;
  assert.equal(ergebnis.success, true, 'Verweisung wurde abgelehnt');
  return ergebnis.incident;
}

test('Login mit fremder oeffentlicher Kennung scheitert', async () => {
  const anna = await tab();
  const annaDaten = await anmelden(anna, { name: 'Anna' });
  await bereitMelden(anna, 1);

  const bernd = await tab();
  await anmelden(bernd, { name: 'Bernd' });
  await schicke(bernd, annaDaten.id, 'Max Muster');

  // Die Angreiferin kennt den Beitrittscode und sieht Annas Kennung in der
  // Kollegenliste. Das Token steht dort nicht.
  const mallory = await tab();
  const liste = warteAuf(mallory, 'available_teachers', l => l.length > 0);
  await anmelden(mallory, { name: 'Mallory' });
  await bereitMelden(anna, 2);
  const eintrag = (await liste).find(t => t.id === annaDaten.id);
  assert.ok(eintrag, 'Anna fehlt in der Liste');
  assert.deepEqual(Object.keys(eintrag).sort(), ['capacity', 'id', 'name', 'room']);

  // 1. Die Kennung als Token vorzeigen.
  const fremd = await tab();
  const abgewiesen = warteAuf(fremd, 'login_failed');
  fremd.emit('login', { schulId: 'rstn', token: annaDaten.id });
  assert.equal((await abgewiesen).grund, 'sitzung_ungueltig');

  // 2. Die Kennung wie frueher als teacherId mitschicken. Das ergibt eine
  //    neue, eigene Lehrkraft - nicht Anna, und ohne Annas Vorfaelle.
  const zweiter = await tab();
  const vorfaelle = warteAuf(zweiter, 'sync_incidents');
  const uebernahme = await anmelden(zweiter, { name: 'Mallory', teacherId: annaDaten.id });
  assert.notEqual(uebernahme.id, annaDaten.id);
  assert.deepEqual(await vorfaelle, []);

  // Anna ist unveraendert dieselbe.
  const annaListe = warteAuf(bernd, 'available_teachers');
  await bereitMelden(anna, 3);
  const annaJetzt = (await annaListe).find(t => t.id === annaDaten.id);
  assert.equal(annaJetzt.name, 'Anna');
});

test('Reconnect mit Token stellt Aufnahmebereitschaft, Plaetze und laufende Vorfaelle wieder her', async () => {
  const carla = await tab();
  const carlaDaten = await anmelden(carla, { name: 'Carla', room: '204' });
  assert.match(carlaDaten.token, /^[A-Za-z0-9_-]{43}$/);
  await bereitMelden(carla, 2);

  const dirk = await tab();
  const dirkDaten = await anmelden(dirk, { name: 'Dirk', room: '108' });
  const vorfall = await schicke(dirk, carlaDaten.id, 'Lena Beispiel');

  const angekommen = warteAuf(dirk, 'student_arrived');
  carla.emit('confirm_arrival', { incidentId: vorfall.id });
  await angekommen;

  // Verbindung weg - Bildschirmsperre, WLAN-Wechsel. Dirk sieht Carla als
  // nicht erreichbar.
  const offline = warteAuf(dirk, 'sync_incidents', l => l.some(v => v.receiverOnline === false));
  carla.close();
  await offline;

  // Neue Verbindung, nur mit dem Token: kein Name, kein Code.
  const carla2 = await tab();
  const vorfaelle = warteAuf(carla2, 'sync_incidents');
  const liste = warteAuf(dirk, 'available_teachers', l => l.some(t => t.id === carlaDaten.id));
  const wieder = await anmelden(carla2, { token: carlaDaten.token, pin: undefined, room: undefined });

  assert.equal(wieder.id, carlaDaten.id);
  assert.equal(wieder.name, 'Carla');
  assert.equal(wieder.room, '204');
  assert.equal(wieder.isAvailable, true);
  assert.equal(wieder.plaetze, 2);
  assert.equal(wieder.token, undefined, 'Das Token geht nur bei der Erstanmeldung raus');

  const laufend = await vorfaelle;
  assert.equal(laufend.length, 1);
  assert.equal(laufend[0].id, vorfall.id);
  assert.equal(laufend[0].status, 'betreut');
  assert.equal(laufend[0].studentName, 'Lena Beispiel');
  assert.equal(laufend[0].senderId, dirkDaten.id);

  // Ein Platz ist durch Lena belegt, einer frei.
  const carlaInListe = (await liste).find(t => t.id === carlaDaten.id);
  assert.equal(carlaInListe.capacity, 1);

  // Und die Sitzung ist wirklich wieder handlungsfaehig.
  const rueckweg = warteAuf(dirk, 'student_returning');
  carla2.emit('send_back', { incidentId: vorfall.id });
  assert.equal((await rueckweg).id, vorfall.id);
});

test('Abmelden widerruft das Token und meldet alle Tabs der Sitzung ab', async () => {
  const erster = await tab();
  const daten = await anmelden(erster, { name: 'Eva' });

  const zweiter = await tab();
  await anmelden(zweiter, { token: daten.token });

  const abgemeldet = warteAuf(zweiter, 'logged_out');
  erster.emit('logout');
  await abgemeldet;

  const spaeter = await tab();
  const abgewiesen = warteAuf(spaeter, 'login_failed');
  spaeter.emit('login', { schulId: 'rstn', token: daten.token });
  assert.equal((await abgewiesen).grund, 'sitzung_ungueltig');
});

test('Abmelden ohne Verbindung widerruft das Token nach dem Reconnect', async () => {
  const client = await tab();
  const daten = await anmelden(client, { name: 'Gerd' });
  client.close();

  // Die gepufferte Abmeldung kommt auf einer neuen, noch nicht angemeldeten
  // Verbindung an - nur mit dem Token.
  const neu = await tab();
  neu.emit('logout', { token: daten.token });

  const abgewiesen = warteAuf(neu, 'login_failed');
  neu.emit('login', { schulId: 'rstn', token: daten.token });
  assert.equal((await abgewiesen).grund, 'sitzung_ungueltig');
});

test('Wiederanmeldung bleibt bei der eigenen Schule', async () => {
  const client = await tab();
  const daten = await anmelden(client, { name: 'Frank' });

  const fremd = await tab();
  const abgewiesen = warteAuf(fremd, 'login_failed');
  fremd.emit('login', { schulId: 'andere', token: daten.token });
  assert.equal((await abgewiesen).grund, 'kennung_fremder_schule');
});

test('Erstanmeldung verlangt weiterhin den Beitrittscode', async () => {
  const client = await tab();
  const abgewiesen = warteAuf(client, 'login_failed');
  client.emit('login', { schulId: 'rstn', name: 'Gast', room: '1', pin: 'falsch' });
  assert.equal((await abgewiesen).grund, 'pin_falsch');
});
