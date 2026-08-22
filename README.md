# Auszeit App

Die **Auszeit App** ist eine Echtzeit-Webanwendung für Schulen. Sie ermöglicht es Lehrkräften während des Unterrichts, Schülerinnen und Schüler bei Unterrichtsstörungen oder Auszeit-Bedarf unkompliziert, sicher und beaufsichtigt in die Klasse von verfügbaren Kolleginnen und Kollegen zu schicken.

---

## 🚀 Hauptfunktionen

- **Schnellanmeldung & Raumeingabe**: Lehrkräfte melden sich mit ihrem Namen/Kürzel und ihrem aktuellen Raum an (Session wird lokal gespeichert).
- **Verfügbarkeit & Kapazitätsverwaltung**: Lehrkräfte stellen per Schalter ein, ob sie aktuell Schüler aufnehmen können, und geben die maximale Anzahl freier Plätze an (1, 2 oder 3+).
- **Echtzeit-Verweisung ("Auszeit anfordern")**: 
  - Ansicht aller aktuell verfügbaren Kolleginnen und Kollegen inkl. Raum und freien Kapazitäten in Echtzeit.
  - Optionaler Eintrag des Schülernamens.
  - Direktes Absenden der Auszeit-Anforderung per Klick.
- **Sofort-Benachrichtigung & Ankunftsbestätigung**:
  - Die aufnehmende Lehrkraft erhält umgehend ein hervorgehobenes Overlay ("Schüler auf dem Weg!") mit optischem Signal und Gerätevibration.
  - Per Klick ("Schüler ist angekommen") wird der Empfang bestätigt.
  - Die absendende Lehrkraft erhält sofort eine Bestätigung (Toast-Nachricht), dass der Schüler sicher angekommen ist.
  - Die verfügbare Kapazität der aufnehmenden Lehrkraft verringert sich automatisch.
- **Protokoll & Verlaufsübersicht ("Meine Auszeiten")**:
  - Live-Liste aller gesendeten und empfangenen Auszeit-Vorfälle mit Status (`Auf dem Weg` / `Angekommen`) und Zeitstempel.

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
| `login` | Client ➔ Server | Übermittelt Name und Raum der Lehrkraft. |
| `login_success` | Server ➔ Client | Bestätigt erfolgreiche Anmeldung und gibt Benutzerdaten zurück. |
| `update_status` | Client ➔ Server | Aktualisiert Aufnahmebereitschaft (`isAvailable`), Kapazität (`capacity`) und Raum. |
| `available_teachers` | Server ➔ Clients | Sendet die Liste aller aktuell aufnahmebereiten Lehrkräfte an alle verbundenen Clients. |
| `request_help` | Client ➔ Server | Startet Auszeit für einen Schüler an einen gewählten Kollegen. |
| `incoming_student` | Server ➔ Receiver | Benachrichtigt die aufnehmende Lehrkraft über den Schüler auf dem Weg. |
| `confirm_arrival` | Receiver ➔ Server | Aufnehmende Lehrkraft bestätigt das Eintreffen des Schülers. |
| `student_arrived` | Server ➔ Sender | Benachrichtigt die absendende Lehrkraft über das Eintreffen. |
| `sync_incidents` | Server ➔ Client | Synchronisiert die Liste aller relevanten Auszeit-Vorfälle des Nutzers. |

---

## 📄 Lizenz

Dieses Projekt steht unter der ISC-Lizenz.
