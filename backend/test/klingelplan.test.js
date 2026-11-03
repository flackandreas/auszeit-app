// Klingelplan: eingefuegte Zeilen zerlegen, das Ende einer Bereitschaft finden.
const test = require('node:test');
const assert = require('node:assert/strict');
const { zerlegeKlingelplan, stundenenden } = require('../klingelplan');

const PLAN = [
  { beginn: '07:45', ende: '08:30' },
  { beginn: '08:30', ende: '09:15' },
  { beginn: '09:35', ende: '10:20' }
];

// Ortszeit, wie im Container. Der 3. November 2026 ist ein Dienstag.
function um(stunde, minute) {
  return new Date(2026, 10, 3, stunde, minute).getTime();
}

test('Zeilen in gemischter Schreibweise ergeben denselben Plan', () => {
  const { stunden, fehler } = zerlegeKlingelplan([
    '1. Stunde 7:45 - 8:30',
    '',
    '3. Std. 09.35–10.20',
    '2) 08:30 bis 09:15   '
  ].join('\n'));
  assert.deepEqual(fehler, []);
  // Sortiert nach Beginn, Uhrzeiten zweistellig.
  assert.deepEqual(stunden, PLAN);
});

test('Was nicht passt, steht mit Zeile und Grund in den Fehlern', () => {
  const { fehler } = zerlegeKlingelplan([
    '1. Stunde 7:45',
    '2. Stunde 8:30 - 9:15',
    'Pause 9:15 - 9:15',
    '3. Stunde 25:00 - 26:00',
    '4. Stunde 9:00 - 9:40'
  ].join('\n'));
  assert.deepEqual(fehler.map(f => [f.zeile, f.grund]), [
    [1, 'Beginn und Ende erwartet, etwa 7:45 - 8:30'],
    [3, 'Das Ende liegt vor dem Beginn'],
    [4, 'Keine gültige Uhrzeit'],
    [5, 'Überschneidet sich mit der Stunde davor']
  ]);
});

test('Ein leerer Plan ist erlaubt', () => {
  assert.deepEqual(zerlegeKlingelplan('  \n'), { stunden: [], fehler: [] });
});

test('Die Bereitschaft endet mit der laufenden Stunde oder der danach', () => {
  // Mitten in der ersten Stunde.
  assert.deepEqual(stundenenden(PLAN, um(8, 0)), [um(8, 30), um(9, 15)]);
  // In der grossen Pause zaehlt schon die naechste Stunde.
  assert.deepEqual(stundenenden(PLAN, um(9, 20)), [um(10, 20)]);
  // Vor Schulbeginn die erste.
  assert.deepEqual(stundenenden(PLAN, um(7, 0)), [um(8, 30), um(9, 15)]);
  // Nach der letzten Stunde gibt es kein Ende nach Plan.
  assert.deepEqual(stundenenden(PLAN, um(11, 0)), []);
  assert.deepEqual(stundenenden([], um(8, 0)), []);
});

test('Kurz vor dem Klingeln zaehlt schon die naechste Stunde', () => {
  assert.deepEqual(stundenenden(PLAN, um(8, 27)), [um(9, 15), um(10, 20)]);
  assert.deepEqual(stundenenden(PLAN, um(8, 24)), [um(8, 30), um(9, 15)]);
});
