// Ablage ohne Datenbank: alles im Arbeitsspeicher.
//
// So lief Auszeit bis hierher, und so laeuft es weiter, wenn kein DB_HOST
// gesetzt ist - fuer die Entwicklung, fuer die Tests und fuer eine Demo, die
// ohnehin nichts behalten soll. Ein Neustart des Prozesses verliert alles.
//
// Innerhalb eines Prozesses ueberlebt der Inhalt aber das erneute Laden des
// Servers. Darauf bauen die Tests auf, die einen Neustart nachspielen.

const OFFEN = new Set(['unterwegs', 'betreut', 'auf_dem_rueckweg']);

function kopie(zeile) {
  return structuredClone(zeile);
}

function erstelleFluechtigeAblage() {
  const lehrkraefte = new Map();
  const sitzungen = new Map();
  const vorfaelle = new Map();
  const schueler = new Map();
  const pushAbos = new Map();

  return {
    art: 'fluechtig',

    async oeffnen() {},
    async schliessen() {},

    async lehrkraftSpeichern(zeile) { lehrkraefte.set(zeile.kennung, kopie(zeile)); },
    async lehrkraftLoeschen(kennung) { lehrkraefte.delete(kennung); },

    async sitzungSpeichern(zeile) { sitzungen.set(zeile.schluessel, kopie(zeile)); },
    // Mit einer Sitzung enden ihre Push-Abos.
    async sitzungLoeschen(schluessel) {
      sitzungen.delete(schluessel);
      for (const [k, a] of pushAbos) if (a.sitzung === schluessel) pushAbos.delete(k);
    },
    async sitzungenLoeschenFuer(kennung) {
      for (const [schluessel, s] of sitzungen) if (s.kennung === kennung) sitzungen.delete(schluessel);
      for (const [k, a] of pushAbos) if (a.kennung === kennung) pushAbos.delete(k);
    },
    async abgelaufeneSitzungenLoeschen(jetztMs) {
      for (const [schluessel, s] of sitzungen) if (s.gueltig_bis <= jetztMs) sitzungen.delete(schluessel);
      for (const [k, a] of pushAbos) if (!sitzungen.has(a.sitzung)) pushAbos.delete(k);
    },

    async pushAboSpeichern(zeile) { pushAbos.set(zeile.schluessel, kopie(zeile)); },
    async pushAboLoeschen(schluessel) { pushAbos.delete(schluessel); },

    async schuelerSpeichern(zeilen) {
      for (const zeile of zeilen) schueler.set(zeile.kennung, kopie(zeile));
    },

    async vorfallSpeichern(zeile) { vorfaelle.set(zeile.id, kopie(zeile)); },
    async vorfallLoeschen(id) { vorfaelle.delete(id); },

    async laden({ jetztMs, anzeigeSeit }) {
      const gueltig = [...sitzungen.values()].filter(s => s.gueltig_bis > jetztMs);
      const geladen = [...vorfaelle.values()].filter(v =>
        OFFEN.has(v.status) || (v.beendet_am && v.beendet_am >= anzeigeSeit));
      const gebraucht = new Set([
        ...gueltig.map(s => s.kennung),
        ...geladen.flatMap(v => [v.sender_kennung, v.empfaenger_kennung])
      ]);
      return {
        lehrkraefte: [...lehrkraefte.values()].filter(l => l.sub || gebraucht.has(l.kennung)).map(kopie),
        sitzungen: gueltig.map(kopie),
        vorfaelle: geladen.map(kopie),
        schueler: [...schueler.values()].map(kopie),
        pushAbos: [...pushAbos.values()].filter(a => gueltig.some(s => s.schluessel === a.sitzung)).map(kopie)
      };
    },

    async jahreswechsel(schuljahr) {
      const geloescht = { vorfaelle: 0, schueler: 0 };
      for (const [id, v] of vorfaelle) {
        if (v.schuljahr < schuljahr) {
          vorfaelle.delete(id);
          geloescht.vorfaelle += 1;
        }
      }
      for (const [kennung, s] of schueler) {
        if (s.schuljahr < schuljahr) {
          schueler.delete(kennung);
          geloescht.schueler += 1;
        }
      }
      return geloescht;
    },

    // Lehrkraefte aus Anmeldungen mit Code haben keine dauerhafte Identitaet.
    // Ohne gueltige Sitzung und ohne Vorfall zeigt nichts mehr auf sie.
    async verwaisteLehrkraefteLoeschen(jetztMs) {
      const bezogen = new Set([...vorfaelle.values()].flatMap(v => [v.sender_kennung, v.empfaenger_kennung]));
      const angemeldet = new Set([...sitzungen.values()].filter(s => s.gueltig_bis > jetztMs).map(s => s.kennung));
      let geloescht = 0;
      for (const [kennung, l] of lehrkraefte) {
        if (!l.sub && !bezogen.has(kennung) && !angemeldet.has(kennung)) {
          lehrkraefte.delete(kennung);
          geloescht += 1;
        }
      }
      return geloescht;
    },

    // Nur fuer die Tests: was gerade in der Ablage steht.
    inhalt() {
      return {
        lehrkraefte: [...lehrkraefte.values()].map(kopie),
        sitzungen: [...sitzungen.values()].map(kopie),
        vorfaelle: [...vorfaelle.values()].map(kopie),
        schueler: [...schueler.values()].map(kopie),
        pushAbos: [...pushAbos.values()].map(kopie)
      };
    }
  };
}

module.exports = { erstelleFluechtigeAblage };
