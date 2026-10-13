// Dauerhafte Ablage von Lehrkraeften, Sitzungen und Vorfaellen.
//
// Der Arbeitsspeicher bleibt der Arbeitszustand: Wer gerade online ist,
// aufnehmen kann und wie viele Plaetze anbietet, wechselt im Minutentakt und
// beginnt nach einem Neustart ohnehin von vorn. Die Ablage ist die dauerhafte
// Abschrift - das Protokoll fuer die Schule und der Stand, aus dem ein
// Neustart laufende Auszeiten samt Belegung wiederherstellt.
//
// Geschrieben wird hinter dem Rueckruf, nicht davor: Die Socket-Ereignisse
// bleiben synchron und schnell, eine langsame Datenbank haelt keine
// Ankunftsbestaetigung auf. Damit dabei nichts durcheinandergeraet, laufen
// alle Schreibvorgaenge nacheinander durch eine Warteschlange - "angekommen"
// kann "angelegt" nicht ueberholen.
const fs = require('fs');
const { erstelleFluechtigeAblage } = require('./fluechtig');
const { erstelleMariadbAblage } = require('./mariadb');
const { lehrkraftZeile, vorfallZeile } = require('./zeilen');

function umWarteschlange(impl) {
  let kette = Promise.resolve();
  let fehler = 0;

  function einreihen(beschreibung, arbeit) {
    kette = kette.then(arbeit).catch(err => {
      fehler += 1;
      // Der Laufzeitzustand stimmt weiter; nur die Abschrift fehlt. Das muss
      // im Log auffallen, darf aber keine laufende Auszeit aufhalten.
      console.error(`Ablage: ${beschreibung} nicht gespeichert (${err.code || err.message}).`);
    });
    return kette;
  }

  return {
    art: impl.art,
    get fehler() { return fehler; },

    oeffnen: () => impl.oeffnen(),
    laden: (optionen) => impl.laden(optionen),

    // Wartet, bis alles Eingereihte geschrieben ist - vor dem Beenden und in
    // den Tests.
    leeren: () => kette,
    async schliessen() {
      await kette;
      await impl.schliessen();
    },

    // Die Momentaufnahme entsteht hier, beim Aufruf - nicht erst, wenn die
    // Warteschlange so weit ist.
    lehrkraftSpeichern(teacher) {
      const zeile = lehrkraftZeile(teacher);
      return einreihen(`Lehrkraft ${zeile.kennung}`, () => impl.lehrkraftSpeichern(zeile));
    },
    lehrkraftLoeschen(kennung) {
      return einreihen(`Loeschen der Lehrkraft ${kennung}`, () => impl.lehrkraftLoeschen(kennung));
    },

    sitzungSpeichern(schluessel, eintrag) {
      const { teacherId, gueltigBis, ...angaben } = eintrag;
      const zeile = { schluessel, kennung: teacherId, gueltig_bis: gueltigBis, angaben };
      return einreihen('Sitzung', () => impl.sitzungSpeichern(zeile));
    },
    sitzungLoeschen(schluessel) {
      return einreihen('Ende einer Sitzung', () => impl.sitzungLoeschen(schluessel));
    },
    sitzungenLoeschenFuer(kennung) {
      return einreihen('Ende der Sitzungen einer Lehrkraft', () => impl.sitzungenLoeschenFuer(kennung));
    },
    abgelaufeneSitzungenLoeschen(jetztMs) {
      return einreihen('Aufraeumen der Sitzungen', () => impl.abgelaufeneSitzungenLoeschen(jetztMs));
    },

    vorfallSpeichern(vorfall) {
      const zeile = vorfallZeile(vorfall);
      return einreihen(`Vorfall ${zeile.id}`, () => impl.vorfallSpeichern(zeile));
    },
    vorfallLoeschen(id) {
      return einreihen(`Loeschen des Vorfalls ${id}`, () => impl.vorfallLoeschen(id));
    },

    // Liefert, wie viele Vorfaelle geloescht wurden - also nicht nur
    // einreihen, sondern auf das Ergebnis warten.
    async jahreswechsel(schuljahr) {
      let geloescht = 0;
      await einreihen('Schuljahreswechsel', async () => {
        geloescht = await impl.jahreswechsel(schuljahr);
      });
      return geloescht;
    },
    verwaisteLehrkraefteLoeschen(jetztMs) {
      return einreihen('Aufraeumen der Lehrkraefte', () => impl.verwaisteLehrkraefteLoeschen(jetztMs));
    },

    // Nur fuer die Tests, nur bei der fluechtigen Ablage.
    inhalt: impl.inhalt ? () => impl.inhalt() : undefined
  };
}

// Dieselben Namen wie bei den PHP-Modulen des Verbunds. DB_PASS_FILE fuer den
// Einzelbetrieb: Dort erzeugt Compose das Passwort beim ersten Start in eine
// Datei, statt eines mitzuliefern.
function dbKonfiguration(umgebung) {
  let passwort = umgebung.DB_PASS || '';
  if (!passwort && umgebung.DB_PASS_FILE) {
    try {
      passwort = fs.readFileSync(umgebung.DB_PASS_FILE, 'utf8').trim();
    } catch (err) {
      console.error(`DB_PASS_FILE nicht lesbar: ${err.message}`);
    }
  }
  return {
    host: umgebung.DB_HOST,
    port: Number.parseInt(umgebung.DB_PORT, 10) || 3306,
    datenbank: umgebung.DB_NAME || 'auszeit',
    nutzer: umgebung.DB_USER || 'auszeit',
    passwort
  };
}

// Eine Ablage je Prozess. Laedt ein Test den Server neu, um einen Neustart
// nachzuspielen, findet der neue Server dieselbe Ablage vor - so, wie ein
// neuer Container dieselbe Datenbank vorfindet.
let standard = null;

function standardAblage(umgebung = process.env) {
  if (!standard) {
    standard = umWarteschlange(umgebung.DB_HOST
      ? erstelleMariadbAblage(dbKonfiguration(umgebung))
      : erstelleFluechtigeAblage());
  }
  return standard;
}

module.exports = { standardAblage, umWarteschlange, dbKonfiguration };
