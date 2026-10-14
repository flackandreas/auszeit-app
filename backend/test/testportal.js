// Ein Portal fuer die Tests: Entdeckung, JWKS und Token-Endpunkt.
//
// Mit echten RSA-Schluesseln und echten Signaturen, kein Double - genau diese
// Pruefung ist der Kern der Anmeldung. Ueber "anpassen" laesst sich jedes
// ausgestellte ID-Token gezielt verderben: fremder Empfaenger, abgelaufen,
// alg "none", falsch signiert.
//
// Der Aussteller ist eine Adresse, die es nicht gibt (http://schulos.invalid).
// Erreichbar ist das Portal nur ueber seine echte Adresse - so wie im
// Containerverbund, wo die oeffentliche Adresse von innen nicht routbar ist.
// Kommt eine Anmeldung durch, hat Auszeit also PORTAL_INTERN benutzt.
const http = require('http');
const crypto = require('crypto');

const AUSSTELLER = 'http://schulos.invalid';
const CLIENT_ID = 'modul-auszeit';
const GEHEIMNIS = 'test-geheimnis-mindestens-24-zeichen';

function b64(wert) {
  return Buffer.from(typeof wert === 'string' ? wert : JSON.stringify(wert)).toString('base64url');
}

function signiere(kopf, nutzdaten, schluessel) {
  const unterschrieben = `${b64(kopf)}.${b64(nutzdaten)}`;
  if (kopf.alg === 'none') return `${unterschrieben}.`;
  // Die klassische Verwechslung: der oeffentliche Schluessel als HMAC-Geheimnis.
  if (kopf.alg === 'HS256') {
    return `${unterschrieben}.${crypto.createHmac('sha256', schluessel).update(unterschrieben).digest('base64url')}`;
  }
  const signatur = crypto.sign('sha256', Buffer.from(unterschrieben), schluessel).toString('base64url');
  return `${unterschrieben}.${signatur}`;
}

async function starteTestportal() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const fremd = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey;
  const kid = 'test-1';
  const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
  const oeffentlichPem = publicKey.export({ format: 'pem', type: 'spki' });

  const codes = new Map(); // code -> { anfrage, person, anpassen }
  const abrufe = [];

  function idToken(eintrag) {
    const jetzt = Math.floor(Date.now() / 1000);
    let kopf = { alg: 'RS256', kid, typ: 'JWT' };
    let nutzdaten = {
      iss: AUSSTELLER,
      sub: eintrag.person.sub,
      aud: CLIENT_ID,
      iat: jetzt,
      exp: jetzt + 300,
      auth_time: jetzt,
      nonce: eintrag.anfrage.get('nonce'),
      sid: eintrag.person.sid,
      preferred_username: eintrag.person.kuerzel,
      name: eintrag.person.name,
      groups: eintrag.person.gruppen
    };
    let schluessel = privateKey;
    if (eintrag.anpassen) {
      ({ kopf, nutzdaten, schluessel } = eintrag.anpassen({ kopf, nutzdaten, schluessel, fremd, oeffentlichPem }));
    }
    return signiere(kopf, nutzdaten, schluessel);
  }

  function json(res, status, daten) {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(daten));
  }

  const server = http.createServer((req, res) => {
    abrufe.push(`${req.method} ${req.url}`);
    let koerper = '';
    req.on('data', teil => { koerper += teil; });
    req.on('end', () => {
      if (req.url === '/.well-known/openid-configuration') {
        return json(res, 200, {
          issuer: AUSSTELLER,
          authorization_endpoint: `${AUSSTELLER}/oidc/autorisieren`,
          token_endpoint: `${AUSSTELLER}/oidc/token`,
          userinfo_endpoint: `${AUSSTELLER}/oidc/benutzerinfo`,
          jwks_uri: `${AUSSTELLER}/oidc/jwks.json`,
          end_session_endpoint: `${AUSSTELLER}/oidc/abmelden`,
          response_types_supported: ['code'],
          subject_types_supported: ['public'],
          id_token_signing_alg_values_supported: ['RS256'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic']
        });
      }
      if (req.url === '/oidc/jwks.json') return json(res, 200, { keys: [jwk] });
      if (req.url === '/oidc/token' && req.method === 'POST') {
        const formular = new URLSearchParams(koerper);
        const eintrag = codes.get(formular.get('code'));
        codes.delete(formular.get('code'));
        const pkce = eintrag && crypto.createHash('sha256')
          .update(formular.get('code_verifier') || '').digest('base64url');
        if (!eintrag
            || formular.get('client_id') !== CLIENT_ID
            || formular.get('client_secret') !== GEHEIMNIS
            || formular.get('redirect_uri') !== eintrag.anfrage.get('redirect_uri')
            || pkce !== eintrag.anfrage.get('code_challenge')) {
          return json(res, 400, { error: 'invalid_grant' });
        }
        return json(res, 200, {
          access_token: crypto.randomBytes(16).toString('hex'),
          token_type: 'Bearer',
          expires_in: 900,
          id_token: idToken(eintrag)
        });
      }
      json(res, 404, { error: 'not_found' });
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

  return {
    aussteller: AUSSTELLER,
    clientId: CLIENT_ID,
    geheimnis: GEHEIMNIS,
    intern: `http://127.0.0.1:${server.address().port}`,
    abrufe,

    // Was im Browser die Anmeldung am Portal waere: Die Autorisierungsadresse
    // wird angenommen, ein Code geht zurueck.
    autorisiere(adresse, person, anpassen = null) {
      const url = new URL(adresse);
      if (`${url.origin}${url.pathname}` !== `${AUSSTELLER}/oidc/autorisieren`) {
        throw new Error(`Unerwartete Autorisierungsadresse: ${adresse}`);
      }
      const code = crypto.randomBytes(16).toString('hex');
      codes.set(code, { anfrage: url.searchParams, person, anpassen });
      return { code, state: url.searchParams.get('state'), anfrage: url.searchParams };
    },

    beenden() {
      server.close();
    }
  };
}

module.exports = { starteTestportal };
