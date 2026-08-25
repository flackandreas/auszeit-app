# Auszeit App

Die **Auszeit App** ist eine Echtzeit-Webanwendung für Schulen. Sie ermöglicht es Lehrkräften während des Unterrichts, Schülerinnen und Schüler bei Unterrichtsstörungen oder Auszeit-Bedarf unkompliziert, sicher und beaufsichtigt in die Klasse von verfügbaren Kolleginnen und Kollegen zu schicken.

---

## 🚀 Hauptfunktionen

- **Schnellanmeldung & Raumeingabe**: Lehrkräfte melden sich mit ihrem Namen/Kürzel und ihrem aktuellen Raum an (Session wird lokal gespeichert).
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
│   └── server.js         # Express + Socket.IO Server & In-Memory Event-Logik
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

---

## 🔌 WebSocket API-Events (Socket.io)

| Event | Richtung | Beschreibung |
| :--- | :--- | :--- |
| `login` | Client ➔ Server | Übermittelt stabile Gerätekennung, Name und Raum. Dient auch der Wiederanmeldung nach einem Reconnect. |
| `login_success` | Server ➔ Client | Bestätigt die Anmeldung und gibt den **serverseitigen** Stand zurück (Raum, Aufnahmebereitschaft, angebotene Plätze). |
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
| `logout` | Client ➔ Server | Meldet die Lehrkraft ab; laufende Vorfälle bleiben bestehen. |
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


Lehrkräfte hängen an einer stabilen Kennung aus dem `localStorage`, nicht an der
`socket.id`. Die wechselt bei jedem Reconnect — Bildschirmsperre, Tab im
Hintergrund, WLAN-Wechsel beim Gang durchs Gebäude. Zwischen Verweisung und
Rückkehr liegen 20 bis 45 Minuten, in denen genau das laufend passiert; an der
`socket.id` wären die Vorfälle danach verwaist.

---

## 📄 Lizenz

Dieses Projekt steht unter der ISC-Lizenz.
