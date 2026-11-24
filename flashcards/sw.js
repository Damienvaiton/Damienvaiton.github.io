const CACHE_NAME = "flashcards-pwa-v2";
const ASSETS = [
	"./",
	"./index.html",
	"./style.css",
	"./app.js",
	"./manifest.webmanifest",
	"./icon-192.png",
	"./icon-512.png",
	"./paquets/catalogue.json",
	"https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap",
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
