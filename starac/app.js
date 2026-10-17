"use strict";

/* ================= Données de départ ================= */
const PROMO_DEPART = {
	promo: "2026",
	eleves: [
		"Amel", "Antoine", "Brieuc", "Cameron", "Elija", "Félix", "Isabella", "Khalil", "Kylian",
		"Leeloo", "Maud", "Mélina", "Morgan", "Noémie", "Tracy", "Ydriss", "Zoé",
	],
};

const STORAGE_KEY = "starac:v1";
const MEDAILLES = ["🥇", "🥈", "🥉"];
const collator = new Intl.Collator("fr", { sensitivity: "base" });

/* ================= Utilitaires ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
	String(s).replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
// Un même nom n'est jamais ajouté deux fois, quelle que soit la casse
const cle = (nom) => String(nom).trim().toLocaleLowerCase("fr");
const place = (i) => (i < 3 ? MEDAILLES[i] : `${i + 1}.`);
const rang = (i) => `${i + 1}${i === 0 ? "ʳᵉ" : "ᵉ"}`;

function iso(d) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
const aujourdhui = () => iso(new Date());

function dateLocale(texte) {
	const [y, m, d] = String(texte).slice(0, 10).split("-").map(Number);
	return new Date(y, (m || 1) - 1, d || 1);
}

// Un classement par prime : la semaine d'un prime va du samedi (soir du
// prime) au vendredi suivant. On l'identifie par la date de ce samedi.
const JOUR_DU_PRIME = 6; // samedi
function samediDuPrime(d = new Date()) {
	const ecartJours = (d.getDay() - JOUR_DU_PRIME + 7) % 7;
	return iso(new Date(d.getFullYear(), d.getMonth(), d.getDate() - ecartJours));
}

function formatDate(iso) {
	if (!iso) return "";
	const [y, m, d] = String(iso).slice(0, 10).split("-").map(Number);
	if (!y || !m || !d) return "";
	return new Date(y, m - 1, d).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

function vibrer(ms = 8) {
	try {
		navigator.vibrate?.(ms);
	} catch {
		// pas de vibration dispo
	}
}

/* ================= État & stockage ================= */
function etatInitial() {
	return {
		pseudo: "",
		promo: PROMO_DEPART.promo,
		eleves: PROMO_DEPART.eleves.map((name) => ({ name, eliminatedOn: null })),
		// Au premier passage, les élèves sont rangés par ordre alphabétique
		ranking: [...PROMO_DEPART.eleves].sort(collator.compare),
		potes: {},
		primes: [], // un classement par prime ; le dernier est celui en cours (= ranking)
		promoSync: null, // empreinte du dernier promo.json appliqué
		photos: {}, // prénom (en minuscules) → chemin de la photo, d'après promo.json
		onglet: "classement",
	};
}

// Remet l'état d'aplomb : pas de doublon, et le classement contient
// exactement les élèves en lice (les nouveaux arrivent en bas).
function normaliser(s) {
	const vus = new Set();
	s.eleves = (Array.isArray(s.eleves) ? s.eleves : [])
		.filter((e) => {
			if (!e || typeof e.name !== "string") return false;
			const k = cle(e.name);
			if (!k || vus.has(k)) return false;
			vus.add(k);
			return true;
		})
		.map((e) => ({ name: e.name.trim(), eliminatedOn: e.eliminatedOn || null }));

	const enLice = s.eleves.filter((e) => !e.eliminatedOn).map((e) => e.name);
	const parCle = new Map(enLice.map((n) => [cle(n), n]));
	const ranking = [];
	const places = new Set();
	for (const n of Array.isArray(s.ranking) ? s.ranking : []) {
		if (typeof n !== "string") continue;
		const k = cle(n);
		if (parCle.has(k) && !places.has(k)) {
			ranking.push(parCle.get(k));
			places.add(k);
		}
	}
	for (const n of enLice) if (!places.has(cle(n))) ranking.push(n);
	s.ranking = ranking;

	if (!s.potes || typeof s.potes !== "object" || Array.isArray(s.potes)) s.potes = {};
	s.primes = (Array.isArray(s.primes) ? s.primes : [])
		.filter((p) => p && typeof p.date === "string" && Array.isArray(p.ranking))
		.map((p) => ({ date: p.date.slice(0, 10), ranking: p.ranking.filter((n) => typeof n === "string") }));
	// Le prime en cours suit le classement qu'on modifie ; les précédents restent figés
	const dernier = s.primes[s.primes.length - 1];
	if (dernier && dernier.date === samediDuPrime()) dernier.ranking = [...s.ranking];
	if (!s.photos || typeof s.photos !== "object" || Array.isArray(s.photos)) s.photos = {};
	if (typeof s.pseudo !== "string") s.pseudo = "";
	if (typeof s.promo !== "string" || !s.promo.trim()) s.promo = PROMO_DEPART.promo;
	return s;
}

// L'ancienne version gardait des « photos » du classement : chacune devient
// le classement du prime de sa semaine. Le classement actuel n'est pas touché.
function migrer(s) {
	if (!Array.isArray(s.primes)) {
		const parPrime = new Map();
		const photos = Array.isArray(s.historique) ? s.historique : [];
		for (const h of photos) {
			if (!h || typeof h.date !== "string" || !Array.isArray(h.ranking)) continue;
			parPrime.set(samediDuPrime(dateLocale(h.date)), h.ranking);
		}
		const enCours = samediDuPrime();
		s.primes = [...parPrime]
			.filter(([date]) => date < enCours)
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([date, ranking]) => ({ date, ranking: [...ranking] }));
	}
	delete s.historique;
	return s;
}

function charger() {
	try {
		const brut = localStorage.getItem(STORAGE_KEY);
		if (brut) return normaliser({ ...etatInitial(), ...migrer(JSON.parse(brut)) });
	} catch {
		// stockage indisponible ou corrompu : on repart de zéro
	}
	return etatInitial();
}

