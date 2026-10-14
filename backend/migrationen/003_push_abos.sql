-- Push-Abos: ein Eintrag je Geraet.
--
-- Ein Abo haengt an der Sitzung, nicht an der Lehrkraft. Endet die Sitzung -
-- Abmelden, Abmeldung im Portal, Ablauf -, endet auch das Abo. Auf einem
-- Raum-PC bekommt so niemand die Alarme der Person, die vorher dort sass.
CREATE TABLE IF NOT EXISTS push_abos (
    -- SHA-256 der Adresse: Dasselbe Geraet nennt nach jeder Anmeldung
    -- dieselbe Adresse, das Abo wird umgehaengt statt verdoppelt.
    schluessel CHAR(64) NOT NULL PRIMARY KEY,
    sitzung CHAR(64) NOT NULL,
    kennung VARCHAR(32) NOT NULL,
    endpunkt TEXT NOT NULL,
    p256dh VARCHAR(100) NOT NULL,
    auth VARCHAR(32) NOT NULL,
    angelegt_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY push_sitzung (sitzung),
    KEY push_kennung (kennung)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
