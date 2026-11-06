// Abmeldung zum Stundenende am Raum-PC.
//
// Ein Browser am PC meldet sich als "geteilt": Dort sitzt nach dem Klingeln die
// naechste Klasse. Seine Sitzung endet mit der Stunde - ueber das Portal auch
// dort, sonst kaeme ein Schueler mit einem Klick auf die Kachel als die
// Lehrkraft wieder herein. Handy und Tablet bleiben angemeldet.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestportal } = require('./testportal');
const { starteTestserver } = require('./testserver');
const { warteAuf, tab, ueberPortal } = require('./hilfen');

// Ohne Klingelplan endet die Stunde nach der pauschalen Frist. Kurz, damit der
// Test sie abwarten kann.
const PAUSCHAL_MS = 400;

let testportal;
let testserver;
let adresse;
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
    PORTAL_NUR_SSO: '0'
  });
  testserver = await starteTestserver({ standard: 'rstn', schulen: { rstn: { name: 'Testschule' } } });
  adresse = testserver.adresse;
});

test.after(async () => {
  for (const client of clients) client.close();
  await testserver.beenden();
  testportal.beenden();
});

const warte = ms => new Promise(resolve => setTimeout(resolve, ms));

async function anmelden(daten) {
  const client = await tab(adresse, { sammlung: clients });
  const antwort = Promise.race([
    warteAuf(client, 'login_success'),
    warteAuf(client, 'login_failed')
  ]);
  client.emit('login', { schulId: '', room: '101', ...daten });
  return { client, daten: await antwort };
}

async function amPortal(kuerzel) {
  const anmeldung = await ueberPortal(adresse, testportal,
    { sub: `sub-${kuerzel}`, sid: `sid-${kuerzel}`, kuerzel, name: `Lehrkraft ${kuerzel}`, gruppen: [] });
  const client = await tab(adresse, { sitzung: anmeldung.sitzung, sammlung: clients });
  const da = warteAuf(client, 'login_success');
  client.emit('login', { portal: true, schulId: '', room: '102', geteilt: true });
  return { sitzung: anmeldung.sitzung, client, daten: await da };
}

function abmelden(sitzung) {
  return fetch(`${adresse}/abmelden`, {
    method: 'POST',
    redirect: 'manual',
    headers: sitzung ? { cookie: `auszeit_sitzung=${sitzung}` } : {}
  });
}

test('Am PC endet die Sitzung zum Stundenende, am Handy nicht', async () => {
  const vorher = Date.now();
  const pc = await anmelden({ name: 'Anna PC', geteilt: true });
  const handy = await anmelden({ name: 'Bernd Handy' });
  assert.ok(pc.daten.abmeldenUm >= vorher + PAUSCHAL_MS && pc.daten.abmeldenUm <= Date.now() + PAUSCHAL_MS);
  assert.equal(handy.daten.abmeldenUm, null);

  // Ein zweiter Tab desselben Browsers verschiebt nichts.
  const zweiterTab = await anmelden({ token: pc.daten.token, geteilt: true });
  assert.equal(zweiterTab.daten.abmeldenUm, pc.daten.abmeldenUm);

  // Vor der Zeit passiert nichts.
  testserver.instanz.pruefeStundenende();
  assert.equal((await anmelden({ token: pc.daten.token })).daten.id, pc.daten.id);

  let handyAbgemeldet = false;
  handy.client.on('logged_out', () => { handyAbgemeldet = true; });
  await warte(PAUSCHAL_MS + 50);
  const abgemeldet = warteAuf(pc.client, 'logged_out');
  const auchZweiter = warteAuf(zweiterTab.client, 'logged_out');
  testserver.instanz.pruefeStundenende();
  assert.deepEqual(await abgemeldet, { grund: 'stundenende' });
  assert.deepEqual(await auchZweiter, { grund: 'stundenende' });
  await warte(50);
  assert.equal(handyAbgemeldet, false);

  // Ein Tab, der zum Stundenende keine Verbindung hatte, erfaehrt es beim
  // Wiederverbinden - und meldet nicht still neu an.
  assert.deepEqual((await anmelden({ token: pc.daten.token, geteilt: true })).daten, { grund: 'stundenende' });
  assert.equal((await anmelden({ token: handy.daten.token })).daten.id, handy.daten.id);
});

