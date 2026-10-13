// Beide Ablagen muessen sich gleich verhalten: die im Arbeitsspeicher, gegen
// die alle uebrigen Tests laufen, und MariaDB im Betrieb.
//
// Gegen MariaDB laeuft dieser Test nur, wenn AUSZEIT_TEST_DB_HOST gesetzt ist -
// mit einer Wegwerf-Datenbank, denn er leert die Tabellen. Etwa:
//
//   docker run -d --rm --name auszeit-testdb -p 127.0.0.1:33306:3306 \
//     -e MARIADB_ROOT_PASSWORD=test -e MARIADB_DATABASE=auszeit_test mariadb:10.11
//   AUSZEIT_TEST_DB_HOST=127.0.0.1 AUSZEIT_TEST_DB_PORT=33306 \
//     AUSZEIT_TEST_DB_PASS=test npm test
const test = require('node:test');
const assert = require('node:assert/strict');
const { umWarteschlange } = require('../ablage');
const { erstelleFluechtigeAblage } = require('../ablage/fluechtig');
const { erstelleMariadbAblage } = require('../ablage/mariadb');
const { lehrkraftAusZeile, vorfallAusZeile } = require('../ablage/zeilen');

const STUNDE = 60 * 60 * 1000;

const arten = [['fluechtig', async () => erstelleFluechtigeAblage()]];
if (process.env.AUSZEIT_TEST_DB_HOST) {
  arten.push(['mariadb', async () => {
    const konfiguration = {
      host: process.env.AUSZEIT_TEST_DB_HOST,
      port: Number(process.env.AUSZEIT_TEST_DB_PORT) || 3306,
      datenbank: process.env.AUSZEIT_TEST_DB_NAME || 'auszeit_test',
      nutzer: process.env.AUSZEIT_TEST_DB_USER || 'root',
      passwort: process.env.AUSZEIT_TEST_DB_PASS || ''
    };
    // Leer beginnen - auch die Migrationen sollen von vorn laufen.
    const mysql = require('mysql2/promise');
    const db = await mysql.createConnection({
      host: konfiguration.host, port: konfiguration.port, user: konfiguration.nutzer,
      password: konfiguration.passwort, database: konfiguration.datenbank
    });
    await db.query('DROP TABLE IF EXISTS migrationen, lehrkraefte, sitzungen, vorfaelle');
    await db.end();
    return erstelleMariadbAblage(konfiguration, { versuche: 1 });
  }]);
}

// Ein Vorfall, wie der Server ihn haelt.
function vorfall(id, felder = {}) {
  return {
    id,
    schulId: 'schule',
    schuljahr: 2026,
    senderId: 'abgebend-1',
    senderName: 'Anna Ab',
    senderRaum: '101',
    receiverId: 'aufnehmend-1',
    receiverName: 'Bert Auf',
    receiverRaum: '202',
    studentName: 'Max Muster',
    status: 'unterwegs',
    timestamp: new Date('2026-10-13T08:15:00.123Z'),
    ...felder
  };
}

function lehrkraft(id, felder = {}) {
  return { id, schulId: 'schule', name: `Lehrkraft ${id}`, room: 'R1', ...felder };
}

