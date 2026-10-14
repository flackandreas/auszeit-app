// Anmeldung ueber das SchulOS-Portal (OpenID Connect).
//
// Ein dauerhaftes Protokoll braucht echte Identitaeten - ein frei eingetippter
// Name ist dafuer keine. Das Portal ist die einzige Stelle, an der eine
// Lehrkraft ein Passwort eingibt; Auszeit bekommt von dort, wer sie ist.
//
// Den Ablauf selbst erledigt openid-client statt eines Eigenbaus. Der
// Pruefumfang entspricht dem der PHP-Module (schulos-sso): PKCE mit S256,
// state und nonce auf dem Server, Signatur ueber JWKS nur mit RS256, dazu
// iss, aud, exp und azp. Das Entdeckungsdokument muss den Aussteller nennen,
// nach dem gefragt wurde.
//
// Ohne PORTAL_ISSUER ist hier alles aus und Auszeit laeuft wie bisher mit
// Beitrittscode - eine Schule soll Auszeit auch ohne Portal betreiben koennen.
const crypto = require('crypto');

// Zwischen /sso/start und /sso/rueckweg liegt die Anmeldung am Portal. Laenger
// als zehn Minuten braucht dafuer niemand; ein aelterer Vorgang ist verdaechtig.
const VORGANG_GUELTIG_MS = 10 * 60 * 1000;
// /sso/start ist ohne Anmeldung erreichbar. Ohne Obergrenze liesse sich der
// Speicher mit angefangenen Vorgaengen fuellen.
const VORGAENGE_HOECHSTENS = 5000;

class PortalFehler extends Error {}

// Kommagetrennte Gruppenliste, wie sie in den Umgebungsvariablen steht.
function gruppenListe(wert) {
  return String(wert || '').split(',').map(g => g.trim()).filter(Boolean);
}

// Gross- und Kleinschreibung zaehlt nicht: "kollegium" aus einer Datei und
// "Kollegium" aus dem Portal sind dieselbe Gruppe.
function inGruppen(eigene, gesucht) {
  const klein = new Set(eigene.map(g => g.toLowerCase()));
  return gesucht.some(g => klein.has(g.toLowerCase()));
}

function konfigurationAusUmgebung(umgebung = process.env) {
  const lies = name => String(umgebung[`PORTAL_${name}`] || '').trim();

  const aussteller = lies('ISSUER').replace(/\/+$/, '');
  const clientId = lies('CLIENT_ID');
  const geheimnis = lies('CLIENT_SECRET');
  let rueckadresse = lies('REDIRECT_URI');
  const intern = lies('INTERN').replace(/\/+$/, '');

  // Dieselbe Schreibweise, die openid-client beim Token-Abruf verwendet. Das
  // Portal vergleicht die Rueckadresse zeichengenau.
  let rueckadresseGueltig = false;
  try {
    const url = new URL(rueckadresse);
    rueckadresseGueltig = url.protocol === 'https:' || url.protocol === 'http:';
    if (rueckadresseGueltig) rueckadresse = url.href;
  } catch (err) {
    rueckadresseGueltig = false;
  }

  // Eine halb ausgefuellte Konfiguration ist der gefaehrlichere Fall: Auszeit
  // meint, es sei am Portal, und scheitert erst beim Anmelden.
  const angaben = { ISSUER: aussteller, CLIENT_ID: clientId, CLIENT_SECRET: geheimnis, REDIRECT_URI: rueckadresse };
  const gesetzt = Object.values(angaben).some(Boolean);
  const fehlend = gesetzt
    ? Object.entries(angaben)
      .filter(([name, wert]) => !wert || (name === 'REDIRECT_URI' && !rueckadresseGueltig))
      .map(([name]) => `PORTAL_${name}`)
    : [];

  return {
    aktiv: gesetzt && fehlend.length === 0,
    fehlend,
    aussteller,
    clientId,
    geheimnis,
    rueckadresse,
    intern,
    bereiche: lies('SCOPES') || 'openid profile email groups',
    adminGruppen: gruppenListe(umgebung.PORTAL_ADMIN_GRUPPEN === undefined ? 'Schulleitung' : umgebung.PORTAL_ADMIN_GRUPPEN),
    zugangGruppen: gruppenListe(umgebung.PORTAL_ZUGANG_GRUPPEN),
    nurPortal: lies('NUR_SSO') === '1'
  };
}

