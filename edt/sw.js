const CACHE_NAME = "edt-pwa-v1";
const ASSETS = [
	"./",
	"./index.html",
	"./manifest.webmanifest",
	"https://fonts.googleapis.com/css?family=Space+Grotesk:400,500,600,700|IBM+Plex+Mono:400,500",
	"https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css",
];

self.addEventListener("install", (e) => {
	e.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS)));
	self.skipWaiting();
});

self.addEventListener("activate", (e) => {
	e.waitUntil(
		caches
			.keys()
			.then((keys) =>
				Promise.all(
					keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)),
				),
			),
	);
	self.clients.claim();
});

// Stratégie : Réseau en priorité, repli sur le cache si hors-ligne
self.addEventListener("fetch", (e) => {
	// On ne gère que les requêtes GET dans le périmètre
	if (e.request.method !== "GET") return;

	e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});