function sauver() {
	normaliser(state);
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		toast("⚠️ Impossible d'enregistrer sur cet appareil");
	}
}

let state = charger();
let selection = null; // élève sélectionné·e dans le panneau de déplacement

// Démarre le classement du prime de la semaine s'il n'existe pas encore,
// en partant de celui du prime d'avant. Renvoie le prime précédent le cas échéant.
function assurerPrimeCourant() {
	const date = samediDuPrime();
	const dernier = state.primes[state.primes.length - 1];
	if (dernier && dernier.date >= date) return null;
	state.primes.push({ date, ranking: [...state.ranking] });
	sauver();
	return dernier || null;
}
const primeDemarre = assurerPrimeCourant();

const elimines = () =>
	state.eleves
		.filter((e) => e.eliminatedOn)
		.sort((a, b) => b.eliminatedOn.localeCompare(a.eliminatedOn));
const trouverEleve = (nom) => state.eleves.find((e) => cle(e.name) === cle(nom));

/* ================= Actions ================= */
function deplacer(nom, vers) {
	const i = state.ranking.indexOf(nom);
	if (i < 0) return;
	vers = Math.max(0, Math.min(state.ranking.length - 1, vers));
	if (vers === i) return;
	state.ranking.splice(i, 1);
	state.ranking.splice(vers, 0, nom);
	sauver();
	vibrer();
	render();
}

function ajouterEleve(nomBrut) {
	const nom = nomBrut.trim().replace(/\s+/g, " ");
	if (!nom) return false;
	const existant = trouverEleve(nom);
	if (existant && !existant.eliminatedOn) {
		toast(`${existant.name} est déjà dans la liste`);
		return false;
	}
	if (existant) {
		// Annuler une élimination : il suffit de ré-ajouter l'élève
		existant.eliminatedOn = null;
		toast(`🎉 ${existant.name} fait son grand retour !`);
	} else {
		state.eleves.push({ name: nom, eliminatedOn: null });
		toast(`✨ ${nom} rejoint le château`);
	}
	sauver();
	render();
	return true;
}

function eliminerEleve(nom) {
	const e = trouverEleve(nom);
	if (!e || e.eliminatedOn) return;
	e.eliminatedOn = aujourdhui();
	sauver();
	vibrer(30);
	render();
	toast(`💔 ${e.name} quitte le château… Merci pour tout !`);
}

function supprimerEleve(nom) {
	state.eleves = state.eleves.filter((e) => cle(e.name) !== cle(nom));
	sauver();
	render();
}

/* ================= Liste commune (promo.json) ================= */
// promo.json est la liste officielle : quand il change, les éliminations et
// les nouveaux élèves arrivent chez tout le monde, sans rien faire.
const PROMO_URL = "promo.json";

function empreinte(txt) {
	let h = 0;
	for (const c of txt) h = (h * 31 + c.codePointAt(0)) | 0;
	return String(h);
}

// Seulement des images du dossier de l'app (ex. "photos/amel.jpg")
function lirePhotos(photos) {
	const res = {};
	if (!photos || typeof photos !== "object") return res;
	for (const [nom, chemin] of Object.entries(photos)) {
		if (typeof chemin === "string" && /^[\w\-./]+\.(jpe?g|png|webp)$/i.test(chemin) && !chemin.includes(".."))
			res[cle(nom)] = chemin;
	}
	return res;
}

const estAlphabetique = (liste) => liste.every((n, i) => i === 0 || collator.compare(liste[i - 1], n) <= 0);

async function synchroniserPromo() {
	let brut;
	try {
		const res = await fetch(PROMO_URL, { cache: "no-store" });
		if (!res.ok) return;
		brut = await res.text();
	} catch {
		return; // hors-ligne : on garde la liste locale
	}
	const version = empreinte(brut);
	if (version === state.promoSync) return;
	let data;
	try {
		data = JSON.parse(brut);
	} catch {
		return;
	}
	if (!data || !Array.isArray(data.eleves)) return;

	const premiere = state.promoSync === null;
	const elim = data.elimines && typeof data.elimines === "object" ? data.elimines : {};
	const dates = new Map(
		Object.entries(elim).map(([n, d]) => [cle(n), typeof d === "string" && d ? d.slice(0, 10) : aujourdhui()]),
	);
	const noms = [...data.eleves, ...Object.keys(elim)]
		.filter((n) => typeof n === "string" && n.trim())
		.map((n) => n.trim().replace(/\s+/g, " "));

	// On calcule d'abord les changements…
	const nouveaux = [];
	const sortants = [];
	const retours = [];
	const vus = new Set();
	for (const nom of noms) {
		const k = cle(nom);
		if (vus.has(k)) continue;
		vus.add(k);
		const e = trouverEleve(nom);
		const date = dates.get(k) || null;
		if (!e) nouveaux.push({ name: nom, eliminatedOn: date });
		else if (date && !e.eliminatedOn) sortants.push({ e, date });
		else if (!date && e.eliminatedOn) retours.push(e);
		else if (date) e.eliminatedOn = date;
	}

	// …puis on les applique
	const alpha = estAlphabetique(state.ranking);
	state.eleves.push(...nouveaux);
	sortants.forEach(({ e, date }) => (e.eliminatedOn = date));
	retours.forEach((e) => (e.eliminatedOn = null));
	if (typeof data.promo === "string" && data.promo.trim()) state.promo = data.promo.trim();
	state.photos = lirePhotos(data.photos);
	state.promoSync = version;
	normaliser(state);
	// Tant que personne n'a été déplacé, on reste par ordre alphabétique
	if (alpha) state.ranking.sort(collator.compare);
	sauver();
	render();

	if (premiere) return;
	const annonces = [
		...sortants.map(({ e }) => `💔 ${e.name} quitte le château`),
		...nouveaux.filter((e) => !e.eliminatedOn).map((e) => `✨ ${e.name} arrive`),
		...retours.map((e) => `🎉 ${e.name} revient`),
	];
	if (annonces.length) toast(annonces.join(" · "));
}

