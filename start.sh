#!/bin/bash
echo "Starte Backend..."
cd backend
npm start &
BACKEND_PID=$!

echo "Starte Frontend..."
cd ../frontend
npm run dev &
FRONTEND_PID=$!

echo "App läuft. Drücke CTRL+C zum Beenden."
wait