// Aus den geprueften Angaben des Portals wird die Identitaet. Dieselbe
// Reihenfolge wie in schulos-sso, damit eine Lehrkraft in allen Modulen
// gleich heisst.
function alsIdentitaet(claims) {
  const sub = String(claims.sub || '');
  if (!sub) throw new PortalFehler('Das ID-Token enthaelt kein sub.');

  let kuerzel = String(claims.preferred_username || claims.username || '').trim();
  if (!kuerzel && claims.email) kuerzel = String(claims.email).split('@')[0];

  let name = String(claims.name || '').trim();
  if (!name) name = `${claims.given_name || ''} ${claims.family_name || ''}`.trim();
  if (!name) name = kuerzel;

  const gruppen = [];
  for (const feld of ['groups', 'roles', 'group', 'memberOf']) {
    const wert = claims[feld];
    if (typeof wert === 'string' && wert) gruppen.push(wert);
    if (Array.isArray(wert)) gruppen.push(...wert.filter(g => typeof g === 'string' && g));
  }

  return {
    sub,
    kuerzel: kuerzel.slice(0, 50),
    name: name.slice(0, 60),
    gruppen: [...new Set(gruppen.map(g => g.trim()))],
    sid: String(claims.sid || '')
  };
}

/**
 * @param konfiguration  aus konfigurationAusUmgebung(), aktiv === true
 */
