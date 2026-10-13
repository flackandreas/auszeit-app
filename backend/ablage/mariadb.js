// Ablage in MariaDB.
//
// MariaDB, weil der SchulOS-Verbund sie ohnehin betreibt und ihr Volume
// ohnehin gesichert wird - eine zweite Datenbankart haette eine zweite
// Sicherung bedeutet.
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const MIGRATIONEN = path.join(__dirname, '..', 'migrationen');
const OFFEN = ['unterwegs', 'betreut', 'auf_dem_rueckweg'];

const VORFALL_SPALTEN = [
  'id', 'schul_id', 'schuljahr', 'schueler_kennung', 'schueler_name',
  'sender_kennung', 'sender_name', 'sender_raum',
  'empfaenger_kennung', 'empfaenger_name', 'empfaenger_raum',
  'status', 'angefordert_am', 'angekommen_am', 'rueckholwunsch_am',
  'zurueckgeschickt_am', 'zurueck_am', 'beendet_am', 'abschluss', 'beendet_von'
];
const LEHRKRAFT_SPALTEN = ['kennung', 'schul_id', 'sub', 'name', 'kuerzel', 'raum', 'verwaltung'];

// INSERT ... ON DUPLICATE KEY UPDATE fuer alle Spalten ausser dem Schluessel.
// Der Server schreibt bei jedem Zustandswechsel die ganze Zeile.
function einfuegenOderAendern(tabelle, spalten) {
  const aendern = spalten.slice(1).map(s => `${s} = VALUES(${s})`).join(', ');
  return `INSERT INTO ${tabelle} (${spalten.join(', ')}) VALUES (${spalten.map(() => '?').join(', ')})
          ON DUPLICATE KEY UPDATE ${aendern}`;
}

const VORFALL_SPEICHERN = einfuegenOderAendern('vorfaelle', VORFALL_SPALTEN);
const LEHRKRAFT_SPEICHERN = einfuegenOderAendern('lehrkraefte', LEHRKRAFT_SPALTEN);

