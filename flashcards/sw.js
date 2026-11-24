const CACHE_NAME = "flashcards-pwa-v5";
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
	// « reload » : on ignore le cache HTTP du navigateur (GitHub Pages garde
	// les fichiers 10 min), sinon on mettrait en cache l'ancienne version.
	// Fichier par fichier : une police ou des icônes injoignables ne doivent
	// pas empêcher l'appli de s'installer.
	e.waitUntil(
		caches
			.open(CACHE_NAME)
			.then((cache) =>
				Promise.all(ASSETS.map((url) => cache.add(new Request(url, { cache: "reload" })).catch(() => {}))),
			),
	);
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

	// Fichiers de l'appli : toujours revérifiés auprès du serveur (« no-cache »),
	// pour qu'une mise à jour arrive dès la réouverture, pas 10 min plus tard.
	const memeSite = new URL(e.request.url).origin === self.location.origin;
	const requete = memeSite ? new Request(e.request.url, { cache: "no-cache", credentials: "same-origin" }) : e.request;

	e.respondWith(
		fetch(requete)
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
