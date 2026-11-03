// Klingelplan einer Schule: wann die Stunden beginnen und enden.
//
// Die Bereitschaft zur Aufnahme endet mit der Stunde. Wer in der naechsten
// Stunde woanders unterrichtet oder eine Arbeit schreiben laesst, soll keine
// Schueler mehr geschickt bekommen - und morgens nicht mit dem Raum von
// gestern in der Liste stehen.
//
// Ein Plan fuer alle Wochentage. Gerechnet wird in der Ortszeit des Servers
// (im Container TZ=Europe/Berlin), wie beim Schuljahr.

const HOECHSTENS_STUNDEN = 16;
// Zwei Uhrzeiten je Zeile, mit Doppelpunkt oder Punkt: "7:45", "07.45". Eine
// vorangestellte Nummer wie "1." ist keine Uhrzeit - nach dem Punkt fehlen
// die zwei Ziffern.
const UHRZEIT = /(\d{1,2})[:.](\d{2})/g;

function alsText(minuten) {
  return `${String(Math.floor(minuten / 60)).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;
}

function alsMinuten(text) {
  const [stunde, minute] = text.split(':').map(Number);
  return stunde * 60 + minute;
}

/**
 * Zerlegt einen eingefuegten Klingelplan: eine Zeile je Stunde mit Beginn und
 * Ende, etwa "1. Stunde 7:45 - 8:30". Liefert die Stunden sortiert als
 * { beginn: 'HH:MM', ende: 'HH:MM' } und die Zeilen, die nicht passen.
 */
function zerlegeKlingelplan(text) {
  const gelesen = [];
  const fehler = [];
  String(text || '').split(/\r?\n/).forEach((roh, index) => {
    const zeile = roh.trim();
    if (!zeile) return;
    const nummer = index + 1;
    const zeiten = [...zeile.matchAll(UHRZEIT)].map(t => [Number(t[1]), Number(t[2])]);
    if (zeiten.length !== 2) {
      fehler.push({ zeile: nummer, text: zeile, grund: 'Beginn und Ende erwartet, etwa 7:45 - 8:30' });
      return;
    }
    if (zeiten.some(([stunde, minute]) => stunde > 23 || minute > 59)) {
      fehler.push({ zeile: nummer, text: zeile, grund: 'Keine gültige Uhrzeit' });
      return;
    }
    const [beginn, ende] = zeiten.map(([stunde, minute]) => stunde * 60 + minute);
    if (ende <= beginn) {
      fehler.push({ zeile: nummer, text: zeile, grund: 'Das Ende liegt vor dem Beginn' });
      return;
    }
    gelesen.push({ beginn, ende, nummer, zeile });
  });

  gelesen.sort((a, b) => a.beginn - b.beginn);
  for (let i = 1; i < gelesen.length; i++) {
    if (gelesen[i].beginn < gelesen[i - 1].ende) {
      fehler.push({ zeile: gelesen[i].nummer, text: gelesen[i].zeile, grund: 'Überschneidet sich mit der Stunde davor' });
    }
  }
  if (gelesen.length > HOECHSTENS_STUNDEN) {
    fehler.push({ zeile: 0, text: '', grund: `Höchstens ${HOECHSTENS_STUNDEN} Stunden` });
  }
  return {
    stunden: gelesen.map(s => ({ beginn: alsText(s.beginn), ende: alsText(s.ende) })),
    fehler
  };
}

// Wer kurz vor dem Klingeln einschaltet, meint die naechste Stunde - eine
// Bereitschaft fuer drei Minuten nuetzt niemandem.
const PUFFER_MS = 5 * 60 * 1000;

/**
 * Die moeglichen Enden einer Bereitschaft, die jetzt beginnt: das Ende der
 * laufenden Stunde - in der Pause oder vor Schulbeginn das der naechsten - und
 * eine Stunde weiter, fuer die Doppelstunde. Leer, wenn heute keine Stunde
 * mehr kommt.
 */
function stundenenden(plan, jetzt = Date.now()) {
  return plan
    .map(stunde => {
      const ende = new Date(jetzt);
      const minuten = alsMinuten(stunde.ende);
      ende.setHours(Math.floor(minuten / 60), minuten % 60, 0, 0);
      return ende.getTime();
    })
    .filter(ende => ende - jetzt > PUFFER_MS)
    .slice(0, 2);
}

module.exports = { zerlegeKlingelplan, stundenenden, HOECHSTENS_STUNDEN };