/* ================= Classements des primes ================= */
// Places gagnées depuis un prime : > 0 = monté, < 0 = descendu, "new" = absent·e.
// On ne compare que les élèves présents des deux côtés, pour qu'une élimination
// ne fasse pas « monter » tout le monde d'une place.
function ecart(nom, liste, prime) {
	if (!prime) return null;
	const ici = new Set(liste.map(cle));
	const avant = prime.ranking.map(cle).filter((k) => ici.has(k));
	const j = avant.indexOf(cle(nom));
	if (j < 0) return "new";
	const la = new Set(avant);
	return j - liste.map(cle).filter((k) => la.has(k)).indexOf(cle(nom));
}

function badgeEcart(d) {
	if (d === null || d === 0) return "";
	if (d === "new") return `<span class="evo is-new">new</span>`;
	return d > 0 ? `<span class="evo is-up">▲${d}</span>` : `<span class="evo is-down">▼${-d}</span>`;
}

const titrePrime = (p) => `Prime du ${formatDate(p.date)}`;
const primeCourant = () => state.primes[state.primes.length - 1] || null;
// Le prime d'avant celui en cours : c'est la référence des flèches ▲▼
const primePrecedent = () => state.primes[state.primes.length - 2] || null;

// Photo de l'élève, ou pastille avec son initiale si on n'en a pas
function avatar(nom, grand = false) {
	const classe = `avatar${grand ? " avatar-grand" : ""}`;
	const chemin = state.photos?.[cle(nom)];
	if (chemin) return `<img class="${classe}" src="${esc(chemin)}" alt="" loading="lazy" />`;
	let teinte = 0;
	for (const c of cle(nom)) teinte = (teinte * 31 + c.codePointAt(0)) % 360;
	return `<span class="${classe} avatar-initiale" style="--teinte:${teinte}" aria-hidden="true">${esc([...nom.trim()][0] || "?").toUpperCase()}</span>`;
}

/* ================= Rendu ================= */
function render() {
	$("#promoLabel").textContent = `Promo ${state.promo}`;
	renderClassement();
	renderEleves();
	renderPotes();
	renderHistorique();
	rafraichirSheet();
}

function renderClassement() {
	const n = state.ranking.length;
	const nbElim = elimines().length;
	$("#rankCount").textContent = `${n} en lice${nbElim ? ` · ${nbElim} éliminé·e${nbElim > 1 ? "s" : ""}` : ""}`;

	const courant = primeCourant();
	const prime = primePrecedent();
	$("#primeLabel").textContent = courant
		? `${titrePrime(courant)}${prime ? ` · ▲▼ depuis le prime du ${formatDate(prime.date)}` : ""}`
		: "";
	$("#rankList").innerHTML = n
		? state.ranking
				.map(
					(nom, i) => `
			<li class="rank-item${nom === selection ? " is-selected" : ""}${i < 3 ? " is-podium" : ""}" data-name="${esc(nom)}">
				<span class="rank-pos">${place(i)}</span>
				${avatar(nom)}
				<span class="rank-name">${nom === selection ? "👉 " : ""}${esc(nom)}</span>
				${badgeEcart(ecart(nom, state.ranking, prime))}
				<button class="rank-handle" type="button" aria-label="Glisser ${esc(nom)}"><i class="bx bx-menu"></i></button>
			</li>`,
				)
				.join("")
		: `<li class="empty">Plus personne en lice… Ajoute des élèves dans l'onglet « Élèves ».</li>`;

	const el = elimines();
	$("#rankEliminated").innerHTML = el.length
		? `<h3 class="section-title">Éliminé·es</h3>
			<ul class="elim-list">${el
				.map(
					(e) =>
						`<li><span>❌ <s>${esc(e.name)}</s></span><span class="mono hint">${formatDate(e.eliminatedOn)}</span></li>`,
				)
				.join("")}</ul>`
		: "";
}

function renderEleves() {
	const enLice = state.eleves.filter((e) => !e.eliminatedOn).sort((a, b) => collator.compare(a.name, b.name));
	const el = elimines();
	$("#elevesLists").innerHTML = `
		<h3 class="section-title">En lice (${enLice.length})</h3>
		<ul class="eleve-list">${
			enLice
				.map(
					(e) => `
			<li class="eleve-item">
				<span class="eleve-name">${avatar(e.name)}${esc(e.name)}</span>
				<button class="btn btn-small btn-danger" data-elim="${esc(e.name)}">💔 Éliminer</button>
			</li>`,
				)
				.join("") || `<li class="empty">Personne en lice.</li>`
		}</ul>
		${
			el.length
				? `<h3 class="section-title">Éliminé·es (${el.length})</h3>
		<ul class="eleve-list">${el
			.map(
				(e) => `
			<li class="eleve-item is-out">
				<span class="eleve-name">❌ <s>${esc(e.name)}</s> <span class="mono hint">${formatDate(e.eliminatedOn)}</span></span>
				<span class="btn-row">
					<button class="btn btn-small" data-revive="${esc(e.name)}">Ré-intégrer</button>
					<button class="icon-btn icon-btn-small" data-delete="${esc(e.name)}" aria-label="Supprimer ${esc(e.name)}"><i class="bx bx-trash"></i></button>
				</span>
			</li>`,
			)
			.join("")}</ul>`
				: ""
		}`;
}

