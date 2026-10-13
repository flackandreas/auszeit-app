// Was das Portal von aussen an Auszeit prueft.
const test = require('node:test');
const assert = require('node:assert/strict');
const { starteTestserver } = require('./testserver');

let testserver;

test.before(async () => {
  testserver = await starteTestserver({
    standard: 'rstn',
    schulen: { rstn: { name: 'Testschule', pin: '4711' } }
  });
});

test.after(() => testserver.beenden());

test('healthz antwortet so, wie das Portal es erwartet', async () => {
  // Portal: Erreichbarkeit::frage() verlangt Status 200 und status === "ok".
  const antwort = await fetch(`${testserver.adresse}/healthz`);
  assert.equal(antwort.status, 200);
  assert.equal(antwort.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await antwort.json(), { status: 'ok', modul: 'auszeit' });
});

test('healthz verraet nichts ueber Mandanten oder Version', async () => {
  const text = await (await fetch(`${testserver.adresse}/healthz`)).text();
  for (const verraeterisch of ['rstn', 'Testschule', '4711', 'version']) {
    assert.ok(!text.includes(verraeterisch), `healthz enthaelt "${verraeterisch}"`);
  }
});
