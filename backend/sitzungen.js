// Sitzungsnachweis der Lehrkraefte.
//
// Bisher genuegte die Kennung einer Lehrkraft als Nachweis fuer die
// Wiederanmeldung - dieselbe Kennung, die jede Kollegin der Schule mit der
// Liste der aufnahmebereiten Lehrkraefte zugeschickt bekommt. Wer den
// Beitrittscode kannte, konnte damit die Sitzung einer anderen Lehrkraft
// uebernehmen: ihre Vorfaelle sehen, Ankuenfte bestaetigen.
//
// Deshalb jetzt zwei getrennte Werte: die oeffentliche Kennung adressiert eine
// Lehrkraft, das geheime Token weist nach, dass man sie ist. Das Token geht
// genau einmal an genau ein Geraet und nie in eine Liste.
//
// Gespeichert wird nur der Hash. Wer den Speicher zu sehen bekommt - heute ein
// Speicherabbild, spaeter eine Datenbanksicherung - kann damit keine Sitzung
// uebernehmen. Ein schneller Hash genuegt: das Token hat 256 Bit Zufall, da
// gibt es nichts durchzuprobieren, anders als bei einem Passwort.
const crypto = require('crypto');

// 32 Byte als base64url ergeben genau 43 Zeichen. Alles andere wird gar nicht
// erst gehasht - das haelt beliebig lange Eingaben vom Server fern.
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;

function hashe(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * @param optionen.gueltigMs  Lebensdauer eines Tokens ab der Ausstellung
 * @param optionen.jetzt      () => Millisekunden; fuer Tests austauschbar
 */
function erstelleSitzungen({ gueltigMs, jetzt = Date.now }) {
  const eintraege = new Map(); // Token-Hash -> { teacherId, gueltigBis }

  // Fester Ablauf ab der Ausstellung statt eines gleitenden: auf einem Raum-PC,
  // an dem sich niemand abmeldet, soll die Sitzung auch dann enden, wenn der
  // Rechner den ganzen Tag laeuft und staendig neu verbindet.
  function ausstellen(teacherId) {
    const token = crypto.randomBytes(32).toString('base64url');
    eintraege.set(hashe(token), { teacherId, gueltigBis: jetzt() + gueltigMs });
    return token;
  }

  // Liefert die Kennung der Lehrkraft oder null. Ein abgelaufenes Token wird
  // dabei gleich entfernt.
  function pruefen(token) {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
    const schluessel = hashe(token);
    const eintrag = eintraege.get(schluessel);
    if (!eintrag) return null;
    if (eintrag.gueltigBis <= jetzt()) {
      eintraege.delete(schluessel);
      return null;
    }
    return eintrag.teacherId;
  }

  // Beim Abmelden und wenn die Lehrkraft aus dem Speicher faellt.
  function widerrufeFuer(teacherId) {
    let anzahl = 0;
    for (const [schluessel, eintrag] of eintraege) {
      if (eintrag.teacherId === teacherId) {
        eintraege.delete(schluessel);
        anzahl += 1;
      }
    }
    return anzahl;
  }

  // Abgelaufene Tokens, die niemand mehr vorzeigt, wuerden sonst liegenbleiben.
  function aufraeumen() {
    const grenze = jetzt();
    let anzahl = 0;
    for (const [schluessel, eintrag] of eintraege) {
      if (eintrag.gueltigBis <= grenze) {
        eintraege.delete(schluessel);
        anzahl += 1;
      }
    }
    return anzahl;
  }

  return {
    ausstellen,
    pruefen,
    widerrufeFuer,
    aufraeumen,
    get anzahl() { return eintraege.size; }
  };
}

module.exports = { erstelleSitzungen };
