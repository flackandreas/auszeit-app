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
 * @param optionen.ablage     dauerhafte Abschrift (ablage/index.js), optional.
 *                            Gelesen wird nur beim Start ueber laden(); im
 *                            Betrieb ist der Speicher die Wahrheit.
 */
function erstelleSitzungen({ gueltigMs, jetzt = Date.now, ablage = null }) {
  // Token-Hash -> { teacherId, gueltigBis, ...angaben }. Die Angaben haengen
  // an der Sitzung, nicht an der Lehrkraft: bei der Anmeldung ueber das
  // Portal etwa dessen Sitzungskennung (sid) und das ID-Token, mit dem sich
  // genau dieser Browser wieder abmelden laesst.
  const eintraege = new Map();

  // Fester Ablauf ab der Ausstellung statt eines gleitenden: auf einem Raum-PC,
  // an dem sich niemand abmeldet, soll die Sitzung auch dann enden, wenn der
  // Rechner den ganzen Tag laeuft und staendig neu verbindet.
  function ausstellen(teacherId, angaben = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const schluessel = hashe(token);
    const eintrag = { ...angaben, teacherId, gueltigBis: jetzt() + gueltigMs };
    eintraege.set(schluessel, eintrag);
    if (ablage) ablage.sitzungSpeichern(schluessel, eintrag);
    return token;
  }

  // Der Eintrag zum Token samt Schluessel, beendet oder nicht. Ein
  // abgelaufenes Token wird dabei gleich entfernt.
  function nachschlagen(token) {
    if (typeof token !== 'string' || !TOKEN_FORMAT.test(token)) return null;
    const schluessel = hashe(token);
    const eintrag = eintraege.get(schluessel);
    if (!eintrag) return null;
    if (eintrag.gueltigBis <= jetzt()) {
      eintraege.delete(schluessel);
      if (ablage) ablage.sitzungLoeschen(schluessel);
      return null;
    }
    return { ...eintrag, schluessel };
  }

  // Die gueltige Sitzung zum Token samt ihrem Schluessel, sonst null.
  function sitzung(token) {
    const gefunden = nachschlagen(token);
    return gefunden && !gefunden.beendet ? gefunden : null;
  }

  // Eine Sitzung, die zum Stundenende beendet wurde, deren Browser davon aber
  // noch nichts weiss - etwa weil der Rechner schlief. Sie oeffnet nichts
  // mehr; sie sagt nur, dass sich dieser Browser noch beim Portal abmelden
  // muss.
  function beendete(token) {
    const gefunden = nachschlagen(token);
    return gefunden && gefunden.beendet ? gefunden : null;
  }

  // Gilt die Sitzung mit diesem Schluessel noch? Fuer alles, was an einer
  // Sitzung haengt, ohne ihr Token zu kennen - etwa ein Push-Abo.
  function gueltig(schluessel) {
    const eintrag = eintraege.get(schluessel);
    return Boolean(eintrag && !eintrag.beendet && eintrag.gueltigBis > jetzt());
  }

  // Auf einem Rechner, den viele benutzen, endet die Sitzung zu einer festen
  // Uhrzeit statt erst nach dem Schultag.
  function abmeldenUm(schluessel) {
    const eintrag = eintraege.get(schluessel);
    return eintrag && !eintrag.beendet && eintrag.abmeldenUm ? eintrag.abmeldenUm : null;
  }

  function setzeAbmeldung(schluessel, zeitpunkt) {
    const eintrag = eintraege.get(schluessel);
    if (!eintrag || eintrag.beendet) return;
    eintrag.abmeldenUm = zeitpunkt;
    if (ablage) ablage.sitzungSpeichern(schluessel, eintrag);
  }

  // Die Sitzungen, deren Abmeldezeit erreicht ist.
  function faellig(grenze = jetzt()) {
    const gefunden = [];
    for (const [schluessel, eintrag] of eintraege) {
      if (eintrag.beendet || !eintrag.abmeldenUm || eintrag.abmeldenUm > grenze) continue;
      if (eintrag.gueltigBis > jetzt()) gefunden.push(schluessel);
    }
    return gefunden;
  }

  // Beendet eine Sitzung, ohne sie zu vergessen: Sie oeffnet nichts mehr, aber
  // ihr Browser ist noch zu erkennen, wenn er sich wieder meldet. Ganz weg ist
  // sie mit widerrufen() oder ihrem Ablauf.
  function beenden(schluessel) {
    const eintrag = eintraege.get(schluessel);
    if (!eintrag) return null;
    eintrag.beendet = true;
    if (ablage) ablage.sitzungSpeichern(schluessel, eintrag);
    return { ...eintrag, schluessel };
  }

  // Liefert die Kennung der Lehrkraft oder null.
  function pruefen(token) {
    const gefunden = sitzung(token);
    return gefunden ? gefunden.teacherId : null;
  }

  // Beendet genau eine Sitzung - die eines Browsers. Eine Lehrkraft, die
  // zusaetzlich am Tablet angemeldet ist, bleibt dort angemeldet.
  function widerrufen(schluessel) {
    const eintrag = eintraege.get(schluessel);
    if (!eintrag) return null;
    eintraege.delete(schluessel);
    if (ablage) ablage.sitzungLoeschen(schluessel);
    return { ...eintrag, schluessel };
  }

  // Wenn die Lehrkraft aus dem Speicher faellt.
  function widerrufeFuer(teacherId) {
    let anzahl = 0;
    for (const [schluessel, eintrag] of eintraege) {
      if (eintrag.teacherId === teacherId) {
        eintraege.delete(schluessel);
        anzahl += 1;
      }
    }
    if (ablage && anzahl > 0) ablage.sitzungenLoeschenFuer(teacherId);
    return anzahl;
  }

  // Schluessel aller Sitzungen, auf die die Bedingung zutrifft - etwa alle zu
  // einer Portalsitzung, die gerade abgemeldet wird. Beendete gehoeren dazu:
  // Mit der Abmeldung beim Portal ist auch fuer sie nichts mehr offen.
  function schluesselWo(bedingung) {
    const gefunden = [];
    for (const [schluessel, eintrag] of eintraege) {
      if (eintrag.gueltigBis > jetzt() && bedingung(eintrag)) gefunden.push(schluessel);
    }
    return gefunden;
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
    if (ablage) ablage.abgelaufeneSitzungenLoeschen(grenze);
    return anzahl;
  }

  // Nach einem Neustart: die gueltigen Sitzungen aus der Ablage uebernehmen,
  // ohne sie erneut zu schreiben.
  function laden(zeilen) {
    for (const zeile of zeilen) {
      if (zeile.gueltig_bis <= jetzt()) continue;
      eintraege.set(zeile.schluessel, { ...(zeile.angaben || {}), teacherId: zeile.kennung, gueltigBis: zeile.gueltig_bis });
    }
  }

  return {
    ausstellen,
    sitzung,
    beendete,
    gueltig,
    abmeldenUm,
    setzeAbmeldung,
    faellig,
    beenden,
    pruefen,
    widerrufen,
    widerrufeFuer,
    schluesselWo,
    aufraeumen,
    laden,
    get anzahl() { return eintraege.size; }
  };
}

module.exports = { erstelleSitzungen };
