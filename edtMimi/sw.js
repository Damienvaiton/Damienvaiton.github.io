const CACHE_NAME = "edtmimi-pwa-v1";
const ASSETS = ["./", "./index.html", "./style.css", "./app.js", "./manifest.webmanifest"];

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

// Stratégie : Réseau en priorité, repli sur le cache si hors-ligne.
// L'emploi du temps lui-même est dans le localStorage, donc dispo hors-ligne.
self.addEventListener("fetch", (e) => {
	if (e.request.method !== "GET") return;
	e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
