// Anmeldung ueber das SchulOS-Portal - gegen ein Testportal mit echten
// Schluesseln, durch den ganzen Ablauf bis in die Socket-Verbindung.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestportal } = require('./testportal');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab, ueberPortal } = require('./hilfen');

let testportal;
let testserver;
let adresse;
const clients = [];

const RUECKADRESSE = 'http://auszeit.invalid/sso/rueckweg';

test.before(async () => {
  testportal = await starteTestportal();
  Object.assign(process.env, {
    PORTAL_ISSUER: testportal.aussteller,
    PORTAL_CLIENT_ID: testportal.clientId,
    PORTAL_CLIENT_SECRET: testportal.geheimnis,
    PORTAL_REDIRECT_URI: RUECKADRESSE,
    PORTAL_INTERN: testportal.intern,
    PORTAL_ZUGANG_GRUPPEN: 'Kollegium, Referendare',
    PORTAL_ADMIN_GRUPPEN: 'Schulleitung',
    PORTAL_NUR_SSO: '0'
  });
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: { rstn: { name: 'Testschule', pin: '4711' } }
  });
  adresse = testserver.adresse;
});

test.after(() => {
  for (const client of clients) client.close();
  testserver.beenden();
  testportal.beenden();
});

function person(kuerzel, sid, gruppen = ['Kollegium']) {
  return { sub: `sub-${kuerzel}`, sid, kuerzel, name: `Lehrkraft ${kuerzel}`, gruppen };
}

async function sitzungsAuskunft(sitzung) {
  return fetch(`${adresse}/api/sitzung`, { headers: { cookie: `auszeit_sitzung=${sitzung}` } });
}

async function imPortalTab(sitzung, room) {
  const client = await tab(adresse, { sitzung, sammlung: clients });
  const antwort = Promise.race([
    warteAuf(client, 'login_success'),
    warteAuf(client, 'login_failed').then(f => { throw new Error(`Anmeldung abgewiesen: ${f.grund}`); })
  ]);
  client.emit('login', { portal: true, schulId: '', room });
  return { client, daten: await antwort };
}

async function vorderkanal(sid, iss = testportal.aussteller) {
  return fetch(`${adresse}/sso/abmelden?${new URLSearchParams({ iss, sid })}`);
}

test('Anmeldung ueber das Portal: Name und Kuerzel aus dem Portal, Raum von der Lehrkraft', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('AN', 'sid-an'));
  assert.equal(anmeldung.status, 303);
  assert.equal(anmeldung.antwort.headers.get('location'), '/');
  assert.match(anmeldung.sitzung, /^[A-Za-z0-9_-]{43}$/);
  assert.match(anmeldung.keksZeile, /HttpOnly/i);
  assert.match(anmeldung.keksZeile, /SameSite=Lax/i);
  assert.match(anmeldung.keksZeile, /Path=\//);
  // Die Rueckadresse ist http - Secure waere hier falsch.
  assert.doesNotMatch(anmeldung.keksZeile, /Secure/i);

  // PKCE mit S256, state und nonce auf dem Hinweg.
  assert.equal(anmeldung.anfrage.get('code_challenge_method'), 'S256');
  assert.ok(anmeldung.anfrage.get('nonce'));
  assert.equal(anmeldung.anfrage.get('redirect_uri'), RUECKADRESSE);

  const auskunft = await (await sitzungsAuskunft(anmeldung.sitzung)).json();
  assert.deepEqual(auskunft, { name: 'Lehrkraft AN', kuerzel: 'AN', raum: '' });

  // Beim ersten Mal fehlt der Raum.
  const ohneRaum = await tab(adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const fehlt = warteAuf(ohneRaum, 'login_failed');
  ohneRaum.emit('login', { portal: true, schulId: '' });
  assert.equal((await fehlt).grund, 'raum_fehlt');

  const { daten } = await imPortalTab(anmeldung.sitzung, 'B12');
  assert.equal(daten.name, 'Lehrkraft AN');
  assert.equal(daten.room, 'B12');
  assert.equal(daten.token, undefined, 'Bei der Portal-Anmeldung steht das Token nur im Cookie');
});

