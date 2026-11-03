-- Einstellungen einer Schule, gepflegt von der Rolle Verwaltung in der App.
--
-- Der Klingelplan bestimmt, wann die Bereitschaft zur Aufnahme endet; der
-- Hinweis steht da, wenn gerade niemand frei ist. Beides gehoert nicht zum
-- Schuljahr und bleibt beim Jahreswechsel stehen.
CREATE TABLE IF NOT EXISTS schuleinstellungen (
    schul_id VARCHAR(32) NOT NULL PRIMARY KEY,
    -- JSON: [{"beginn":"07:45","ende":"08:30"}, ...]
    klingelplan TEXT NOT NULL,
    hinweis_niemand VARCHAR(300) NOT NULL DEFAULT '',
    geaendert_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
