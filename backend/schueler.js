// Die Schuelerliste: Zerlegen einer eingefuegten Liste und Abgleich mit dem
// Bestand.
//
// Freitext macht ein dauerhaftes Protokoll unbrauchbar - "Max", "Max M." und
// "max mueller" sind drei Schueler. Im Schulbetrieb waehlen Lehrkraefte deshalb
// aus einer Liste, die die Verwaltung einmal einfuegt.
//
// Die Zerlegung folgt Roster::parseNames aus dem Unterrichtsmodul: Aus IServ,
// Untis und ASV-BW kommt "Nachname, Vorname", von Hand getippt wird "Vorname
// Nachname" - beide ergeben denselben Schluessel. Hinzu kommt hier die Klasse
// in derselben Zeile.

// Ein Name enthaelt keine Ziffer, eine Klasse fast immer: 5a, 10b, J1, Q2.
// Daran wird die Klasse erkannt, egal an welcher Stelle der Zeile sie steht.
// "EF" (Einfuehrungsphase) ist die eine Ausnahme ohne Ziffer.
function istKlasse(feld) {
  const wert = String(feld).trim();
  return /^[0-9A-Za-z./-]{1,8}$/.test(wert) && (/\d/.test(wert) || /^ef$/i.test(wert));
}

// "07A" und "7a" sind dieselbe Klasse. Klassen, die mit einer Ziffer
// beginnen, schreiben sich mit kleinem Buchstaben (7a), die uebrigen gross
// (J1, EF) - so stehen sie auch auf jedem Stundenplan.
function normalisiereKlasse(feld) {
  const wert = String(feld).replace(/\s+/g, '');
  if (/^\d/.test(wert)) return wert.replace(/^0+(?=\d)/, '').toLowerCase();
  return wert.toUpperCase();
}

// Schluessel fuer den Abgleich: Kleinschreibung, Umlaute ausgeschrieben,
// Akzente weg, alles ausser Buchstaben und Ziffern als ein Leerzeichen.
// "Müller", "Mueller" und "MÜLLER" sind derselbe Name.
function namensSchluessel(text) {
  return String(text)
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .slice(0, 150);
}

function schluesselVon(klasse, vorname, nachname) {
  return `${normalisiereKlasse(klasse).toLowerCase()}|${namensSchluessel(`${vorname} ${nachname}`)}`;
}

function aufraeumen(text) {
  return String(text).replace(/\s+/g, ' ').trim().slice(0, 60);
}

// "Nachname, Vorname" oder "Vorname Nachname". Bei der zweiten Form gilt das
// letzte Wort als Nachname - "Maria von der Heide" sortiert dann unter H. Der
// Schluessel stimmt trotzdem mit "von der Heide, Maria" ueberein, weil er aus
// dem ganzen Namen entsteht.
function zerlegeName(text) {
  const name = aufraeumen(text);
  const teile = name.split(',').map(t => t.trim()).filter(Boolean);
  if (name.includes(',')) {
    if (teile.length !== 2) return { grund: 'Mehr als ein Komma im Namen' };
    return { nachname: aufraeumen(teile[0]), vorname: aufraeumen(teile[1]) };
  }
  const woerter = name.split(' ').filter(Boolean);
  if (woerter.length < 2) return { grund: 'Vor- und Nachname noetig' };
  return { vorname: woerter.slice(0, -1).join(' '), nachname: woerter[woerter.length - 1] };
}

// Eine Zeile zerlegen. Liefert { klasse, vorname, nachname } oder { grund }.
function zerlegeZeile(roh) {
  // Fuehrende Nummerierung aus kopierten Listen: "1.", "12)", "- ".
  const zeile = String(roh).replace(/^\s*(\d+\s*[.)]|[-•*])\s+/, '').trim();

  // Spalten aus einer Tabelle (Tabulator) oder einer CSV-Datei (Semikolon).
  if (/[\t;]/.test(zeile)) {
    const felder = zeile.split(/[\t;]/).map(f => f.trim()).filter(Boolean);
    const stelle = felder.findIndex(istKlasse);
    if (stelle === -1) return { grund: 'Keine Klasse erkannt' };
    const klasse = felder[stelle];
    const rest = felder.filter((_, i) => i !== stelle);
    // Zwei Namensspalten: so exportieren ASV-BW und Untis - erst der
    // Familienname, dann der Rufname.
    if (rest.length === 2) {
      return { klasse, nachname: aufraeumen(rest[0]), vorname: aufraeumen(rest[1]) };
    }
    if (rest.length !== 1) return { grund: 'Zu viele Spalten' };
    const name = zerlegeName(rest[0]);
    return name.grund ? name : { klasse, ...name };
  }

  // Sonst steht die Klasse vorn oder hinten: "7a Anna Mueller", "Mueller, Anna 7a".
  const woerter = zeile.split(/\s+/).filter(Boolean);
  if (woerter.length < 2) return { grund: 'Klasse und Name noetig' };
  let klasse;
  let name;
  if (istKlasse(woerter[0])) {
    klasse = woerter[0];
    name = woerter.slice(1).join(' ');
  } else if (istKlasse(woerter[woerter.length - 1])) {
    klasse = woerter[woerter.length - 1];
    name = woerter.slice(0, -1).join(' ');
  } else {
    return { grund: 'Keine Klasse erkannt' };
  }
  const zerlegt = zerlegeName(name);
  return zerlegt.grund ? zerlegt : { klasse, ...zerlegt };
}

