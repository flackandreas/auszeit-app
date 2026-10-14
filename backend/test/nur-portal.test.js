// PORTAL_NUR_SSO=1: Jeder Weg hinein fuehrt ueber das Portal.
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
    PORTAL_REDIRECT_URI: 'https://auszeit.invalid/sso/rueckweg',
    PORTAL_INTERN: testportal.intern,
    PORTAL_NUR_SSO: '1'
  });
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: { rstn: { name: 'Testschule', pin: '4711' } }
  });
});

test.after(() => {
  for (const client of clients) client.close();
  testserver.beenden();
  testportal.beenden();
});

test('Die Anmeldemaske zeigt kein Codefeld', async () => {
  const schule = await (await fetch(`${testserver.adresse}/api/schule`)).json();
  assert.equal(schule.nurPortal, true);
  assert.equal(schule.pinNoetig, false);
});

test('Anmeldung mit Code wird abgelehnt, auch mit richtigem Code', async () => {
  const client = await tab(testserver.adresse, { sammlung: clients });
  const abgewiesen = warteAuf(client, 'login_failed');
  client.emit('login', { schulId: '', name: 'Mallory', room: '1', pin: '4711' });
  assert.equal((await abgewiesen).grund, 'nur_portal');
});

test('Anmeldung ueber das Portal funktioniert, mit Secure-Cookie bei https', async () => {
  const anmeldung = await ueberPortal(testserver.adresse, testportal,
    { sub: 'sub-np', sid: 'sid-np', kuerzel: 'NP', name: 'Nora Portal', gruppen: ['Kollegium'] });
  assert.equal(anmeldung.status, 303);
  assert.match(anmeldung.keksZeile, /Secure/);

  const client = await tab(testserver.adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: 'A1' });
  assert.equal((await da).name, 'Nora Portal');
});
