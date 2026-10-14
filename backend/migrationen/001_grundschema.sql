-- Grundschema: Lehrkraefte, Sitzungen, Vorfaelle.
--
-- Alle Zeitpunkte in UTC. Die Verbindung arbeitet mit timezone 'Z'; sonst
-- haengt die Bedeutung eines DATETIME an der Zeitzone des Containers, und um
-- die Zeitumstellung herum wird eine Stunde doppeldeutig.

-- Wer an einer Auszeit beteiligt war. Bei Anmeldung ueber das Portal steht
-- hier die dauerhafte Kennung (sub) - sie haelt die oeffentliche Kennung ueber
-- Neustarts stabil, an der laufende Vorfaelle haengen. Bei Anmeldung mit Code
-- gibt es keine dauerhafte Identitaet; solche Zeilen verschwinden, sobald
-- weder Sitzung noch Vorfall auf sie zeigt.
CREATE TABLE IF NOT EXISTS lehrkraefte (
    kennung VARCHAR(32) NOT NULL PRIMARY KEY,
    schul_id VARCHAR(32) NOT NULL,
    sub VARCHAR(255) NULL,
    name VARCHAR(60) NOT NULL,
    kuerzel VARCHAR(50) NULL,
    raum VARCHAR(30) NOT NULL DEFAULT '',
    verwaltung TINYINT(1) NOT NULL DEFAULT 0,
    angelegt_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY lehrkraft_sub (schul_id, sub)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Gespeichert wird nur der Hash des Tokens. Wer eine Sicherung der Datenbank
-- in die Haende bekommt, kann damit keine Sitzung uebernehmen.
CREATE TABLE IF NOT EXISTS sitzungen (
    schluessel CHAR(64) NOT NULL PRIMARY KEY,
    kennung VARCHAR(32) NOT NULL,
    gueltig_bis BIGINT NOT NULL,
    angaben TEXT NULL,
    KEY sitzung_kennung (kennung),
    KEY sitzung_ablauf (gueltig_bis)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Das Protokoll. Je Zustandswechsel ein Zeitpunkt - die Auswertung des
-- Piloten fragt etwa, wie lange es bis zur Ankunftsbestaetigung dauert und
-- wie viele Meldungen ohne Reaktion bleiben.
--
-- Namen und Raeume stehen als Momentaufnahme am Vorfall: so, wie sie zum
-- Zeitpunkt der Verweisung galten.
CREATE TABLE IF NOT EXISTS vorfaelle (
    id VARCHAR(24) NOT NULL PRIMARY KEY,
    schul_id VARCHAR(32) NOT NULL,
    -- Beginnjahr des Schuljahres, 2026 fuer 2026/27. Daran haengt die Loeschung.
    schuljahr SMALLINT NOT NULL,
    schueler_kennung VARCHAR(32) NULL,
    schueler_name VARCHAR(60) NOT NULL DEFAULT '',
    sender_kennung VARCHAR(32) NOT NULL,
    sender_name VARCHAR(60) NOT NULL,
    sender_raum VARCHAR(30) NOT NULL DEFAULT '',
    empfaenger_kennung VARCHAR(32) NOT NULL,
    empfaenger_name VARCHAR(60) NOT NULL,
    empfaenger_raum VARCHAR(30) NOT NULL DEFAULT '',
    status VARCHAR(20) NOT NULL,
    angefordert_am DATETIME(3) NOT NULL,
    angekommen_am DATETIME(3) NULL,
    rueckholwunsch_am DATETIME(3) NULL,
    zurueckgeschickt_am DATETIME(3) NULL,
    zurueck_am DATETIME(3) NULL,
    beendet_am DATETIME(3) NULL,
    -- zurueck: Rueckkehr bestaetigt. einseitig: von einer Seite geschlossen,
    -- weil die andere nicht erreichbar war. abgebrochen: nach 24 Stunden von
    -- selbst geschlossen, nie beendet.
    abschluss VARCHAR(20) NULL,
    beendet_von VARCHAR(32) NULL,
    KEY vorfall_status (status),
    KEY vorfall_schuljahr (schuljahr),
    KEY vorfall_schule (schul_id, angefordert_am)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