/**
 * Zerlegt eine eingefuegte Liste.
 *
 * @returns {{ eintraege: Array, fehler: Array<{ zeile: number, text: string, grund: string }> }}
 */
function zerlegeListe(text) {
  const eintraege = [];
  const fehler = [];
  const gesehen = new Set();

  String(text || '').split(/\r\n|\r|\n/).forEach((roh, index) => {
    if (!roh.trim()) return;
    const nummer = index + 1;
    const ergebnis = zerlegeZeile(roh);
    if (ergebnis.grund) {
      fehler.push({ zeile: nummer, text: roh.trim().slice(0, 120), grund: ergebnis.grund });
      return;
    }
    const klasse = normalisiereKlasse(ergebnis.klasse);
    const schluessel = schluesselVon(klasse, ergebnis.vorname, ergebnis.nachname);
    if (!namensSchluessel(`${ergebnis.vorname} ${ergebnis.nachname}`)) {
      fehler.push({ zeile: nummer, text: roh.trim().slice(0, 120), grund: 'Kein lesbarer Name' });
      return;
    }
    if (gesehen.has(schluessel)) {
      fehler.push({ zeile: nummer, text: roh.trim().slice(0, 120), grund: 'Doppelt in der Liste' });
      return;
    }
    gesehen.add(schluessel);
    eintraege.push({ klasse, vorname: ergebnis.vorname, nachname: ergebnis.nachname, schluessel });
  });

  return { eintraege, fehler };
}

function anzeige(s) {
  return `${s.vorname} ${s.nachname}`;
}

/**
 * Was ein Import bewirken wuerde - ohne es zu tun.
 *
 * Die Vorschau ist kein Beiwerk: Wer eine unvollstaendige Klassenliste
 * einfuegt, archiviert versehentlich den Rest der Klasse. Das muss vorher
 * sichtbar sein.
 *
 * Archiviert wird nur innerhalb der Klassen, die im Import vorkommen. So
 * lassen sich Klassen einzeln einfuegen - etwa erst die Pilotklassen -, ohne
 * die uebrigen zu leeren.
 *
 * @param bestand   alle Schueler der Schule in diesem Schuljahr, auch archivierte
 * @param eintraege aus zerlegeListe()
 */
function planeImport(bestand, eintraege) {
  const nachSchluessel = new Map(bestand.map(s => [s.schluessel, s]));
  const imImport = new Set(eintraege.map(e => e.schluessel));
  const klassen = new Set(eintraege.map(e => e.klasse));

  const neu = [];
  const reaktiviert = [];
  const bleibt = [];
  for (const eintrag of eintraege) {
    const vorhanden = nachSchluessel.get(eintrag.schluessel);
    if (!vorhanden) neu.push(eintrag);
    else if (vorhanden.archiviertAm) reaktiviert.push({ ...vorhanden, ...eintrag });
    else bleibt.push({ ...vorhanden, ...eintrag });
  }
  // Wer in einer eingefuegten Klasse fehlt, wird archiviert, nicht geloescht:
  // An laufenden und protokollierten Vorfaellen haengt seine Kennung.
  const archiviert = bestand.filter(s =>
    !s.archiviertAm && klassen.has(s.klasse) && !imImport.has(s.schluessel));

  const jeKlasse = [...klassen].sort(vergleicheKlassen).map(klasse => ({
    klasse,
    anzahl: eintraege.filter(e => e.klasse === klasse).length
  }));

  return { neu, reaktiviert, bleibt, archiviert, jeKlasse };
}

// 5a vor 10a, nicht dahinter; Klassen ohne fuehrende Ziffer ans Ende.
function vergleicheKlassen(a, b) {
  const zahl = k => (/^\d+/.exec(k) ? Number(/^\d+/.exec(k)[0]) : Infinity);
  return zahl(a) - zahl(b) || a.localeCompare(b, 'de');
}

function vergleicheSchueler(a, b) {
  return vergleicheKlassen(a.klasse, b.klasse)
    || a.nachname.localeCompare(b.nachname, 'de')
    || a.vorname.localeCompare(b.vorname, 'de');
}

module.exports = {
  istKlasse,
  normalisiereKlasse,
  namensSchluessel,
  schluesselVon,
  zerlegeZeile,
  zerlegeListe,
  planeImport,
  vergleicheKlassen,
  vergleicheSchueler,
  anzeige
};
