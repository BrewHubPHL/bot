/**
 * BrewHub PHL — Service Worker for Offline Resilience
 *
 * Strategy: Cache-first for app shell & static assets,
 * network-first for API calls (with stale fallback).
 *
 * When the Comcast fiber gets cut, staff iPads still load:
 * - POS page (take orders on cached menu, queue for sync)
 * - KDS page (shows last-known orders)
 * - Scanner page (shows offline notice)
 */

const CACHE_NAME = 'brewhub-v3';
const API_CACHE = 'brewhub-api-v3';

// App shell: public routes safe to pre-cache (no auth required)
const APP_SHELL = [
  '/',
  '/cafe',
  '/login',
  '/site.webmanifest',
];

// Protected ops routes — behind OpsGate, never pre-cached by SW.
// The app's middleware handles auth; the SW must not intercept these.
const PROTECTED_ROUTES = ['/pos', '/kds', '/kds-legacy', '/scanner', '/staff-hub', '/manager', '/parcels-pickup'];

// ── Install: Pre-cache app shell ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(async (cache) => {
      // Cache what we can, don't fail install if one request fails
      for (const url of APP_SHELL) {
        try {
          await cache.add(url);
        } catch (err) {
          console.warn(`[SW] Failed to pre-cache ${url}:`, err.message);
        }
      }
    })
  );
  // Activate immediately — don't wait for old tabs to close
  self.skipWaiting();
});

// ── Activate: Clean old caches ──────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME && k !== API_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  // Take control of all open tabs immediately
  self.clients.claim();
});

// ── Fetch: Smart routing ────────────────────────────────────────
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests (POST orders, etc. handled by app-level queue)
  if (request.method !== 'GET') return;

  // Skip WebSocket / Supabase realtime connections
  if (url.protocol === 'wss:' || url.protocol === 'ws:') return;

  // Skip chrome-extension, etc.
  if (!url.protocol.startsWith('http')) return;

  // Skip cross-origin requests (Unsplash images, external CDNs, etc.)
  // The SW should only manage same-origin resources.
  if (url.origin !== self.location.origin) return;

  // Never intercept protected ops routes — OpsGate middleware owns auth.
  // Caching a 302 redirect here would poison the cache with login pages.
  const isProtected = PROTECTED_ROUTES.some(p => url.pathname.startsWith(p));
  if (isProtected) return;

  // ── API calls: Network-first with cache fallback ──────────
  if (url.pathname.startsWith('/.netlify/functions/') || url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithCache(request));
    return;
  }

  // ── Next.js static chunks: Cache-first ────────────────────
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── App pages & other assets: Stale-while-revalidate ──────
  event.respondWith(staleWhileRevalidate(request));
});

// ── Strategy: Network-first, fallback to cache ──────────────────
async function networkFirstWithCache(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    // Cache successful GET responses for offline fallback
    if (response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    // Network failed — try cache
    const cached = await cache.match(request);
    if (cached) return cached;

    // No cache either — return offline JSON
    return new Response(
      JSON.stringify({ error: 'offline', message: 'You are offline. Cached data unavailable.' }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }
}

// ── Strategy: Cache-first (immutable hashed assets) ─────────────
// If a chunk 404s, the build changed — tell the client to hard-reload
// so it picks up fresh HTML with correct chunk references.
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(CACHE_NAME);
      cache.put(request, response.clone());
      return response;
    }

    // Chunk 404 → deployment changed. Purge stale cache & notify clients.
    if (response.status === 404 && request.url.includes('/_next/static/chunks/')) {
      console.warn('[SW] Stale chunk detected, triggering reload:', request.url);
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach((client) => client.postMessage({ type: 'CHUNK_STALE' }));
      // Clear cached pages so reload fetches fresh HTML
      const cache = await caches.open(CACHE_NAME);
      const keys = await cache.keys();
      await Promise.all(
        keys.filter((k) => !k.url.includes('/_next/static/')).map((k) => cache.delete(k))
      );
    }
    return response;
  } catch {
    return new Response('', { status: 503 });
  }
}

// ── Strategy: Stale-while-revalidate ────────────────────────────
async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then((response) => {
      if (response.ok) {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => null);

  // Return cached version immediately if available, update in background
  if (cached) {
    // Fire-and-forget revalidation
    networkFetch;
    return cached;
  }

  // No cache — must wait for network
  const response = await networkFetch;
  if (response) return response;

  // Offline fallback page for navigation requests
  if (request.mode === 'navigate') {
    const shellFallback = await cache.match('/cafe') || await cache.match('/login');
    if (shellFallback) return shellFallback;
  }

  return new Response('Offline', { status: 503 });
}

// ── Message handler: Manual cache updates from app ──────────────
self.addEventListener('message', (event) => {
  // Validate sender origin: only accept messages from same-origin clients
  try {
    const sourceUrl = event.source && event.source.url;
    const origin = sourceUrl ? new URL(sourceUrl).origin : null;
    const allowedOrigins = [self.location.origin, 'https://brewhubphl.com', 'https://www.brewhubphl.com'];
    if (!origin || !allowedOrigins.includes(origin)) return;
  } catch (e) {
    return;
  }
  if (event.data?.type === 'CACHE_MENU') {
    // App sends fresh menu data to cache
    const menuResponse = new Response(JSON.stringify(event.data.payload), {
      headers: { 'Content-Type': 'application/json' },
    });
    caches.open(API_CACHE).then((cache) => {
      cache.put('/.netlify/functions/get-menu', menuResponse);
    });
  }

  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
