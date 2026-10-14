const test = require('node:test');
const assert = require('node:assert/strict');
const { stichtagAus, schuljahrVon, schuljahrText } = require('../schuljahr');

// Ortszeit wie an der Schule: new Date(Jahr, Monat - 1, Tag, ...).

test('Vorgabe: Das Schuljahr beginnt am 1. August um Mitternacht', () => {
  const stichtag = stichtagAus(undefined);
  assert.equal(schuljahrVon(new Date(2027, 6, 31, 23, 59, 59), stichtag), 2026);
  assert.equal(schuljahrVon(new Date(2027, 7, 1, 0, 0, 0), stichtag), 2027);
  assert.equal(schuljahrVon(new Date(2027, 0, 15), stichtag), 2026);
  assert.equal(schuljahrVon(new Date(2026, 9, 13), stichtag), 2026);
});

test('Ein eingestellter Stichtag verschiebt den Wechsel', () => {
  const stichtag = stichtagAus('09-15');
  assert.deepEqual(stichtag, { monat: 9, tag: 15 });
  assert.equal(schuljahrVon(new Date(2027, 8, 14, 23, 59), stichtag), 2026);
  assert.equal(schuljahrVon(new Date(2027, 8, 15, 0, 0), stichtag), 2027);
});

test('Unbrauchbare Stichtage fallen auf den 1. August zurueck', () => {
  for (const falsch of ['', '8-1', '13-01', '02-30', '02-29', 'August', '08-01-2026']) {
    assert.deepEqual(stichtagAus(falsch), { monat: 8, tag: 1 }, `"${falsch}"`);
  }
});

test('Schreibweise des Schuljahres', () => {
  assert.equal(schuljahrText(2026), '2026/27');
  assert.equal(schuljahrText(2099), '2099/00');
});