test('Abrufe von Server zu Server laufen ueber PORTAL_INTERN', () => {
  // Der Aussteller http://schulos.invalid ist nicht erreichbar. Dass die
  // Anmeldung oben durchkam, ging nur ueber die interne Adresse.
  assert.ok(testportal.abrufe.includes('GET /.well-known/openid-configuration'));
  assert.ok(testportal.abrufe.includes('POST /oidc/token'));
  assert.ok(testportal.abrufe.includes('GET /oidc/jwks.json'));
});

test('Abgelehnte ID-Tokens fuehren zu keiner Sitzung', async (t) => {
  const faelle = {
    'fremder Empfaenger (aud)': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf, nutzdaten: { ...nutzdaten, aud: 'modul-antrag' }, schluessel }),
    'abgelaufen (exp)': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf, nutzdaten: { ...nutzdaten, iat: nutzdaten.iat - 7200, exp: nutzdaten.iat - 3600 }, schluessel }),
    'alg none': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf: { ...kopf, alg: 'none' }, nutzdaten, schluessel }),
    'HS256 mit dem oeffentlichen Schluessel': ({ kopf, nutzdaten, oeffentlichPem }) =>
      ({ kopf: { ...kopf, alg: 'HS256' }, nutzdaten, schluessel: oeffentlichPem }),
    'falsch signiert': ({ kopf, nutzdaten, fremd }) =>
      ({ kopf, nutzdaten, schluessel: fremd }),
    'fremder Aussteller (iss)': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf, nutzdaten: { ...nutzdaten, iss: 'http://boese.invalid' }, schluessel }),
    'falscher Einmalwert (nonce)': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf, nutzdaten: { ...nutzdaten, nonce: 'untergeschoben' }, schluessel }),
    'fremde berechtigte Partei (azp)': ({ kopf, nutzdaten, schluessel }) =>
      ({ kopf, nutzdaten: { ...nutzdaten, aud: [nutzdaten.aud, 'modul-antrag'], azp: 'modul-antrag' }, schluessel })
  };

  for (const [fall, anpassen] of Object.entries(faelle)) {
    await t.test(fall, async (st) => {
      const vorher = testserver.fehler.length;
      const anmeldung = await ueberPortal(adresse, testportal, person('XX', 'sid-xx'), { anpassen });
      assert.equal(anmeldung.status, 400);
      assert.equal(anmeldung.sitzung, null, 'trotz verdorbenem Token eine Sitzung');
      // Abgelehnt wegen des Tokens - nicht wegen eines anderen Fehlers.
      const grund = testserver.fehler.slice(vorher).join('\n');
      assert.match(grund, /Anmeldung ueber das Portal gescheitert/);
      assert.match(grund, /JWT|ID Token|alg|signature|claim/i);
      st.diagnostic(grund.replace(/^.*gescheitert:\s*/, ''));
    });
  }
});

test('Ein falscher state wird abgewiesen', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('ST', 'sid-st'), { state: 'untergeschoben' });
  assert.equal(anmeldung.status, 400);
  assert.equal(anmeldung.sitzung, null);
});

test('Ein Anmeldevorgang laesst sich nur einmal einloesen', async () => {
  const erste = await ueberPortal(adresse, testportal, person('EV', 'sid-ev'));
  assert.equal(erste.status, 303);

  const nochmal = await fetch(`${adresse}/sso/rueckweg?code=${erste.code}&state=${erste.anfrage.get('state')}`, {
    redirect: 'manual',
    headers: { cookie: `auszeit_vorgang=${erste.vorgang}` }
  });
  assert.equal(nochmal.status, 400);

  const ohneVorgang = await fetch(`${adresse}/sso/rueckweg?code=egal&state=egal`, { redirect: 'manual' });
  assert.equal(ohneVorgang.status, 400);
});

test('Zugang nur fuer die Gruppen aus PORTAL_ZUGANG_GRUPPEN', async () => {
  const schuelerin = await ueberPortal(adresse, testportal, person('SU', 'sid-su', ['Schüler']));
  assert.equal(schuelerin.status, 403);
  assert.equal(schuelerin.sitzung, null);

  // Gross- und Kleinschreibung zaehlt nicht.
  const referendar = await ueberPortal(adresse, testportal, person('RF', 'sid-rf', ['referendare']));
  assert.equal(referendar.status, 303);
  assert.ok(referendar.sitzung);
});

