// Uebersetzung zwischen dem Laufzeitzustand und den Zeilen der Ablage.
//
// Der Server arbeitet mit lebenden Objekten, die sich laufend aendern. In die
// Warteschlange der Ablage kommt deshalb eine Momentaufnahme als flache Zeile:
// Was zum Zeitpunkt des Ereignisses galt, wird geschrieben - nicht, was zwei
// Schreibvorgaenge spaeter am Objekt steht.

function datum(wert) {
  return wert ? new Date(wert) : null;
}

function lehrkraftZeile(teacher) {
  return {
    kennung: teacher.id,
    schul_id: teacher.schulId,
    sub: teacher.sub || null,
    name: teacher.name,
    kuerzel: teacher.kuerzel || null,
    raum: teacher.room || '',
    verwaltung: teacher.verwaltung ? 1 : 0
  };
}

// Nur der Datensatz - Aufnahmebereitschaft, Plaetze und Erreichbarkeit sind
// Laufzeitzustand und beginnen nach einem Neustart von vorn.
function lehrkraftAusZeile(zeile) {
  return {
    id: zeile.kennung,
    schulId: zeile.schul_id,
    ...(zeile.sub ? { sub: zeile.sub } : {}),
    kuerzel: zeile.kuerzel || '',
    name: zeile.name,
    room: zeile.raum || '',
    verwaltung: Boolean(zeile.verwaltung),
    isAvailable: false,
    plaetze: 0,
    betreut: [],
    online: false,
    offlineSeit: Date.now()
  };
}

function schuelerZeile(s) {
  return {
    kennung: s.kennung,
    schul_id: s.schulId,
    schuljahr: s.schuljahr,
    klasse: s.klasse,
    vorname: s.vorname,
    nachname: s.nachname,
    schluessel: s.schluessel,
    archiviert_am: datum(s.archiviertAm)
  };
}

function schuelerAusZeile(z) {
  return {
    kennung: z.kennung,
    schulId: z.schul_id,
    schuljahr: Number(z.schuljahr),
    klasse: z.klasse,
    vorname: z.vorname,
    nachname: z.nachname,
    schluessel: z.schluessel,
    archiviertAm: datum(z.archiviert_am)
  };
}

function vorfallZeile(v) {
  return {
    id: v.id,
    schul_id: v.schulId,
    schuljahr: v.schuljahr,
    schueler_kennung: v.schuelerKennung || null,
    // Kommt der Schueler aus der Liste, steht im Protokoll nur seine
    // Kennung. Der Name gehoert in die Liste und faellt mit ihr weg.
    schueler_name: v.schuelerKennung ? '' : (v.studentName || ''),
    sender_kennung: v.senderId,
    sender_name: v.senderName,
    sender_raum: v.senderRaum || '',
    empfaenger_kennung: v.receiverId,
    empfaenger_name: v.receiverName,
    empfaenger_raum: v.receiverRaum || '',
    status: v.status,
    angefordert_am: datum(v.timestamp),
    angekommen_am: datum(v.angekommenAm),
    rueckholwunsch_am: datum(v.rueckholwunschSeit),
    zurueckgeschickt_am: datum(v.rueckwegSeit),
    zurueck_am: datum(v.zurueckAm),
    beendet_am: datum(v.beendetAm),
    abschluss: v.abschluss || null,
    beendet_von: v.beendetVon || null
  };
}

// Dieselben Felder, die der Server beim Anlegen und bei jedem Uebergang setzt.
// Was nicht gesetzt war, fehlt auch hier - der Client unterscheidet daran.
function vorfallAusZeile(z) {
  const v = {
    id: z.id,
    schulId: z.schul_id,
    schuljahr: Number(z.schuljahr),
    senderId: z.sender_kennung,
    senderName: z.sender_name,
    senderRaum: z.sender_raum,
    receiverId: z.empfaenger_kennung,
    receiverName: z.empfaenger_name,
    receiverRaum: z.empfaenger_raum,
    studentName: z.schueler_name || '',
    status: z.status,
    timestamp: datum(z.angefordert_am)
  };
  if (z.schueler_kennung) v.schuelerKennung = z.schueler_kennung;
  if (z.angekommen_am) v.angekommenAm = datum(z.angekommen_am);
  if (z.rueckholwunsch_am) {
    v.rueckholwunsch = true;
    v.rueckholwunschSeit = datum(z.rueckholwunsch_am);
  }
  if (z.zurueckgeschickt_am) v.rueckwegSeit = datum(z.zurueckgeschickt_am);
  if (z.zurueck_am) v.zurueckAm = datum(z.zurueck_am);
  if (z.beendet_am) v.beendetAm = datum(z.beendet_am);
  if (z.abschluss) v.abschluss = z.abschluss;
  if (z.beendet_von) v.beendetVon = z.beendet_von;
  return v;
}

module.exports = {
  lehrkraftZeile, lehrkraftAusZeile, schuelerZeile, schuelerAusZeile, vorfallZeile, vorfallAusZeile
};
