# Auszeit App

Die **Auszeit App** ist eine Echtzeit-Webanwendung für Schulen. Sie ermöglicht es Lehrkräften während des Unterrichts, Schülerinnen und Schüler bei Unterrichtsstörungen oder Auszeit-Bedarf unkompliziert, sicher und beaufsichtigt in die Klasse von verfügbaren Kolleginnen und Kollegen zu schicken.

---

## 🚀 Hauptfunktionen

- **Schnellanmeldung & Raumeingabe**: Lehrkräfte melden sich mit ihrem Namen/Kürzel und ihrem aktuellen Raum an. Ein geheimes Sitzungstoken bringt sie nach Verbindungsabbrüchen still in ihre Sitzung zurück (siehe [Identität und Sitzung](#identität-und-sitzung)).
- **Verfügbarkeit & Kapazitätsverwaltung**: Lehrkräfte stellen per Schalter ein, ob sie aktuell Schüler aufnehmen können, und geben an, wie viele Plätze sie anbieten (1, 2 oder 3+). Die freien Plätze ergeben sich aus den angebotenen abzüglich der laufenden Auszeiten und werden im Dashboard als Belegung angezeigt.
- **Echtzeit-Verweisung ("Auszeit anfordern")**: 
  - Ansicht aller aktuell verfügbaren Kolleginnen und Kollegen inkl. Raum und freien Kapazitäten in Echtzeit.
  - Optionaler Eintrag des Schülernamens.
  - Direktes Absenden der Auszeit-Anforderung per Klick.
- **Sofort-Benachrichtigung & Ankunftsbestätigung**:
  - Die aufnehmende Lehrkraft erhält umgehend ein hervorgehobenes Overlay ("Schüler auf dem Weg!") mit optischem Signal und Gerätevibration.
  - Per Klick ("Schüler ist angekommen") wird der Empfang bestätigt.
  - Die absendende Lehrkraft erhält sofort eine Bestätigung (Toast-Nachricht), dass der Schüler sicher angekommen ist.
  - Der Platz gilt bereits ab dem Absenden als belegt, damit nicht zwei Lehrkräfte gleichzeitig auf denselben freien Platz schicken.
- **Rückkehr in die Klasse**:
  - Die aufnehmende Lehrkraft schickt den Schüler per Klick auf der Vorfallskarte zurück ("Zurückschicken").
  - Sie erfährt dabei den Raum, in dem die abgebende Lehrkraft **aktuell** unterrichtet — nach 45 Minuten ist das selten noch der Raum der Verweisung.
  - Die abgebende Lehrkraft erhält ein Overlay ("Schüler kommt zurück") und bestätigt die Rückkehr ("Ist wieder da"). Damit ist der Vorfall geschlossen.
  - Der belegte Platz wird beim Zurückschicken sofort wieder frei.
- **Rückholwunsch**:
  - Die abgebende Lehrkraft kann auf ihrer Karte "Zurückholen" antippen, etwa wenn die Stunde endet.
  - Das ist bewusst nur ein Wunsch und kein Zustandswechsel: Wann das Kind den Raum verlässt, entscheidet weiterhin die aufnehmende Lehrkraft, die es vor sich hat.
  - Ist die Gegenseite nicht erreichbar, wird die Schaltfläche nicht angeboten — der Wunsch käme nie an.
- **Einseitiger Abschluss**:
  - Ist die Gegenseite offline, lässt sich ein hängengebliebener Vorfall einseitig beenden. Er endet als `Einseitig beendet`, nicht als `Zurück` — niemand hat die Rückkehr bestätigt.
  - Solange die Gegenseite erreichbar ist, wird das abgelehnt: Sonst beendete man ihr einen laufenden Vorgang unter den Händen.
  - Ein belegter Platz wird dabei frei.
- **Datensparsamkeit**:
  - Der Schülername wird aus beendeten Vorfällen gelöscht (Vorgabe: nach 2 Stunden); Zeitpunkt und beteiligte Lehrkräfte bleiben als Protokoll stehen.
  - Beendete Vorfälle fallen später ganz aus dem Speicher (Vorgabe: nach 12 Stunden), nie geschlossene nach 24 Stunden.
- **Protokoll & Verlaufsübersicht ("Meine Auszeiten")**:
  - Live-Liste aller gesendeten und empfangenen Auszeit-Vorfälle mit Status und Zeitstempel; laufende Vorfälle stehen oben.
  - Zustände: `Auf dem Weg` → `In Betreuung` → `Auf dem Rückweg` → `Zurück`.

---

## 🛠 Tech Stack

### Backend
- **Node.js** & **Express** (`v5`)
- **Socket.io** (`v4`) für bi-direktionale Echtzeit-Websocket-Kommunikation
- **CORS** Middleware
- In-Memory Datenhaltung (keine externe Datenbank erforderlich)

### Frontend
- **Vite** & JavaScript (ES Modules)
- **Socket.io Client**
- Vanilla CSS mit Modern Dark Mode UI, Glassmorphism, Google Fonts (`Inter` & `Outfit`), Micro-Animations und mobiler Optimierung (Vibration-API Support).

---

## 📂 Projektstruktur

```text
auszeit-app/
├── backend/
│   ├── package.json
│   ├── server.js         # Express + Socket.IO Server & In-Memory Event-Logik
│   ├── sitzungen.js      # Sitzungstokens: ausstellen, prüfen, widerrufen
│   ├── speicher.js       # Ablage der Mandanten (daten/schulen.json)
│   ├── admin.js          # Verwaltungsoberfläche für Mandanten
│   └── test/             # Tests mit node:test
├── frontend/
│   ├── index.html        # Single-Page HTML Struktur (Login, Dashboard, Emergency Views)
│   ├── main.js           # Client-seitige Event-Verarbeitung & WebSocket Kommunikation
│   ├── style.css         # Modernes Stylesheet mit Responsive- & Darkmode-Designs
│   └── package.json
├── start.sh              # Bash-Skript zum parallelen Starten von Backend und Frontend
└── README.md
```

---

## 💻 Installation & Start

### Voraussetzungen
- **Node.js** (Version 18+ empfohlen)
- **npm** (wird mit Node.js installiert)

### 1. Abhängigkeiten installieren

Verzeichnis fürs Backend aufrufen und Abhängigkeiten installieren:
```bash
cd backend
npm install
```

Verzeichnis fürs Frontend aufrufen und Abhängigkeiten installieren:
```bash
cd ../frontend
npm install
```

### 2. Anwendung starten

#### Option A: Automatisiertes Start-Skript (Empfohlen)
Vom Hauptverzeichnis der Anwendung aus das mitgelieferte Start-Skript ausführen:

```bash
chmod +x start.sh
./start.sh
```

#### Option B: Manuell starten

1. **Backend starten** (aus dem Verzeichnis `backend`):
   ```bash
   npm start
   ```
   *Läuft standardmäßig auf Port `4000` (`http://localhost:4000`).*

2. **Frontend starten** (aus dem Verzeichnis `frontend`):
   ```bash
   npm run dev
   ```
   *Öffnet den Vite Dev Server (standardmäßig auf `http://localhost:5173`).*

### 3. Tests

Aus dem Verzeichnis `backend`:

```bash
npm test
```

Die Tests laufen mit `node:test` und starten den Server auf einem freien Port;
die Mandanten kommen dabei aus einer temporären Datei, die echte Ablage bleibt
unberührt.

---

## 🔌 WebSocket API-Events (Socket.io)

| Event | Richtung | Beschreibung |
| :--- | :--- | :--- |
| `login` | Client ➔ Server | Zwei Wege: **Erstanmeldung** mit Name, Raum und ggf. Beitrittscode – oder **Wiederanmeldung** nach einem Reconnect allein mit dem Sitzungstoken (`token`). Eine mitgeschickte Kennung wird nicht beachtet. |
| `login_success` | Server ➔ Client | Bestätigt die Anmeldung und gibt den **serverseitigen** Stand zurück (öffentliche Kennung, Raum, Aufnahmebereitschaft, angebotene Plätze). Nur nach der Erstanmeldung enthält sie das Sitzungstoken. |
| `login_failed` | Server ➔ Client | Abweisung mit Grund: `pin_falsch`, `unbekannte_schule`, `kennung_fremder_schule` oder `sitzung_ungueltig` (Token abgelaufen, widerrufen oder nach einem Neustart unbekannt). |
| `update_status` | Client ➔ Server | Aktualisiert Aufnahmebereitschaft (`isAvailable`), angebotene Plätze (`capacity`) und Raum. |
| `status_updated` | Server ➔ eigene Geräte | Spiegelt den geänderten eigenen Stand an alle Tabs derselben Lehrkraft zurück. |
| `available_teachers` | Server ➔ Clients | Liste aller aufnahmebereiten Lehrkräfte mit ihren **freien** Plätzen. |
| `request_help` | Client ➔ Server | Startet eine Auszeit. Der Platz wird sofort belegt, nicht erst bei der Ankunft. |
| `help_requested` | Server ➔ Sender | Rückmeldung, ob die Verweisung angenommen wurde. |
| `incoming_student` | Server ➔ Empfänger | Benachrichtigt über den Schüler auf dem Weg. |
| `confirm_arrival` | Empfänger ➔ Server | Bestätigt das Eintreffen; Vorfall geht auf `betreut`. |
| `student_arrived` | Server ➔ Sender | Benachrichtigt über das Eintreffen. |
| `send_back` | Empfänger ➔ Server | Schickt den Schüler zurück; Vorfall geht auf `auf_dem_rueckweg`, der Platz wird frei. |
| `send_back_ok` | Server ➔ Empfänger | Quittung mit dem Raum, in dem die abgebende Lehrkraft **jetzt** unterrichtet. |
| `student_returning` | Server ➔ Sender | Kündigt die Rückkehr des Schülers an. |
| `confirm_return` | Sender ➔ Server | Bestätigt die Rückkehr; der Vorfall ist abgeschlossen (`zurueck`). |
| `return_confirmed` | Server ➔ Empfänger | Meldet, dass der Schüler wieder angekommen ist. |
| `request_return` | Sender ➔ Server | Meldet den Wunsch, den Schüler zurückzubekommen. Ändert den Zustand nicht. |
| `return_requested` | Server ➔ Empfänger | Zeigt den Rückholwunsch an. |
| `close_incident` | Client ➔ Server | Einseitiger Abschluss; nur zulässig, solange die Gegenseite offline ist. |
| `logout` | Client ➔ Server | Meldet die Lehrkraft ab und widerruft das Sitzungstoken; laufende Vorfälle bleiben bestehen. Das Token geht mit, damit die Abmeldung auch dann greift, wenn sie erst nach einem Reconnect ankommt. |
| `logged_out` | Server ➔ übrige Tabs | Ein anderer Tab derselben Sitzung hat sich abgemeldet; dieser Tab kehrt zur Anmeldung zurück. |
| `sync_incidents` | Server ➔ Client | Synchronisiert alle Vorfälle des Nutzers, angereichert um die aktuellen Räume und die Erreichbarkeit beider Seiten. |

### Zustandsautomat eines Vorfalls

Hin- und Rückweg sind derselbe zweistufige Handschlag mit vertauschten Rollen:
Erst ist der Schüler unterwegs, dann bestätigt die Person, in deren Raum er
eintrifft. Jeder Übergang ist idempotent — ein zweiter Klick dreht nichts weiter.

```text
[–] --request_help--> unterwegs --confirm_arrival--> betreut
                                                        |
                                           send_back    v
                       zurueck <--confirm_return-- auf_dem_rueckweg
```

Daneben steht `abgebrochen`: der einseitige Abschluss, aus jedem offenen Zustand
heraus erreichbar, sobald die Gegenseite offline ist. Bewusst ein eigener
Endzustand — `zurueck` würde behaupten, die Rückkehr sei bestätigt worden.

`request_return` setzt nur das Kennzeichen `rueckholwunsch` am Vorfall und
verändert den Zustand nicht.

### Mandanten (mehrere Schulen auf einer Instanz)

Ohne Konfiguration laeuft die App als Einzelinstallation fuer eine Schule und
verhaelt sich wie bisher. Sollen mehrere Schulen dieselbe Instanz nutzen, ohne
einander zu sehen, bekommt jede einen eigenen Link:

```
https://auszeit.example.de/s/rstn
```

Die Anmeldung bleibt dabei bei Name und Raum - der Mandant steckt in der
Adresse, kein zusaetzliches Feld. Eingerichtet wird er ueber `AUSZEIT_SCHULEN`
(JSON):

```json
{
  "rstn": { "name": "RS Trittau-Nord", "pin": "4711" },
  "demo": { "name": "Offene Demo", "demo": true }
}
```

| Variable | Bedeutung |
| :--- | :--- |
| `AUSZEIT_SCHULEN` | Zulaessige Mandanten. Bewusst eine feste Liste: ein Tippfehler im Link soll eine klare Fehlermeldung geben und keinen stillen, leeren Mandanten. |
| `AUSZEIT_STANDARD_SCHULE` | Mandant fuer Aufrufe ohne `/s/<code>`. Haelt bestehende Lesezeichen gueltig. |
| `AUSZEIT_ORIGIN` | Erlaubte Herkunft fuer Socket-Verbindungen, kommagetrennt. Ohne Angabe nur die eigene. Noetig beim getrennten Vite-Dev-Server; im SchulOS-Verbund die oeffentliche Modul-Adresse (siehe unten). |

`demo: true` blendet beim Schuelernamen den Hinweis ein, im Testbetrieb keine
echten Namen einzugeben.

#### Beitrittscode

Mit `pin` verlangt ein Mandant einen gemeinsamen Code (mindestens vier Zeichen;
kuerzere werden verworfen und der Mandant laeuft ohne). Die Lehrkraft gibt ihn
bei der **Anmeldung** ein. Der Browser behaelt ihn nur, bis die Anmeldung
geklappt hat, und legt ihn nie im `localStorage` ab - auf einem Raum-PC waere er
dort fuer jede Person lesbar, die nach einem an den Rechner kommt. Die
Wiederanmeldung nach einem Verbindungsabbruch braucht ihn nicht, die erledigt
das Sitzungstoken. Erneut gefragt wird erst nach dem Abmelden oder wenn die
Sitzung abgelaufen ist.

Einordnung, damit die Erwartung stimmt: Das ist ein **gemeinsames Geheimnis des
Kollegiums**, vergleichbar mit einem WLAN-Schluessel - kein persoenliches
Passwort. Er steht im Klartext in der Konfiguration und identifiziert
niemanden. Er haelt Fremde mit einem
weitergeleiteten Link drausssen, mehr nicht. Wer Identitaeten braucht, braucht
die naechste Stufe (Namensliste je Schule oder IServ-OIDC).

Gegen das Durchprobieren steht keine Sperre, sondern eine wachsende
Verzoegerung der Antwort: Die ersten drei Fehlversuche kosten nichts - Vertippen
soll nicht bestraft werden -, danach verdoppelt sie sich bis auf fuenf Sekunden
und wird nach zehn ruhigen Minuten vergessen. Eine Sperre waere von aussen
ausloesbar, um ein ganzes Kollegium auszusperren; eine Verzoegerung bremst nur.
Zusaetzlich trennt der Server eine Verbindung nach zehn Fehlversuchen.

Was die Trennung leistet: Die Liste der aufnahmebereiten Lehrkraefte geht nur
noch an den eigenen Mandanten, und eine Verweisung ueber die Mandantengrenze
wird abgewiesen - auch mit erratener Kennung. Eine Sitzung gehoert dauerhaft
zu einer Schule.

### Verwaltung

Mandanten lassen sich ueber eine eigene Oberflaeche anlegen und aendern. Sie
wirkt **sofort, ohne Neustart** - vorher war jede Aenderung ein
Container-Neustart, der alle Angemeldeten hinauswarf und laufende Auszeiten
verlor.

| Variable | Bedeutung |
| :--- | :--- |
| `AUSZEIT_ADMIN_TOKEN` | Zugang zur Verwaltung, mindestens 16 Zeichen. **Ohne Token bleibt die Oberflaeche abgeschaltet** - eine ungeschuetzte Verwaltungsseite waere schlimmer als keine. |
| `AUSZEIT_ADMIN_PORT` | Optional. Laesst die Verwaltung auf einem eigenen Port laufen, der nicht veroeffentlicht wird. Ohne Angabe liegt sie unter `/admin` auf demselben Port wie die App. |
| `AUSZEIT_DATEN` | Pfad der Mandantendatei. Vorgabe `daten/schulen.json`. |

Die Mandanten liegen in einer JSON-Datei statt nur in der Umgebung, sonst waere
eine ueber die Oberflaeche angelegte Schule nach dem naechsten Ausrollen weg.
`AUSZEIT_SCHULEN` dient dann nur noch als **Startbelegung**: Existiert noch
keine Datei, wird die Umgebung einmalig uebernommen und festgehalten. Eine
bestehende Installation laeuft dadurch unveraendert weiter.

Die Datei wird atomar geschrieben und alle zehn Sekunden auf fremde Aenderungen
geprueft - eine Reparatur per SSH wirkt also ebenfalls ohne Neustart. Ist das
Verzeichnis nicht beschreibbar, laeuft die App wie bisher rein im Speicher
weiter; nur die Oberflaeche kann dann nichts festhalten.

Was die Verwaltung **nicht** zeigt: Sie ist die einzige Stelle, an der Daten
aller Mandanten zusammenlaufen, und zeigt deshalb ausschliesslich Zahlen -
angemeldete Lehrkraefte und laufende Auszeiten. Weder Lehrer- noch
Schuelernamen verlassen diesen Weg, und ein gesetzter Beitrittscode wird nie
ausgeliefert, nur sein Vorhandensein.

Stilllegen statt loeschen: Ein stillgelegter Mandant nimmt keine neuen
Anmeldungen mehr an, wer verbunden ist, arbeitet aber weiter - laufende
Auszeiten brechen nicht mitten in der Stunde ab. Endgueltig loeschen laesst
sich nur, was niemand mehr benutzt.

### Aufbewahrung konfigurieren

Aufbewahrungsfristen sind eine Schulentscheidung, keine Programmierentscheidung.
Alle Werte in Millisekunden, als Umgebungsvariablen des Containers:

| Variable | Vorgabe | Bedeutung |
| :--- | :--- | :--- |
| `AUSZEIT_NAME_TTL_MS` | 2 h | Wann der Schülername aus einem beendeten Vorfall gelöscht wird |
| `AUSZEIT_VORFALL_TTL_MS` | 12 h | Wann ein beendeter Vorfall ganz entfernt wird |
| `AUSZEIT_MAX_ALTER_MS` | 24 h | Höchstalter für nie geschlossene Vorfälle |
| `AUSZEIT_AUFRAEUM_MS` | 30 min | Abstand zwischen zwei Aufräumläufen |

### Identität und Sitzung

Lehrkräfte hängen an einer stabilen Kennung, nicht an der `socket.id`. Die
wechselt bei jedem Reconnect — Bildschirmsperre, Tab im Hintergrund,
WLAN-Wechsel beim Gang durchs Gebäude. Zwischen Verweisung und Rückkehr liegen
20 bis 45 Minuten, in denen genau das laufend passiert; an der `socket.id` wären
die Vorfälle danach verwaist.

Dabei gibt es **zwei getrennte Werte**:

| Wert | Wer kennt ihn | Wofür |
| :--- | :--- | :--- |
| Öffentliche **Kennung** | alle Lehrkräfte der Schule (Kollegenliste) | Adressiert eine Lehrkraft, etwa beim Verweisen. Kein Nachweis. |
| Geheimes **Sitzungstoken** | nur das Gerät, das sich angemeldet hat | Weist bei der Wiederanmeldung nach, wer man ist. |

Beide erzeugt der **Server** bei der Erstanmeldung. Früher erzeugte der Browser
die Kennung selbst und zeigte sie bei der Wiederanmeldung als einzigen Nachweis
vor – dieselbe Kennung, die jede Kollegin in der Liste sieht. Wer den
Beitrittscode kannte, konnte so die Sitzung einer anderen Lehrkraft übernehmen.

- Das Token hat 256 Bit Zufall und geht genau einmal an genau ein Gerät, nie in
  eine Liste. Der Server speichert nur seinen SHA-256-Hash.
- Es läuft nach fester Frist ab, gerechnet ab der Anmeldung – nicht ab der
  letzten Benutzung. Ein Raum-PC, der den ganzen Tag neu verbindet, hält die
  Sitzung damit nicht künstlich am Leben.
- **Abmelden widerruft das Token** und meldet alle Tabs dieser Sitzung ab. Die
  nächste Anmeldung auf dem Gerät ist eine neue Lehrkraft mit neuer Kennung;
  offene Vorfälle der alten Sitzung lassen sich von der Gegenseite einseitig
  abschließen.
- Ist das Token abgelaufen oder unbekannt, landet die Lehrkraft in der
  vorausgefüllten Anmeldemaske und gibt nur den Code erneut ein. Schulen ohne
  Code werden still neu angemeldet.

| Variable | Vorgabe | Bedeutung |
| :--- | :--- | :--- |
| `AUSZEIT_SITZUNG_TTL_MS` | 14 h | Gültigkeit eines Sitzungstokens in Millisekunden. Mindestens ein Schultag, aber nicht bis zum nächsten Morgen. |

Die Tokens liegen derzeit im Arbeitsspeicher, wie alles andere auch: Nach einem
Neustart des Servers melden sich alle Lehrkräfte neu an. Mit der dauerhaften
Speicherung wandern sie in die Datenbank.

### Betrieb im SchulOS-Verbund

Auszeit läuft auch als Modul im Server-Verbund des SchulOS-Portals
(`schulos-portal`, Profil `auszeit`). Der Verbund baut das Abbild aus diesem
Repository; Caddy reicht den Hostnamen des Moduls an Port 4000 durch,
WebSockets eingeschlossen.

```bash
cd ../schulos-portal
docker compose --profile auszeit up -d --build
```

Was das Portal von Auszeit erwartet:

- **`GET /healthz`** antwortet mit `200` und `{"status":"ok"}`. Daran
  entscheidet das Portal, ob das Modul „erreichbar“ ist und die Kachel
  erscheint. Der Endpunkt ist ohne Anmeldung erreichbar und verrät deshalb
  weder Version noch Mandanten.
- **`AUSZEIT_ORIGIN`** ist die öffentliche Adresse des Moduls, also dieselbe
  wie `AUSZEIT_URL` in der `.env` des Verbunds. Die `compose.yml` des Portals
  setzt sie selbst.

Im Verbund gilt: ein Portal ist eine Schule. Ohne weitere Angabe läuft Auszeit
dort mit dem Standardmandanten. Die Anmeldung über das Portal (OpenID Connect)
folgt; bis dahin melden sich Lehrkräfte wie im Einzelbetrieb mit Name, Raum
und gegebenenfalls Beitrittscode an.

Der **Einzelbetrieb bleibt unverändert**: `docker compose up` in diesem
Repository startet Auszeit ohne Portal.

---

## 📄 Lizenz

Dieses Projekt steht unter der ISC-Lizenz.