function warte(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * @param konfiguration { host, port, datenbank, nutzer, passwort }
 */
function erstelleMariadbAblage(konfiguration, { versuche = 30, pause = 2000 } = {}) {
  let pool = null;

  const verbindung = {
    host: konfiguration.host,
    port: konfiguration.port || 3306,
    user: konfiguration.nutzer,
    password: konfiguration.passwort,
    database: konfiguration.datenbank,
    // UTC, siehe 001_grundschema.sql.
    timezone: 'Z',
    charset: 'utf8mb4'
  };

  // Die Migrationen in Dateinamenreihenfolge. Nummeriert mit fuehrenden
  // Nullen, damit die Reihenfolge der Namen die Reihenfolge der Schritte ist -
  // und eine neue Datei nicht vergessen werden kann, weil sie erst noch in
  // eine Liste eingetragen werden muesste.
  async function migrieren() {
    const db = await mysql.createConnection({ ...verbindung, multipleStatements: true });
    try {
      await db.query(`CREATE TABLE IF NOT EXISTS migrationen (
        datei VARCHAR(255) NOT NULL PRIMARY KEY,
        eingespielt_am DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      const [erledigt] = await db.query('SELECT datei FROM migrationen');
      const bekannt = new Set(erledigt.map(z => z.datei));
      const dateien = fs.readdirSync(MIGRATIONEN).filter(d => d.endsWith('.sql')).sort();
      for (const datei of dateien) {
        if (bekannt.has(datei)) continue;
        await db.query(fs.readFileSync(path.join(MIGRATIONEN, datei), 'utf8'));
        await db.query('INSERT INTO migrationen (datei) VALUES (?)', [datei]);
        console.log(`Migration eingespielt: ${datei}`);
      }
    } finally {
      await db.end();
    }
  }

  return {
    art: 'mariadb',

    // Beim Start des Verbunds ist die Datenbank womoeglich noch nicht so weit.
    // Ein paar Versuche statt eines Absturzes beim ersten - und ohne Erfolg
    // dann doch ein klarer Abbruch: Schreiben ins Leere waere schlimmer.
    async oeffnen() {
      // Im Verbund heisst das: DB_AUSZEIT_PASSWORT fehlt in der .env, und der
      // Datenbanknutzer wurde gar nicht erst angelegt. Lieber nicht starten
      // als ohne Protokoll laufen.
      if (!konfiguration.passwort) {
        throw new Error('DB_HOST ist gesetzt, aber kein Passwort (DB_PASS oder DB_PASS_FILE).');
      }
      for (let versuch = 1; ; versuch++) {
        try {
          await migrieren();
          break;
        } catch (err) {
          if (versuch >= versuche) throw err;
          console.error(`Datenbank noch nicht erreichbar (${err.code || err.message}) - neuer Versuch in ${pause / 1000} s.`);
          await warte(pause);
        }
      }
      // Ein zweiter Aufruf - etwa nach einem neu geladenen Server im selben
      // Prozess - nimmt den vorhandenen Pool, statt einen weiteren zu oeffnen.
      if (!pool) pool = mysql.createPool({ ...verbindung, connectionLimit: 4 });
    },

    async schliessen() {
      if (pool) await pool.end();
      pool = null;
    },

    async lehrkraftSpeichern(z) {
      await pool.execute(LEHRKRAFT_SPEICHERN, LEHRKRAFT_SPALTEN.map(s => z[s]));
    },
    async lehrkraftLoeschen(kennung) {
      await pool.execute('DELETE FROM lehrkraefte WHERE kennung = ?', [kennung]);
    },

    async sitzungSpeichern(z) {
      await pool.execute(
        'REPLACE INTO sitzungen (schluessel, kennung, gueltig_bis, angaben) VALUES (?, ?, ?, ?)',
        [z.schluessel, z.kennung, z.gueltig_bis, JSON.stringify(z.angaben || {})]
      );
    },
    async sitzungLoeschen(schluessel) {
      await pool.execute('DELETE FROM sitzungen WHERE schluessel = ?', [schluessel]);
    },
    async sitzungenLoeschenFuer(kennung) {
      await pool.execute('DELETE FROM sitzungen WHERE kennung = ?', [kennung]);
    },
    async abgelaufeneSitzungenLoeschen(jetztMs) {
      await pool.execute('DELETE FROM sitzungen WHERE gueltig_bis <= ?', [jetztMs]);
    },

    async vorfallSpeichern(z) {
      await pool.execute(VORFALL_SPEICHERN, VORFALL_SPALTEN.map(s => z[s]));
    },
    async vorfallLoeschen(id) {
      await pool.execute('DELETE FROM vorfaelle WHERE id = ?', [id]);
    },

    async laden({ jetztMs, anzeigeSeit }) {
      const [sitzungen] = await pool.query(
        'SELECT schluessel, kennung, gueltig_bis, angaben FROM sitzungen WHERE gueltig_bis > ?', [jetztMs]);
      const [vorfaelle] = await pool.query(
        `SELECT * FROM vorfaelle WHERE status IN (?) OR beendet_am >= ? ORDER BY angefordert_am`,
        [OFFEN, anzeigeSeit]);
      const [lehrkraefte] = await pool.query(
        `SELECT * FROM lehrkraefte l
          WHERE l.sub IS NOT NULL
             OR EXISTS (SELECT 1 FROM sitzungen s WHERE s.kennung = l.kennung AND s.gueltig_bis > ?)
             OR l.kennung IN (?)`,
        [jetztMs, ['', ...vorfaelle.flatMap(v => [v.sender_kennung, v.empfaenger_kennung])]]);
      return {
        lehrkraefte,
        sitzungen: sitzungen.map(s => ({
          ...s,
          gueltig_bis: Number(s.gueltig_bis),
          angaben: s.angaben ? JSON.parse(s.angaben) : {}
        })),
        vorfaelle
      };
    },

    async jahreswechsel(schuljahr) {
      const [ergebnis] = await pool.execute('DELETE FROM vorfaelle WHERE schuljahr < ?', [schuljahr]);
      return ergebnis.affectedRows;
    },

    // Lehrkraefte aus Anmeldungen mit Code haben keine dauerhafte Identitaet.
    // Ohne gueltige Sitzung und ohne Vorfall zeigt nichts mehr auf sie.
    async verwaisteLehrkraefteLoeschen(jetztMs) {
      const [ergebnis] = await pool.execute(
        `DELETE FROM lehrkraefte
          WHERE sub IS NULL
            AND NOT EXISTS (SELECT 1 FROM sitzungen s WHERE s.kennung = lehrkraefte.kennung AND s.gueltig_bis > ?)
            AND NOT EXISTS (SELECT 1 FROM vorfaelle v
                             WHERE v.sender_kennung = lehrkraefte.kennung
                                OR v.empfaenger_kennung = lehrkraefte.kennung)`,
        [jetztMs]);
      return ergebnis.affectedRows;
    }
  };
}

module.exports = { erstelleMariadbAblage };
