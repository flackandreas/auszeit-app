const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const {
  zerlegeListe, zerlegeZeile, normalisiereKlasse, schluesselVon, planeImport, istKlasse
} = require('../schueler');

// Rund 30 Zeilen, so gemischt, wie sie aus verschiedenen Quellen
// zusammenkopiert werden: Export aus ASV-BW und Untis (Tabulator, Semikolon),
// IServ ("Nachname, Vorname"), von Hand getippt, nummeriert, mit Umlauten -
// dazu drei Zeilen, die nicht passen. Dieselbe Liste benutzt der Test des
// Imports ueber die Socket-Verbindung.
const GEMISCHT = fs.readFileSync(path.join(__dirname, 'beispiele', 'schuelerliste-gemischt.txt'), 'utf8');

test('Gemischte Liste aus rund 30 Zeilen', () => {
  const { eintraege, fehler } = zerlegeListe(GEMISCHT);
  assert.equal(eintraege.length, 30);

  const finde = (klasse, nachname) => eintraege.find(e => e.klasse === klasse && e.nachname === nachname);
  assert.deepEqual(
    (({ klasse, vorname, nachname }) => ({ klasse, vorname, nachname }))(finde('7a', 'Müller')),
    { klasse: '7a', vorname: 'Anna', nachname: 'Müller' }
  );
  assert.equal(finde('7a', 'Klein').vorname, 'Lea', 'Tabellenexport: erst Familienname, dann Rufname');
  assert.equal(finde('7a', 'Hoffmann').vorname, 'Mia Sophie');
  assert.equal(finde('7a', 'Schulz').vorname, 'Paul', 'Klasse am Zeilenende');
  assert.equal(finde('7a', 'Richter').vorname, 'Noah', 'Nummerierung entfernt');
  assert.equal(finde('7a', 'Neumann').klasse, '7a', '07A ist 7a');
  assert.equal(finde('7b', 'Lange').vorname, 'Emil', 'Klasse in der letzten Spalte');
  assert.equal(finde('7b', 'von der Heide').vorname, 'Maria');
  assert.equal(finde('J1', 'König').vorname, 'Felix');
  assert.equal(finde('J1', 'Walter').vorname, 'Ella', 'j1 ist J1');

  assert.deepEqual(fehler.map(f => [f.zeile, f.grund]), [
    [32, 'Doppelt in der Liste'],
    [33, 'Keine Klasse erkannt'],
    [34, 'Vor- und Nachname noetig']
  ]);
});

test('Beide Schreibweisen ergeben denselben Schluessel', () => {
  const formen = ['7a; Müller, Anna', '7a Anna Müller', '7A\tMüller\tAnna', 'Mueller, Anna 7a', '7a ANNA MÜLLER'];
  const schluessel = formen.map(f => {
    const z = zerlegeZeile(f);
    return schluesselVon(z.klasse, z.vorname, z.nachname);
  });
  assert.equal(new Set(schluessel).size, 1, schluessel.join(' / '));

  const heide = ['7b; von der Heide, Maria', '7b Maria von der Heide'].map(f => {
    const z = zerlegeZeile(f);
    return schluesselVon(z.klasse, z.vorname, z.nachname);
  });
  assert.equal(heide[0], heide[1]);
  assert.equal(schluesselVon('7b', 'René', 'Lefèvre'), schluesselVon('7b', 'Rene', 'Lefevre'));
});

test('Klassen werden erkannt und vereinheitlicht', () => {
  for (const k of ['5a', '10b', '7', 'J1', 'Q2', 'EF', '5.1']) assert.ok(istKlasse(k), k);
  for (const k of ['Anna', 'Müller', 'von', 'a']) assert.ok(!istKlasse(k), k);
  assert.equal(normalisiereKlasse('07A'), '7a');
  assert.equal(normalisiereKlasse('10 b'), '10b');
  assert.equal(normalisiereKlasse('ef'), 'EF');
  assert.equal(normalisiereKlasse('j1'), 'J1');
});

test('Abgleich: zweiter Import derselben Liste bringt nichts Neues', () => {
  const { eintraege } = zerlegeListe(GEMISCHT);
  const bestand = eintraege.map((e, i) => ({ ...e, kennung: `s${i}`, archiviertAm: null }));
  const plan = planeImport(bestand, zerlegeListe(GEMISCHT).eintraege);
  assert.equal(plan.neu.length, 0);
  assert.equal(plan.reaktiviert.length, 0);
  assert.equal(plan.archiviert.length, 0);
  assert.equal(plan.bleibt.length, 30);
});

test('Abgleich: Wer in einer eingefuegten Klasse fehlt, wird archiviert - andere Klassen bleiben', () => {
  const { eintraege } = zerlegeListe(GEMISCHT);
  const bestand = eintraege.map((e, i) => ({ ...e, kennung: `s${i}`, archiviertAm: null }));
  // Nur 7a neu eingefuegt, ohne Anna Mueller, dafuer mit einem Neuen.
  const siebenA = zerlegeListe(GEMISCHT).eintraege
    .filter(e => e.klasse === '7a' && e.nachname !== 'Müller')
    .map(e => `${e.klasse}; ${e.nachname}, ${e.vorname}`)
    .concat('7a Ole Neu')
    .join('\n');
  const plan = planeImport(bestand, zerlegeListe(siebenA).eintraege);
  assert.deepEqual(plan.archiviert.map(s => s.nachname), ['Müller']);
  assert.deepEqual(plan.neu.map(s => s.nachname), ['Neu']);
  assert.deepEqual(plan.jeKlasse, [{ klasse: '7a', anzahl: 12 }]);

  // Taucht sie wieder auf, kommt sie zurueck - mit derselben Kennung.
  const danach = bestand.map(s => (s.nachname === 'Müller' ? { ...s, archiviertAm: new Date() } : s));
  const zurueck = planeImport(danach, zerlegeListe('7a Anna Müller').eintraege);
  assert.equal(zurueck.reaktiviert.length, 1);
  assert.equal(zurueck.reaktiviert[0].kennung, bestand.find(s => s.nachname === 'Müller').kennung);
});