test('Abmeldung ueber den Vorderkanal beendet die Sitzung und meldet die Tabs ab', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('VK', 'sid-vk'));
  const { client } = await imPortalTab(anmeldung.sitzung, 'C3');

  // Fremder Aussteller oder fremde Sitzungskennung: nichts passiert.
  assert.equal((await vorderkanal('sid-vk', 'http://boese.invalid')).status, 204);
  assert.equal((await vorderkanal('sid-andere')).status, 204);
  assert.equal((await sitzungsAuskunft(anmeldung.sitzung)).status, 200);

  const abgemeldet = warteAuf(client, 'logged_out');
  const antwort = await vorderkanal('sid-vk');
  assert.equal(antwort.status, 204);
  // Nur das Portal darf die Seite einrahmen.
  assert.match(antwort.headers.get('content-security-policy'), /frame-ancestors http:\/\/schulos\.invalid/);
  await abgemeldet;

  assert.equal((await sitzungsAuskunft(anmeldung.sitzung)).status, 401);
  const spaeter = await tab(adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const abgewiesen = warteAuf(spaeter, 'login_failed');
  spaeter.emit('login', { portal: true, schulId: '', room: 'C3' });
  assert.equal((await abgewiesen).grund, 'portal_sitzung_fehlt');
});

test('Neue Portal-Anmeldung findet dieselbe Lehrkraft samt laufender Auszeit', async () => {
  const carla = person('CA', 'sid-ca-1');
  const erste = await ueberPortal(adresse, testportal, carla);
  const { client: carlaTab, daten: carlaDaten } = await imPortalTab(erste.sitzung, 'D4');
  const bereit = warteAuf(carlaTab, 'status_updated');
  carlaTab.emit('update_status', { isAvailable: true, capacity: 2 });
  await bereit;

  // Dirk meldet sich mit Code an - der Rueckfall bleibt.
  const dirk = await tab(adresse, { sammlung: clients });
  const dirkDa = warteAuf(dirk, 'login_success');
  dirk.emit('login', { schulId: '', name: 'Dirk', room: '108', pin: '4711' });
  await dirkDa;
  const geschickt = warteAuf(dirk, 'help_requested');
  dirk.emit('request_help', { receiverId: carlaDaten.id, studentName: 'Lena Beispiel' });
  const vorfall = (await geschickt).incident;

  // Die Portalsitzung endet, Carla meldet sich neu an.
  await vorderkanal('sid-ca-1');
  const zweite = await ueberPortal(adresse, testportal, { ...carla, sid: 'sid-ca-2' });
  const neuerTab = await tab(adresse, { sitzung: zweite.sitzung, sammlung: clients });
  const vorfaelle = warteAuf(neuerTab, 'sync_incidents');
  const wieder = warteAuf(neuerTab, 'login_success');
  neuerTab.emit('login', { portal: true, schulId: '', room: 'D4' });

  assert.equal((await wieder).id, carlaDaten.id);
  const laufend = await vorfaelle;
  assert.equal(laufend.length, 1);
  assert.equal(laufend[0].id, vorfall.id);
  assert.equal(laufend[0].studentName, 'Lena Beispiel');
});

test('Zweites Geraet: dieselbe Lehrkraft, aber eine eigene Sitzung', async () => {
  const eva = person('EW', 'sid-handy');
  const handy = await ueberPortal(adresse, testportal, eva);
  const tablet = await ueberPortal(adresse, testportal, { ...eva, sid: 'sid-tablet' });
  const { daten: amHandy } = await imPortalTab(handy.sitzung, 'E5');
  const { daten: amTablet } = await imPortalTab(tablet.sitzung, 'E5');
  assert.equal(amTablet.id, amHandy.id);

  // Abmelden am Handy laesst das Tablet angemeldet.
  await vorderkanal('sid-handy');
  assert.equal((await sitzungsAuskunft(handy.sitzung)).status, 401);
  assert.equal((await sitzungsAuskunft(tablet.sitzung)).status, 200);
});

