// Startet den Server fuer die Tests auf einem freien Port.
//
// Die Mandanten kommen aus einer eigenen Datei, damit die Tests nichts an der
// echten Ablage veraendern. node --test startet jede Testdatei in einem eigenen
// Prozess - jede bekommt also einen frischen Server mit leerem Speicher.
const fs = require('fs');
const os = require('os');
const path = require('path');

async function starteTestserver(mandanten) {
  const ordner = fs.mkdtempSync(path.join(os.tmpdir(), 'auszeit-test-'));
  process.env.AUSZEIT_DATEN = path.join(ordner, 'schulen.json');
  fs.writeFileSync(process.env.AUSZEIT_DATEN, JSON.stringify({ version: 1, ...mandanten }));

  // Der Server protokolliert jede Verbindung - in der Testausgabe nur Rauschen.
  const log = console.log;
  console.log = () => {};

  const { server, io } = require('../server');
  await new Promise(resolve => server.listen(0, resolve));

  return {
    adresse: `http://localhost:${server.address().port}`,
    beenden() {
      io.close();
      fs.rmSync(ordner, { recursive: true, force: true });
      console.log = log;
    }
  };
}

module.exports = { starteTestserver };
