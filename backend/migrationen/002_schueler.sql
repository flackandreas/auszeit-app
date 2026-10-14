-- Die Schuelerliste einer Schule, je Schuljahr.
--
-- Im Protokoll steht nur die Kennung eines Schuelers; Name und Klasse kommen
-- von hier. Wer bei einem neuen Import in seiner Klasse fehlt, wird
-- archiviert, nicht geloescht - an laufenden und protokollierten Vorfaellen
-- haengt seine Kennung. Zum Schuljahreswechsel faellt die Liste mit dem
-- Protokoll des alten Schuljahres weg.
CREATE TABLE IF NOT EXISTS schueler (
    kennung VARCHAR(24) NOT NULL PRIMARY KEY,
    schul_id VARCHAR(32) NOT NULL,
    schuljahr SMALLINT NOT NULL,
    klasse VARCHAR(10) NOT NULL,
    vorname VARCHAR(60) NOT NULL,
    nachname VARCHAR(60) NOT NULL,
    -- Normalisiert aus Klasse und Name; haelt einen zweiten Import frei von
    -- Dubletten.
    schluessel VARCHAR(190) NOT NULL,
    archiviert_am DATETIME(3) NULL,
    angelegt_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    UNIQUE KEY schueler_schluessel (schul_id, schuljahr, schluessel),
    KEY schueler_schuljahr (schuljahr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
