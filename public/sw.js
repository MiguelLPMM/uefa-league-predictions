// sw.js
const CACHE_VERSION = 'v4';
const SHELL_CACHE = `uefa-predictions-shell-${CACHE_VERSION}`;
const API_CACHE = `uefa-predictions-api-${CACHE_VERSION}`;

const SHELL_ASSETS = [
    '/',
    '/index.html',
    '/leaderboard.html',
    '/admin.html',
    '/style.css',
    '/js/main.js',
    '/js/leaderboard.js',
    '/js/admin.js',
    '/js/standings.js',
    '/js/theme.js',
    '/js/compSelector.js',
    '/js/auth.js',
    '/js/adminConfig.js',
    '/js/nav.js',
    '/js/notify.js',
    '/js/supabaseClient.js',
    '/vendor/supabase.js',
    '/manifest.json',
    '/assets/ucl.ico',
    '/assets/ucl-dark.ico',
    '/assets/uel.ico',
    '/assets/uel-dark.ico',
    '/assets/uecl.ico',
    '/assets/uecl-dark.ico',
    '/assets/icon-192.png',
    '/assets/icon-512.png',
    '/assets/icon-512-maskable.png',
    '/assets/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL_ASSETS))
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(
                keys
                    .filter((key) => key !== SHELL_CACHE && key !== API_CACHE)
                    .map((key) => caches.delete(key))
            ))
            .then(() => self.clients.claim())
    );
});

// Matches/standings data: try the network first so predictions stay live,
// but fall back to the last cached response when offline.
async function networkFirst(request) {
    const cache = await caches.open(API_CACHE);
    try {
        const response = await fetch(request);
        cache.put(request, response.clone());
        return response;
    } catch (error) {
        const cached = await cache.match(request);
        if (cached) return cached;
        return new Response(
            JSON.stringify({ error: 'Offline and no cached data available' }),
            { status: 503, headers: { 'Content-Type': 'application/json' } }
        );
    }
}

// App shell: serve from cache instantly, refresh the cache in the background.
async function cacheFirst(request) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(request);
    const networkFetch = fetch(request)
        .then((response) => {
            cache.put(request, response.clone());
            return response;
        })
        .catch(() => null);

    if (cached) {
        networkFetch.catch(() => {});
        return cached;
    }

    const networkResponse = await networkFetch;
    if (networkResponse) return networkResponse;

    if (request.mode === 'navigate') {
        // Serve whichever page was actually requested if we have it cached
        // (index.html, leaderboard.html, admin.html, ...), falling back to
        // index.html only if that exact page was never cached.
        const url = new URL(request.url);
        return (await cache.match(url.pathname)) || cache.match('/index.html');
    }
    return Response.error();
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    if (event.request.method !== 'GET' || url.origin !== self.location.origin) {
        return;
    }

    // Any backend API route (matches, sync, and whatever gets added later)
    // should always try the network first — never treat it as static shell
    // content.
    if (url.pathname.startsWith('/api/')) {
        event.respondWith(networkFirst(event.request));
        return;
    }

    event.respondWith(cacheFirst(event.request));
});
