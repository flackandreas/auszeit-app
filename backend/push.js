// Web Push: der Alarm, wenn die App nicht offen ist.
//
// Lehrkraefte tragen Handy und Tablet bei sich, nicht einen offenen Tab. Ein
// Alarm, der nur bei offener App ankommt, wird verpasst - Overlay und
// Vibration bleiben, reichen aber nicht.
//
// Was eine Benachrichtigung NIE enthaelt: Schuelernamen. Push laeuft ueber
// Server von Apple, Google, Mozilla oder Microsoft. Die Nachricht sagt nur,
// dass etwas zu tun ist; die Einzelheiten laedt die App nach dem Oeffnen ueber
// die eigene Verbindung.
const crypto = require('crypto');
const webpush = require('web-push');

// Die Push-Dienste der Browser. Nur dorthin schickt der Server: Ein Abo ist
// eine Adresse, die ein angemeldetes Geraet nennt - ohne diese Liste koennte
// es eine Adresse im Hausnetz eintragen, und der Server riefe sie auf.
const BEKANNTE_DIENSTE = [
  'fcm.googleapis.com',         // Chrome, Edge auf Android
  'android.googleapis.com',
  'push.services.mozilla.com',  // Firefox
  'push.apple.com',             // Safari, iPhone und iPad ab iOS 16.4
  'notify.windows.com'          // Edge unter Windows
];

// Gueltig, solange der Alarm noch etwas nuetzt. Eine Meldung, die nach einer
// Viertelstunde ankommt, ist keine Hilfe mehr - dann lieber gar nicht.
const LEBENSDAUER_S = 10 * 60;

function pushKonfiguration(umgebung = process.env) {
  const oeffentlich = String(umgebung.AUSZEIT_VAPID_PUBLIC || '').trim();
  const privat = String(umgebung.AUSZEIT_VAPID_PRIVATE || '').trim();
  const absender = String(umgebung.AUSZEIT_VAPID_SUBJECT || '').trim();

  const angaben = { AUSZEIT_VAPID_PUBLIC: oeffentlich, AUSZEIT_VAPID_PRIVATE: privat, AUSZEIT_VAPID_SUBJECT: absender };
  const gesetzt = Object.values(angaben).some(Boolean);
  const fehlend = gesetzt ? Object.entries(angaben).filter(([, wert]) => !wert).map(([name]) => name) : [];
  // Die Push-Dienste verlangen eine Kontaktadresse: mailto: oder https.
  const absenderGueltig = /^(mailto:\S+@\S+|https:\/\/\S+)$/.test(absender);
  if (gesetzt && absender && !absenderGueltig) fehlend.push('AUSZEIT_VAPID_SUBJECT (mailto: oder https://)');

  const dienste = String(umgebung.AUSZEIT_PUSH_DIENSTE || '')
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);

  return {
    aktiv: gesetzt && fehlend.length === 0,
    fehlend,
    oeffentlich,
    privat,
    absender,
    dienste: dienste.length > 0 ? dienste : BEKANNTE_DIENSTE
  };
}

const BASIS64URL = /^[A-Za-z0-9_-]+={0,2}$/;

// Ein Abo, wie PushSubscription.toJSON() es liefert. Liefert die geprueften
// Felder oder null.
function abonnementPruefen(roh, dienste = BEKANNTE_DIENSTE) {
  if (!roh || typeof roh !== 'object') return null;
  const endpunkt = typeof roh.endpoint === 'string' ? roh.endpoint : '';
  const p256dh = roh.keys && typeof roh.keys.p256dh === 'string' ? roh.keys.p256dh : '';
  const auth = roh.keys && typeof roh.keys.auth === 'string' ? roh.keys.auth : '';
  if (!endpunkt || endpunkt.length > 2048) return null;

  let url;
  try {
    url = new URL(endpunkt);
  } catch (err) {
    return null;
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
  const host = url.hostname.toLowerCase();
  if (!dienste.some(d => host === d || host.endsWith(`.${d}`))) return null;

  // Oeffentlicher Schluessel des Geraets (65 Byte) und Authentisierungsgeheimnis
  // (16 Byte), beide base64url.
  if (!BASIS64URL.test(p256dh) || p256dh.length < 80 || p256dh.length > 100) return null;
  if (!BASIS64URL.test(auth) || auth.length < 16 || auth.length > 32) return null;

  return { endpunkt, p256dh, auth };
}

// Kennung eines Abos: der Hash seiner Adresse. Dasselbe Geraet meldet nach
// jeder Anmeldung dieselbe Adresse - so wird das Abo umgehaengt statt
// verdoppelt.
function aboSchluessel(endpunkt) {
  return crypto.createHash('sha256').update(endpunkt, 'utf8').digest('hex');
}

// Die Nachrichten. Bewusst ohne Namen - weder Schueler noch Lehrkraefte.
const NACHRICHTEN = {
  kommt: {
    titel: 'Schüler auf dem Weg zu dir',
    text: 'Bitte in Auszeit die Ankunft bestätigen.'
  },
  zurueck: {
    titel: 'Dein Schüler kommt zurück',
    text: 'Bitte in Auszeit die Rückkehr bestätigen.'
  },
  rueckholwunsch: {
    titel: 'Rückholwunsch',
    text: 'Die abgebende Lehrkraft möchte den Schüler zurück.'
  }
};

// Der eigentliche Versand. Austauschbar, damit die Tests ohne Netz sehen,
// was hinausginge.
let versand = (abo, nutzlast, optionen) => webpush.sendNotification(abo, nutzlast, optionen);

function ersetzeVersand(neu) {
  versand = neu;
}

function erstellePush(konfiguration) {
  const optionen = {
    vapidDetails: {
      subject: konfiguration.absender,
      publicKey: konfiguration.oeffentlich,
      privateKey: konfiguration.privat
    },
    TTL: LEBENSDAUER_S,
    // "high" weckt ein Handy im Energiesparmodus; der Alarm ist dringend.
    urgency: 'high'
  };

  /**
   * Schickt eine Nachricht an ein Abo. Liefert 'ok', 'weg' (der Dienst kennt
   * das Abo nicht mehr - loeschen) oder 'fehler'.
   *
   * @param thema  ersetzt beim Dienst eine noch nicht zugestellte Nachricht
   *               mit demselben Thema - etwa zweimal derselbe Vorfall.
   */
  async function sende(abo, nachricht, thema) {
    try {
      await versand(
        { endpoint: abo.endpunkt, keys: { p256dh: abo.p256dh, auth: abo.auth } },
        JSON.stringify(nachricht),
        { ...optionen, ...(thema ? { topic: thema } : {}) }
      );
      return 'ok';
    } catch (err) {
      if (err.statusCode === 404 || err.statusCode === 410) return 'weg';
      console.error(`Push nicht zugestellt (${err.statusCode || err.code || err.message}).`);
      return 'fehler';
    }
  }

  return { oeffentlich: konfiguration.oeffentlich, dienste: konfiguration.dienste, sende };
}

module.exports = {
  BEKANNTE_DIENSTE,
  NACHRICHTEN,
  pushKonfiguration,
  abonnementPruefen,
  aboSchluessel,
  erstellePush,
  ersetzeVersand
};
