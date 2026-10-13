// Startet den Server fuer die Tests auf einem freien Port.
//
// Die Mandanten kommen aus einer eigenen Datei, damit die Tests nichts an der
// echten Ablage veraendern. node --test startet jede Testdatei in einem eigenen
// Prozess - jede bekommt also einen frischen Server mit leerem Speicher.
const fs = require('fs');
const os = require('os');
const path = require('path');

const SERVER = require.resolve('../server');

async function starteTestserver(mandanten) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'auszeit-test-'));
  process.env.AUSZEIT_DATEN = path.join(ordner, 'schulen.json');
  fs.writeFileSync(process.env.AUSZEIT_DATEN, JSON.stringify({ version: 1, ...mandanten }));

  // Der Server protokolliert jede Verbindung - in der Testausgabe nur Rauschen.
  // Meldungen werden gesammelt statt ausgegeben: Ein Test, der eine Ablehnung
  // erwartet, prueft daran, dass sie aus dem richtigen Grund kam.
  const log = console.log;
  const fehlerAusgabe = console.error;
  const protokoll = [];
  const fehler = [];
  console.log = (...teile) => { protokoll.push(teile.join(' ')); };
  console.error = (...teile) => { fehler.push(teile.join(' ')); };

  let instanz;
  async function starte() {
    instanz = require(SERVER);
    await instanz.bereit;
    await new Promise(resolve => instanz.server.listen(0, resolve));
    testserver.adresse = `http://localhost:${instanz.server.address().port}`;
  }

  const testserver = {
    adresse: null,
    protokoll,
    fehler,
    get instanz() { return instanz; },

    // Spielt einen Neustart nach: Der alte Server faehrt herunter, ein neu
    // geladener startet mit leerem Speicher - und findet dieselbe Ablage vor,
    // so wie ein neuer Container dieselbe Datenbank vorfindet.
    async neustarten() {
      await instanz.beenden();
      delete require.cache[SERVER];
      await starte();
    },

    async beenden() {
      await instanz.beenden();
      // Die Ablage gehoert dem Prozess, nicht dem Server. Am Ende der
      // Testdatei wird sie geschlossen - sonst hielten offene Verbindungen zur
      // Datenbank den Prozess am Leben.
      await instanz.ablage.schliessen();
      fs.rmSync(ordner, { recursive: true, force: true });
      console.log = log;
      console.error = fehlerAusgabe;
    }
  };

  await starte();
  return testserver;
}

module.exports = { starteTestserver };
