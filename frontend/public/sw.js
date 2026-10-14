// Service Worker: zeigt Benachrichtigungen, auch wenn Auszeit nicht offen ist.
//
// Bewusst ohne Zwischenspeicher fuer die App selbst. Ein Service Worker, der
// Dateien vorhaelt, liefert nach einem Update gern die alte Fassung aus - und
// Auszeit ist ohne Verbindung zum Server ohnehin nicht zu gebrauchen.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

// Jeder Push zeigt eine Benachrichtigung. Das ist keine Kuer: iOS entzieht
// einer Web-App das Abo, wenn ein Push ohne sichtbare Benachrichtigung
// bleibt. Deshalb auch dann ein Text, wenn die Nachricht nicht lesbar ist.
self.addEventListener('push', (event) => {
  let daten = {};
  try {
    daten = event.data ? event.data.json() : {};
  } catch (err) {
    daten = {};
  }
  event.waitUntil(self.registration.showNotification(daten.titel || 'Auszeit', {
    body: daten.text || 'Es gibt Neues in Auszeit.',
    // Gleicher Vorfall, gleiche Kennung: die neue ersetzt die alte.
    tag: daten.tag || 'auszeit',
    renotify: true,
    icon: '/icons/auszeit-192.png',
    badge: '/icons/auszeit-192.png',
    vibrate: [200, 100, 200, 100, 500],
    // Ein Schueler auf dem Weg soll nicht von selbst verschwinden.
    requireInteraction: daten.art === 'kommt',
    data: { ziel: daten.ziel || '/' }
  }));
});

// Ein Tipp holt Auszeit nach vorn. Die Einzelheiten - wer, aus welchem Raum -
// laedt die App selbst ueber ihre Verbindung; in der Benachrichtigung stehen
// sie nicht.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const ziel = new URL((event.notification.data && event.notification.data.ziel) || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const fenster = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const offen = fenster.find(f => f.url.startsWith(self.location.origin));
    if (offen) {
      await offen.focus();
      return;
    }
    await self.clients.openWindow(ziel);
  })());
});