test('"Angemeldet bleiben" schiebt die Abmeldung hinaus, fuer alle Tabs dieses Browsers', async () => {
  const pc = await anmelden({ name: 'Carla PC', geteilt: true });
  const zweiterTab = await anmelden({ token: pc.daten.token, geteilt: true });

  const mitgeteilt = warteAuf(zweiterTab.client, 'abmeldung_um');
  const antwort = await pc.client.emitWithAck('angemeldet_bleiben', {});
  assert.equal(antwort.ok, true);
  // Eine Stunde dran, gezaehlt vom bisherigen Ende.
  assert.equal(antwort.abmeldenUm, pc.daten.abmeldenUm + PAUSCHAL_MS);
  assert.deepEqual(await mitgeteilt, { abmeldenUm: antwort.abmeldenUm });

  // Ohne Abmeldezeit gibt es nichts zu verlaengern.
  const handy = await anmelden({ name: 'Dirk Handy' });
  assert.deepEqual(await handy.client.emitWithAck('angemeldet_bleiben', {}), { ok: false });
});

test('Bereit fuer die Doppelstunde: Der PC bleibt so lange angemeldet', async () => {
  const pc = await anmelden({ name: 'Eva PC', geteilt: true });
  const verschoben = warteAuf(pc.client, 'abmeldung_um');
  const stand = warteAuf(pc.client, 'status_updated');
  pc.client.emit('update_status', { isAvailable: true, capacity: 1, stunden: 2 });
  const { bereitBis } = await stand;
  assert.ok(bereitBis > pc.daten.abmeldenUm);
  assert.deepEqual(await verschoben, { abmeldenUm: bereitBis });
});

test('Ueber das Portal: Nach dem Stundenende geht es zur Abmeldung beim Portal', async () => {
  const pc = await amPortal('PC');
  assert.ok(pc.daten.abmeldenUm);

  await warte(PAUSCHAL_MS + 50);
  const abgemeldet = warteAuf(pc.client, 'logged_out');
  testserver.instanz.pruefeStundenende();
  assert.deepEqual(await abgemeldet, { grund: 'stundenende' });

  // Die Seite erfaehrt beim Laden, dass sie erst beim Portal abmelden muss.
  const auskunft = await fetch(`${adresse}/api/sitzung`, { headers: { cookie: `auszeit_sitzung=${pc.sitzung}` } });
  assert.equal(auskunft.status, 401);
  assert.deepEqual(await auskunft.json(), { fehler: 'stundenende' });
  // Ebenso ein Tab, der zum Stundenende schlief.
  const spaeter = await tab(adresse, { sitzung: pc.sitzung, sammlung: clients });
  const abgewiesen = warteAuf(spaeter, 'login_failed');
  spaeter.emit('login', { portal: true, schulId: '', room: '102', geteilt: true });
  assert.equal((await abgewiesen).grund, 'stundenende');

  const antwort = await abmelden(pc.sitzung);
  assert.equal(antwort.status, 303);
  const ziel = new URL(antwort.headers.get('location'));
  assert.equal(`${ziel.origin}${ziel.pathname}`, 'http://schulos.invalid/oidc/abmelden');
  assert.ok(ziel.searchParams.get('id_token_hint'));
  assert.equal(ziel.searchParams.get('post_logout_redirect_uri'), 'http://auszeit.invalid/');
  // Danach ist die Sitzung ganz vergessen; die Seite geht normal zur Anmeldung.
  const danach = await fetch(`${adresse}/api/sitzung`, { headers: { cookie: `auszeit_sitzung=${pc.sitzung}` } });
  assert.deepEqual(await danach.json(), { fehler: 'keine_sitzung' });

  // Ein zweiter Tab desselben Browsers, dessen Sitzung der erste eben beendet
  // hat, muss trotzdem zum Portal - sonst kaeme er ueber die noch offene
  // Portalsitzung gleich wieder hinein. Ohne Cookie - von einer fremden
  // Seite - nicht.
  const zweiter = await abmelden(pc.sitzung);
  const zweitesZiel = new URL(zweiter.headers.get('location'));
  assert.equal(zweitesZiel.pathname, '/oidc/abmelden');
  assert.equal(zweitesZiel.searchParams.get('id_token_hint'), null);
  assert.equal(zweitesZiel.searchParams.get('client_id'), testportal.clientId);
  assert.equal((await abmelden(null)).headers.get('location'), '/');
});

