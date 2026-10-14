// Schuljahr eines Zeitpunkts.
//
// Die Schule loescht das Protokoll zu Beginn des neuen Schuljahres. Der genaue
// Stichtag wird noch mit dem Datenschutzbeauftragten festgelegt - deshalb
// einstellbar, Vorgabe der 1. August.
//
// Gerechnet wird in der Ortszeit des Servers (im Container TZ=Europe/Berlin):
// Der Stichtag beginnt um Mitternacht an der Schule, nicht in Greenwich.

const VORGABE = { monat: 8, tag: 1 };

// "MM-TT", etwa "08-01". Alles andere faellt auf die Vorgabe zurueck - ein
// Tippfehler in der Konfiguration soll nicht dazu fuehren, dass nie oder
// staendig geloescht wird.
function stichtagAus(text) {
  const treffer = /^(\d{2})-(\d{2})$/.exec(String(text || '').trim());
  if (!treffer) return VORGABE;
  const monat = Number(treffer[1]);
  const tag = Number(treffer[2]);
  // Ein Tag, den es in jedem Jahr gibt - der 29. Februar waere nicht jedes
  // Jahr ein Stichtag.
  const probe = new Date(2023, monat - 1, tag);
  if (probe.getMonth() !== monat - 1 || probe.getDate() !== tag) return VORGABE;
  return { monat, tag };
}

// Beginnjahr des Schuljahres: 2026 fuer 2026/27.
function schuljahrVon(datum, stichtag = VORGABE) {
  const zeitpunkt = new Date(datum);
  const jahr = zeitpunkt.getFullYear();
  const beginn = new Date(jahr, stichtag.monat - 1, stichtag.tag);
  return zeitpunkt >= beginn ? jahr : jahr - 1;
}

function schuljahrText(beginnjahr) {
  return `${beginnjahr}/${String((beginnjahr + 1) % 100).padStart(2, '0')}`;
}

module.exports = { stichtagAus, schuljahrVon, schuljahrText };
