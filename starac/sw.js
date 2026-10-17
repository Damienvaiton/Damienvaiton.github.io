const CACHE_NAME = "starac-pwa-v2";
const ASSETS = [
	"./",
	"./index.html",
	"./style.css",
	"./app.js",
	"./manifest.webmanifest",
	"./icon-192.png",
	"./icon-512.png",
	"https://fonts.googleapis.com/css?family=Space+Grotesk:400,500,600,700|IBM+Plex+Mono:400,500",
	"https://cdn.jsdelivr.net/npm/boxicons@2.1.4/css/boxicons.min.css",
	"https://cdn.jsdelivr.net/npm/sortablejs@1.15.2/Sortable.min.js",
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

// Stratégie : Réseau en priorité (et mise en cache), repli sur le cache si hors-ligne
self.addEventListener("fetch", (e) => {
	if (e.request.method !== "GET") return;

	e.respondWith(
		fetch(e.request)
			.then((res) => {
				if (res.ok) {
					const copie = res.clone();
					caches.open(CACHE_NAME).then((cache) => cache.put(e.request, copie));
				}
				return res;
			})
			.catch(() =>
				caches.match(e.request, { ignoreSearch: true }).then(
					(r) => r || caches.match("./index.html"),
				),
			),
	);
});
