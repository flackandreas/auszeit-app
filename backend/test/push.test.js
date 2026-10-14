const test = require('node:test');
const assert = require('node:assert/strict');
const { pushKonfiguration, abonnementPruefen, aboSchluessel } = require('../push');

const SCHLUESSEL = { p256dh: `B${'A'.repeat(86)}`, auth: 'abcdefghijklmnopqrstuv' };

test('Ohne VAPID-Schluessel ist Push aus, halb eingerichtet wird es gemeldet', () => {
  assert.equal(pushKonfiguration({}).aktiv, false);
  assert.deepEqual(pushKonfiguration({}).fehlend, []);

  const halb = pushKonfiguration({ AUSZEIT_VAPID_PUBLIC: 'x', AUSZEIT_VAPID_PRIVATE: 'y' });
  assert.equal(halb.aktiv, false);
  assert.deepEqual(halb.fehlend, ['AUSZEIT_VAPID_SUBJECT']);

  const http = pushKonfiguration({ AUSZEIT_VAPID_PUBLIC: 'x', AUSZEIT_VAPID_PRIVATE: 'y', AUSZEIT_VAPID_SUBJECT: 'http://schule.de' });
  assert.equal(http.aktiv, false, 'die Dienste verlangen mailto: oder https');

  for (const absender of ['mailto:it@schule.de', 'https://schule.de']) {
    assert.equal(pushKonfiguration({ AUSZEIT_VAPID_PUBLIC: 'x', AUSZEIT_VAPID_PRIVATE: 'y', AUSZEIT_VAPID_SUBJECT: absender }).aktiv, true);
  }
});

test('Abos der Push-Dienste von Google, Apple, Mozilla und Microsoft werden angenommen', () => {
  for (const endpoint of [
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://web.push.apple.com/QGv3J9KxF',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=BQYA'
  ]) {
    assert.ok(abonnementPruefen({ endpoint, keys: SCHLUESSEL }), endpoint);
  }
});

test('Andere Adressen nicht - der Server soll nichts im Hausnetz aufrufen', () => {
  for (const endpoint of [
    'http://fcm.googleapis.com/fcm/send/abc',      // ohne TLS
    'https://portal/oidc/token',                    // Container im Verbund
    'https://192.168.1.1/admin',
    'https://fcm.googleapis.com.boese.example/x',   // nur zum Schein
    'https://boesefcm.googleapis.com.example/x',
    'https://user:pass@fcm.googleapis.com/x',
    'https://fcm.googleapis.com:8443/x',
    'kein Link'
  ]) {
    assert.equal(abonnementPruefen({ endpoint, keys: SCHLUESSEL }), null, endpoint);
  }
});

test('Schluessel des Geraets muessen plausibel sein', () => {
  const endpoint = 'https://fcm.googleapis.com/fcm/send/abc';
  assert.equal(abonnementPruefen({ endpoint }), null);
  assert.equal(abonnementPruefen({ endpoint, keys: { ...SCHLUESSEL, auth: 'kurz' } }), null);
  assert.equal(abonnementPruefen({ endpoint, keys: { ...SCHLUESSEL, p256dh: 'nicht base64!' } }), null);
  assert.equal(abonnementPruefen(null), null);
});

test('Ein Geraet behaelt seinen Schluessel - das Abo wird umgehaengt, nicht verdoppelt', () => {
  assert.equal(aboSchluessel('https://fcm.googleapis.com/a'), aboSchluessel('https://fcm.googleapis.com/a'));
  assert.notEqual(aboSchluessel('https://fcm.googleapis.com/a'), aboSchluessel('https://fcm.googleapis.com/b'));
});
