"use strict";

/* =========================================================
   Flashcards — réviser efficacement
   ---------------------------------------------------------
   - Paquets de cartes (recto / verso), import depuis Quizlet
   - « Réviser » : répétition espacée façon Anki (SM-2 simplifié),
     chaque carte revient juste avant d'être oubliée
   - Entraînement libre façon Quizlet : Cartes, Écrire, Quiz, Associer
   Tout est stocké sur l'appareil (localStorage), rien n'est envoyé.
   ========================================================= */

const STORAGE_KEY = "flashcards:v1";
const MIN = 60 * 1000;
const HEURE = 60 * MIN;
const JOUR = 24 * HEURE;
// La « journée de révision » commence à 4 h du matin, comme dans Anki :
// réviser à 1 h du matin compte encore pour la veille.
const DEBUT_JOURNEE_H = 4;

// Étapes d'apprentissage (en minutes) avant qu'une carte passe en révision espacée
const ETAPES_APPRENTISSAGE = [1, 10];
const ETAPES_REAPPRENTISSAGE = [10];
const INTERVALLE_DIPLOME = 1; // jours, après la dernière étape « Bien »
const INTERVALLE_FACILE = 4; // jours, si « Facile » dès l'apprentissage
const FACILITE_DEPART = 2.5;
const FACILITE_MIN = 1.3;
const SEUIL_MAITRISE = 21; // jours d'intervalle à partir desquels une carte est « maîtrisée »

const COULEURS = ["#5b5bd6", "#0090ff", "#12a594", "#30a46c", "#f76b15", "#e5484d", "#d6409f", "#8e4ec6"];

const NOTES = [
	{ note: 1, label: "À revoir", cls: "n1" },
	{ note: 2, label: "Difficile", cls: "n2" },
	{ note: 3, label: "Bien", cls: "n3" },
	{ note: 4, label: "Facile", cls: "n4" },
];

const PAQUET_EXEMPLE = {
	nom: "Capitales d'Europe (exemple)",
	cartes: [
		["Espagne", "Madrid"],
		["Portugal", "Lisbonne"],
		["Italie", "Rome"],
		["Allemagne", "Berlin"],
		["Autriche", "Vienne"],
		["Pologne", "Varsovie"],
		["Hongrie", "Budapest"],
		["Suède", "Stockholm"],
		["Norvège", "Oslo"],
		["Danemark", "Copenhague"],
		["Irlande", "Dublin"],
		["Grèce", "Athènes"],
	],
};

