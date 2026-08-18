/* =================================================================
   WILDR — Service Worker
   Offline: mette in cache l'app shell (index.html + librerie esterne)
   e le tile della mappa già visitate, così l'app si apre e le zone
   già esplorate restano visibili anche senza connessione.
   I dati del viaggio (Firestore) sono gestiti separatamente dalla
   persistenza offline nativa di Firestore, non da questo file.
   ================================================================= */

const CACHE_NAME = 'wildr-cache-v1';

// File dell'app shell da mettere in cache al primo avvio
const APP_SHELL = [
  './',
  './index.html'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn('[SW] Precache app shell fallito:', err))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return; // non mettere in cache scritture/upload

  const url = new URL(req.url);

  // Tile della mappa OpenStreetMap — cache-first: le zone già visualizzate
  // restano disponibili anche offline (utile in viaggio, specie in camper)
  if (url.hostname.endsWith('tile.openstreetmap.org')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // Librerie esterne (Leaflet, jsPDF, Google Fonts, Firebase SDK) — cambiano raramente,
  // cache-first per velocità e disponibilità offline
  const cdnHosts = [
    'unpkg.com',
    'cdnjs.cloudflare.com',
    'fonts.googleapis.com',
    'fonts.gstatic.com'
  ];
  if (cdnHosts.some((h) => url.hostname.endsWith(h)) || url.href.includes('gstatic.com/firebasejs')) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // La pagina dell'app stessa — network-first, così gli aggiornamenti si vedono subito,
  // con fallback alla cache se offline
  if (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname === '/') {
    event.respondWith(networkFirst(req));
    return;
  }

  // Tutto il resto (Firestore, OSRM, Nominatim, OpenWeather, ImgBB, chat, ecc.)
  // passa diretto: sono dati dinamici, gestiti dalla persistenza offline di Firestore
  // o comunque non adatti a una cache statica.
});

async function cacheFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || new Response('', { status: 504, statusText: 'Offline e non disponibile in cache' });
  }
}

async function networkFirst(req) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const res = await fetch(req);
    if (res && res.status === 200) cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(req);
    if (cached) return cached;
    return new Response('Sei offline e questa pagina non è ancora stata salvata in cache.', {
      status: 504,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' }
    });
  }
}