test('Abmeldeknopf beendet die Sitzung und leitet zur Abmeldung beim Portal', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('AB', 'sid-ab'));
  const antwort = await fetch(`${adresse}/abmelden`, {
    method: 'POST',
    redirect: 'manual',
    headers: { cookie: `auszeit_sitzung=${anmeldung.sitzung}` }
  });
  assert.equal(antwort.status, 303);

  const ziel = new URL(antwort.headers.get('location'));
  assert.equal(`${ziel.origin}${ziel.pathname}`, 'http://schulos.invalid/oidc/abmelden');
  assert.ok(ziel.searchParams.get('id_token_hint'), 'ohne id_token_hint weiss das Portal nicht, wen es abmeldet');
  assert.equal(ziel.searchParams.get('post_logout_redirect_uri'), 'http://auszeit.invalid/');
  assert.equal((await sitzungsAuskunft(anmeldung.sitzung)).status, 401);
});

test('Fremde Herkunft wird beim Handshake abgewiesen', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('HK', 'sid-hk'));
  await assert.rejects(
    tab(adresse, { sitzung: anmeldung.sitzung, herkunft: 'http://antrag.invalid', sammlung: clients })
  );
  // Dieselbe Herkunft wie der Server: erlaubt.
  const eigene = await tab(adresse, { sitzung: anmeldung.sitzung, herkunft: adresse, sammlung: clients });
  assert.ok(eigene.connected);
});

test('Das Portal-Token gilt nicht als Token einer Code-Anmeldung', async () => {
  const anmeldung = await ueberPortal(adresse, testportal, person('PT', 'sid-pt'));
  const client = await tab(adresse, { sammlung: clients });
  const abgewiesen = warteAuf(client, 'login_failed');
  client.emit('login', { schulId: '', token: anmeldung.sitzung });
  assert.equal((await abgewiesen).grund, 'sitzung_ungueltig');
});

test('/api/schule nennt die Betriebsart', async () => {
  const schule = await (await fetch(`${adresse}/api/schule`)).json();
  assert.equal(schule.portal, true);
  assert.equal(schule.nurPortal, false);
  assert.equal(schule.pinNoetig, true);
});

test('Raum-PC: Meldet sich eine andere Lehrkraft im selben Browser an, endet die alte Sitzung', async () => {
  const erste = await ueberPortal(adresse, testportal, person('R1', 'sid-r1'));
  const { client } = await imPortalTab(erste.sitzung, 'F6');
  const abgemeldet = warteAuf(client, 'logged_out');

  // Derselbe Browser, also dasselbe Cookie - aber eine andere Person.
  const start = await fetch(`${adresse}/sso/start`, { redirect: 'manual' });
  const vorgang = start.headers.getSetCookie().find(z => z.startsWith('auszeit_vorgang=')).split(';')[0];
  const zurueck = testportal.autorisiere(start.headers.get('location'), person('R2', 'sid-r2'));
  const antwort = await fetch(`${adresse}/sso/rueckweg?code=${zurueck.code}&state=${zurueck.state}`, {
    redirect: 'manual',
    headers: { cookie: `${vorgang}; auszeit_sitzung=${erste.sitzung}` }
  });
  assert.equal(antwort.status, 303);
  await abgemeldet;
  assert.equal((await sitzungsAuskunft(erste.sitzung)).status, 401);
});

test('Dieselbe Lehrkraft oeffnet die Kachel erneut: offene Tabs laufen weiter', async () => {
  const erste = await ueberPortal(adresse, testportal, person('KA', 'sid-ka'));
  await imPortalTab(erste.sitzung, 'G7');

  const start = await fetch(`${adresse}/sso/start`, { redirect: 'manual' });
  const vorgang = start.headers.getSetCookie().find(z => z.startsWith('auszeit_vorgang=')).split(';')[0];
  const zurueck = testportal.autorisiere(start.headers.get('location'), person('KA', 'sid-ka'));
  const antwort = await fetch(`${adresse}/sso/rueckweg?code=${zurueck.code}&state=${zurueck.state}`, {
    redirect: 'manual',
    headers: { cookie: `${vorgang}; auszeit_sitzung=${erste.sitzung}` }
  });
  assert.equal(antwort.status, 303);
  assert.equal((await sitzungsAuskunft(erste.sitzung)).status, 200);
});