/* ================= Utilitaires ================= */
const $ = (sel, root = document) => root.querySelector(sel);
const esc = (s) =>
	String(s ?? "").replace(
		/[&<>"']/g,
		(c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
	);
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

function melanger(liste) {
	const a = [...liste];
	for (let i = a.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[a[i], a[j]] = [a[j], a[i]];
	}
	return a;
}

function iso(d) {
	const pad = (n) => String(n).padStart(2, "0");
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Clé du jour de révision (bascule à 4 h du matin)
const jourCle = (t = Date.now()) => iso(new Date(t - DEBUT_JOURNEE_H * HEURE));

// Fin de la journée de révision en cours (le prochain 4 h du matin)
function finDeJournee(t = Date.now()) {
	const d = new Date(t - DEBUT_JOURNEE_H * HEURE);
	d.setHours(0, 0, 0, 0);
	d.setDate(d.getDate() + 1);
	return d.getTime() + DEBUT_JOURNEE_H * HEURE;
}

// Pour comparer une réponse tapée : sans accents, casse ni ponctuation
function normaliser(s) {
	return String(s ?? "")
		.toLowerCase()
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[’']/g, " ")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();
}

function levenshtein(a, b) {
	if (a === b) return 0;
	if (!a.length) return b.length;
	if (!b.length) return a.length;
	let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
	for (let i = 1; i <= a.length; i++) {
		const cur = [i];
		for (let j = 1; j <= b.length; j++) {
			cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
		}
		prev = cur;
	}
	return prev[b.length];
}

function formatDelai(ms) {
	if (ms < MIN) return "<1 min";
	if (ms < HEURE) return `${Math.round(ms / MIN)} min`;
	if (ms < JOUR) return `${Math.round(ms / HEURE)} h`;
	const j = Math.round(ms / JOUR);
	if (j < 31) return `${j} j`;
	if (j < 365) return `${Math.round(j / 30)} mois`;
	const ans = Math.round((j / 365) * 10) / 10;
	return `${String(ans).replace(".", ",")} an${ans >= 2 ? "s" : ""}`;
}

function formatChrono(ms) {
	const s = ms / 1000;
	return s < 60 ? `${s.toFixed(1).replace(".", ",")} s` : `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const pluriel = (n, mot, motPluriel = mot + "s") => `${n} ${n > 1 ? motPluriel : mot}`;

// Taille du texte d'une carte selon sa longueur
function tailleTexte(t) {
	const n = String(t || "").length;
	if (n <= 18) return "t-xl";
	if (n <= 60) return "t-l";
	if (n <= 160) return "t-m";
	return "t-s";
}

function vibrer(ms = 8) {
	try {
		navigator.vibrate?.(ms);
	} catch {
		// pas de vibration dispo
	}
}

let toastTimer = null;
function toast(msg) {
	const t = $("#toast");
	t.textContent = msg;
	t.classList.add("on");
	clearTimeout(toastTimer);
	toastTimer = setTimeout(() => t.classList.remove("on"), 2400);
}

/* ================= État & stockage ================= */
const srsNeuf = () => ({ etat: "nouvelle", due: 0, iv: 0, fac: FACILITE_DEPART, etape: 0, reps: 0, oublis: 0 });

const nouvelleCarte = (recto, verso) => ({
	id: uid(),
	recto: String(recto).trim(),
	verso: String(verso).trim(),
	etoile: false,
	srs: srsNeuf(),
});

function nouveauPaquet(nom, couleur = COULEURS[0]) {
	return {
		id: uid(),
		nom: String(nom).trim() || "Sans titre",
		couleur,
		sens: "recto", // recto → verso, "verso" → recto, ou "mixte"
		creeLe: Date.now(),
		nouvellesDuJour: { jour: "", n: 0, bonus: 0 },
		meilleurAssocier: null,
		cartes: [],
	};
}

function etatInitial() {
	return { paquets: [], reglages: { nouvellesParJour: 20 }, journal: {} };
}

// Remet d'aplomb un état chargé (ancienne version, sauvegarde importée…)
function reparer(e) {
	const base = etatInitial();
	const etat = { ...base, ...(e && typeof e === "object" ? e : {}) };
	etat.reglages = { ...base.reglages, ...(etat.reglages || {}) };
	etat.journal = etat.journal && typeof etat.journal === "object" ? etat.journal : {};
	etat.paquets = (Array.isArray(etat.paquets) ? etat.paquets : []).map((p) => {
		const paquet = { ...nouveauPaquet(p.nom || "Sans titre"), ...p };
		paquet.nouvellesDuJour = { jour: "", n: 0, bonus: 0, ...(p.nouvellesDuJour || {}) };
		paquet.cartes = (Array.isArray(p.cartes) ? p.cartes : [])
			.filter((c) => c && (c.recto || c.verso))
			.map((c) => ({
				id: c.id || uid(),
				recto: String(c.recto ?? ""),
				verso: String(c.verso ?? ""),
				etoile: !!c.etoile,
				srs: { ...srsNeuf(), ...(c.srs || {}) },
			}));
		return paquet;
	});
	return etat;
}

function charger() {
	try {
		const brut = localStorage.getItem(STORAGE_KEY);
		return reparer(brut ? JSON.parse(brut) : null);
	} catch {
		return etatInitial();
	}
}

function sauver() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
	} catch {
		toast("Impossible d'enregistrer : stockage plein ?");
	}
}

let state = charger();

const trouverPaquet = (id) => state.paquets.find((p) => p.id === id);
const trouverCarte = (paquet, id) => paquet.cartes.find((c) => c.id === id);

/* ================= Répétition espacée ================= */
function graduer(s, iv, maintenant) {
	s.etat = "revision";
	s.iv = iv;
	s.etape = 0;
	s.due = maintenant + iv * JOUR;
}

// Petit flou sur les longs intervalles, pour que les cartes apprises
// ensemble ne reviennent pas toutes le même jour.
function flouter(iv) {
	if (iv < 3) return iv;
	const ecart = Math.max(1, Math.round(iv * 0.05));
	return iv + Math.round((Math.random() * 2 - 1) * ecart);
}

// Calcule le nouvel état d'une carte après une note (1 à 4)
function planifier(srs, note, maintenant = Date.now(), { flou = true } = {}) {
	const s = { ...srs, reps: (srs.reps || 0) + 1 };

	if (s.etat === "nouvelle" || s.etat === "apprentissage") {
		const etapes = ETAPES_APPRENTISSAGE;
		const etape = s.etat === "nouvelle" ? 0 : Math.min(s.etape, etapes.length - 1);
		s.etat = "apprentissage";
		if (note === 1) {
			s.etape = 0;
			s.due = maintenant + etapes[0] * MIN;
		} else if (note === 2) {
			s.etape = etape;
			const delai = etape === 0 && etapes.length > 1 ? (etapes[0] + etapes[1]) / 2 : etapes[etape];
			s.due = maintenant + delai * MIN;
		} else if (note === 3) {
			if (etape + 1 >= etapes.length) graduer(s, INTERVALLE_DIPLOME, maintenant);
			else {
				s.etape = etape + 1;
				s.due = maintenant + etapes[s.etape] * MIN;
			}
		} else {
			graduer(s, INTERVALLE_FACILE, maintenant);
		}
		return s;
	}

	if (s.etat === "reapprentissage") {
		const etapes = ETAPES_REAPPRENTISSAGE;
		const etape = Math.min(s.etape, etapes.length - 1);
		if (note === 1) {
			s.etape = 0;
			s.due = maintenant + etapes[0] * MIN;
		} else if (note === 2) {
			s.due = maintenant + etapes[etape] * MIN;
		} else if (note === 3) {
			if (etape + 1 >= etapes.length) graduer(s, Math.max(1, s.iv), maintenant);
			else {
				s.etape = etape + 1;
				s.due = maintenant + etapes[s.etape] * MIN;
			}
		} else {
			graduer(s, Math.max(1, s.iv) + 1, maintenant);
		}
		return s;
	}

	// Carte en révision espacée
	const iv = Math.max(1, s.iv || 1);
	if (note === 1) {
		s.oublis = (s.oublis || 0) + 1;
		s.fac = Math.max(FACILITE_MIN, s.fac - 0.2);
		s.iv = Math.max(1, Math.round(iv * 0.3));
		s.etat = "reapprentissage";
		s.etape = 0;
		s.due = maintenant + ETAPES_REAPPRENTISSAGE[0] * MIN;
		return s;
	}
	let nouvelIv;
	if (note === 2) {
		s.fac = Math.max(FACILITE_MIN, s.fac - 0.15);
		nouvelIv = iv * 1.2;
	} else if (note === 3) {
		nouvelIv = iv * s.fac;
	} else {
		s.fac += 0.15;
		nouvelIv = iv * s.fac * 1.3;
	}
	nouvelIv = Math.max(iv + 1, Math.round(nouvelIv));
	if (flou) nouvelIv = Math.max(iv + 1, flouter(nouvelIv));
	graduer(s, Math.min(nouvelIv, 3650), maintenant);
	return s;
}

const enApprentissage = (c) => c.srs.etat === "apprentissage" || c.srs.etat === "reapprentissage";

function nouvellesRestantes(paquet) {
	const nd = paquet.nouvellesDuJour;
	const dejaVues = nd.jour === jourCle() ? nd.n : 0;
	const bonus = nd.jour === jourCle() ? nd.bonus || 0 : 0;
	return Math.max(0, state.reglages.nouvellesParJour + bonus - dejaVues);
}

function statsPaquet(paquet, maintenant = Date.now()) {
	const fin = finDeJournee(maintenant);
	let nouvelles = 0;
	let aRevoir = 0;
	let enCours = 0;
	let maitrisees = 0;
	for (const c of paquet.cartes) {
		const s = c.srs;
		if (s.etat === "nouvelle") nouvelles++;
		else if (s.etat === "revision" && s.iv >= SEUIL_MAITRISE) maitrisees++;
		else enCours++;
		if (s.etat !== "nouvelle" && s.due <= fin) aRevoir++;
	}
	const nouvellesDispo = Math.min(nouvelles, nouvellesRestantes(paquet));
	return { total: paquet.cartes.length, nouvelles, nouvellesDispo, aRevoir, enCours, maitrisees };
}

// Prochaine échéance après aujourd'hui (pour « Prochaine révision : … »)
function prochaineEcheance(paquet) {
	const fin = finDeJournee();
	const futures = paquet.cartes.filter((c) => c.srs.etat !== "nouvelle" && c.srs.due > fin);
	if (!futures.length) return null;
	const quand = Math.min(...futures.map((c) => c.srs.due));
	const jour = jourCle(quand);
	return { quand, n: futures.filter((c) => jourCle(c.srs.due) === jour).length };
}

function noterJournal(champ) {
	const j = jourCle();
	state.journal[j] = state.journal[j] || { revues: 0 };
	state.journal[j][champ] = (state.journal[j][champ] || 0) + 1;
}

// Nombre de jours d'affilée avec au moins une carte révisée
function serie() {
	let n = 0;
	const d = new Date(Date.now() - DEBUT_JOURNEE_H * HEURE);
	if (!state.journal[iso(d)]?.revues) d.setDate(d.getDate() - 1); // pas encore révisé aujourd'hui
	while (state.journal[iso(d)]?.revues) {
		n++;
		d.setDate(d.getDate() - 1);
	}
	return n;
}

/* ================= Sens des cartes ================= */
// Renvoie la question et la réponse d'une carte selon le sens du paquet
function faces(carte, sens) {
	const inverse = sens === "verso" || (sens === "mixte" && Math.random() < 0.5);
	return inverse
		? { question: carte.verso, reponse: carte.recto }
		: { question: carte.recto, reponse: carte.verso };
}

const LIBELLES_SENS = { recto: "Terme → Définition", verso: "Définition → Terme", mixte: "Les deux, au hasard" };

/* ================= Import / export texte ================= */
const SEPARATEURS = {
	auto: { label: "Automatique", re: null },
	tab: { label: "Tabulation (Quizlet)", re: /\t/ },
	pv: { label: "Point-virgule  ;", re: /\s*;\s*/ },
	virgule: { label: "Virgule  ,", re: /\s*,\s*/ },
	tiret: { label: "Tiret  -", re: /\s+[-–—]\s+/ },
	dp: { label: "Deux-points  :", re: /\s*:\s*/ },
};

function detecterSeparateur(lignes) {
	const candidats = ["tab", "tiret", "pv", "dp", "virgule"];
	for (const cle of candidats) {
		const re = SEPARATEURS[cle].re;
		const ok = lignes.filter((l) => re.test(l)).length;
		if (ok && ok >= lignes.length * 0.6) return cle;
	}
	return "tab";
}

function analyserImport(texte, sepCle = "auto", sepCartes = "ligne") {
	const brut = String(texte || "").replace(/\r\n?/g, "\n");
	const lignes = (sepCartes === "pv" ? brut.split(";") : brut.split("\n"))
		.map((l) => l.trim())
		.filter(Boolean);
	if (!lignes.length) return { cartes: [], sep: sepCle };
	const cle = sepCle === "auto" ? detecterSeparateur(lignes) : sepCle;
	const re = SEPARATEURS[cle].re;
	const cartes = [];
	for (const l of lignes) {
		const m = l.match(re);
		if (!m) continue;
		const recto = l.slice(0, m.index).trim();
		const verso = l.slice(m.index + m[0].length).trim();
		if (recto && verso) cartes.push([recto, verso]);
	}
	return { cartes, sep: cle };
}

const exporterTexte = (paquet) =>
	paquet.cartes.map((c) => `${c.recto.replace(/\s*\n\s*/g, " ")}\t${c.verso.replace(/\s*\n\s*/g, " ")}`).join("\n");

/* ================= Routeur ================= */
// #/                      accueil
// #/p/ID                  paquet
// #/p/ID/reviser          répétition espacée
// #/p/ID/cartes|ecrire|quiz|associer[?e=1]   entraînement (e=1 : étoilées seulement)
// #/reglages
function route() {
	const [chemin, requete = ""] = location.hash.replace(/^#/, "").split("?");
	const parts = chemin.split("/").filter(Boolean);
	const params = new URLSearchParams(requete);
	if (parts[0] === "reglages") return { vue: "reglages", cle: "reglages" };
	if (parts[0] === "p" && parts[1]) {
		const mode = parts[2] || "paquet";
		return { vue: mode, id: parts[1], etoiles: params.get("e") === "1", cle: location.hash };
	}
	return { vue: "accueil", cle: "accueil" };
}

const aller = (hash) => {
	location.hash = hash;
};

let routeCourante = null;
let session = null; // état de la séance en cours (révision, quiz…)
let clavier = null; // raccourcis clavier de la vue en cours

function render() {
	const r = route();
	if (!routeCourante || routeCourante.cle !== r.cle) {
		session = null;
		window.scrollTo(0, 0);
	}
	routeCourante = r;
	clavier = null;
	document.body.dataset.vue = r.vue;

	const app = $("#app");
	if (r.vue === "accueil") return renderAccueil(app);
	if (r.vue === "reglages") return renderReglages(app);

	const paquet = trouverPaquet(r.id);
	if (!paquet) {
		aller("#/");
		return;
	}
	document.documentElement.style.setProperty("--paquet", paquet.couleur);
	const vues = {
		paquet: renderPaquet,
		reviser: renderReviser,
		cartes: renderCartes,
		ecrire: renderEcrire,
		quiz: renderQuiz,
		associer: renderAssocier,
	};
	(vues[r.vue] || renderPaquet)(app, paquet, r);
}

/* ================= Vue : accueil ================= */
function renderAccueil(app) {
	document.documentElement.style.setProperty("--paquet", COULEURS[0]);
	const stats = state.paquets.map((p) => statsPaquet(p));
	const totalDu = stats.reduce((n, s) => n + s.aRevoir + s.nouvellesDispo, 0);
	const revuesAujourdhui = state.journal[jourCle()]?.revues || 0;
	const s = serie();

	const listePaquets = state.paquets
		.map((p, i) => {
			const st = stats[i];
			const pct = st.total ? Math.round((st.maitrisees / st.total) * 100) : 0;
			const du = st.aRevoir + st.nouvellesDispo;
			return `<button class="paquet-item" data-action="ouvrir" data-id="${p.id}" style="--c:${p.couleur}">
				<span class="paquet-pastille">${esc((p.nom.trim()[0] || "?").toUpperCase())}</span>
				<span class="paquet-corps">
					<span class="paquet-nom">${esc(p.nom)}</span>
					<span class="paquet-meta">${pluriel(st.total, "carte")} · ${pct} % maîtrisées</span>
					<span class="barre"><span style="width:${pct}%"></span></span>
				</span>
				${du ? `<span class="badge-du">${du}</span>` : `<i class="bx bx-check-circle paquet-ok"></i>`}
			</button>`;
		})
		.join("");

	app.innerHTML = `
	<header class="entete wrap">
		<div>
			<p class="surtitre">${new Date().toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}</p>
			<h1>Flashcards</h1>
		</div>
		<div class="entete-actions">
			${s ? `<span class="serie" title="Jours d'affilée"><i class="bx bxs-flame"></i>${s}</span>` : ""}
			<button class="rond" data-action="reglages" aria-label="Réglages"><i class="bx bx-cog"></i></button>
		</div>
	</header>
	<main class="wrap">
		${
			state.paquets.length
				? `<section class="resume">
				<div>
					<p class="resume-k">Aujourd'hui</p>
					<p class="resume-v">${totalDu ? `${pluriel(totalDu, "carte")} à réviser` : "Tout est à jour 🎉"}</p>
					<p class="resume-s">${revuesAujourdhui ? `${pluriel(revuesAujourdhui, "carte révisée", "cartes révisées")} aujourd'hui` : "Rien révisé pour l'instant"}</p>
				</div>
				<i class="bx bx-brain resume-ic"></i>
			</section>
			<div class="titre-section"><h2>Mes paquets</h2></div>
			<div class="liste-paquets">${listePaquets}</div>
			<button class="btn large secondaire" data-action="nouveau-paquet"><i class="bx bx-plus"></i>Nouveau paquet</button>`
				: `<section class="vide">
				<div class="vide-ill"><span></span><span></span><span></span></div>
				<h2>Crée ton premier paquet</h2>
				<p>Ajoute tes cartes à la main ou colle un export Quizlet. L'appli te fait ensuite réviser chaque carte au bon moment, juste avant que tu l'oublies.</p>
				<button class="btn large" data-action="nouveau-paquet"><i class="bx bx-plus"></i>Nouveau paquet</button>
				<button class="btn large secondaire" data-action="exemple"><i class="bx bx-play"></i>Essayer avec un paquet d'exemple</button>
			</section>`
		}
	</main>`;
}

/* ================= Vue : paquet ================= */
let recherche = "";

function renderPaquet(app, paquet) {
	const st = statsPaquet(paquet);
	const du = st.aRevoir + st.nouvellesDispo;
	const nbEtoiles = paquet.cartes.filter((c) => c.etoile).length;
	const filtreEtoiles = session?.filtreEtoiles && nbEtoiles > 0;
	session = { filtreEtoiles };
	const suffixe = filtreEtoiles ? "?e=1" : "";
	const prochaine = !du ? prochaineEcheance(paquet) : null;
	const nouvellesBloquees = !du && st.nouvelles > 0;

	const q = normaliser(recherche);
	const cartes = q
		? paquet.cartes.filter((c) => normaliser(c.recto + " " + c.verso).includes(q))
		: paquet.cartes;

	const modes = [
		{ mode: "cartes", ic: "bx-copy", nom: "Cartes", desc: "Retourner et trier" },
		{ mode: "ecrire", ic: "bx-pencil", nom: "Écrire", desc: "Taper la réponse" },
		{ mode: "quiz", ic: "bx-list-check", nom: "Quiz", desc: "Questions à choix" },
		{ mode: "associer", ic: "bx-extension", nom: "Associer", desc: "Le jeu des paires" },
	];

	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="accueil" aria-label="Retour"><i class="bx bx-chevron-left"></i></button>
		<button class="rond" data-action="options-paquet" aria-label="Options du paquet"><i class="bx bx-dots-horizontal-rounded"></i></button>
	</header>
	<main class="wrap">
		<div class="paquet-tete">
			<h1>${esc(paquet.nom)}</h1>
			<p>${pluriel(st.total, "carte")} · ${esc(LIBELLES_SENS[paquet.sens])}</p>
		</div>

		${
			st.total
				? `<section class="carte-revision">
			<div class="cr-haut">
				<div>
					<p class="cr-k"><i class="bx bx-brain"></i>Révision espacée</p>
					<p class="cr-v">${du ? `${pluriel(du, "carte")} pour aujourd'hui` : "Rien à réviser pour l'instant"}</p>
				</div>
			</div>
			<div class="compteurs">
				<span class="cpt bleu"><b>${st.nouvellesDispo}</b>nouvelles</span>
				<span class="cpt vert"><b>${st.aRevoir}</b>à revoir</span>
			</div>
			${
				du
					? `<button class="btn large" data-action="reviser"><i class="bx bx-play"></i>Commencer</button>`
					: `<p class="cr-info">${
							prochaine
								? `Prochaine révision ${quandLisible(prochaine.quand)} · ${pluriel(prochaine.n, "carte")}`
								: "Tu as vu toutes tes cartes du jour."
						}</p>
					${nouvellesBloquees ? `<button class="btn large secondaire" data-action="plus-de-nouvelles"><i class="bx bx-plus"></i>Apprendre 10 nouvelles cartes de plus</button>` : ""}`
			}
		</section>

		<div class="titre-section"><h2>S'entraîner</h2>
			${
				nbEtoiles
					? `<button class="puce${filtreEtoiles ? " on" : ""}" data-action="filtre-etoiles"><i class="bx ${filtreEtoiles ? "bxs-star" : "bx-star"}"></i>Étoilées (${nbEtoiles})</button>`
					: ""
			}
		</div>
		<div class="grille-modes">
			${modes
				.map(
					(m) => `<a class="mode" href="#/p/${paquet.id}/${m.mode}${suffixe}">
				<i class="bx ${m.ic}"></i><b>${m.nom}</b><span>${m.desc}</span></a>`,
				)
				.join("")}
		</div>

		<section class="maitrise">
			<div class="maitrise-barre">
				<span class="m-new" style="flex:${st.nouvelles}"></span>
				<span class="m-cours" style="flex:${st.enCours}"></span>
				<span class="m-ok" style="flex:${st.maitrisees}"></span>
			</div>
			<div class="maitrise-legende">
				<span><i class="pt m-new"></i>${st.nouvelles} jamais vues</span>
				<span><i class="pt m-cours"></i>${st.enCours} en cours</span>
				<span><i class="pt m-ok"></i>${st.maitrisees} maîtrisées</span>
			</div>
		</section>`
				: `<section class="vide petit">
			<h2>Ce paquet est vide</h2>
			<p>Ajoute des cartes une par une, ou colle d'un coup toute une liste (export Quizlet, tableur, notes…).</p>
		</section>`
		}

		<div class="titre-section"><h2>Cartes ${st.total ? `<span class="nb">${st.total}</span>` : ""}</h2></div>
		<div class="actions-cartes">
			<button class="btn" data-action="ajouter"><i class="bx bx-plus"></i>Ajouter</button>
			<button class="btn secondaire" data-action="importer"><i class="bx bx-import"></i>Importer</button>
		</div>
		${
			st.total > 6
				? `<label class="recherche"><i class="bx bx-search"></i><input type="search" id="recherche" placeholder="Rechercher une carte" value="${esc(recherche)}" /></label>`
				: ""
		}
		<div class="liste-cartes" id="listeCartes">${listeCartesHtml(cartes)}</div>
	</main>`;

	const champ = $("#recherche");
	if (champ) {
		champ.addEventListener("input", () => {
			recherche = champ.value;
			const q2 = normaliser(recherche);
			$("#listeCartes").innerHTML = listeCartesHtml(
				q2 ? paquet.cartes.filter((c) => normaliser(c.recto + " " + c.verso).includes(q2)) : paquet.cartes,
			);
		});
	}
}

function listeCartesHtml(cartes) {
	if (!cartes.length) return recherche ? `<p class="aucun">Aucune carte ne correspond.</p>` : "";
	return cartes
		.map(
			(c) => `<button class="ligne-carte" data-action="editer-carte" data-id="${c.id}">
			<span class="lc-recto">${esc(c.recto)}</span>
			<span class="lc-verso">${esc(c.verso)}</span>
			<span class="lc-etat ${etatVisuel(c)}" title="${titreEtat(c)}"></span>
			${c.etoile ? `<i class="bx bxs-star lc-etoile"></i>` : ""}
		</button>`,
		)
		.join("");
}

const etatVisuel = (c) =>
	c.srs.etat === "nouvelle" ? "m-new" : c.srs.etat === "revision" && c.srs.iv >= SEUIL_MAITRISE ? "m-ok" : "m-cours";
const titreEtat = (c) =>
	c.srs.etat === "nouvelle" ? "Jamais vue" : c.srs.etat === "revision" && c.srs.iv >= SEUIL_MAITRISE ? "Maîtrisée" : "En cours";

function quandLisible(t) {
	const jours = Math.round((new Date(jourCle(t)) - new Date(jourCle())) / JOUR);
	if (jours <= 1) return "demain";
	if (jours < 7) return `dans ${jours} jours`;
	return `le ${new Date(t).toLocaleDateString("fr-FR", { day: "numeric", month: "long" })}`;
}

/* ================= Vue : révision espacée ================= */
function demarrerRevision(paquet) {
	const fin = finDeJournee();
	const apprentissage = [];
	const revisions = [];
	const nouvelles = [];
	for (const c of paquet.cartes) {
		if (c.srs.etat === "nouvelle") nouvelles.push(c.id);
		else if (c.srs.due <= fin) (enApprentissage(c) ? apprentissage : revisions).push(c.id);
	}
	return {
		type: "reviser",
		apprentissage,
		revisions: melanger(revisions),
		nouvelles: nouvelles.slice(0, nouvellesRestantes(paquet)),
		courante: null,
		question: "",
		reponse: "",
		retournee: false,
		faites: 0,
		annulation: null,
		debut: Date.now(),
	};
}

function choisirSuivante(paquet, s) {
	const maintenant = Date.now();
	const appr = s.apprentissage
		.map((id) => trouverCarte(paquet, id))
		.filter(Boolean)
		.sort((a, b) => a.srs.due - b.srs.due);
	// 1. une carte en apprentissage dont l'heure est venue
	if (appr.length && appr[0].srs.due <= maintenant) return appr[0].id;
	// 2. révisions et nouvelles, avec une nouvelle toutes les 3 cartes
	const prendreNouvelle = s.nouvelles.length && (!s.revisions.length || s.faites % 3 === 2);
	if (prendreNouvelle) return s.nouvelles[0];
	if (s.revisions.length) return s.revisions[0];
	if (s.nouvelles.length) return s.nouvelles[0];
	// 3. il ne reste que des cartes en apprentissage : on les avance
	if (appr.length) return appr[0].id;
	return null;
}

function preparerCarte(paquet, s) {
	s.courante = choisirSuivante(paquet, s);
	s.retournee = false;
	if (!s.courante) return;
	const carte = trouverCarte(paquet, s.courante);
	const f = faces(carte, paquet.sens);
	s.question = f.question;
	s.reponse = f.reponse;
}

function renderReviser(app, paquet) {
	if (!session || session.type !== "reviser") {
		session = demarrerRevision(paquet);
		preparerCarte(paquet, session);
	}
	const s = session;
	const carte = s.courante && trouverCarte(paquet, s.courante);

	if (!carte) return renderFinRevision(app, paquet, s);

	const nbAppr = s.apprentissage.length;
	const type = s.nouvelles.includes(carte.id) ? "bleu" : enApprentissage(carte) ? "rouge" : "vert";
	const maintenant = Date.now();

	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="retour-paquet" aria-label="Quitter"><i class="bx bx-x"></i></button>
		<div class="compteurs-mini">
			<span class="cpt-m bleu${type === "bleu" ? " actif" : ""}">${s.nouvelles.length}</span>
			<span class="cpt-m rouge${type === "rouge" ? " actif" : ""}">${nbAppr}</span>
			<span class="cpt-m vert${type === "vert" ? " actif" : ""}">${s.revisions.length}</span>
		</div>
		<button class="rond" data-action="annuler-note" aria-label="Annuler la dernière note" ${s.annulation ? "" : "disabled"}><i class="bx bx-undo"></i></button>
	</header>
	<main class="wrap etude">
		<div class="carte-etude ${s.retournee ? "ouverte" : ""}" data-action="retourner">
			<button class="etoile-btn" data-action="etoile" data-id="${carte.id}" aria-label="Étoile"><i class="bx ${carte.etoile ? "bxs-star" : "bx-star"}"></i></button>
			<div class="ce-question ${tailleTexte(s.question)}">${esc(s.question)}</div>
			${
				s.retournee
					? `<div class="ce-sep"></div><div class="ce-reponse ${tailleTexte(s.reponse)}">${esc(s.reponse)}</div>`
					: `<p class="ce-aide">Touche la carte pour voir la réponse</p>`
			}
		</div>
		<div class="zone-notes">
			${
				s.retournee
					? `<p class="notes-aide">Tu t'en souvenais ?</p><div class="notes">${NOTES.map((n) => {
							const apres = planifier(carte.srs, n.note, maintenant, { flou: false });
							return `<button class="note ${n.cls}" data-action="noter" data-note="${n.note}">
							<b>${n.label}</b><span>${formatDelai(apres.due - maintenant)}</span></button>`;
						}).join("")}</div>`
					: `<button class="btn large" data-action="retourner"><i class="bx bx-show"></i>Voir la réponse</button>`
			}
		</div>
	</main>`;

	clavier = (e) => {
		if (!s.retournee && (e.key === " " || e.key === "Enter")) return actions.retourner(), true;
		if (s.retournee && ["1", "2", "3", "4"].includes(e.key)) return noter(paquet, +e.key), true;
		if (s.retournee && (e.key === " " || e.key === "Enter")) return noter(paquet, 3), true;
		if (e.key === "z" || e.key === "Backspace") return actions["annuler-note"](), true;
		return false;
	};
}

function noter(paquet, note) {
	const s = session;
	const carte = trouverCarte(paquet, s.courante);
	if (!carte || !s.retournee) return;
	const etaitNouvelle = carte.srs.etat === "nouvelle";

	s.annulation = {
		carteId: carte.id,
		srs: { ...carte.srs },
		listes: {
			apprentissage: [...s.apprentissage],
			revisions: [...s.revisions],
			nouvelles: [...s.nouvelles],
		},
		nouvellesDuJour: { ...paquet.nouvellesDuJour },
		journal: { ...(state.journal[jourCle()] || {}) },
		faites: s.faites,
	};

	carte.srs = planifier(carte.srs, note);
	if (etaitNouvelle) {
		const nd = paquet.nouvellesDuJour;
		if (nd.jour !== jourCle()) Object.assign(nd, { jour: jourCle(), n: 0, bonus: 0 });
		nd.n++;
		s.nouvelles = s.nouvelles.filter((id) => id !== carte.id);
	}
	s.revisions = s.revisions.filter((id) => id !== carte.id);
	s.apprentissage = s.apprentissage.filter((id) => id !== carte.id);
	if (enApprentissage(carte) && carte.srs.due <= finDeJournee()) s.apprentissage.push(carte.id);

	s.faites++;
	noterJournal("revues");
	sauver();
	vibrer(note === 1 ? 20 : 8);
	preparerCarte(paquet, s);
	render();
}

function renderFinRevision(app, paquet, s) {
	const prochaine = prochaineEcheance(paquet);
	const st = statsPaquet(paquet);
	const duree = Math.max(1, Math.round((Date.now() - s.debut) / MIN));
	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="retour-paquet" aria-label="Retour"><i class="bx bx-x"></i></button>
	</header>
	<main class="wrap fin">
		<div class="fin-ic">🎉</div>
		<h1>${s.faites ? "Séance terminée !" : "Rien à réviser"}</h1>
		<p>${
			s.faites
				? `${pluriel(s.faites, "réponse")} en ${duree} min. ${serie() > 1 ? `Ça fait ${serie()} jours d'affilée 🔥` : ""}`
				: "Toutes les cartes de ce paquet sont à jour."
		}</p>
		${prochaine ? `<p class="fin-prochaine"><i class="bx bx-calendar"></i>Prochaine révision ${quandLisible(prochaine.quand)} · ${pluriel(prochaine.n, "carte")}</p>` : ""}
		<div class="fin-actions">
			${st.nouvelles ? `<button class="btn large secondaire" data-action="plus-de-nouvelles"><i class="bx bx-plus"></i>Apprendre 10 nouvelles cartes de plus</button>` : ""}
			<a class="btn large secondaire" href="#/p/${paquet.id}/cartes"><i class="bx bx-copy"></i>S'entraîner quand même</a>
			<button class="btn large" data-action="retour-paquet">Retour au paquet</button>
		</div>
	</main>`;
	if (s.faites) s.annulation = null;
}

/* ================= Entraînement : choix des cartes ================= */
function cartesEntrainement(paquet, r) {
	const cartes = r.etoiles ? paquet.cartes.filter((c) => c.etoile) : paquet.cartes;
	return cartes.length ? cartes : paquet.cartes;
}

function enteteEntrainement(titre, progres) {
	return `<header class="barre-haut wrap">
		<button class="rond" data-action="retour-paquet" aria-label="Quitter"><i class="bx bx-x"></i></button>
		<div class="titre-mode">${titre}</div>
		<button class="rond" data-action="recommencer" aria-label="Recommencer"><i class="bx bx-revision"></i></button>
	</header>
	${progres !== undefined ? `<div class="progres wrap"><span style="width:${Math.round(progres * 100)}%"></span></div>` : ""}`;
}

function finEntrainement(app, { titre, texte, liste = [], boutons }) {
	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="retour-paquet" aria-label="Retour"><i class="bx bx-x"></i></button>
	</header>
	<main class="wrap fin">
		<div class="fin-ic">${titre.ic}</div>
		<h1>${titre.texte}</h1>
		<p>${texte}</p>
		${
			liste.length
				? `<div class="fin-liste"><p class="fin-liste-k">À retravailler</p>${liste
						.map((c) => `<div class="fin-ligne"><b>${esc(c.recto)}</b><span>${esc(c.verso)}</span></div>`)
						.join("")}</div>`
				: ""
		}
		<div class="fin-actions">${boutons}</div>
	</main>`;
}

/* ================= Mode Cartes (retourner et trier) ================= */
function renderCartes(app, paquet, r) {
	if (!session || session.type !== "cartes") {
		const ids = (session?.ids || cartesEntrainement(paquet, r).map((c) => c.id));
		session = { type: "cartes", ids, index: 0, retournee: false, sais: [], revoir: [], faces: {}, melange: !!session?.melange };
	}
	const s = session;

	if (s.index >= s.ids.length) {
		const revoir = s.revoir.map((id) => trouverCarte(paquet, id)).filter(Boolean);
		return finEntrainement(app, {
			titre: revoir.length ? { ic: "💪", texte: "Tour terminé" } : { ic: "🎉", texte: "Tu sais tout !" },
			texte: `${s.sais.length} sues · ${revoir.length} à revoir`,
			liste: revoir,
			boutons: `${revoir.length ? `<button class="btn large" data-action="cartes-revoir"><i class="bx bx-revision"></i>Revoir les ${pluriel(revoir.length, "carte")}</button>` : ""}
				<button class="btn large secondaire" data-action="recommencer"><i class="bx bx-shuffle"></i>Tout recommencer</button>
				<button class="btn large secondaire" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}

	const carte = trouverCarte(paquet, s.ids[s.index]);
	if (!carte) {
		s.index++;
		return render();
	}
	if (!s.faces[carte.id]) s.faces[carte.id] = faces(carte, paquet.sens);
	const f = s.faces[carte.id];

	app.innerHTML = `
	${enteteEntrainement(`Cartes <span>${s.index + 1} / ${s.ids.length}</span>`, s.index / s.ids.length)}
	<main class="wrap etude">
		<div class="tri-compteurs"><span class="tc rouge">${s.revoir.length} à revoir</span><span class="tc vert">${s.sais.length} sues</span></div>
		<div class="flip ${s.retournee ? "retournee" : ""}" id="flip" data-action="retourner-flip">
			<div class="flip-face recto">
				<button class="etoile-btn" data-action="etoile" data-id="${carte.id}" aria-label="Étoile"><i class="bx ${carte.etoile ? "bxs-star" : "bx-star"}"></i></button>
				<div class="${tailleTexte(f.question)}">${esc(f.question)}</div>
				<p class="ce-aide">Touche pour retourner</p>
			</div>
			<div class="flip-face verso">
				<div class="${tailleTexte(f.reponse)}">${esc(f.reponse)}</div>
			</div>
		</div>
		<div class="tri-boutons">
			<button class="tri rouge" data-action="trier" data-sait="0" aria-label="À revoir"><i class="bx bx-x"></i><span>À revoir</span></button>
			<button class="tri neutre" data-action="tri-annuler" aria-label="Carte précédente" ${s.index ? "" : "disabled"}><i class="bx bx-undo"></i></button>
			<button class="tri vert" data-action="trier" data-sait="1" aria-label="Je sais"><i class="bx bx-check"></i><span>Je sais</span></button>
		</div>
		<p class="astuce">Glisse la carte à droite si tu sais, à gauche sinon</p>
	</main>`;

	activerGlisser($("#flip"), (sens) => trier(sens > 0));

	clavier = (e) => {
		if (e.key === " " || e.key === "Enter" || e.key === "ArrowUp" || e.key === "ArrowDown") return actions["retourner-flip"](), true;
		if (e.key === "ArrowRight") return trier(true), true;
		if (e.key === "ArrowLeft") return trier(false), true;
		if (e.key === "z" || e.key === "Backspace") return actions["tri-annuler"](), true;
		return false;
	};
}

function trier(sait) {
	const s = session;
	if (!s || s.type !== "cartes" || s.index >= s.ids.length) return;
	const id = s.ids[s.index];
	(sait ? s.sais : s.revoir).push(id);
	s.index++;
	s.retournee = false;
	vibrer(sait ? 8 : 15);
	render();
}

// Glisser une carte à gauche / à droite (mobile)
function activerGlisser(el, surGlisse) {
	if (!el) return;
	let x0 = null;
	let y0 = null;
	let dx = 0;
	el.addEventListener(
		"touchstart",
		(e) => {
			x0 = e.touches[0].clientX;
			y0 = e.touches[0].clientY;
			dx = 0;
			el.style.transition = "none";
		},
		{ passive: true },
	);
	el.addEventListener(
		"touchmove",
		(e) => {
			if (x0 === null) return;
			dx = e.touches[0].clientX - x0;
			const dy = e.touches[0].clientY - y0;
			if (Math.abs(dx) > Math.abs(dy)) {
				el.style.translate = `${dx}px 0`;
				el.style.rotate = `${dx / 25}deg`;
				el.dataset.glisse = dx > 40 ? "droite" : dx < -40 ? "gauche" : "";
			}
		},
		{ passive: true },
	);
	el.addEventListener("touchend", () => {
		el.style.transition = "";
		el.style.translate = "";
		el.style.rotate = "";
		el.dataset.glisse = "";
		if (Math.abs(dx) > 80) {
			el.dataset.vientDeGlisser = "1";
			surGlisse(dx);
		}
		x0 = null;
	});
}

/* ================= Mode Écrire ================= */
function verifierReponse(tape, attendu) {
	const a = normaliser(tape);
	const b = normaliser(attendu);
	if (!a) return { ok: false };
	if (a === b) {
		const exact = tape.trim().toLowerCase() === attendu.trim().toLowerCase();
		return { ok: true, note: exact ? "" : "Attention aux accents ou à la ponctuation." };
	}
	// Plusieurs réponses acceptées : « chat / matou »
	const variantes = String(attendu).split(/\s*[/|]\s*/).map(normaliser).filter(Boolean);
	if (variantes.length > 1 && variantes.includes(a)) return { ok: true, note: "" };
	const tolerance = b.length >= 10 ? 2 : b.length >= 4 ? 1 : 0;
	if (tolerance && levenshtein(a, b) <= tolerance) return { ok: true, note: "Presque : petite faute de frappe." };
	return { ok: false };
}

function renderEcrire(app, paquet, r) {
	if (!session || session.type !== "ecrire") {
		const ids = melanger(session?.ids || cartesEntrainement(paquet, r).map((c) => c.id));
		session = { type: "ecrire", file: ids, total: ids.length, justes: 0, ratees: new Set(), resultat: null, faces: {}, tape: "" };
	}
	const s = session;

	if (!s.file.length) {
		const ratees = [...s.ratees].map((id) => trouverCarte(paquet, id)).filter(Boolean);
		const premierCoup = s.total - ratees.length;
		return finEntrainement(app, {
			titre: { ic: ratees.length ? "✍️" : "🎉", texte: ratees.length ? "Terminé !" : "Sans faute !" },
			texte: `${premierCoup} / ${s.total} du premier coup`,
			liste: ratees,
			boutons: `${ratees.length ? `<button class="btn large" data-action="ecrire-ratees"><i class="bx bx-revision"></i>Refaire les ${pluriel(ratees.length, "erreur")}</button>` : ""}
				<button class="btn large secondaire" data-action="recommencer"><i class="bx bx-shuffle"></i>Tout recommencer</button>
				<button class="btn large secondaire" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}

	const carte = trouverCarte(paquet, s.file[0]);
	if (!carte) {
		s.file.shift();
		return render();
	}
	if (!s.faces[carte.id]) s.faces[carte.id] = faces(carte, paquet.sens);
	const f = s.faces[carte.id];
	const res = s.resultat;

	app.innerHTML = `
	${enteteEntrainement(`Écrire <span>${s.justes} / ${s.total}</span>`, s.justes / s.total)}
	<main class="wrap etude">
		<div class="carte-etude statique">
			<button class="etoile-btn" data-action="etoile" data-id="${carte.id}" aria-label="Étoile"><i class="bx ${carte.etoile ? "bxs-star" : "bx-star"}"></i></button>
			<div class="ce-question ${tailleTexte(f.question)}">${esc(f.question)}</div>
		</div>
		${
			res
				? `<div class="retour ${res.ok ? "ok" : "ko"}">
				<p class="retour-titre"><i class="bx ${res.ok ? "bx-check-circle" : "bx-x-circle"}"></i>${res.ok ? "Correct !" : res.passe ? "La réponse était" : "Pas tout à fait"}</p>
				${res.note ? `<p class="retour-note">${esc(res.note)}</p>` : ""}
				${!res.ok && !res.passe ? `<p class="retour-k">Ta réponse</p><p class="retour-tape">${esc(res.tape)}</p><p class="retour-k">Bonne réponse</p>` : ""}
				${!res.ok || res.note ? `<p class="retour-bonne">${esc(f.reponse)}</p>` : ""}
			</div>
			<div class="ecrire-actions">
				${!res.ok && !res.passe ? `<button class="btn secondaire" data-action="ecrire-javais-bon">J'avais bon</button>` : ""}
				<button class="btn large" data-action="ecrire-suivante" id="btnSuivante">Continuer<i class="bx bx-right-arrow-alt"></i></button>
			</div>`
				: `<form class="ecrire-form" id="formEcrire" autocomplete="off">
				<textarea id="champReponse" rows="2" placeholder="Ta réponse" autocapitalize="off" autocorrect="off" spellcheck="false">${esc(s.tape)}</textarea>
				<div class="ecrire-actions">
					<button type="button" class="btn secondaire" data-action="ecrire-passer">Je ne sais pas</button>
					<button type="submit" class="btn large">Valider</button>
				</div>
			</form>`
		}
	</main>`;

	const champ = $("#champReponse");
	if (champ) {
		champ.focus();
		champ.addEventListener("input", () => (s.tape = champ.value));
		champ.addEventListener("keydown", (e) => {
			if (e.key === "Enter" && !e.shiftKey) {
				e.preventDefault();
				$("#formEcrire").requestSubmit();
			}
		});
		$("#formEcrire").addEventListener("submit", (e) => {
			e.preventDefault();
			const tape = champ.value;
			if (!tape.trim()) return champ.focus();
			const v = verifierReponse(tape, f.reponse);
			s.resultat = { ...v, tape };
			if (!v.ok) s.ratees.add(carte.id);
			vibrer(v.ok ? 8 : 25);
			render();
		});
	} else {
		$("#btnSuivante")?.focus();
	}

	clavier = (e) => {
		if (s.resultat && e.key === "Enter") return actions["ecrire-suivante"](), true;
		return false;
	};
}

/* ================= Mode Quiz (QCM) ================= */
function preparerQuiz(paquet, cartes) {
	const toutes = paquet.cartes;
	const questions = melanger(cartes)
		.slice(0, 20)
		.map((carte) => {
			const f = faces(carte, paquet.sens);
			const inverse = f.question === carte.verso && f.question !== carte.recto;
			const bonne = f.reponse;
			const vus = new Set([normaliser(bonne)]);
			const leurres = [];
			for (const autre of melanger(toutes)) {
				if (autre.id === carte.id) continue;
				const t = inverse ? autre.recto : autre.verso;
				const n = normaliser(t);
				if (!n || vus.has(n)) continue;
				vus.add(n);
				leurres.push(t);
				if (leurres.length === 3) break;
			}
			const choix = melanger([bonne, ...leurres]);
			return { carteId: carte.id, question: f.question, choix, bonne: choix.indexOf(bonne) };
		});
	return { type: "quiz", questions, i: 0, choisi: null, erreurs: [], cartesIds: cartes.map((c) => c.id) };
}

function renderQuiz(app, paquet, r) {
	const distinctes = new Set(paquet.cartes.map((c) => normaliser(c.verso))).size;
	if (paquet.cartes.length < 2 || distinctes < 2) {
		return finEntrainement(app, {
			titre: { ic: "🤏", texte: "Pas assez de cartes" },
			texte: "Il faut au moins 2 cartes avec des réponses différentes pour faire un quiz (4 c'est mieux).",
			boutons: `<button class="btn large" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}
	if (!session || session.type !== "quiz") {
		const cartes = session?.ids
			? session.ids.map((id) => trouverCarte(paquet, id)).filter(Boolean)
			: cartesEntrainement(paquet, r);
		session = preparerQuiz(paquet, cartes);
	}
	const s = session;

	if (s.i >= s.questions.length) {
		const erreurs = s.erreurs.map((id) => trouverCarte(paquet, id)).filter(Boolean);
		const score = s.questions.length - erreurs.length;
		const pct = Math.round((score / s.questions.length) * 100);
		return finEntrainement(app, {
			titre: { ic: pct === 100 ? "🏆" : pct >= 70 ? "👏" : "📚", texte: `${score} / ${s.questions.length}` },
			texte: `${pct} % de bonnes réponses`,
			liste: erreurs,
			boutons: `${erreurs.length ? `<button class="btn large" data-action="quiz-erreurs"><i class="bx bx-revision"></i>Retravailler les erreurs</button>` : ""}
				<button class="btn large secondaire" data-action="recommencer"><i class="bx bx-shuffle"></i>Nouveau quiz</button>
				<button class="btn large secondaire" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}

	const q = s.questions[s.i];
	const repondu = s.choisi !== null;
	app.innerHTML = `
	${enteteEntrainement(`Quiz <span>${s.i + 1} / ${s.questions.length}</span>`, s.i / s.questions.length)}
	<main class="wrap etude">
		<div class="carte-etude statique">
			<div class="ce-question ${tailleTexte(q.question)}">${esc(q.question)}</div>
		</div>
		<div class="choix">
			${q.choix
				.map((c, i) => {
					let cls = "";
					if (repondu && i === q.bonne) cls = "bon";
					else if (repondu && i === s.choisi) cls = "faux";
					else if (repondu) cls = "eteint";
					return `<button class="choix-btn ${cls}" data-action="quiz-choisir" data-i="${i}" ${repondu ? "disabled" : ""}>
					<span class="choix-n">${i + 1}</span><span>${esc(c)}</span></button>`;
				})
				.join("")}
		</div>
		${repondu && s.choisi !== q.bonne ? `<button class="btn large" data-action="quiz-suivante" id="btnSuivante">Continuer<i class="bx bx-right-arrow-alt"></i></button>` : ""}
	</main>`;
	$("#btnSuivante")?.focus();

	clavier = (e) => {
		if (!repondu && /^[1-4]$/.test(e.key) && +e.key <= q.choix.length) return choisirQuiz(+e.key - 1), true;
		if (repondu && e.key === "Enter") return actions["quiz-suivante"](), true;
		return false;
	};
}

function choisirQuiz(i) {
	const s = session;
	const q = s.questions[s.i];
	if (s.choisi !== null) return;
	s.choisi = i;
	const juste = i === q.bonne;
	if (!juste) s.erreurs.push(q.carteId);
	vibrer(juste ? 8 : 25);
	render();
	if (juste) {
		const iAttendu = s.i;
		setTimeout(() => {
			if (session === s && s.i === iAttendu) actions["quiz-suivante"]();
		}, 650);
	}
}

/* ================= Mode Associer ================= */
const PAIRES_ASSOCIER = 6;

function renderAssocier(app, paquet, r) {
	const cartes = cartesEntrainement(paquet, r);
	if (cartes.length < 2) {
		return finEntrainement(app, {
			titre: { ic: "🤏", texte: "Pas assez de cartes" },
			texte: "Il faut au moins 2 cartes pour jouer.",
			boutons: `<button class="btn large" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}
	if (!session || session.type !== "associer") {
		const choisies = melanger(cartes).slice(0, PAIRES_ASSOCIER);
		const tuiles = melanger(
			choisies.flatMap((c) => [
				{ cle: c.id + ":r", carte: c.id, texte: c.recto },
				{ cle: c.id + ":v", carte: c.id, texte: c.verso },
			]),
		);
		session = { type: "associer", tuiles, trouvees: new Set(), selection: null, erreur: null, debut: Date.now(), penalite: 0, fin: null };
	}
	const s = session;

	if (s.fin) {
		const temps = s.fin - s.debut + s.penalite;
		const record = paquet.meilleurAssocier;
		const nouveauRecord = !record || temps < record;
		if (nouveauRecord && !s.recordEnregistre) {
			paquet.meilleurAssocier = temps;
			s.recordEnregistre = true;
			sauver();
		}
		return finEntrainement(app, {
			titre: { ic: nouveauRecord ? "🏆" : "⏱️", texte: formatChrono(temps) },
			texte: nouveauRecord ? "Nouveau record !" : `Record : ${formatChrono(record)}`,
			boutons: `<button class="btn large" data-action="recommencer"><i class="bx bx-revision"></i>Rejouer</button>
				<button class="btn large secondaire" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}

	app.innerHTML = `
	${enteteEntrainement(`Associer <span id="chrono">0,0 s</span>`)}
	<main class="wrap etude">
		<p class="astuce haut">Touche un terme puis sa définition</p>
		<div class="tuiles">
			${s.tuiles
				.map((t) => {
					const cls = s.trouvees.has(t.carte)
						? "trouvee"
						: s.erreur?.includes(t.cle)
							? "erreur"
							: s.selection === t.cle
								? "choisie"
								: "";
					return `<button class="tuile ${cls}" data-action="associer" data-cle="${t.cle}" ${s.trouvees.has(t.carte) ? "disabled" : ""}>${esc(t.texte)}</button>`;
				})
				.join("")}
		</div>
		${s.penalite ? `<p class="astuce">+${s.penalite / 1000} s de pénalité</p>` : ""}
	</main>`;

	clearInterval(s.timer);
	s.timer = setInterval(() => {
		const el = $("#chrono");
		if (!el || session !== s) return clearInterval(s.timer);
		el.textContent = formatChrono(Date.now() - s.debut + s.penalite);
	}, 100);
}

function associer(cle) {
	const s = session;
	const tuile = s.tuiles.find((t) => t.cle === cle);
	if (!tuile || s.trouvees.has(tuile.carte)) return;
	if (!s.selection || s.selection === cle) {
		s.selection = s.selection === cle ? null : cle;
		s.erreur = null;
		return render();
	}
	const autre = s.tuiles.find((t) => t.cle === s.selection);
	if (autre.carte === tuile.carte) {
		s.trouvees.add(tuile.carte);
		s.selection = null;
		vibrer(8);
		if (s.trouvees.size === s.tuiles.length / 2) {
			s.fin = Date.now();
			clearInterval(s.timer);
		}
	} else {
		s.erreur = [cle, s.selection];
		s.selection = null;
		s.penalite += 1000;
		vibrer(30);
		setTimeout(() => {
			if (session === s && s.erreur) {
				s.erreur = null;
				render();
			}
		}, 500);
	}
	render();
}

/* ================= Vue : réglages ================= */
function renderReglages(app) {
	document.documentElement.style.setProperty("--paquet", COULEURS[0]);
	const nbCartes = state.paquets.reduce((n, p) => n + p.cartes.length, 0);
	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="accueil" aria-label="Retour"><i class="bx bx-chevron-left"></i></button>
		<div class="titre-mode">Réglages</div>
		<span class="rond fantome"></span>
	</header>
	<main class="wrap">
		<section class="bloc">
			<h2>Révision</h2>
			<div class="reglage">
				<div><b>Nouvelles cartes par jour</b><span>Par paquet. Moins = révisions plus légères les jours suivants.</span></div>
				<div class="stepper">
					<button class="rond petit" data-action="nouvelles-moins" aria-label="Moins"><i class="bx bx-minus"></i></button>
					<b>${state.reglages.nouvellesParJour}</b>
					<button class="rond petit" data-action="nouvelles-plus" aria-label="Plus"><i class="bx bx-plus"></i></button>
				</div>
			</div>
		</section>

		<section class="bloc">
			<h2>Sauvegarde</h2>
			<p class="bloc-texte">Tes cartes sont enregistrées uniquement sur cet appareil (${pluriel(state.paquets.length, "paquet")}, ${pluriel(nbCartes, "carte")}). Exporte une sauvegarde de temps en temps, ou pour passer sur un autre téléphone.</p>
			<div class="pile">
				<button class="btn large secondaire" data-action="sauvegarde-exporter"><i class="bx bx-download"></i>Exporter une sauvegarde</button>
				<label class="btn large secondaire"><i class="bx bx-upload"></i>Importer une sauvegarde<input type="file" id="fichierSauvegarde" accept=".json,application/json" hidden /></label>
				<button class="btn large danger" data-action="tout-effacer"><i class="bx bx-trash"></i>Tout effacer</button>
			</div>
		</section>

		<section class="bloc">
			<h2>Comment ça marche ?</h2>
			<div class="bloc-texte explications">
				<p><b>Réviser</b> utilise la répétition espacée. Après chaque carte, dis si tu t'en souvenais. Une carte bien sue revient de plus en plus tard (1 jour, 3 jours, 1 semaine, 1 mois…). Une carte oubliée revient tout de suite. Tu révises donc surtout ce que tu es en train d'oublier.</p>
				<p><b>Conseil :</b> fais tes révisions tous les jours, même 5 minutes. C'est la régularité qui fait tout.</p>
				<p><b>Cartes, Écrire, Quiz et Associer</b> sont des entraînements libres pour la veille d'un examen. Ils ne changent pas le planning des révisions.</p>
				<p><b>Raccourcis clavier :</b> espace pour retourner, 1 à 4 pour noter, flèches pour trier, Z pour annuler.</p>
			</div>
		</section>
	</main>`;

	$("#fichierSauvegarde").addEventListener("change", async (e) => {
		const fichier = e.target.files?.[0];
		e.target.value = "";
		if (!fichier) return;
		try {
			const donnees = reparer(JSON.parse(await fichier.text()));
			if (!donnees.paquets.length) throw new Error("vide");
			const existants = new Set(state.paquets.map((p) => p.id));
			const remplaces = donnees.paquets.filter((p) => existants.has(p.id)).length;
			confirmer({
				titre: "Importer la sauvegarde ?",
				texte: `${pluriel(donnees.paquets.length, "paquet")} trouvés.${remplaces ? ` ${pluriel(remplaces, "paquet")} déjà présent${remplaces > 1 ? "s" : ""} sera remplacé${remplaces > 1 ? "s" : ""}.` : ""} Tes autres paquets sont conservés.`,
				bouton: "Importer",
				surOk: () => {
					for (const p of donnees.paquets) {
						const i = state.paquets.findIndex((x) => x.id === p.id);
						if (i >= 0) state.paquets[i] = p;
						else state.paquets.push(p);
					}
					for (const [j, v] of Object.entries(donnees.journal)) {
						state.journal[j] = { revues: Math.max(state.journal[j]?.revues || 0, v.revues || 0) };
					}
					sauver();
					toast("Sauvegarde importée");
					render();
				},
			});
		} catch {
			toast("Ce fichier n'est pas une sauvegarde valide");
		}
	});
}

/* ================= Feuilles (panneaux du bas) ================= */
function ouvrirFeuille(html, { surOuvrir } = {}) {
	const f = $("#feuille");
	f.innerHTML = `<div class="feuille-poignee"></div>${html}`;
	$("#feuilleFond").classList.add("ouvert");
	document.body.classList.add("feuille-ouverte");
	surOuvrir?.(f);
}

function fermerFeuille() {
	$("#feuilleFond").classList.remove("ouvert");
	document.body.classList.remove("feuille-ouverte");
}

function confirmer({ titre, texte, bouton, danger = false, surOk }) {
	ouvrirFeuille(
		`<h2>${titre}</h2><p class="feuille-texte">${texte}</p>
		<div class="pile">
			<button class="btn large ${danger ? "danger plein" : ""}" id="confOk">${bouton}</button>
			<button class="btn large secondaire" data-action="fermer">Annuler</button>
		</div>`,
		{
			surOuvrir: () =>
				$("#confOk").addEventListener("click", () => {
					fermerFeuille();
					surOk();
				}),
		},
	);
}

function choixCouleursHtml(actuelle) {
	return `<div class="couleurs">${COULEURS.map(
		(c) =>
			`<label class="couleur" style="--c:${c}"><input type="radio" name="couleur" value="${c}" ${c === actuelle ? "checked" : ""} /><span></span></label>`,
	).join("")}</div>`;
}

function choixSensHtml(actuel) {
	return `<div class="segments">${Object.entries(LIBELLES_SENS)
		.map(
			([v, l]) =>
				`<label><input type="radio" name="sens" value="${v}" ${v === actuel ? "checked" : ""} /><span>${l}</span></label>`,
		)
		.join("")}</div>`;
}

function feuilleNouveauPaquet() {
	const couleur = COULEURS[state.paquets.length % COULEURS.length];
	ouvrirFeuille(
		`<h2>Nouveau paquet</h2>
		<form id="formPaquet">
			<label class="champ"><span>Nom</span><input id="nomPaquet" required maxlength="80" placeholder="Ex. : Anatomie — chapitre 3" /></label>
			<p class="champ-k">Couleur</p>
			${choixCouleursHtml(couleur)}
			<div class="pile">
				<button class="btn large" type="submit">Créer</button>
				<button class="btn large secondaire" type="button" data-action="fermer">Annuler</button>
			</div>
		</form>`,
		{
			surOuvrir: () => {
				$("#nomPaquet").focus();
				$("#formPaquet").addEventListener("submit", (e) => {
					e.preventDefault();
					const p = nouveauPaquet($("#nomPaquet").value, new FormData(e.target).get("couleur"));
					state.paquets.push(p);
					sauver();
					fermerFeuille();
					aller(`#/p/${p.id}`);
				});
			},
		},
	);
}

function feuilleOptionsPaquet(paquet) {
	ouvrirFeuille(
		`<h2>Options du paquet</h2>
		<form id="formOptions">
			<label class="champ"><span>Nom</span><input id="nomPaquet" required maxlength="80" value="${esc(paquet.nom)}" /></label>
			<p class="champ-k">Couleur</p>
			${choixCouleursHtml(paquet.couleur)}
			<p class="champ-k">Sens des questions</p>
			${choixSensHtml(paquet.sens)}
			<button class="btn large" type="submit">Enregistrer</button>
		</form>
		<div class="feuille-sep"></div>
		<div class="pile">
			<button class="btn large secondaire" data-action="exporter"><i class="bx bx-export"></i>Exporter les cartes (texte)</button>
			<button class="btn large secondaire" data-action="reinitialiser"><i class="bx bx-reset"></i>Remettre la progression à zéro</button>
			<button class="btn large danger" data-action="supprimer-paquet"><i class="bx bx-trash"></i>Supprimer le paquet</button>
		</div>`,
		{
			surOuvrir: () => {
				$("#formOptions").addEventListener("submit", (e) => {
					e.preventDefault();
					const d = new FormData(e.target);
					paquet.nom = $("#nomPaquet").value.trim() || paquet.nom;
					paquet.couleur = d.get("couleur") || paquet.couleur;
					paquet.sens = d.get("sens") || paquet.sens;
					sauver();
					fermerFeuille();
					render();
				});
			},
		},
	);
}

function feuilleAjouter(paquet) {
	let ajoutees = 0;
	ouvrirFeuille(
		`<h2>Ajouter des cartes</h2>
		<form id="formAjout">
			<label class="champ"><span>Terme (recto)</span><textarea id="recto" rows="2" required></textarea></label>
			<label class="champ"><span>Définition (verso)</span><textarea id="verso" rows="3" required></textarea></label>
			<p class="feuille-aide" id="ajoutInfo">La feuille reste ouverte pour enchaîner les cartes.</p>
			<div class="pile">
				<button class="btn large" type="submit"><i class="bx bx-plus"></i>Ajouter la carte</button>
				<button class="btn large secondaire" type="button" data-action="fermer">Terminé</button>
			</div>
		</form>`,
		{
			surOuvrir: () => {
				const recto = $("#recto");
				const verso = $("#verso");
				recto.focus();
				const valider = () => {
					if (!recto.value.trim() || !verso.value.trim()) {
						(recto.value.trim() ? verso : recto).focus();
						return;
					}
					paquet.cartes.push(nouvelleCarte(recto.value, verso.value));
					sauver();
					ajoutees++;
					$("#ajoutInfo").textContent = `✓ ${pluriel(ajoutees, "carte ajoutée", "cartes ajoutées")}`;
					recto.value = "";
					verso.value = "";
					recto.focus();
					render();
				};
				$("#formAjout").addEventListener("submit", (e) => {
					e.preventDefault();
					valider();
				});
				// Entrée dans le recto passe au verso, Entrée dans le verso ajoute
				// (Maj + Entrée pour aller à la ligne)
				recto.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						verso.focus();
					}
				});
				verso.addEventListener("keydown", (e) => {
					if (e.key === "Enter" && !e.shiftKey) {
						e.preventDefault();
						valider();
					}
				});
			},
		},
	);
}

function feuilleEditerCarte(paquet, carte) {
	ouvrirFeuille(
		`<h2>Modifier la carte</h2>
		<form id="formCarte">
			<label class="champ"><span>Terme (recto)</span><textarea id="recto" rows="2" required>${esc(carte.recto)}</textarea></label>
			<label class="champ"><span>Définition (verso)</span><textarea id="verso" rows="3" required>${esc(carte.verso)}</textarea></label>
			<label class="case"><input type="checkbox" id="etoile" ${carte.etoile ? "checked" : ""} /><span><i class="bx bxs-star"></i>Carte étoilée</span></label>
			<p class="feuille-aide">${titreEtat(carte)}${carte.srs.etat !== "nouvelle" ? ` · revue ${pluriel(carte.srs.reps, "fois", "fois")} · oubliée ${pluriel(carte.srs.oublis || 0, "fois", "fois")}` : ""}</p>
			<div class="pile">
				<button class="btn large" type="submit">Enregistrer</button>
				<button class="btn large danger" type="button" id="suppCarte"><i class="bx bx-trash"></i>Supprimer</button>
			</div>
		</form>`,
		{
			surOuvrir: () => {
				$("#formCarte").addEventListener("submit", (e) => {
					e.preventDefault();
					const recto = $("#recto").value.trim();
					const verso = $("#verso").value.trim();
					if (!recto || !verso) return;
					carte.recto = recto;
					carte.verso = verso;
					carte.etoile = $("#etoile").checked;
					sauver();
					fermerFeuille();
					render();
				});
				const supp = $("#suppCarte");
				supp.addEventListener("click", () => {
					if (!supp.dataset.arme) {
						supp.dataset.arme = "1";
						supp.classList.add("plein");
						supp.innerHTML = `<i class="bx bx-error"></i>Confirmer la suppression`;
						return;
					}
					paquet.cartes = paquet.cartes.filter((c) => c.id !== carte.id);
					sauver();
					fermerFeuille();
					toast("Carte supprimée");
					render();
				});
			},
		},
	);
}

function feuilleImporter(paquet) {
	ouvrirFeuille(
		`<h2>Importer des cartes</h2>
		<p class="feuille-texte">Colle une carte par ligne, avec le terme et la définition séparés par une tabulation, un tiret, un point-virgule… <br /><b>Depuis Quizlet :</b> ouvre ton set, <i>⋯ → Exporter</i>, copie le texte et colle-le ici.</p>
		<form id="formImport">
			<textarea id="texteImport" rows="7" placeholder="chat	cat&#10;chien	dog&#10;cheval - horse"></textarea>
			<div class="import-options">
				<label class="champ"><span>Entre terme et définition</span>
					<select id="sepImport">${Object.entries(SEPARATEURS)
						.map(([k, v]) => `<option value="${k}">${v.label}</option>`)
						.join("")}</select>
				</label>
				<label class="champ"><span>Entre les cartes</span>
					<select id="sepCartes"><option value="ligne">Retour à la ligne</option><option value="pv">Point-virgule</option></select>
				</label>
			</div>
			<div class="apercu" id="apercu"></div>
			<div class="pile">
				<button class="btn large" type="submit" id="btnImport" disabled>Importer</button>
				<button class="btn large secondaire" type="button" data-action="fermer">Annuler</button>
			</div>
		</form>`,
		{
			surOuvrir: () => {
				const zone = $("#texteImport");
				const maj = () => {
					const { cartes, sep } = analyserImport(zone.value, $("#sepImport").value, $("#sepCartes").value);
					const btn = $("#btnImport");
					btn.disabled = !cartes.length;
					btn.textContent = cartes.length ? `Importer ${pluriel(cartes.length, "carte")}` : "Importer";
					$("#apercu").innerHTML = cartes.length
						? `<p class="apercu-k">${pluriel(cartes.length, "carte détectée", "cartes détectées")}${$("#sepImport").value === "auto" ? ` · séparateur : ${SEPARATEURS[sep].label.toLowerCase()}` : ""}</p>
						${cartes
							.slice(0, 3)
							.map(([r, v]) => `<div class="apercu-ligne"><b>${esc(r)}</b><span>${esc(v)}</span></div>`)
							.join("")}${cartes.length > 3 ? `<p class="apercu-plus">… et ${cartes.length - 3} autres</p>` : ""}`
						: zone.value.trim()
							? `<p class="apercu-k">Aucune carte reconnue : essaie un autre séparateur.</p>`
							: "";
				};
				zone.addEventListener("input", maj);
				$("#sepImport").addEventListener("change", maj);
				$("#sepCartes").addEventListener("change", maj);
				zone.focus();
				$("#formImport").addEventListener("submit", (e) => {
					e.preventDefault();
					const { cartes } = analyserImport(zone.value, $("#sepImport").value, $("#sepCartes").value);
					if (!cartes.length) return;
					paquet.cartes.push(...cartes.map(([r, v]) => nouvelleCarte(r, v)));
					sauver();
					fermerFeuille();
					toast(`${pluriel(cartes.length, "carte importée", "cartes importées")}`);
					render();
				});
			},
		},
	);
}

function feuilleExporter(paquet) {
	ouvrirFeuille(
		`<h2>Exporter les cartes</h2>
		<p class="feuille-texte">Une carte par ligne, terme et définition séparés par une tabulation. Ce format s'importe dans Quizlet, Anki ou un tableur.</p>
		<textarea id="texteExport" rows="8" readonly>${esc(exporterTexte(paquet))}</textarea>
		<div class="pile">
			<button class="btn large" id="btnCopier"><i class="bx bx-copy"></i>Copier</button>
			<button class="btn large secondaire" data-action="fermer">Fermer</button>
		</div>`,
		{
			surOuvrir: () =>
				$("#btnCopier").addEventListener("click", async () => {
					try {
						await navigator.clipboard.writeText($("#texteExport").value);
						toast("Copié !");
					} catch {
						$("#texteExport").select();
						toast("Sélectionne le texte et copie-le");
					}
				}),
		},
	);
}

/* ================= Actions (clics) ================= */
const paquetCourant = () => routeCourante?.id && trouverPaquet(routeCourante.id);

const actions = {
	accueil: () => aller("#/"),
	reglages: () => aller("#/reglages"),
	ouvrir: (el) => {
		recherche = "";
		aller(`#/p/${el.dataset.id}`);
	},
	"retour-paquet": () => {
		if (session?.timer) clearInterval(session.timer);
		aller(`#/p/${routeCourante.id}`);
	},
	fermer: fermerFeuille,
	"nouveau-paquet": feuilleNouveauPaquet,
	exemple: () => {
		const p = nouveauPaquet(PAQUET_EXEMPLE.nom, COULEURS[1]);
		p.cartes = PAQUET_EXEMPLE.cartes.map(([r, v]) => nouvelleCarte(r, v));
		state.paquets.push(p);
		sauver();
		aller(`#/p/${p.id}`);
	},
	"options-paquet": () => feuilleOptionsPaquet(paquetCourant()),
	ajouter: () => feuilleAjouter(paquetCourant()),
	importer: () => feuilleImporter(paquetCourant()),
	exporter: () => feuilleExporter(paquetCourant()),
	"editer-carte": (el) => {
		const p = paquetCourant();
		const c = trouverCarte(p, el.dataset.id);
		if (c) feuilleEditerCarte(p, c);
	},
	reinitialiser: () => {
		const p = paquetCourant();
		confirmer({
			titre: "Remettre à zéro ?",
			texte: "Toutes les cartes redeviennent « jamais vues ». Les cartes elles-mêmes sont conservées.",
			bouton: "Remettre à zéro",
			danger: true,
			surOk: () => {
				p.cartes.forEach((c) => (c.srs = srsNeuf()));
				p.nouvellesDuJour = { jour: "", n: 0, bonus: 0 };
				sauver();
				toast("Progression remise à zéro");
				render();
			},
		});
	},
	"supprimer-paquet": () => {
		const p = paquetCourant();
		confirmer({
			titre: `Supprimer « ${esc(p.nom)} » ?`,
			texte: `${pluriel(p.cartes.length, "carte")} et toute la progression seront effacées. Impossible de revenir en arrière.`,
			bouton: "Supprimer",
			danger: true,
			surOk: () => {
				state.paquets = state.paquets.filter((x) => x.id !== p.id);
				sauver();
				toast("Paquet supprimé");
				aller("#/");
			},
		});
	},
	reviser: () => aller(`#/p/${routeCourante.id}/reviser`),
	"plus-de-nouvelles": () => {
		const p = paquetCourant();
		const nd = p.nouvellesDuJour;
		if (nd.jour !== jourCle()) Object.assign(nd, { jour: jourCle(), n: 0, bonus: 0 });
		nd.bonus = (nd.bonus || 0) + 10;
		sauver();
		session = null;
		if (routeCourante.vue === "reviser") render();
		else aller(`#/p/${p.id}/reviser`);
	},
	"filtre-etoiles": () => {
		session = { filtreEtoiles: !session?.filtreEtoiles };
		render();
	},
	etoile: (el, e) => {
		e.stopPropagation();
		const c = trouverCarte(paquetCourant(), el.dataset.id);
		if (!c) return;
		c.etoile = !c.etoile;
		sauver();
		vibrer();
		el.querySelector("i").className = `bx ${c.etoile ? "bxs-star" : "bx-star"}`;
	},
	retourner: () => {
		if (!session || session.type !== "reviser" || session.retournee) return;
		session.retournee = true;
		render();
	},
	noter: (el) => noter(paquetCourant(), +el.dataset.note),
	"annuler-note": () => {
		const s = session;
		if (!s?.annulation) return;
		const p = paquetCourant();
		const a = s.annulation;
		const c = trouverCarte(p, a.carteId);
		if (c) c.srs = a.srs;
		Object.assign(s, a.listes);
		p.nouvellesDuJour = a.nouvellesDuJour;
		state.journal[jourCle()] = a.journal;
		s.faites = a.faites;
		s.annulation = null;
		s.courante = a.carteId;
		const f = faces(c, p.sens);
		s.question = f.question;
		s.reponse = f.reponse;
		s.retournee = true;
		sauver();
		render();
	},
	"retourner-flip": () => {
		const flip = $("#flip");
		if (!flip || !session) return;
		if (flip.dataset.vientDeGlisser) {
			delete flip.dataset.vientDeGlisser;
			return;
		}
		session.retournee = !session.retournee;
		flip.classList.toggle("retournee", session.retournee);
	},
	trier: (el) => trier(el.dataset.sait === "1"),
	"tri-annuler": () => {
		const s = session;
		if (!s || s.index === 0) return;
		s.index--;
		const id = s.ids[s.index];
		s.sais = s.sais.filter((x) => x !== id);
		s.revoir = s.revoir.filter((x) => x !== id);
		s.retournee = false;
		render();
	},
	"cartes-revoir": () => {
		session = { ids: [...session.revoir] };
		render();
	},
	recommencer: () => {
		const type = session?.type;
		if (session?.timer) clearInterval(session.timer);
		session = type === "cartes" ? { ids: melanger(cartesEntrainement(paquetCourant(), routeCourante).map((c) => c.id)) } : null;
		render();
	},
	"ecrire-passer": () => {
		const s = session;
		s.resultat = { ok: false, passe: true, tape: "" };
		s.ratees.add(s.file[0]);
		render();
	},
	"ecrire-javais-bon": () => {
		const s = session;
		s.ratees.delete(s.file[0]);
		s.resultat = { ...s.resultat, ok: true, note: "" };
		actions["ecrire-suivante"]();
	},
	"ecrire-suivante": () => {
		const s = session;
		if (!s?.resultat) return;
		const id = s.file.shift();
		// Une carte ratée revient à la fin de la file jusqu'à ce qu'elle soit juste
		if (s.resultat.ok) s.justes++;
		else s.file.push(id);
		s.resultat = null;
		s.tape = "";
		render();
	},
	"ecrire-ratees": () => {
		session = { ids: [...session.ratees] };
		render();
	},
	"quiz-choisir": (el) => choisirQuiz(+el.dataset.i),
	"quiz-suivante": () => {
		const s = session;
		if (!s || s.choisi === null) return;
		s.i++;
		s.choisi = null;
		render();
	},
	"quiz-erreurs": () => {
		session = { ids: [...new Set(session.erreurs)] };
		render();
	},
	associer: (el) => associer(el.dataset.cle),
	"nouvelles-moins": () => {
		state.reglages.nouvellesParJour = Math.max(0, state.reglages.nouvellesParJour - 5);
		sauver();
		render();
	},
	"nouvelles-plus": () => {
		state.reglages.nouvellesParJour = Math.min(200, state.reglages.nouvellesParJour + 5);
		sauver();
		render();
	},
	"sauvegarde-exporter": () => {
		const blob = new Blob([JSON.stringify(state, null, 1)], { type: "application/json" });
		const a = document.createElement("a");
		a.href = URL.createObjectURL(blob);
		a.download = `flashcards-sauvegarde-${iso(new Date())}.json`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		setTimeout(() => URL.revokeObjectURL(a.href), 1000);
	},
	"tout-effacer": () =>
		confirmer({
			titre: "Tout effacer ?",
			texte: "Tous les paquets, toutes les cartes et toute la progression seront supprimés de cet appareil.",
			bouton: "Tout effacer",
			danger: true,
			surOk: () => {
				state = etatInitial();
				sauver();
				toast("Tout est effacé");
				aller("#/");
			},
		}),
};

document.addEventListener("click", (e) => {
	const el = e.target.closest("[data-action]");
	if (!el || el.disabled) return;
	const fn = actions[el.dataset.action];
	if (fn) fn(el, e);
});

// Clic sur le fond sombre = fermer la feuille
$("#feuilleFond").addEventListener("click", (e) => {
	if (e.target.id === "feuilleFond") fermerFeuille();
});

document.addEventListener("keydown", (e) => {
	if (e.key === "Escape" && $("#feuilleFond").classList.contains("ouvert")) return fermerFeuille();
	if ($("#feuilleFond").classList.contains("ouvert")) return;
	const t = e.target;
	if (t.matches?.("input, textarea, select")) return;
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	if (clavier?.(e)) e.preventDefault();
});

window.addEventListener("hashchange", render);

/* ================= Démarrage ================= */
render();

// Demande au navigateur de ne pas effacer les données en cas de manque de place
navigator.storage?.persist?.().catch(() => {});

if ("serviceWorker" in navigator) {
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("./sw.js", { scope: "./" })
			.catch((err) => console.error("Échec enregistrement SW:", err));
	});
}
