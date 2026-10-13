# Auszeit App

Die **Auszeit App** ist eine Echtzeit-Webanwendung für Schulen. Sie ermöglicht es Lehrkräften während des Unterrichts, Schülerinnen und Schüler bei Unterrichtsstörungen oder Auszeit-Bedarf unkompliziert, sicher und beaufsichtigt in die Klasse von verfügbaren Kolleginnen und Kollegen zu schicken.

---

## 🚀 Hauptfunktionen

- **Schnellanmeldung & Raumeingabe**: Lehrkräfte melden sich mit ihrem Namen/Kürzel und ihrem aktuellen Raum an. Ein geheimes Sitzungstoken bringt sie nach Verbindungsabbrüchen still in ihre Sitzung zurück (siehe [Identität und Sitzung](#identität-und-sitzung)).
- **Anmeldung über das SchulOS-Portal**: Hängt Auszeit am Portal, kommen Name und Kürzel von dort – ohne zweites Passwort. Gefragt wird nur noch der Raum (siehe [Anmeldung über das SchulOS-Portal](#anmeldung-über-das-schulos-portal)).
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
- **Dauerhaftes Protokoll & Datensparsamkeit** (siehe [Aufbewahrung](#aufbewahrung)):
  - Im Schulbetrieb werden Vorfälle in MariaDB protokolliert, mit einem Zeitstempel je Zustandswechsel, und **zu Beginn des neuen Schuljahres gelöscht**.
  - Ein Neustart des Servers verliert keine laufende Auszeit: Vorfälle, Belegung und Sitzungen stehen danach wieder da.
  - Demo-Mandanten behalten die kurzen Fristen: Schülername nach 2 Stunden, Vorfall nach 12 Stunden weg.
- **Protokoll & Verlaufsübersicht ("Meine Auszeiten")**:
  - Live-Liste aller gesendeten und empfangenen Auszeit-Vorfälle mit Status und Zeitstempel; laufende Vorfälle stehen oben.
  - Zustände: `Auf dem Weg` → `In Betreuung` → `Auf dem Rückweg` → `Zurück`.

---

## 🛠 Tech Stack

### Backend
- **Node.js** & **Express** (`v5`)
- **Socket.io** (`v4`) für bi-direktionale Echtzeit-Websocket-Kommunikation
- **CORS** Middleware
- **MariaDB** (`mysql2`) für das Protokoll; ohne `DB_HOST` läuft alles nur im Arbeitsspeicher

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
│   ├── server.js         # Express + Socket.IO Server & Event-Logik
│   ├── ablage/           # Dauerhafte Ablage: MariaDB oder nur Arbeitsspeicher
│   ├── migrationen/      # Datenbankschema, beim Start eingespielt
│   ├── schuljahr.js      # Schuljahr eines Zeitpunkts, Stichtag
│   ├── sitzungen.js      # Sitzungstokens: ausstellen, prüfen, widerrufen
│   ├── portal.js         # Anmeldung über das SchulOS-Portal (OpenID Connect)
│   ├── kekse.js          # Cookies lesen – für Routen und Socket-Handshake
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
unberührt. Sie brauchen keine Datenbank: Ohne `DB_HOST` hält die Ablage alles
im Arbeitsspeicher, und einen Neustart spielen die Tests nach, indem sie den
Server im selben Prozess neu laden.

Die Ablage selbst lässt sich zusätzlich gegen eine echte MariaDB prüfen –
eine Wegwerf-Datenbank, denn der Test leert die Tabellen:

```bash
docker run -d --rm --name auszeit-testdb -p 127.0.0.1:33306:3306 -e MARIADB_ROOT_PASSWORD=test -e MARIADB_DATABASE=auszeit_test mariadb:10.11
```

```bash
AUSZEIT_TEST_DB_HOST=127.0.0.1 AUSZEIT_TEST_DB_PORT=33306 AUSZEIT_TEST_DB_PASS=test npm test
```

---

## 🔌 WebSocket API-Events (Socket.io)

| Event | Richtung | Beschreibung |
| :--- | :--- | :--- |
| `login` | Client ➔ Server | Drei Wege: **Erstanmeldung** mit Name, Raum und ggf. Beitrittscode – **Wiederanmeldung** nach einem Reconnect allein mit dem Sitzungstoken (`token`) – oder **über das Portal** (`portal: true` und Raum); wer die Lehrkraft ist, hat dann schon der Handshake aus dem Cookie gelesen. Eine mitgeschickte Kennung wird nie beachtet. |
| `login_success` | Server ➔ Client | Bestätigt die Anmeldung und gibt den **serverseitigen** Stand zurück (öffentliche Kennung, Raum, Aufnahmebereitschaft, angebotene Plätze). Nur nach der Erstanmeldung enthält sie das Sitzungstoken. |
| `login_failed` | Server ➔ Client | Abweisung mit Grund: `pin_falsch`, `unbekannte_schule`, `kennung_fremder_schule`, `sitzung_ungueltig` (Token abgelaufen, widerrufen oder nach einem Neustart unbekannt), `nur_portal` (Anmeldung mit Code abgeschaltet), `portal_sitzung_fehlt` oder `raum_fehlt`. |
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
| `logged_out` | Server ➔ übrige Tabs | Die Sitzung dieses Tabs ist beendet – durch einen anderen Tab oder durch die Abmeldung im Portal; der Tab kehrt zur Anmeldung zurück. |
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

### Dauerhafte Speicherung

Vorfälle, Sitzungen und Lehrkräfte stehen in MariaDB. Der Arbeitsspeicher bleibt
der Arbeitszustand: Wer online ist, aufnehmen kann und wie viele Plätze
anbietet, wechselt im Minutentakt und beginnt nach einem Neustart von vorn. Die
Datenbank ist die dauerhafte Abschrift – das Protokoll für die Schule und der
Stand, aus dem ein Neustart laufende Auszeiten samt Belegung wiederherstellt.

Geschrieben wird hinter dem Ereignis: Die Socket-Ereignisse bleiben schnell,
eine langsame Datenbank hält keine Ankunftsbestätigung auf. Alle Schreibvorgänge
laufen nacheinander durch eine Warteschlange, sodass „angekommen“ nie „angelegt“
überholt. Beim Herunterfahren (`SIGTERM`, etwa durch `docker compose restart`)
wird die Warteschlange erst zu Ende geschrieben.

| Variable | Bedeutung |
| :--- | :--- |
| `DB_HOST` | Datenbankserver. **Ohne Angabe läuft alles nur im Arbeitsspeicher** – ein Neustart verliert dann alle Vorfälle. |
| `DB_PORT` | Vorgabe `3306` |
| `DB_NAME` / `DB_USER` | Vorgabe jeweils `auszeit` |
| `DB_PASS` | Passwort |
| `DB_PASS_FILE` | Alternativ: Datei mit dem Passwort |

Die Namen sind dieselben wie bei den PHP-Modulen des Verbunds. Ist `DB_HOST`
gesetzt, aber kein Passwort, startet Auszeit nicht – lieber nicht starten als
ohne Protokoll laufen. Beim Start wartet Auszeit bis zu einer Minute auf die
Datenbank und spielt fehlende Migrationen aus `backend/migrationen/` ein, in der
Reihenfolge der Dateinamen.

Tabellen:

| Tabelle | Inhalt |
| :--- | :--- |
| `lehrkraefte` | Kennung, Schule, `sub` bei Anmeldung über das Portal, Name, Kürzel, Raum, Rolle „Verwaltung“ |
| `sitzungen` | Hash des Tokens, Kennung, Ablauf, bei Portal-Anmeldung `sid` und ID-Token |
| `vorfaelle` | Schuljahr, Schüler, abgebende und aufnehmende Lehrkraft samt Raum, Zustand, je Zustandswechsel ein Zeitpunkt (`angefordert_am`, `angekommen_am`, `rueckholwunsch_am`, `zurueckgeschickt_am`, `zurueck_am`, `beendet_am`), Art des Abschlusses (`zurueck`, `einseitig`, `abgebrochen`) |

**Alle Zeitpunkte stehen in UTC.** Sonst hinge ihre Bedeutung an der Zeitzone
des Containers, und um die Zeitumstellung herum wäre eine Stunde doppeldeutig.
Für eine Auswertung in Ortszeit: `CONVERT_TZ(angefordert_am, '+00:00', 'Europe/Berlin')`
(braucht die Zeitzonentabellen von MariaDB) oder die Umrechnung im
Auswertungswerkzeug.

**Einzelbetrieb.** Die `docker-compose.yml` bringt eine eigene MariaDB mit.
Ihr Passwort steht nirgends im Klartext: Beim allerersten Start erzeugt der
Dienst `geheimnis` es in ein eigenes Volume, MariaDB und Auszeit lesen es von
dort. `docker compose up` braucht dafür keine Vorbereitung. Zu sichern ist das
Volume `db-daten`. Für einen Blick in die Datenbank:

```bash
docker compose exec db sh -c 'mariadb -uauszeit -p"$(cat /geheimnis/db)" auszeit'
```

**Im Verbund** liegen die Daten in `db_auszeit` der gemeinsamen MariaDB;
`DB_AUSZEIT_PASSWORT` in der `.env` des Portals ist dafür Pflicht.

### Aufbewahrung

Zwei Regeln, je nachdem, ob ein Mandant als Demo markiert ist (`demo: true`):

**Schulbetrieb.** Das Protokoll ist eine Vorgabe der Schule. Vorfälle bleiben
mit Namen bis zum Beginn des neuen Schuljahres; dann löscht Auszeit alle
Vorfälle früherer Schuljahre und schreibt die Anzahl ins Log. Das Schuljahr
steht als Spalte am Vorfall. Ein Vorfall, den nach 24 Stunden niemand beendet
hat, wird als `abgebrochen` geschlossen statt gelöscht – auch eine Meldung, auf
die niemand reagiert hat, gehört ins Protokoll. Aus „Meine Auszeiten“
verschwinden beendete Vorfälle nach zwölf Stunden; das ist nur die Anzeige.

**Demo-Mandanten** behalten die kurzen Fristen: Eine öffentliche Demo soll keine
Daten ansammeln. Der Schülername fällt nach zwei Stunden weg, der beendete
Vorfall nach zwölf, ein nie geschlossener nach 24 – auch aus der Datenbank.

| Variable | Vorgabe | Bedeutung |
| :--- | :--- | :--- |
| `AUSZEIT_SCHULJAHR_STICHTAG` | `08-01` | Beginn des neuen Schuljahres (`MM-TT`), ab Mitternacht Ortszeit. Ein unbrauchbarer Wert fällt auf den 1. August zurück. |
| `AUSZEIT_NAME_TTL_MS` | 2 h | Nur Demo: wann der Schülername aus einem beendeten Vorfall gelöscht wird |
| `AUSZEIT_VORFALL_TTL_MS` | 12 h | Nur Demo: wann ein beendeter Vorfall ganz gelöscht wird |
| `AUSZEIT_MAX_ALTER_MS` | 24 h | Nur Demo: wann ein nie geschlossener Vorfall gelöscht wird |
| `AUSZEIT_AUFRAEUM_MS` | 30 min | Abstand zwischen zwei Aufräumläufen; mit jedem Lauf wird auch der Schuljahreswechsel geprüft |

Der Stichtag ist einstellbar, weil er noch mit dem Datenschutzbeauftragten
festgelegt wird. Lehrkräfte aus einer Anmeldung mit Code verschwinden aus der
Datenbank, sobald weder eine Sitzung noch ein Vorfall auf sie zeigt; Lehrkräfte
aus dem Portal bleiben – an ihnen hängt die Kennung, unter der ihre Vorfälle
stehen.

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

Die Sitzungen stehen in der Datenbank – nur der Hash des Tokens – und
überstehen damit einen Neustart: Die Lehrkräfte kommen ohne erneuten Code
zurück.

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
dort mit dem Standardmandanten, und die Lehrkräfte melden sich über das Portal
an (nächster Abschnitt). Prüfen lässt sich das Zusammenspiel mit
`pruefung/05-auszeit.sh` im Portal-Repository.

Der **Einzelbetrieb bleibt unverändert**: `docker compose up` in diesem
Repository startet Auszeit ohne Portal.

### Anmeldung über das SchulOS-Portal

Ein dauerhaftes Protokoll braucht echte Identitäten, ein frei eingetippter Name
ist keine. Hängt Auszeit am Portal, meldet sich die Lehrkraft dort an – an der
einzigen Stelle, an der sie ein Passwort eingibt – und kommt über die Kachel
ohne weitere Eingabe in Auszeit. Name und Kürzel stammen aus dem Portal, den
Raum gibt sie wie bisher selbst ein.

**Ohne `PORTAL_ISSUER` bleibt alles wie bisher** (Beitrittscode).

| Variable | Bedeutung |
| :--- | :--- |
| `PORTAL_ISSUER` | Öffentliche Adresse des Portals |
| `PORTAL_CLIENT_ID` | `modul-auszeit` |
| `PORTAL_CLIENT_SECRET` | Geheimnis zwischen Portal und Auszeit (`AUSZEIT_SECRET` im Verbund) |
| `PORTAL_REDIRECT_URI` | `<öffentliche Adresse von Auszeit>/sso/rueckweg` |
| `PORTAL_INTERN` | Adresse für Abrufe von Server zu Server, im Verbund `http://portal` |
| `PORTAL_ADMIN_GRUPPEN` | Portalgruppen mit der Rolle „Verwaltung“ in Auszeit, Vorgabe `Schulleitung` |
| `PORTAL_ZUGANG_GRUPPEN` | Leer: alle angemeldeten Personen. Sonst nur diese Gruppen (kommagetrennt). |
| `PORTAL_NUR_SSO` | `1`: kein Codefeld, Anmeldungen mit Code lehnt der Server ab. |

Die Namen sind dieselben wie bei den PHP-Modulen. Ist der Satz nur halb
ausgefüllt, nennt das Log beim Start die fehlenden Angaben, und die Anmeldung
über das Portal bleibt aus.

| Route | |
| :--- | :--- |
| `GET /sso/start` | Anmeldung am Portal beginnen – das Ziel der Kachel |
| `GET /sso/rueckweg` | Rückweg vom Portal: Code einlösen, Lehrkraft zuordnen, Sitzung beginnen |
| `GET /sso/abmelden` | Abmeldung über den Vorderkanal (OpenID Connect Front-Channel Logout) |
| `POST /abmelden` | Abmeldeknopf: Sitzung beenden, weiter zur Abmeldung beim Portal |
| `GET /api/sitzung` | Name, Kürzel und Raum der angemeldeten Lehrkraft, sonst `401` |

**Was geprüft wird.** Den Ablauf erledigt die Bibliothek `openid-client`, der
Prüfumfang entspricht dem der PHP-Module (`schulos-sso`): PKCE mit S256,
`state` und `nonce` auf dem Server, die Signatur über JWKS ausschließlich mit
RS256 (`alg: none` und HMAC werden abgelehnt), dazu `iss`, `aud`, `exp` und
`azp`. Eine Falle dabei: `openid-client` prüft die Signatur des ID-Tokens nur,
wenn man es ausdrücklich verlangt (`enableNonRepudiationChecks`) – OIDC erlaubt
den Verzicht, wenn das Token per TLS direkt vom Token-Endpunkt kommt. Im
Verbund kommt es aber über `http://portal`, also ohne TLS. Ein Test hält fest,
dass eine gefälschte Signatur abgelehnt wird.

**`PORTAL_INTERN`.** Der Browser spricht die öffentliche Adresse des Portals,
der Container erreicht es nur als `http://portal`. Entdeckung, Token und
Schlüssel holt Auszeit deshalb intern; geprüft wird der Aussteller trotzdem
gegen `PORTAL_ISSUER`. Umgeschrieben wird nur dieser bekannte Anfang.

**Sitzung.** Nach dem Rückweg trägt ein Cookie `auszeit_sitzung` das
Sitzungstoken (`HttpOnly`, `SameSite=Lax`, `Secure` sobald die Rückadresse
https ist). Der Socket-Handshake liest das Cookie und bestimmt die Lehrkraft
serverseitig; der Client schickt nur noch den Raum. Die Sitzung gilt
`AUSZEIT_SITZUNG_TTL_MS` (Vorgabe 14 h), danach geht es über das Portal neu
hinein – ohne Passwort, solange die Portalsitzung besteht. Die endet nach acht
Stunden ohne Aktivität im Portal; in der Regel heißt das: morgens einmal das
Passwort, dann den Tag über nicht mehr.

**Eine Lehrkraft je Portalkonto.** Auszeit ordnet über `sub` zu, nicht über das
Kürzel (das nach Jahren neu vergeben wird) und nicht über die Sitzung: Läuft
die ab oder meldet sich die Lehrkraft zusätzlich am Tablet an, ist es dieselbe
Lehrkraft mit denselben laufenden Auszeiten. Jedes Gerät hat aber seine eigene
Sitzung.

**Abmelden in beide Richtungen.** Der Abmeldeknopf in Auszeit beendet die
Sitzung dieses Browsers und schickt ihn weiter zum Portal, das dann alle Module
abmeldet. Umgekehrt lädt das Portal beim Abmelden `/sso/abmelden` in einem
unsichtbaren Rahmen; Auszeit beendet daraufhin alle Sitzungen dieser
Portalsitzung (`sid`) und meldet die offenen Tabs sofort ab. Der Aussteller muss
stimmen, sonst passiert nichts. Andere Geräte derselben Lehrkraft bleiben
angemeldet.

**`PORTAL_NUR_SSO=1`** blendet das Codefeld aus; ohne Portalsitzung leitet
Auszeit gleich zum Portal weiter. Der Server lehnt Anmeldungen mit Code ab –
**bewusst auch dann, wenn die Portal-Anbindung unvollständig ist**. Die
PHP-Module lassen in diesem Fall ihre eigene Anmeldung offen; im Verbund läuft
Auszeit aber ohne Beitrittscode, und ein vergessenes Geheimnis in der `.env`
öffnete sonst die Tür für jede und jeden. Lieber kommt dann niemand hinein, und
das Log sagt warum.

**Herkunft der Socket-Verbindung.** Seit der Handshake ein Cookie liest, prüft
Auszeit beim Verbindungsaufbau die Herkunft (`Origin`): erlaubt sind die eigene
Adresse und `AUSZEIT_ORIGIN`. CORS allein genügt dafür nicht – es regelt nur
Abfragen per XHR, nicht den Aufbau einer WebSocket-Verbindung. Ohne die Prüfung
könnte eine Seite unter derselben Domain, etwa ein anderes Modul mit einer
Lücke, eine Verbindung im Namen der Lehrkraft aufbauen.

**Hinter Caddy und Cloudflare.** Express vertraut Proxys aus dem eigenen Netz
(`trust proxy`). Ob das Cookie `Secure` bekommt, leitet Auszeit aber aus
`PORTAL_REDIRECT_URI` ab und nicht aus `X-Forwarded-Proto`: Caddy ersetzt
diesen Kopf, solange es dem Tunnel davor nicht ausdrücklich vertraut.

Die Rolle „Verwaltung“ (`PORTAL_ADMIN_GRUPPEN`) wird bei jeder Anmeldung aus
dem Portal übernommen und für den Import der Schülerliste gebraucht.

---

## 📄 Lizenz

Dieses Projekt steht unter der ISC-Lizenz.
