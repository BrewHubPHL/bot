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

  // ── API calls: Zero-trust — NEVER cache or intercept any backend call ──
  // All offline data is handled by IndexedDB in the frontend (offlineStore.ts).
  // The SW must not touch Netlify Functions, Next.js API routes, or Supabase.
  if (url.pathname.startsWith('/.netlify/functions/') ||
      url.pathname.startsWith('/api/') ||
      url.hostname.endsWith('.supabase.co')) {
    return;
  }

  // ── Next.js static chunks: Cache-first ────────────────────
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(request));
    return;
  }

  // ── Next.js RSC payloads & HTML navigations: Network-first ──
  // RSC flight data and page navigations MUST always fetch live data
  // so baristas never see yesterday's prices, stale queues, or ghost items.
  // Cached version is only served when Wi-Fi is completely dead.
  const isRSC = request.headers.get('RSC') === '1' || url.searchParams.has('_rsc');
  const isNavigation = request.mode === 'navigate'
    || (request.headers.get('accept') || '').includes('text/html');

  if (isRSC || isNavigation) {
    event.respondWith(
      fetch(request)
        .then(async (response) => {
          if (response.ok) {
            const cache = await caches.open(CACHE_NAME);
            cache.put(request, response.clone());
          }
          return response;
        })
        .catch(async () => {
          const cached = await caches.match(request);
          if (cached) return cached;

          // Navigation fallback — show a cached app shell page
          if (request.mode === 'navigate') {
            const cache = await caches.open(CACHE_NAME);
            const shell = await cache.match('/cafe') || await cache.match('/login');
            if (shell) return shell;
          }
          return new Response('Offline', { status: 503 });
        })
    );
    return;
  }

  // ── Remaining static assets (images, fonts): Stale-while-revalidate ──
  event.respondWith(staleWhileRevalidate(request));
});

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

    // Chunk 404 → deployment changed. Nuke ALL caches & notify clients.
    // Every Netlify build produces uniquely-hashed chunk filenames so old
    // entries are never reused. Keeping them wastes iPad storage quota and
    // eventually causes Safari to evict the entire CacheStorage mid-shift.
    if (response.status === 404 && request.url.includes('/_next/static/')) {
      console.warn('[SW] Stale asset detected — purging all caches:', request.url);
      const allClients = await self.clients.matchAll({ type: 'window' });
      allClients.forEach((client) => client.postMessage({ type: 'CHUNK_STALE' }));
      // Burn both caches to the ground — reload will repopulate cleanly
      const appCache = await caches.open(CACHE_NAME);
      const apiCache = await caches.open(API_CACHE);
      const [appKeys, apiKeys] = await Promise.all([appCache.keys(), apiCache.keys()]);
      await Promise.all([
        ...appKeys.map((k) => appCache.delete(k)),
        ...apiKeys.map((k) => apiCache.delete(k)),
      ]);
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

// ── Message handler: Only SKIP_WAITING ──────────────────────────
// CACHE_MENU removed — offline menu data is handled by IndexedDB
// in the frontend (offlineStore.ts). The SW never touches API payloads.
self.addEventListener('message', (event) => {
  // ── Origin validation ─────────────────────────────────────────
  let messageOrigin = null;
  if (typeof event.origin === 'string' && event.origin.length > 0) {
    messageOrigin = event.origin;
  } else if (event.source && typeof event.source.url === 'string') {
    try { messageOrigin = new URL(event.source.url).origin; } catch { return; }
  }
  if (messageOrigin !== self.location.origin &&
      messageOrigin !== 'https://brewhubphl.com' &&
      messageOrigin !== 'https://www.brewhubphl.com') {
    return;
  }

  // ── Require a valid Client source ─────────────────────────────
  if (!event.source || typeof event.source.url !== 'string') return;

  // ── Validate event.data shape ─────────────────────────────────
  const { data } = event;
  if (data == null || typeof data !== 'object' || Array.isArray(data)) return;
  if (typeof data.type !== 'string') return;

  // ── SKIP_WAITING only ─────────────────────────────────────────
  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
