// Admin-Oberflaeche: Mandanten anlegen, aendern, stilllegen.
//
// Dies ist die einzige Stelle der Anwendung, an der die Mandantengrenze
// absichtlich ueberschritten wird. Deshalb gilt hier durchgehend: Zahlen, nie
// Inhalte. Weder Schueler- noch Lehrernamen verlassen diesen Weg - nur, wie
// viele gerade angemeldet sind. Ein Leck waere sonst genau hier am teuersten.
const express = require('express');
const crypto = require('crypto');
const path = require('path');
const { liesKeks } = require('./kekse');

const TOKEN_MINDESTLAENGE = 16;
const SITZUNG_GUELTIG_MS = 8 * 60 * 60 * 1000;
const COOKIE = 'auszeit_admin';

// Fehlversuche werden gebremst statt gesperrt - dieselbe Ueberlegung wie beim
// Beitrittscode: eine Sperre liesse sich von aussen ausloesen.
const ANMELDE_FREIVERSUCHE = 2;
const ANMELDE_MAX_VERZOEGERUNG_MS = 8000;
let anmeldeFehler = 0;
let anmeldeLetzter = 0;

function verzoegerung() {
  if (Date.now() - anmeldeLetzter > 10 * 60 * 1000) anmeldeFehler = 0;
  if (anmeldeFehler <= ANMELDE_FREIVERSUCHE) return 0;
  return Math.min(ANMELDE_MAX_VERZOEGERUNG_MS, 500 * 2 ** (anmeldeFehler - ANMELDE_FREIVERSUCHE));
}

function gleichwertig(a, b) {
  const hash = (w) => crypto.createHash('sha256').update(String(w == null ? '' : w), 'utf8').digest();
  return crypto.timingSafeEqual(hash(a), hash(b));
}

// Signiertes Cookie statt Sitzungsspeicher: so ueberlebt die Anmeldung einen
// Neustart, und es braucht keine zweite Datenhaltung.
function cookieErzeugen(token) {
  const gueltigBis = String(Date.now() + SITZUNG_GUELTIG_MS);
  const signatur = crypto.createHmac('sha256', token).update(gueltigBis).digest('hex');
  return `${gueltigBis}.${signatur}`;
}

function cookieGueltig(wert, token) {
  if (typeof wert !== 'string' || !wert.includes('.')) return false;
  const [gueltigBis, signatur] = wert.split('.', 2);
  if (!/^\d+$/.test(gueltigBis) || Number(gueltigBis) < Date.now()) return false;
  const erwartet = crypto.createHmac('sha256', token).update(gueltigBis).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatur, 'hex'), Buffer.from(erwartet, 'hex'));
  } catch (err) {
    return false;
  }
}

/**
 * @param kontext.schulen        die lebende Map (wird direkt geaendert)
 * @param kontext.standard       () => aktueller Standardmandant
 * @param kontext.setzeStandard  (id) => void
 * @param kontext.speichern      () => void, schreibt die Datei
 * @param kontext.zaehler        (id) => { lehrkraefte, auszeiten }
 * @param kontext.speicher       das Speichermodul (Bereinigung, Codepruefung)
 */