function renderPotes() {
	$("#pseudoLine").innerHTML = state.pseudo
		? `Tu partages en tant que <b>${esc(state.pseudo)}</b> · <button class="link-btn" data-act="pseudo">changer</button>`
		: `<button class="link-btn" data-act="pseudo">Choisis d'abord ton pseudo</button>`;

	const potes = Object.values(state.potes).sort((a, b) => collator.compare(a.pseudo, b.pseudo));
	$("#potesList").innerHTML = `
		<h3 class="section-title">Mes potes (${potes.length})</h3>
		${
			potes.length
				? `<ul class="pote-list">${potes
						.map((p) => {
							const score = compatibilite(state.ranking, p.ranking);
							return `
				<li class="card pote-item" data-pote="${esc(cle(p.pseudo))}">
					<div class="pote-main">
						<div>
							<p class="pote-name">${esc(p.pseudo)}</p>
							<p class="hint">${p.ranking
								.slice(0, 3)
								.map((n, i) => `${MEDAILLES[i]} ${esc(n)}`)
								.join(" ")}</p>
							<p class="hint mono">Mis à jour le ${formatDate(p.updatedAt)}</p>
						</div>
						${score === null ? "" : `<span class="score">${score}%</span>`}
					</div>
				</li>`;
						})
						.join("")}</ul>`
				: `<p class="empty">Aucun classement de pote pour l'instant. Demande-leur leur lien !</p>`
		}`;
}

function renderHistorique() {
	const courant = primeCourant();
	const primes = [...state.primes].reverse();
	$("#historiqueList").innerHTML = `
		<h3 class="section-title">Primes (${primes.length})</h3>
		${
			primes.length
				? `<ul class="pote-list">${primes
						.map(
							(h) => `
				<li class="card pote-item" data-prime="${esc(h.date)}">
					<p class="pote-name">${titrePrime(h)}${h === courant ? ` <span class="badge">en cours</span>` : ""}</p>
					<p class="hint">${h.ranking
						.slice(0, 3)
						.map((n, i) => `${MEDAILLES[i]} ${esc(n)}`)
						.join(" ")}</p>
				</li>`,
						)
						.join("")}</ul>`
				: `<p class="empty">Aucun prime pour l'instant.</p>`
		}`;
}

function vuePrime(date) {
	const idx = state.primes.findIndex((h) => h.date === date);
	if (idx < 0) return "";
	const prime = state.primes[idx];
	const avant = state.primes[idx - 1] || null;
	const enCours = prime === primeCourant();
	// Élèves déjà éliminé·es à ce prime-là (absent·es de son classement)
	const dans = new Set(prime.ranking.map(cle));
	const sortis = elimines().filter((e) => !dans.has(cle(e.name)));
	const lignes = prime.ranking
		.map(
			(nom, i) => `<li class="cmp-row">
				<span class="cmp-pos">${place(i)}</span>
				<span class="cmp-name">${esc(nom)}</span>
				${badgeEcart(ecart(nom, prime.ranking, avant))}
			</li>`,
		)
		.join("");
	return `
		<div class="sheet-head">
			<div>
				<p class="sheet-kicker">Ton classement${enCours ? " · en cours" : ""}</p>
				<h2>${titrePrime(prime)}</h2>
			</div>
			<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
		</div>
		${avant ? `<p class="hint">▲▼ = places gagnées ou perdues depuis le prime du ${formatDate(avant.date)}</p>` : ""}
		<ol class="cmp-list">${lignes}</ol>
		${sortis.length ? `<ul class="elim-list">${sortis.map((e) => `<li><span>❌ <s>${esc(e.name)}</s></span></li>`).join("")}</ul>` : ""}
		<div class="btn-row">
			${enCours ? "" : `<button class="btn btn-danger" data-act="delete-prime">Supprimer</button>`}
			<button class="btn btn-primary" data-close>Fermer</button>
		</div>`;
}

function ouvrirPrime(date) {
	ouvrirSheet({
		render: () => vuePrime(date),
		onClick: async (e) => {
			if (!e.target.closest('[data-act="delete-prime"]')) return;
			if (!(await confirmer(`Supprimer le prime du ${formatDate(date)} ?`, "Son classement sera perdu.", "Supprimer"))) return;
			state.primes = state.primes.filter((h) => h.date !== date || h === primeCourant());
			sauver();
			render();
		},
	});
}

/* ================= Image à partager ================= */
async function dessinerImage() {
	try {
		await document.fonts?.ready;
	} catch {
		// tant pis, police système
	}
	const W = 1080;
	const H = 1920;
	const c = document.createElement("canvas");
	c.width = W;
	c.height = H;
	const g = c.getContext("2d");
	const police = (taille, poids = 700) => `${poids} ${taille}px "Space Grotesk", system-ui, sans-serif`;

	const fond = g.createLinearGradient(0, 0, 0, H);
	fond.addColorStop(0, "#2a1252");
	fond.addColorStop(1, "#140b26");
	g.fillStyle = fond;
	g.fillRect(0, 0, W, H);
	const halo = g.createRadialGradient(W / 2, 0, 0, W / 2, 0, 900);
	halo.addColorStop(0, "rgba(255, 79, 163, 0.35)");
	halo.addColorStop(1, "rgba(255, 79, 163, 0)");
	g.fillStyle = halo;
	g.fillRect(0, 0, W, H);

	g.textAlign = "center";
	g.textBaseline = "middle";
	g.fillStyle = "#ffc94a";
	g.font = police(40, 500);
	const courant = primeCourant();
	g.fillText(`⭐ STAR ACADEMY · ${courant ? titrePrime(courant) : `PROMO ${state.promo}`}`.toUpperCase(), W / 2, 150, W - 160);
	g.fillStyle = "#f7f1ff";
	g.font = police(80);
	g.fillText(state.pseudo ? `Le classement de ${state.pseudo}` : "Mon classement", W / 2, 250, W - 160);

	const el = elimines();
	const n = state.ranking.length;
	const haut = 340;
	const bas = H - (el.length ? 230 : 140);
	const h = Math.min(100, (bas - haut) / Math.max(n, 1));
	const fs = Math.round(Math.min(46, h * 0.48));
	const prime = primePrecedent();
	state.ranking.forEach((nom, i) => {
		const y = haut + i * h;
		g.fillStyle = i < 3 ? "rgba(255, 201, 74, 0.18)" : "rgba(255, 255, 255, 0.07)";
		g.beginPath();
		if (g.roundRect) g.roundRect(90, y + 4, W - 180, h - 8, 18);
		else g.rect(90, y + 4, W - 180, h - 8);
		g.fill();
		const ym = y + h / 2;
		g.textAlign = "center";
		g.font = police(fs, 500);
		g.fillStyle = "rgba(247, 241, 255, 0.7)";
		g.fillText(place(i), 160, ym);
		g.textAlign = "left";
		g.font = police(fs);
		g.fillStyle = "#f7f1ff";
		g.fillText(nom, 230, ym, W - 480);
		const d = ecart(nom, state.ranking, prime);
		if (d !== null && d !== 0) {
			g.textAlign = "right";
			g.font = police(Math.round(fs * 0.75), 600);
			g.fillStyle = d === "new" ? "#ffc94a" : d > 0 ? "#5be3a1" : "#ff6b7a";
			g.fillText(d === "new" ? "new" : d > 0 ? `▲${d}` : `▼${-d}`, W - 120, ym);
		}
	});

	g.textAlign = "center";
	if (el.length) {
		g.font = police(34, 500);
		g.fillStyle = "rgba(247, 241, 255, 0.55)";
		g.fillText(`❌ ${el.map((e) => e.name).join(" · ")}`, W / 2, H - 170, W - 160);
	}
	g.font = police(30, 500);
	g.fillStyle = "rgba(247, 241, 255, 0.4)";
	g.fillText(new Date().toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" }), W / 2, H - 90);

	return new Promise((resolve) => c.toBlob(resolve, "image/png"));
}

async function partagerImage() {
	toast("🎨 Création de l'image…");
	const blob = await dessinerImage();
	if (!blob) return toast("😕 Impossible de créer l'image");
	const fichier = new File([blob], "classement-star-ac.png", { type: "image/png" });
	if (navigator.canShare?.({ files: [fichier] })) {
		try {
			await navigator.share({ files: [fichier] });
			return;
		} catch (err) {
			if (err && err.name === "AbortError") return;
		}
	}
	// Pas de partage natif : aperçu + téléchargement
	const url = URL.createObjectURL(blob);
	ouvrirSheet({
		render: () => `
			<div class="sheet-head">
				<h2>Ton image</h2>
				<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
			</div>
			<img class="share-img" src="${url}" alt="Mon classement Star Ac" />
			<a class="btn btn-primary btn-block" href="${url}" download="classement-star-ac.png"><i class="bx bx-download"></i> Télécharger</a>
			<p class="hint">Sur iPhone : appui long sur l'image, puis « Enregistrer ».</p>`,
		onClose: () => URL.revokeObjectURL(url),
	});
}

