const test = require('node:test');
const assert = require('node:assert/strict');
const { erstelleSitzungen } = require('../sitzungen');

// Eine Uhr, die nur weiterlaeuft, wenn der Test es sagt.
function stehendeUhr(start = 1_000_000) {
  let jetzt = start;
  return { jetzt: () => jetzt, vor: (ms) => { jetzt += ms; } };
}

test('ausgestelltes Token fuehrt zur Lehrkraft', () => {
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000 });
  const token = sitzungen.ausstellen('kennung-a');
  assert.equal(sitzungen.pruefen(token), 'kennung-a');
});

test('Tokens sind zufaellig und haben 256 Bit', () => {
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000 });
  const a = sitzungen.ausstellen('kennung-a');
  const b = sitzungen.ausstellen('kennung-a');
  assert.notEqual(a, b);
  assert.equal(Buffer.from(a, 'base64url').length, 32);
});

test('abgelaufenes Token wird abgewiesen', () => {
  const uhr = stehendeUhr();
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000, jetzt: uhr.jetzt });
  const token = sitzungen.ausstellen('kennung-a');

  uhr.vor(999);
  assert.equal(sitzungen.pruefen(token), 'kennung-a');
  uhr.vor(1);
  assert.equal(sitzungen.pruefen(token), null);
});

test('der Ablauf gleitet nicht mit der Benutzung mit', () => {
  // Ein Raum-PC verbindet staendig neu. Haelte das die Sitzung am Leben,
  // liefe sie nie ab.
  const uhr = stehendeUhr();
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000, jetzt: uhr.jetzt });
  const token = sitzungen.ausstellen('kennung-a');
  for (let i = 0; i < 9; i++) {
    uhr.vor(100);
    assert.equal(sitzungen.pruefen(token), 'kennung-a');
  }
  uhr.vor(100);
  assert.equal(sitzungen.pruefen(token), null);
});

test('Widerruf trifft alle Tokens der Lehrkraft und nur diese', () => {
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000 });
  const a1 = sitzungen.ausstellen('kennung-a');
  const a2 = sitzungen.ausstellen('kennung-a');
  const b = sitzungen.ausstellen('kennung-b');

  assert.equal(sitzungen.widerrufeFuer('kennung-a'), 2);
  assert.equal(sitzungen.pruefen(a1), null);
  assert.equal(sitzungen.pruefen(a2), null);
  assert.equal(sitzungen.pruefen(b), 'kennung-b');
});

test('Aufraeumen entfernt nur abgelaufene Tokens', () => {
  const uhr = stehendeUhr();
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000, jetzt: uhr.jetzt });
  sitzungen.ausstellen('kennung-a');
  uhr.vor(500);
  const spaeter = sitzungen.ausstellen('kennung-b');
  uhr.vor(600);

  assert.equal(sitzungen.aufraeumen(), 1);
  assert.equal(sitzungen.anzahl, 1);
  assert.equal(sitzungen.pruefen(spaeter), 'kennung-b');
});

test('Kennungen, fremde Formate und Unsinn sind kein Token', () => {
  const sitzungen = erstelleSitzungen({ gueltigMs: 1000 });
  const kennung = 'kennung-a';
  sitzungen.ausstellen(kennung);

  for (const wert of [kennung, '', 'x'.repeat(43), 'x'.repeat(10_000), null, undefined, 42, {}, ['a']]) {
    assert.equal(sitzungen.pruefen(wert), null);
  }
});

test('Zur Abmeldezeit faellig, danach beendet: nichts mehr offen, aber noch erkennbar', () => {
  const uhr = stehendeUhr();
  const sitzungen = erstelleSitzungen({ gueltigMs: 10_000, jetzt: uhr.jetzt });
  const raumPc = sitzungen.ausstellen('kennung-a', { portal: true, idToken: 'id' });
  const handy = sitzungen.ausstellen('kennung-a');
  const schluessel = sitzungen.sitzung(raumPc).schluessel;

  sitzungen.setzeAbmeldung(schluessel, uhr.jetzt() + 1000);
  assert.equal(sitzungen.abmeldenUm(schluessel), uhr.jetzt() + 1000);
  assert.deepEqual(sitzungen.faellig(), []);
  uhr.vor(1000);
  assert.deepEqual(sitzungen.faellig(), [schluessel]);

  sitzungen.beenden(schluessel);
  assert.deepEqual(sitzungen.faellig(), []);
  assert.equal(sitzungen.sitzung(raumPc), null);
  assert.equal(sitzungen.pruefen(raumPc), null);
  assert.equal(sitzungen.gueltig(schluessel), false);
  assert.equal(sitzungen.abmeldenUm(schluessel), null);
  // Fuer die Abmeldung beim Portal bleibt sie mit ihrem ID-Token erkennbar.
  assert.equal(sitzungen.beendete(raumPc).idToken, 'id');
  // Das Handy derselben Lehrkraft hat damit nichts zu tun.
  assert.equal(sitzungen.pruefen(handy), 'kennung-a');
  assert.equal(sitzungen.beendete(handy), null);

  // Mit dem Ablauf ist auch die beendete Sitzung weg.
  uhr.vor(9000);
  assert.equal(sitzungen.beendete(raumPc), null);
});