function erstellePortal(konfiguration) {
  let bibliothek = null;
  let serverVersprechen = null;
  const vorgaenge = new Map(); // Kennung -> { state, nonce, pruefwert, erzeugt }

  // openid-client gibt es nur als ES-Modul; der Server ist CommonJS.
  async function oidc() {
    if (!bibliothek) bibliothek = await import('openid-client');
    return bibliothek;
  }

  // Im Containerverbund spricht der Browser die oeffentliche Adresse des
  // Portals, der Container erreicht dasselbe Portal aber nur als
  // http://portal. Abrufe von Server zu Server - Entdeckung, Token, JWKS -
  // laufen deshalb intern; geprueft wird der Aussteller trotzdem gegen die
  // oeffentliche Adresse. Umgeschrieben wird nur dieser bekannte Anfang: ein
  // untergeschobenes Entdeckungsdokument kann den internen Abruf nicht auf
  // einen fremden Server lenken.
  function abruf(adresse, optionen) {
    let ziel = String(adresse);
    const anfang = `${konfiguration.aussteller}/`;
    if (konfiguration.intern && ziel.startsWith(anfang)) {
      ziel = `${konfiguration.intern}/${ziel.slice(anfang.length)}`;
    }
    return fetch(ziel, optionen);
  }

  // Erst beim ersten Gebrauch und bei einem Fehlschlag beim naechsten Mal neu:
  // Startet Auszeit vor dem Portal, darf das nichts dauerhaft verderben.
  async function server() {
    if (!serverVersprechen) {
      serverVersprechen = (async () => {
        const client = await oidc();
        const ohneTls = [konfiguration.aussteller, konfiguration.intern]
          .some(adresse => adresse.startsWith('http:'));
        return client.discovery(
          new URL(konfiguration.aussteller),
          konfiguration.clientId,
          konfiguration.geheimnis,
          undefined,
          {
            [client.customFetch]: abruf,
            execute: [
              // openid-client prueft die Signatur des ID-Tokens nur auf
              // Wunsch: OIDC erlaubt den Verzicht, wenn das Token ueber TLS
              // direkt vom Token-Endpunkt kommt. Im Verbund kommt es aber
              // ueber http://portal - ohne TLS. Also immer pruefen.
              client.enableNonRepudiationChecks,
              // Lokal und im Containernetz laeuft das Portal ohne TLS.
              ...(ohneTls ? [client.allowInsecureRequests] : [])
            ]
          }
        );
      })();
      serverVersprechen.catch(() => { serverVersprechen = null; });
    }
    return serverVersprechen;
  }

  function raeumeVorgaengeAuf() {
    const grenze = Date.now() - VORGANG_GUELTIG_MS;
    for (const [kennung, vorgang] of vorgaenge) {
      if (vorgang.erzeugt < grenze) vorgaenge.delete(kennung);
    }
    // Die Map behaelt die Einfuegereihenfolge - vorne stehen die aeltesten.
    while (vorgaenge.size >= VORGAENGE_HOECHSTENS) {
      vorgaenge.delete(vorgaenge.keys().next().value);
    }
  }

  // Hinweg: state, nonce und PKCE-Pruefwert bleiben auf dem Server. Der
  // Browser bekommt nur eine zufaellige Kennung des Vorgangs als Cookie.
  async function beginne() {
    const client = await oidc();
    const konfig = await server();

    const vorgang = {
      state: client.randomState(),
      nonce: client.randomNonce(),
      pruefwert: client.randomPKCECodeVerifier(),
      erzeugt: Date.now()
    };
    raeumeVorgaengeAuf();
    const kennung = crypto.randomBytes(24).toString('base64url');
    vorgaenge.set(kennung, vorgang);

    const adresse = client.buildAuthorizationUrl(konfig, {
      redirect_uri: konfiguration.rueckadresse,
      scope: konfiguration.bereiche,
      state: vorgang.state,
      nonce: vorgang.nonce,
      code_challenge: await client.calculatePKCECodeChallenge(vorgang.pruefwert),
      code_challenge_method: 'S256'
    });

    return { kennung, adresse: adresse.href };
  }

  // Rueckweg: Code einloesen und das ID-Token pruefen. Wirft bei allem, was
  // nicht stimmt; die Aufrufer zeigen dann eine Fehlerseite.
  async function schliesseAb(kennung, suche) {
    const vorgang = typeof kennung === 'string' ? vorgaenge.get(kennung) : undefined;
    // Einmalwerte sofort entwerten, egal wie es ausgeht.
    if (vorgang) vorgaenge.delete(kennung);
    if (!vorgang) throw new PortalFehler('Zu diesem Rueckweg gibt es keinen begonnenen Anmeldevorgang.');
    if (Date.now() - vorgang.erzeugt > VORGANG_GUELTIG_MS) {
      throw new PortalFehler('Der Anmeldevorgang ist zu alt.');
    }

    const client = await oidc();
    const konfig = await server();

    // Die Adresse, wie sie im Browser stand. Aus der Konfiguration statt aus
    // Host- und Proto-Kopf: hinter Caddy, IServ oder einem Tunnel sagen die
    // nicht verlaesslich, was der Browser gesehen hat.
    const rueckweg = new URL(konfiguration.rueckadresse);
    rueckweg.search = suche || '';

    const tokens = await client.authorizationCodeGrant(konfig, rueckweg, {
      pkceCodeVerifier: vorgang.pruefwert,
      expectedState: vorgang.state,
      expectedNonce: vorgang.nonce,
      idTokenExpected: true
    });

    return { identitaet: alsIdentitaet(tokens.claims()), idToken: tokens.id_token };
  }

  // Front-Channel Logout 1.0: Das Portal laedt /sso/abmelden mit iss und sid.
  // Der Aussteller muss stimmen - sonst koennte jede fremde Seite, die die
  // Adresse in einen Rahmen laedt, Lehrkraefte mitten in der Stunde abmelden.
  function istVorderkanalAbmeldung(anfrage) {
    const aussteller = String((anfrage && anfrage.iss) || '').replace(/\/+$/, '');
    const sid = String((anfrage && anfrage.sid) || '');
    if (!aussteller || !sid) return null;
    const erwartet = Buffer.from(konfiguration.aussteller);
    const erhalten = Buffer.from(aussteller);
    if (erwartet.length !== erhalten.length || !crypto.timingSafeEqual(erwartet, erhalten)) return null;
    return sid;
  }

  // Wohin der Browser nach dem Abmelden in Auszeit geht: zum Portal, das dann
  // auch alle anderen Module abmeldet. Ohne erreichbares Portal bleibt nur die
  // eigene Abmeldung.
  async function abmeldeAdresse(idToken) {
    const client = await oidc();
    const konfig = await server();
    return client.buildEndSessionUrl(konfig, {
      id_token_hint: idToken,
      post_logout_redirect_uri: `${new URL(konfiguration.rueckadresse).origin}/`
    }).href;
  }

  function hatZugang(identitaet) {
    return konfiguration.zugangGruppen.length === 0
      || inGruppen(identitaet.gruppen, konfiguration.zugangGruppen);
  }

  function istVerwaltung(identitaet) {
    return inGruppen(identitaet.gruppen, konfiguration.adminGruppen);
  }

  return {
    beginne,
    schliesseAb,
    istVorderkanalAbmeldung,
    abmeldeAdresse,
    hatZugang,
    istVerwaltung,
    aussteller: konfiguration.aussteller,
    ursprung: new URL(konfiguration.aussteller).origin,
    // Das Sitzungscookie bekommt Secure, sobald Auszeit oeffentlich ueber
    // https erreichbar ist. Abgeleitet aus der Adresse statt aus
    // X-Forwarded-Proto: Caddy ersetzt diesen Kopf, wenn es dem Tunnel davor
    // nicht ausdruecklich vertraut.
    sicher: konfiguration.rueckadresse.startsWith('https:')
  };
}

module.exports = { konfigurationAusUmgebung, erstellePortal, alsIdentitaet, PortalFehler };