/* ================= Comparaison ================= */
// 100 % = même ordre, 0 % = ordre inverse (sur les élèves en commun)
function compatibilite(a, b) {
	const kb = b.map(cle);
	const communs = a.filter((n) => kb.includes(cle(n)));
	const n = communs.length;
	if (n < 2) return null;
	const ordreB = b.filter((x) => communs.some((c) => cle(c) === cle(x))).map(cle);
	let somme = 0;
	communs.forEach((nom, i) => (somme += Math.abs(i - ordreB.indexOf(cle(nom)))));
	const max = Math.floor((n * n) / 2);
	return Math.round(100 * (1 - somme / max));
}

function vueComparaison(pote) {
	const mesCles = state.ranking.map(cle);
	const score = compatibilite(state.ranking, pote.ranking);
	const lignes = pote.ranking
		.map((nom, i) => {
			const j = mesCles.indexOf(cle(nom));
			let diff = "";
			if (j < 0) diff = `<span class="diff">—</span>`;
			else if (j === i) diff = `<span class="diff is-same">=</span>`;
			else if (j < i) diff = `<span class="diff is-up">▲${i - j}</span>`;
			else diff = `<span class="diff is-down">▼${j - i}</span>`;
			return `<li class="cmp-row">
				<span class="cmp-pos">${place(i)}</span>
				<span class="cmp-name">${esc(nom)}</span>
				<span class="cmp-mine mono">${j < 0 ? "—" : `toi ${rang(j)}`}</span>
				${diff}
			</li>`;
		})
		.join("");
	const elim = pote.elimines.length
		? `<ul class="elim-list">${pote.elimines.map((e) => `<li><span>❌ <s>${esc(e.name)}</s></span></li>`).join("")}</ul>`
		: "";
	return `
		<div class="sheet-head">
			<div>
				<p class="sheet-kicker">Classement de</p>
				<h2>${esc(pote.pseudo)}</h2>
			</div>
			<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
		</div>
		${score === null ? "" : `<p class="compat">Compatibilité avec toi : <b>${score}%</b></p>`}
		<p class="hint">▲ = tu le/la classes plus haut · ▼ = plus bas</p>
		<ol class="cmp-list">${lignes}</ol>
		${elim}
		<p class="hint mono">Mis à jour le ${formatDate(pote.updatedAt)}</p>
		<div class="btn-row">
			<button class="btn btn-danger" data-act="delete-pote">Retirer</button>
			<button class="btn btn-primary" data-close>Fermer</button>
		</div>`;
}

function ouvrirComparaison(k) {
	const pote = state.potes[k];
	if (!pote) return;
	ouvrirSheet({
		render: () => (state.potes[k] ? vueComparaison(state.potes[k]) : ""),
		onClick: async (e) => {
			if (e.target.closest('[data-act="delete-pote"]')) {
				const ok = await confirmer(`Retirer ${pote.pseudo} ?`, "Son classement sera supprimé de cet appareil.", "Retirer");
				if (!ok) return;
				delete state.potes[k];
				sauver();
				render();
			}
		},
	});
}