for (const [art, erzeuge] of arten) {
  test(`Ablage ${art}`, async (t) => {
    const ablage = umWarteschlange(await erzeuge());
    await ablage.oeffnen();
    t.after(() => ablage.schliessen());
    const jetzt = Date.parse('2026-10-13T12:00:00Z');
    const laden = () => ablage.laden({ jetztMs: jetzt, anzeigeSeit: new Date(jetzt - 12 * STUNDE) });

    if (art === 'mariadb') {
      await t.test('Migrationen laufen nur einmal', async () => {
        await ablage.oeffnen();
      });
    }

    await t.test('Ein Vorfall kommt so zurueck, wie er gespeichert wurde', async () => {
      const v = vorfall('v-rund', {
        status: 'betreut',
        angekommenAm: new Date('2026-10-13T08:17:30.456Z'),
        rueckholwunsch: true,
        rueckholwunschSeit: new Date('2026-10-13T08:40:00.000Z')
      });
      ablage.vorfallSpeichern(v);
      await ablage.leeren();
      const geladen = (await laden()).vorfaelle.map(vorfallAusZeile).find(x => x.id === 'v-rund');
      assert.deepEqual(geladen, v);
    });

    await t.test('Ein Zustandswechsel aendert die Zeile, statt eine zweite anzulegen', async () => {
      const v = vorfall('v-wechsel');
      ablage.vorfallSpeichern(v);
      // Momentaufnahme: Was nach dem Aufruf am Objekt passiert, gehoert zum
      // naechsten Schreibvorgang, nicht zu diesem.
      v.status = 'zurueck';
      v.zurueckAm = new Date('2026-10-13T09:00:00.000Z');
      v.beendetAm = v.zurueckAm;
      v.abschluss = 'zurueck';
      ablage.vorfallSpeichern(v);
      await ablage.leeren();
      const alle = (await laden()).vorfaelle.filter(x => x.id === 'v-wechsel');
      assert.equal(alle.length, 1);
      assert.equal(alle[0].abschluss, 'zurueck');
    });

    await t.test('Geladen werden offene und heute beendete Vorfaelle', async () => {
      ablage.vorfallSpeichern(vorfall('v-offen-alt', { timestamp: new Date(jetzt - 30 * STUNDE) }));
      ablage.vorfallSpeichern(vorfall('v-gestern', {
        status: 'zurueck', abschluss: 'zurueck', beendetAm: new Date(jetzt - 20 * STUNDE)
      }));
      await ablage.leeren();
      const ids = (await laden()).vorfaelle.map(z => z.id);
      assert.ok(ids.includes('v-offen-alt'), 'ein offener Vorfall fehlt nach dem Neustart');
      assert.ok(ids.includes('v-wechsel'), 'ein heute beendeter Vorfall fehlt');
      assert.ok(!ids.includes('v-gestern'));
    });

    await t.test('Sitzungen: nur gueltige, mit ihren Angaben', async () => {
      ablage.sitzungSpeichern('a'.repeat(64), { teacherId: 'abgebend-1', gueltigBis: jetzt + STUNDE, portal: true, sid: 's1' });
      ablage.sitzungSpeichern('b'.repeat(64), { teacherId: 'weg-1', gueltigBis: jetzt - 1 });
      await ablage.leeren();
      const sitzungen = (await laden()).sitzungen;
      assert.deepEqual(sitzungen, [{
        schluessel: 'a'.repeat(64), kennung: 'abgebend-1', gueltig_bis: jetzt + STUNDE, angaben: { portal: true, sid: 's1' }
      }]);
    });

    await t.test('Lehrkraefte: aus dem Portal immer, mit Code nur mit Sitzung oder Vorfall', async () => {
      ablage.lehrkraftSpeichern(lehrkraft('abgebend-1'));
      ablage.lehrkraftSpeichern(lehrkraft('portal-1', { sub: 'sub-1', kuerzel: 'PO', verwaltung: true }));
      ablage.lehrkraftSpeichern(lehrkraft('ohne-bezug'));
      await ablage.leeren();
      const geladen = (await laden()).lehrkraefte.map(lehrkraftAusZeile);
      const ids = geladen.map(l => l.id).sort();
      assert.deepEqual(ids, ['abgebend-1', 'portal-1']);
      const portal = geladen.find(l => l.id === 'portal-1');
      assert.equal(portal.sub, 'sub-1');
      assert.equal(portal.verwaltung, true);
      assert.equal(portal.room, 'R1');
    });

    await t.test('Ohne Bezug faellt eine Lehrkraft mit Code weg, eine aus dem Portal nie', async () => {
      ablage.verwaisteLehrkraefteLoeschen(jetzt);
      // Eine frische Sitzung machte die Zeile wieder sichtbar - falls es sie
      // noch gaebe.
      ablage.sitzungSpeichern('d'.repeat(64), { teacherId: 'ohne-bezug', gueltigBis: jetzt + STUNDE });
      await ablage.leeren();
      const vorhanden = (await laden()).lehrkraefte.map(z => z.kennung);
      assert.ok(!vorhanden.includes('ohne-bezug'), 'Lehrkraft ohne Bezug ist noch da');
      assert.ok(vorhanden.includes('portal-1'));
      assert.ok(vorhanden.includes('abgebend-1'), 'mit Sitzung und Vorfall muss sie bleiben');
      ablage.sitzungLoeschen('d'.repeat(64));
    });

    await t.test('Sitzungen enden einzeln, je Lehrkraft und nach Ablauf', async () => {
      ablage.sitzungSpeichern('c'.repeat(64), { teacherId: 'abgebend-1', gueltigBis: jetzt + STUNDE });
      ablage.sitzungLoeschen('a'.repeat(64));
      await ablage.leeren();
      assert.deepEqual((await laden()).sitzungen.map(s => s.schluessel), ['c'.repeat(64)]);
      ablage.sitzungenLoeschenFuer('abgebend-1');
      ablage.abgelaufeneSitzungenLoeschen(jetzt);
      await ablage.leeren();
      assert.deepEqual((await laden()).sitzungen, []);
    });

    await t.test('Schuljahreswechsel loescht nur fruehere Schuljahre', async () => {
      ablage.vorfallSpeichern(vorfall('v-neues-jahr', { schuljahr: 2027 }));
      await ablage.leeren();
      const vorher = (await laden()).vorfaelle.filter(z => z.schuljahr === 2026).length;
      assert.equal(await ablage.jahreswechsel(2027), vorher + 1, 'v-gestern zaehlt mit, auch wenn er nicht geladen wird');
      assert.deepEqual((await laden()).vorfaelle.map(z => z.id), ['v-neues-jahr']);
      assert.equal(await ablage.jahreswechsel(2027), 0);
    });

    await t.test('Vorfaelle lassen sich loeschen (Demo)', async () => {
      ablage.vorfallLoeschen('v-neues-jahr');
      await ablage.leeren();
      assert.deepEqual((await laden()).vorfaelle, []);
      assert.equal(ablage.fehler, 0, 'ein Schreibvorgang ist gescheitert');
    });
  });
}
