// Sicherheitskoepfe: keine fremden Skripte, kein Einrahmen durch fremde Seiten.
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { starteTestserver } = require('./testserver');

let testserver;

test.before(async () => {
  // Die Verwaltung unter /admin auf dem Port der App - dort trifft ihre
  // Richtlinie auf die der App.
  process.env.AUSZEIT_ADMIN_TOKEN = 'ein-langes-verwaltungs-token';
  delete process.env.AUSZEIT_ADMIN_PORT;
  testserver = await starteTestserver({ standard: 'schule', schulen: { schule: { name: 'Testschule' } } });
});

test.after(async () => {
  await testserver.beenden();
});

function richtlinie(antwort) {
  return Object.fromEntries(antwort.headers.get('content-security-policy')
    .split(';').map(teil => teil.trim().split(/\s+/)).map(([name, ...werte]) => [name, werte]));
}

test('Die App laedt nur Eigenes und laesst sich nicht einrahmen', async () => {
  for (const pfad of ['/healthz', '/api/schule']) {
    const antwort = await fetch(`${testserver.adresse}${pfad}`);
    assert.equal(antwort.status, 200, pfad);
    const csp = richtlinie(antwort);
    assert.deepEqual(csp['default-src'], ["'self'"], pfad);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"], pfad);
    assert.deepEqual(csp['object-src'], ["'none'"], pfad);
    // Weder Skripte noch Stile aus dem Dokument selbst.
    assert.ok(!antwort.headers.get('content-security-policy').includes('unsafe-inline'), pfad);
    assert.equal(antwort.headers.get('x-frame-options'), 'DENY', pfad);
    assert.equal(antwort.headers.get('x-content-type-options'), 'nosniff', pfad);
    assert.equal(antwort.headers.get('referrer-policy'), 'same-origin', pfad);
  }
});

test('Die Verwaltung erlaubt genau ihr eigenes Skript', async () => {
  const antwort = await fetch(`${testserver.adresse}/admin/`);
  assert.equal(antwort.status, 200);
  const csp = richtlinie(antwort);

  // Der Hash muss zum Skript passen, das tatsaechlich ausgeliefert wird -
  // sonst bliebe die Verwaltungsseite leer.
  const html = await antwort.text();
  assert.equal(html, fs.readFileSync(path.join(__dirname, '..', 'admin.html'), 'utf8'));
  const skripte = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(skripte.length, 1);
  const hash = crypto.createHash('sha256').update(skripte[0][1], 'utf8').digest('base64');
  assert.deepEqual(csp['script-src'], [`'sha256-${hash}'`]);
  assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
  assert.equal(antwort.headers.get('x-frame-options'), 'DENY');
});