/* ================= Partage ================= */
function encoder(obj) {
	const bytes = new TextEncoder().encode(JSON.stringify(obj));
	let bin = "";
	bytes.forEach((b) => (bin += String.fromCharCode(b)));
	return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decoder(code) {
	let b64 = code.replace(/-/g, "+").replace(/_/g, "/");
	while (b64.length % 4) b64 += "=";
	const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
	return JSON.parse(new TextDecoder().decode(bytes));
}

function lienPartage() {
	const code = encoder({
		v: 1,
		p: state.pseudo,
		pr: state.promo,
		r: state.ranking,
		e: elimines().map((e) => [e.name, e.eliminatedOn]),
		t: new Date().toISOString(),
	});
	return `${location.origin}${location.pathname}#c=${code}`;
}

function texteClassement() {
	const courant = primeCourant();
	const lignes = [
		`⭐ Classement Star Ac${state.pseudo ? ` de ${state.pseudo}` : ""} — ${courant ? titrePrime(courant) : `Promo ${state.promo}`}`,
		"",
	];
	state.ranking.forEach((n, i) => lignes.push(`${place(i)} ${n}`));
	const el = elimines();
	if (el.length) {
		lignes.push("");
		el.forEach((e) => lignes.push(`❌ ${e.name}`));
	}
	return lignes.join("\n");
}

async function partager(texte) {
	if (navigator.share) {
		try {
			await navigator.share({ text: texte });
			return;
		} catch (err) {
			if (err && err.name === "AbortError") return;
		}
	}
	try {
		await navigator.clipboard.writeText(texte);
		toast("📋 Copié dans le presse-papier");
	} catch {
		// Dernier recours : on affiche le texte à copier à la main
		ouvrirSheet({
			render: () => `
				<div class="sheet-head"><h2>À copier</h2><button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button></div>
				<textarea class="copy-area" readonly>${esc(texte)}</textarea>`,
		});
		$(".copy-area")?.select();
	}
}

async function partagerLien() {
	if (!state.pseudo && !(await demanderPseudo())) return;
	partager(`⭐ Compare ton classement Star Ac avec celui de ${state.pseudo} :\n${lienPartage()}`);
}

function extraireCode(texte) {
	const t = String(texte).trim();
	const m = t.match(/[#&?]c=([A-Za-z0-9_-]+)/);
	if (m) return m[1];
	if (/^[A-Za-z0-9_-]{16,}$/.test(t)) return t;
	return null;
}

function lireClassementPartage(code) {
	const d = decoder(code);
	if (!d || typeof d.p !== "string" || !d.p.trim() || !Array.isArray(d.r)) throw new Error("format");
	const propre = (s, max) => String(s).trim().replace(/\s+/g, " ").slice(0, max);
	return {
		pseudo: propre(d.p, 30),
		ranking: d.r.filter((n) => typeof n === "string" && n.trim()).slice(0, 100).map((n) => propre(n, 40)),
		elimines: (Array.isArray(d.e) ? d.e : [])
			.filter((x) => Array.isArray(x) && typeof x[0] === "string")
			.slice(0, 100)
			.map(([name, date]) => ({ name: propre(name, 40), eliminatedOn: typeof date === "string" ? date.slice(0, 10) : null })),
		updatedAt: typeof d.t === "string" ? d.t : new Date().toISOString(),
	};
}

async function importer(texte) {
	const code = extraireCode(texte);
	let pote;
	try {
		if (!code) throw new Error("vide");
		pote = lireClassementPartage(code);
	} catch {
		toast("😕 Ce lien n'est pas un classement Star Ac valide");
		return false;
	}
	if (state.pseudo && cle(pote.pseudo) === cle(state.pseudo)) {
		toast("C'est ton propre classement 😄");
		return false;
	}
	const k = cle(pote.pseudo);
	const existe = !!state.potes[k];
	const apercu = pote.ranking
		.slice(0, 3)
		.map((n, i) => `${MEDAILLES[i]} ${esc(n)}`)
		.join("<br>");
	const ok = await confirmer(
		existe ? `Mettre à jour ${pote.pseudo} ?` : `Ajouter ${pote.pseudo} ?`,
		`${apercu}${pote.ranking.length > 3 ? "<br>…" : ""}`,
		existe ? "Mettre à jour" : "Ajouter",
		true,
	);
	if (!ok) return false;
	state.potes[k] = pote;
	sauver();
	render();
	montrerOnglet("potes");
	toast(`✅ Classement de ${pote.pseudo} ${existe ? "mis à jour" : "ajouté"}`);
	return true;
}

function lireHash() {
	if (!/[#&]c=/.test(location.hash)) return;
	const hash = location.hash;
	history.replaceState(null, "", location.pathname + location.search);
	importer(hash);
}

/* ================= Feuille modale ================= */
let sheetCourante = null;

function ouvrirSheet(opts) {
	sheetCourante = opts;
	$("#sheet").hidden = false;
	document.body.classList.add("has-sheet");
	rafraichirSheet();
}

function rafraichirSheet() {
	if (!sheetCourante) return;
	const html = sheetCourante.render();
	if (!html) return fermerSheet();
	$("#sheetBody").innerHTML = html;
}

function fermerSheet() {
	const s = sheetCourante;
	sheetCourante = null;
	$("#sheet").hidden = true;
	document.body.classList.remove("has-sheet");
	s?.onClose?.();
}

$("#sheet").addEventListener("click", (e) => {
	if (e.target.closest("[data-close]")) return fermerSheet();
	sheetCourante?.onClick?.(e);
});

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && sheetCourante) fermerSheet();
});

function confirmer(titre, texteHtml, okLabel = "OK", positif = false) {
	return new Promise((resolve) => {
		let reponse = false;
		ouvrirSheet({
			render: () => `
				<div class="sheet-head"><h2>${esc(titre)}</h2></div>
				<p class="sheet-text">${texteHtml}</p>
				<div class="btn-row">
					<button class="btn" data-close>Annuler</button>
					<button class="btn ${positif ? "btn-primary" : "btn-danger"}" data-ok>${esc(okLabel)}</button>
				</div>`,
			onClick: (e) => {
				if (e.target.closest("[data-ok]")) {
					reponse = true;
					fermerSheet();
				}
			},
			onClose: () => resolve(reponse),
		});
	});
}

/* ---- Panneau de déplacement d'un·e élève ---- */
// « Parcours : 9ᵉ → 5ᵉ → 3ᵉ maintenant » d'après les primes précédents
function parcours(nom, i) {
	const etapes = state.primes
		.slice(0, -1)
		.map((h) => h.ranking.findIndex((x) => cle(x) === cle(nom)))
		.filter((j) => j >= 0)
		.slice(-5);
	if (!etapes.length) return "";
	return `<p class="sheet-context mono">Parcours : ${[...etapes.map(rang), `<b>${rang(i)}</b> maintenant`].join(" → ")}</p>`;
}

function vueDeplacement() {
	const i = state.ranking.indexOf(selection);
	if (i < 0) return "";
	const total = state.ranking.length;
	const avant = state.ranking[i - 1];
	const apres = state.ranking[i + 1];
	return `
		<div class="sheet-head">
			<div>
				<p class="sheet-kicker">${i < 3 ? `${MEDAILLES[i]} ` : ""}${rang(i)} place sur ${total}</p>
				<h2 class="titre-eleve">${avatar(selection, true)}${esc(selection)}</h2>
			</div>
			<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
		</div>
		<p class="sheet-context">${avant ? `Juste après <b>${esc(avant)}</b>` : "Tout en haut 👑"}${apres ? ` · avant <b>${esc(apres)}</b>` : " · tout en bas"}</p>
		${parcours(selection, i)}
		<div class="move-row">
			<button class="move-btn" data-move="top" ${i === 0 ? "disabled" : ""} aria-label="Tout en haut">⏫</button>
			<button class="move-btn" data-move="up" ${i === 0 ? "disabled" : ""} aria-label="Monter d'une place">⬆️</button>
			<button class="move-btn" data-move="down" ${i === total - 1 ? "disabled" : ""} aria-label="Descendre d'une place">⬇️</button>
			<button class="move-btn" data-move="bottom" ${i === total - 1 ? "disabled" : ""} aria-label="Tout en bas">⏬</button>
		</div>
		<p class="sheet-label">📍 À quelle place ?</p>
		<div class="place-grid">${state.ranking
			.map((_, j) => `<button class="place-btn${j === i ? " is-current" : ""}" data-place="${j}">${j + 1}</button>`)
			.join("")}</div>
		<button class="btn btn-primary btn-block" data-close>✅ Terminé</button>`;
}

function ouvrirDeplacement(nom) {
	selection = nom;
	renderClassement();
	ouvrirSheet({
		render: vueDeplacement,
		onClick: (e) => {
			const i = state.ranking.indexOf(selection);
			const mv = e.target.closest("[data-move]")?.dataset.move;
			const pl = e.target.closest("[data-place]")?.dataset.place;
			if (mv === "top") deplacer(selection, 0);
			else if (mv === "up") deplacer(selection, i - 1);
			else if (mv === "down") deplacer(selection, i + 1);
			else if (mv === "bottom") deplacer(selection, state.ranking.length - 1);
			else if (pl !== undefined) deplacer(selection, Number(pl));
			else return;
			garderVisible();
		},
		onClose: () => {
			selection = null;
			renderClassement();
		},
	});
	garderVisible();
}

// Fait défiler la liste pour que l'élève sélectionné·e reste visible au-dessus du panneau
function garderVisible() {
	const li = $("#rankList .is-selected");
	if (!li) return;
	const haut = $(".topbar").offsetHeight;
	const zone = window.innerHeight - $(".sheet-panel").offsetHeight - haut;
	const y = li.getBoundingClientRect().top + window.scrollY - haut - Math.max(12, zone / 2 - li.offsetHeight / 2);
	window.scrollTo({ top: Math.max(0, y), behavior: "smooth" });
}

/* ---- Réglages & pseudo ---- */
function vueReglages() {
	return `
		<div class="sheet-head">
			<h2>Réglages</h2>
			<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
		</div>
		<form class="settings-form" id="settingsForm">
			<label for="pseudoInput">Ton pseudo</label>
			<input id="pseudoInput" type="text" maxlength="30" value="${esc(state.pseudo)}" placeholder="Ex. Damien" />
			<label for="promoInput">Promo</label>
			<input id="promoInput" type="text" maxlength="20" value="${esc(state.promo)}" />
			<button class="btn btn-primary btn-block" type="submit">Enregistrer</button>
		</form>
		<div class="danger-zone">
			<button class="btn btn-block" data-act="reset-ranking">↺ Remettre mon classement par ordre alphabétique</button>
			<button class="btn btn-danger btn-block" data-act="reset-all">Tout effacer (nouvelle saison)</button>
		</div>
		<p class="hint">Tout est enregistré sur cet appareil uniquement.</p>`;
}

function ouvrirReglages() {
	ouvrirSheet({
		render: vueReglages,
		onClick: async (e) => {
			const act = e.target.closest("[data-act]")?.dataset.act;
			if (act === "reset-ranking") {
				if (!(await confirmer("Repartir de l'ordre alphabétique ?", "Ton classement actuel sera perdu.", "Réinitialiser"))) return;
				state.ranking = [...state.ranking].sort(collator.compare);
				sauver();
				render();
				toast("Classement remis par ordre alphabétique");
			} else if (act === "reset-all") {
				if (!(await confirmer("Tout effacer ?", "Élèves, classement et potes : tout repart de zéro avec la promo de départ.", "Tout effacer"))) return;
				state = etatInitial();
				assurerPrimeCourant();
				sauver();
				render();
				montrerOnglet("classement");
				toast("Nouvelle saison 🌟");
			}
		},
	});
	$("#settingsForm").addEventListener("submit", (e) => {
		e.preventDefault();
		state.pseudo = $("#pseudoInput").value.trim().replace(/\s+/g, " ");
		state.promo = $("#promoInput").value.trim() || state.promo;
		sauver();
		fermerSheet();
		render();
		toast("Réglages enregistrés");
	});
}

function demanderPseudo() {
	return new Promise((resolve) => {
		ouvrirSheet({
			render: () => `
				<div class="sheet-head">
					<h2>Ton pseudo</h2>
					<button class="icon-btn" data-close aria-label="Fermer"><i class="bx bx-x"></i></button>
				</div>
				<p class="sheet-text">C'est le nom que verront tes potes quand ils compareront.</p>
				<form class="settings-form" id="pseudoForm">
					<input id="pseudoAsk" type="text" maxlength="30" value="${esc(state.pseudo)}" placeholder="Ex. Damien" enterkeyhint="done" />
					<button class="btn btn-primary btn-block" type="submit">Valider</button>
				</form>`,
			onClose: () => resolve(!!state.pseudo),
		});
		const input = $("#pseudoAsk");
		input.focus();
		$("#pseudoForm").addEventListener("submit", (e) => {
			e.preventDefault();
			const v = input.value.trim().replace(/\s+/g, " ");
			if (!v) return input.focus();
			state.pseudo = v;
			sauver();
			render();
			fermerSheet();
		});
	});
}

/* ================= Toast ================= */
let toastTimer;
function toast(msg) {
	const t = $("#toast");
	t.textContent = msg;
	t.classList.add("is-visible");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove("is-visible"), 2800);
}

/* ================= Onglets ================= */
function montrerOnglet(nom) {
	document.querySelectorAll(".view").forEach((v) => (v.hidden = v.dataset.view !== nom));
	document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("is-active", t.dataset.tab === nom));
	if (state.onglet !== nom) {
		state.onglet = nom;
		sauver();
	}
	window.scrollTo(0, 0);
}

