// Liest ein Cookie aus dem Cookie-Kopf.
//
// Gebraucht von der Verwaltung, von den Portal-Routen und beim Handshake der
// Socket-Verbindung - dort gibt es kein Express, nur die rohe Anfrage. Deshalb
// ein eigener kleiner Leser statt cookie-parser.
function liesKeks(anfrage, name) {
  const roh = (anfrage && anfrage.headers && anfrage.headers.cookie) || '';
  for (const teil of roh.split(';')) {
    const [schluessel, ...rest] = teil.trim().split('=');
    if (schluessel !== name) continue;
    try {
      return decodeURIComponent(rest.join('='));
    } catch (err) {
      // Kaputt kodiert: wie nicht vorhanden behandeln.
      return null;
    }
  }
  return null;
}

module.exports = { liesKeks };
