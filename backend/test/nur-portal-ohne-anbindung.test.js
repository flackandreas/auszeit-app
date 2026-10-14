// PORTAL_NUR_SSO=1 bei unvollstaendiger Portal-Konfiguration.
//
// Bewusst strenger als die PHP-Module: Die Anmeldung mit Code bleibt zu. Im
// Verbund laeuft Auszeit ohne Beitrittscode - ein vergessenes Geheimnis in
// der .env oeffnete sonst die Tuer fuer jede und jeden.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab } = require('./hilfen');

let testserver;
const clients = [];

test.before(async () => {
  Object.assign(process.env, {
    PORTAL_ISSUER: 'http://schulos.invalid',
    PORTAL_CLIENT_ID: 'modul-auszeit',
    PORTAL_CLIENT_SECRET: '',
    PORTAL_REDIRECT_URI: 'http://auszeit.invalid/sso/rueckweg',
    PORTAL_NUR_SSO: '1'
  });
  testserver = await starteTestserver({ schulen: { standard: { name: 'Ohne Code' } } });
});

test.after(() => {
  for (const client of clients) client.close();
  testserver.beenden();
});

test('Die fehlende Angabe steht im Log', () => {
  assert.ok(testserver.fehler.some(z => z.includes('PORTAL_CLIENT_SECRET')));
  assert.ok(testserver.fehler.some(z => z.includes('niemand kann sich anmelden')));
});

test('Die Anmeldung mit Code bleibt trotzdem zu', async () => {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const abgewiesen = warteAuf(client, 'login_failed');
  client.emit('login', { schulId: '', name: 'Gast', room: '1' });
  assert.equal((await abgewiesen).grund, 'nur_portal');
});

test('Der Weg ueber das Portal fuehrt ins Leere statt in einen Fehler', async () => {
  const antwort = await fetch(`${testserver.adresse}/sso/start`, { redirect: 'manual' });
  assert.equal(antwort.status, 303);
  assert.equal(antwort.headers.get('location'), '/');
});