/* ================= Écouteurs ================= */
document.querySelector(".tabbar").addEventListener("click", (e) => {
	const tab = e.target.closest("[data-tab]");
	if (tab) montrerOnglet(tab.dataset.tab);
});

$("#settingsBtn").addEventListener("click", ouvrirReglages);
$("#shareBtn").addEventListener("click", partagerImage);

$("#view-historique").addEventListener("click", (e) => {
	const date = e.target.closest("[data-prime]")?.dataset.prime;
	if (date) ouvrirPrime(date);
});

$("#rankList").addEventListener("click", (e) => {
	if (e.target.closest(".rank-handle")) return;
	const li = e.target.closest(".rank-item");
	if (li) ouvrirDeplacement(li.dataset.name);
});

$("#addForm").addEventListener("submit", (e) => {
	e.preventDefault();
	const input = $("#addInput");
	if (ajouterEleve(input.value)) input.value = "";
});

$("#elevesLists").addEventListener("click", async (e) => {
	const elim = e.target.closest("[data-elim]")?.dataset.elim;
	const revive = e.target.closest("[data-revive]")?.dataset.revive;
	const del = e.target.closest("[data-delete]")?.dataset.delete;
	if (elim) {
		if (await confirmer(`Éliminer ${elim} ?`, "Il ou elle restera affiché·e en bas du classement, barré·e.", "💔 Éliminer")) eliminerEleve(elim);
	} else if (revive) {
		ajouterEleve(revive);
	} else if (del) {
		if (await confirmer(`Supprimer ${del} ?`, "L'élève disparaît complètement de la liste (pratique pour une faute de frappe).", "Supprimer")) supprimerEleve(del);
	}
});