test('Ohne Abmeldung beim Portal stellt der Rueckweg keine neue Sitzung aus', async () => {
  const pc = await amPortal('KL');
  await warte(PAUSCHAL_MS + 50);
  testserver.instanz.pruefeStundenende();

  // Der Tab war zu, der Browser ist beim Portal noch angemeldet. Ein Klick
  // auf die Kachel - ohne Passwort - darf nicht hineinfuehren.
  const start = await fetch(`${adresse}/sso/start`, { redirect: 'manual' });
  const vorgang = start.headers.getSetCookie().find(z => z.startsWith('auszeit_vorgang=')).split(';')[0];
  const zurueck = testportal.autorisiere(start.headers.get('location'),
    { sub: 'sub-KL', sid: 'sid-KL', kuerzel: 'KL', name: 'Lehrkraft KL', gruppen: [] });
  const antwort = await fetch(`${adresse}/sso/rueckweg?code=${zurueck.code}&state=${zurueck.state}`, {
    redirect: 'manual',
    headers: { cookie: `${vorgang}; auszeit_sitzung=${pc.sitzung}` }
  });
  assert.equal(antwort.status, 303);
  assert.equal(antwort.headers.get('location'), '/');
  assert.equal(antwort.headers.getSetCookie().some(z => z.startsWith('auszeit_sitzung=') && !z.startsWith('auszeit_sitzung=;')), false);

  // Meldet das Portal ab, ist auch die beendete Sitzung ganz weg.
  await fetch(`${adresse}/sso/abmelden?${new URLSearchParams({ iss: testportal.aussteller, sid: 'sid-KL' })}`);
  const auskunft = await fetch(`${adresse}/api/sitzung`, { headers: { cookie: `auszeit_sitzung=${pc.sitzung}` } });
  assert.deepEqual(await auskunft.json(), { fehler: 'keine_sitzung' });
});

test('Abmeldezeit und Stundenende ueberstehen einen Neustart', async () => {
  const offen = await anmelden({ name: 'Gabi PC', geteilt: true });
  const vorbei = await anmelden({ name: 'Hans PC', geteilt: true });
  // Hans' Stunde ist vorbei, Gabis dank "Angemeldet bleiben" noch nicht.
  const verlaengert = await offen.client.emitWithAck('angemeldet_bleiben', {});
  await warte(PAUSCHAL_MS + 50);
  testserver.instanz.pruefeStundenende();
  await testserver.instanz.ablage.leeren();

  for (const client of clients.splice(0)) client.close();
  await testserver.neustarten();
  adresse = testserver.adresse;

  assert.equal((await anmelden({ token: offen.daten.token, geteilt: true })).daten.abmeldenUm, verlaengert.abmeldenUm);
  assert.deepEqual((await anmelden({ token: vorbei.daten.token, geteilt: true })).daten, { grund: 'stundenende' });
});

function hhmm(minuten) {
  return `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;
}

function heuteUm(hm) {
  const d = new Date();
  const [h, m] = hm.split(':').map(Number);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

// Zuletzt: Der Klingelplan gilt ab hier fuer die ganze Schule.
test('Mit Klingelplan: abgemeldet zum Ende der Stunde, "Angemeldet bleiben" bis zum Ende der naechsten', async (t) => {
  const minuten = new Date().getHours() * 60 + new Date().getMinutes();
  if (minuten < 15 || minuten > 22 * 60) {
    t.skip('zu nah an Mitternacht');
    return;
  }
  const plan = [
    { beginn: hhmm(minuten - 10), ende: hhmm(minuten + 20) },
    { beginn: hhmm(minuten + 25), ende: hhmm(minuten + 70) }
  ];
  const leitung = await ueberPortal(adresse, testportal,
    { sub: 'sub-SL', sid: 'sid-SL', kuerzel: 'SL', name: 'Schulleitung', gruppen: ['Schulleitung'] });
  const verwaltung = await tab(adresse, { sitzung: leitung.sitzung, sammlung: clients });
  const da = warteAuf(verwaltung, 'login_success');
  verwaltung.emit('login', { portal: true, schulId: '', room: 'SL' });
  await da;
  const gespeichert = await verwaltung.emitWithAck('einstellungen_speichern', {
    klingelplan: plan.map(s => `${s.beginn} - ${s.ende}`).join('\n')
  });
  assert.equal(gespeichert.ok, true);

  const pc = await anmelden({ name: 'Ida PC', geteilt: true });
  assert.equal(pc.daten.abmeldenUm, heuteUm(plan[0].ende));
  const antwort = await pc.client.emitWithAck('angemeldet_bleiben', {});
  assert.equal(antwort.abmeldenUm, heuteUm(plan[1].ende));
});
