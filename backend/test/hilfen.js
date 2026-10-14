// Gemeinsame Handgriffe der Tests.
const assert = require('node:assert/strict');
const { io: verbindeClient } = require('socket.io-client');

// Den Empfaenger immer vor dem Senden anlegen, sonst kann die Antwort schon
// da sein, bevor jemand zuhoert.
function warteAuf(client, ereignis, passt = () => true, ms = 2000) {
  return new Promise((resolve, reject) => {
    const zeit = setTimeout(() => {
      client.off(ereignis, empfang);
      reject(new Error(`"${ereignis}" ist nicht eingetroffen`));
    }, ms);
    function empfang(daten) {
      if (!passt(daten)) return;
      clearTimeout(zeit);
      client.off(ereignis, empfang);
      resolve(daten);
    }
    client.on(ereignis, empfang);
  });
}

// Ein Tab, wahlweise mit Sitzungscookie oder fremder Herkunft. Ohne
// automatische Wiederverbindung: den Reconnect spielen die Tests selbst nach.
function tab(adresse, { sitzung = null, herkunft = null, sammlung = [] } = {}) {
  const kopf = {};
  if (sitzung) kopf.cookie = `auszeit_sitzung=${sitzung}`;
  if (herkunft) kopf.origin = herkunft;
  const client = verbindeClient(adresse, {
    transports: ['websocket'],
    forceNew: true,
    reconnection: false,
    extraHeaders: kopf
  });
  sammlung.push(client);
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('connect_error', reject);
  });
}

// Wert eines Cookies aus den Set-Cookie-Koepfen einer Antwort, samt der
// ganzen Zeile fuer die Attribute.
function keksAus(antwort, name) {
  for (const zeile of antwort.headers.getSetCookie()) {
    const [paar] = zeile.split(';');
    const [schluessel, ...wert] = paar.split('=');
    if (schluessel.trim() === name) return { wert: wert.join('='), zeile };
  }
  return null;
}

// Der ganze Weg ueber das Portal, so wie der Browser ihn ginge: /sso/start,
// Anmeldung am Portal, /sso/rueckweg. Liefert die Antwort des Rueckwegs und
// das Sitzungscookie, falls eines gesetzt wurde.
async function ueberPortal(adresse, testportal, person, { anpassen = null, state = null } = {}) {
  const start = await fetch(`${adresse}/sso/start`, { redirect: 'manual' });
  assert.equal(start.status, 303, 'sso/start leitet nicht weiter');
  const vorgang = keksAus(start, 'auszeit_vorgang');
  assert.ok(vorgang && vorgang.wert, 'kein Vorgangscookie');

  const zurueck = testportal.autorisiere(start.headers.get('location'), person, anpassen);
  const suche = new URLSearchParams({ code: zurueck.code, state: state || zurueck.state });
  const antwort = await fetch(`${adresse}/sso/rueckweg?${suche}`, {
    redirect: 'manual',
    headers: { cookie: `auszeit_vorgang=${vorgang.wert}` }
  });
  const sitzung = keksAus(antwort, 'auszeit_sitzung');
  return {
    antwort,
    status: antwort.status,
    sitzung: sitzung && sitzung.wert ? sitzung.wert : null,
    keksZeile: sitzung ? sitzung.zeile : null,
    vorgang: vorgang.wert,
    anfrage: zurueck.anfrage,
    code: zurueck.code
  };
}

module.exports = { warteAuf, tab, keksAus, ueberPortal };
