# Ein Container fuer Backend und Frontend.
#
# Das Frontend wird beim Bauen einmal kompiliert und anschliessend vom
# Express-Server mit ausgeliefert. Bewusst kein Vite-Dev-Server: der ist fuer
# die Entwicklung gedacht und gehoert nicht hinter einen oeffentlichen Zugang.

# Node 24 (LTS, versorgt bis Ende April 2028). Node 20 bekommt seit Ende
# April 2026 keine Sicherheitsupdates mehr, Node 22 nur noch bis Ende April
# 2027 - mitten im Schuljahr. Nur die Hauptversion steht fest: So bringt jeder
# Neubau die Korrekturen innerhalb von 24 mit.
FROM node:24-alpine

WORKDIR /app

# Frontend bauen
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci
COPY frontend/ ./frontend/
RUN cd frontend && npm run build

# Backend installieren (ohne Entwicklungsabhaengigkeiten)
COPY backend/package*.json ./backend/
RUN cd backend && npm ci --omit=dev
COPY backend/ ./backend/

# Ablage der Mandanten. Als Volume gemountet, damit sie Neubauten ueberlebt.
RUN mkdir -p /app/daten

EXPOSE 4000
CMD ["node", "backend/server.js"]