$("#view-potes").addEventListener("click", (e) => {
	const act = e.target.closest("[data-act]")?.dataset.act;
	if (act === "share-link") partagerLien();
	else if (act === "share-text") partager(texteClassement());
	else if (act === "share-image") partagerImage();
	else if (act === "pseudo") demanderPseudo();
	const pote = e.target.closest("[data-pote]")?.dataset.pote;
	if (pote) ouvrirComparaison(pote);
});

$("#importForm").addEventListener("submit", async (e) => {
	e.preventDefault();
	const input = $("#importInput");
	if (await importer(input.value)) input.value = "";
});

window.addEventListener("hashchange", lireHash);
// L'app peut rester ouverte en fond plusieurs jours : on revérifie la liste au retour
document.addEventListener("visibilitychange", () => {
	if (document.visibilityState !== "visible") return;
	annoncerPrime(assurerPrimeCourant());
	synchroniserPromo();
});

function annoncerPrime(precedent) {
	if (!precedent) return;
	render();
	toast(`🌟 Nouveau prime ! Ton classement repart de celui du ${formatDate(precedent.date)}`);
}

/* ================= Glisser-déposer ================= */
if (window.Sortable) {
	window.Sortable.create($("#rankList"), {
		handle: ".rank-handle",
		draggable: ".rank-item",
		animation: 160,
		forceFallback: true,
		fallbackTolerance: 3,
		ghostClass: "is-ghost",
		chosenClass: "is-chosen",
		dragClass: "is-drag",
		onStart: () => vibrer(),
		onEnd: (e) => {
			// Sortable a déjà bougé le DOM : on applique le changement puis on re-rend
			if (e.oldIndex !== e.newIndex) deplacer(state.ranking[e.oldIndex], e.newIndex);
			else renderClassement();
		},
	});
}

/* ================= Démarrage ================= */
render();
annoncerPrime(primeDemarre);
synchroniserPromo();
montrerOnglet(state.onglet || "classement");
lireHash();

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("./sw.js", { scope: "./" })
			.catch((err) => console.error("Échec enregistrement SW:", err));
	});
}