function erstelleAdmin(kontext) {
  const token = String(process.env.AUSZEIT_ADMIN_TOKEN || '').trim();
  if (token.length < TOKEN_MINDESTLAENGE) {
    if (token.length > 0) {
      console.error(`AUSZEIT_ADMIN_TOKEN ist kuerzer als ${TOKEN_MINDESTLAENGE} Zeichen - Admin bleibt abgeschaltet.`);
    }
    // Ohne Token gibt es die Oberflaeche gar nicht. Das ist die sichere
    // Vorgabe: eine Verwaltungsseite ohne Schutz waere schlimmer als keine.
    return null;
  }

  const router = express.Router();
  router.use(express.json());

  router.get('/', (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));

  router.post('/api/anmelden', (req, res) => {
    const versuch = String((req.body && req.body.token) || '');
    if (!gleichwertig(versuch, token)) {
      const warten = verzoegerung();
      anmeldeFehler += 1;
      anmeldeLetzter = Date.now();
      setTimeout(() => res.status(401).json({ fehler: 'token_falsch' }), warten);
      return;
    }
    anmeldeFehler = 0;
    res.cookie(COOKIE, cookieErzeugen(token), {
      httpOnly: true,
      sameSite: 'strict',
      secure: req.secure || req.headers['x-forwarded-proto'] === 'https',
      maxAge: SITZUNG_GUELTIG_MS
    });
    res.json({ ok: true });
  });

  router.post('/api/abmelden', (req, res) => {
    res.clearCookie(COOKIE);
    res.json({ ok: true });
  });

  // Ab hier ist alles geschuetzt.
  router.use('/api', (req, res, next) => {
    if (cookieGueltig(liesKeks(req, COOKIE), token)) return next();
    res.status(401).json({ fehler: 'nicht_angemeldet' });
  });

  // Nach aussen geht der Code selbst nie - nur, ob einer gesetzt ist.
  function darstellung(id) {
    const schule = kontext.schulen.get(id);
    const zaehler = kontext.zaehler(id);
    return {
      id,
      name: schule.name,
      demo: schule.demo,
      aktiv: schule.aktiv,
      hatCode: Boolean(schule.pin),
      standard: kontext.standard() === id,
      lehrkraefte: zaehler.lehrkraefte,
      auszeiten: zaehler.auszeiten
    };
  }

  router.get('/api/schulen', (req, res) => {
    res.json({
      schulen: [...kontext.schulen.keys()].sort().map(darstellung),
      standard: kontext.standard(),
      mindestlaengeCode: kontext.speicher.PIN_MINDESTLAENGE
    });
  });

  router.post('/api/schulen', (req, res) => {
    const daten = req.body || {};
    const id = kontext.speicher.normalisiereSchulcode(daten.id);
    if (!id) return res.status(400).json({ fehler: 'code_ungueltig' });
    if (kontext.schulen.has(id)) return res.status(409).json({ fehler: 'code_vergeben' });
    if (!String(daten.name || '').trim()) return res.status(400).json({ fehler: 'name_fehlt' });

    const pin = String(daten.pin || '').trim();
    if (pin && pin.length < kontext.speicher.PIN_MINDESTLAENGE) {
      return res.status(400).json({ fehler: 'code_zu_kurz' });
    }

    kontext.schulen.set(id, kontext.speicher.bereinigeSchule({
      name: daten.name, demo: daten.demo, pin, aktiv: true
    }, id));
    if (daten.standard) kontext.setzeStandard(id);
    kontext.speichern();
    res.status(201).json(darstellung(id));
  });

  router.patch('/api/schulen/:id', (req, res) => {
    const id = kontext.speicher.normalisiereSchulcode(req.params.id);
    const schule = id && kontext.schulen.get(id);
    if (!schule) return res.status(404).json({ fehler: 'unbekannt' });

    const daten = req.body || {};
    if (daten.name !== undefined) {
      if (!String(daten.name).trim()) return res.status(400).json({ fehler: 'name_fehlt' });
      schule.name = String(daten.name).trim().slice(0, 80);
    }
    if (daten.demo !== undefined) schule.demo = Boolean(daten.demo);

    if (daten.aktiv !== undefined) {
      const aktiv = Boolean(daten.aktiv);
      // Der Standardmandant faengt den blanken Link ab - stillgelegt liefe
      // jedes bestehende Lesezeichen ins Leere.
      if (!aktiv && kontext.standard() === id) {
        return res.status(409).json({ fehler: 'standard_nicht_stilllegbar' });
      }
      schule.aktiv = aktiv;
    }

    // '' entfernt den Code, undefined laesst ihn unveraendert.
    if (daten.pin !== undefined) {
      const pin = String(daten.pin).trim();
      if (pin && pin.length < kontext.speicher.PIN_MINDESTLAENGE) {
        return res.status(400).json({ fehler: 'code_zu_kurz' });
      }
      schule.pin = pin;
    }

    if (daten.standard === true) {
      if (!schule.aktiv) return res.status(409).json({ fehler: 'standard_muss_aktiv_sein' });
      kontext.setzeStandard(id);
    }

    kontext.speichern();
    res.json(darstellung(id));
  });

  // Stilllegen statt loeschen. Endgueltig weg kann nur, was niemand mehr nutzt.
  router.delete('/api/schulen/:id', (req, res) => {
    const id = kontext.speicher.normalisiereSchulcode(req.params.id);
    const schule = id && kontext.schulen.get(id);
    if (!schule) return res.status(404).json({ fehler: 'unbekannt' });
    if (kontext.standard() === id) return res.status(409).json({ fehler: 'standard_nicht_loeschbar' });

    const zaehler = kontext.zaehler(id);
    if (zaehler.lehrkraefte > 0 || zaehler.auszeiten > 0) {
      return res.status(409).json({ fehler: 'noch_in_benutzung', ...zaehler });
    }
    if (kontext.schulen.size <= 1) return res.status(409).json({ fehler: 'letzter_mandant' });

    kontext.schulen.delete(id);
    kontext.speichern();
    res.json({ ok: true });
  });

  return router;
}

module.exports = { erstelleAdmin, TOKEN_MINDESTLAENGE };
