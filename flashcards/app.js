"use strict";

/* =========================================================
   Flashcards — réviser efficacement
   ---------------------------------------------------------
   - Paquets de cartes (recto / verso), import depuis Quizlet
   - « Réviser » : répétition espacée façon Anki (SM-2 simplifié),
     chaque carte revient juste avant d'être oubliée
   - « Apprendre » : QCM sur tout le paquet, chaque carte revient
     jusqu'à être sue (idéal avant un examen)
   - Entraînement libre façon Quizlet : Cartes, Quiz, Associer
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

const COULEURS = [
	"#5b5bd6",
	"#0090ff",
	"#12a594",
	"#30a46c",
	"#f76b15",
	"#e5484d",
	"#d6409f",
	"#8e4ec6",
];

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
		(c) =>
			({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
				c
			],
	);
const uid = () =>
	Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const collator = new Intl.Collator("fr", {
	sensitivity: "base",
	numeric: true,
});

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
	return s < 60
		? `${s.toFixed(1).replace(".", ",")} s`
		: `${Math.floor(s / 60)} min ${Math.round(s % 60)} s`;
}

const pluriel = (n, mot, motPluriel = mot + "s") =>
	`${n} ${n > 1 ? motPluriel : mot}`;

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
const srsNeuf = () => ({
	etat: "nouvelle",
	due: 0,
	iv: 0,
	fac: FACILITE_DEPART,
	etape: 0,
	reps: 0,
	oublis: 0,
});

// source : d'où vient la carte (« Lecture 3 (part 2) · diapo 11 »), facultatif
const nouvelleCarte = (recto, verso, source) => ({
	id: uid(),
	recto: String(recto).trim(),
	verso: String(verso).trim(),
	...(source ? { source: String(source) } : {}),
	etoile: false,
	srs: srsNeuf(),
});

// Pastille d'un paquet : le numéro du cours (« Lecture 3 (part 2) » → 3b),
// sinon la première lettre du nom
function initiale(nom) {
	const m = String(nom).match(
		/^(?:lecture|cours)\s+(\d+)(?:\s*\(part(?:ie)?\s*(\d+)\))?/i,
	);
	if (m) return m[1] + (m[2] ? "abcdefgh"[Number(m[2]) - 1] || "" : "");
	return (String(nom).trim()[0] || "?").toUpperCase();
}

// Petite étiquette « Lecture 1 · diapo 15 » en haut de la carte
const sourceHtml = (carte) =>
	carte?.source ? `<span class="ce-source">${esc(carte.source)}</span>` : "";

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
	// apprendre : progression du mode Apprendre, par paquet
	// mix : paquets exclus de « Tout mélanger » (les nouveaux paquets sont inclus d'office)
	return {
		paquets: [],
		reglages: { nouvellesParJour: 200 },
		journal: {},
		apprendre: {},
		mix: { exclus: [], meilleurAssocier: null },
	};
}

// Remet d'aplomb un état chargé (ancienne version, sauvegarde importée…)
function reparer(e) {
	const base = etatInitial();
	const etat = { ...base, ...(e && typeof e === "object" ? e : {}) };
	etat.reglages = { ...base.reglages, ...(etat.reglages || {}) };
	etat.journal =
		etat.journal && typeof etat.journal === "object" ? etat.journal : {};
	etat.apprendre =
		etat.apprendre && typeof etat.apprendre === "object" ? etat.apprendre : {};
	etat.mix = { ...base.mix, ...(etat.mix || {}) };
	etat.paquets = (Array.isArray(etat.paquets) ? etat.paquets : []).map((p) => {
		const paquet = { ...nouveauPaquet(p.nom || "Sans titre"), ...p };
		paquet.nouvellesDuJour = {
			jour: "",
			n: 0,
			bonus: 0,
			...(p.nouvellesDuJour || {}),
		};
		paquet.cartes = (Array.isArray(p.cartes) ? p.cartes : [])
			.filter((c) => c && (c.recto || c.verso))
			.map((c) => ({
				id: c.id || uid(),
				recto: String(c.recto ?? ""),
				verso: String(c.verso ?? ""),
				...(c.source ? { source: String(c.source) } : {}),
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
		toast("Impossible d'enregistrer : stockage plein ?");
	}
}

let state = charger();

const ID_TOUT = "tout";

// « Tout mélanger » : un paquet virtuel qui regroupe les cartes des paquets
// choisis. Les cartes sont les mêmes objets que dans leurs paquets d'origine
// (une étoile posée ici se retrouve là-bas).
function paquetTout() {
	const exclus = new Set(state.mix.exclus);
	const inclus = state.paquets.filter((p) => !exclus.has(p.id));
	return {
		id: ID_TOUT,
		virtuel: true,
		nom: "Tous les paquets",
		couleur: "#3e63dd",
		sens: "recto",
		nouvellesDuJour: { jour: "", n: 0, bonus: 0 },
		meilleurAssocier: state.mix.meilleurAssocier,
		inclus,
		cartes: inclus.flatMap((p) => p.cartes),
	};
}

const trouverPaquet = (id) =>
	id === ID_TOUT
		? state.paquets.length
			? paquetTout()
			: null
		: state.paquets.find((p) => p.id === id);
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
		const etape =
			s.etat === "nouvelle" ? 0 : Math.min(s.etape, etapes.length - 1);
		s.etat = "apprentissage";
		if (note === 1) {
			s.etape = 0;
			s.due = maintenant + etapes[0] * MIN;
		} else if (note === 2) {
			s.etape = etape;
			const delai =
				etape === 0 && etapes.length > 1
					? (etapes[0] + etapes[1]) / 2
					: etapes[etape];
			s.due = maintenant + delai * MIN;
		} else if (note === 3) {
			if (etape + 1 >= etapes.length)
				graduer(s, INTERVALLE_DIPLOME, maintenant);
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

const enApprentissage = (c) =>
	c.srs.etat === "apprentissage" || c.srs.etat === "reapprentissage";

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
	return {
		total: paquet.cartes.length,
		nouvelles,
		nouvellesDispo,
		aRevoir,
		enCours,
		maitrisees,
	};
}

// Prochaine échéance après aujourd'hui (pour « Prochaine révision : … »)
function prochaineEcheance(paquet) {
	const fin = finDeJournee();
	const futures = paquet.cartes.filter(
		(c) => c.srs.etat !== "nouvelle" && c.srs.due > fin,
	);
	if (!futures.length) return null;
	const quand = Math.min(...futures.map((c) => c.srs.due));
	const jour = jourCle(quand);
	return {
		quand,
		n: futures.filter((c) => jourCle(c.srs.due) === jour).length,
	};
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

const LIBELLES_SENS = {
	recto: "Terme → Définition",
	verso: "Définition → Terme",
	mixte: "Les deux, au hasard",
};

/* ================= Lexique des abréviations ================= */
// Affiché sous la carte quand une abréviation apparaît dans la question
// ou dans les réponses proposées (cours d'anglais : c., BC, IRA, SNP…).
const LEXIQUE = [
	{ abr: "c.", re: /(^|[^\p{L}])c\.(?=\s)/u, sens: "circa : vers, environ" },
	{ abr: "BC", re: /\bBC\b/, sens: "Before Christ : avant J.-C." },
	{ abr: "v.", re: /(^|[^\p{L}])v\.(?=\s)/u, sens: "versus : contre" },
	{ abr: "St", re: /\bSt\b/, sens: "Saint" },
	{ abr: "MPs", re: /\bMPs?\b/, sens: "Members of Parliament : députés" },
	{ abr: "UK", re: /\bUK\b/, sens: "United Kingdom : Royaume-Uni" },
	{ abr: "US", re: /\bUS\b/, sens: "United States : États-Unis" },
	{ abr: "EU", re: /\bEU\b/, sens: "European Union : Union européenne" },
	{
		abr: "A10",
		re: /\bA10\b/,
		sens: "les 10 pays entrés dans l'UE en 2004 (surtout d'Europe de l'Est)",
	},
	{
		abr: "IRA",
		re: /\bIRA\b/,
		sens: "Irish Republican Army : armée républicaine irlandaise (indépendantistes)",
	},
	{
		abr: "SNP",
		re: /\bSNP\b/,
		sens: "Scottish National Party : parti indépendantiste écossais",
	},
	{
		abr: "DUP",
		re: /\bDUP\b/,
		sens: "Democratic Unionist Party : parti unioniste nord-irlandais (pour le maintien dans le Royaume-Uni)",
	},
	{
		abr: "NICRA",
		re: /\bNICRA\b/,
		sens: "Northern Ireland Civil Rights Association : association pour les droits civiques en Irlande du Nord",
	},
	{
		abr: "RUC",
		re: /\bRUC\b/,
		sens: "Royal Ulster Constabulary : la police d'Irlande du Nord",
	},
	{
		abr: "UVF",
		re: /\bUVF\b/,
		sens: "Ulster Volunteer Force : groupe paramilitaire loyaliste (pro-Royaume-Uni)",
	},
	{
		abr: "CRE",
		re: /\bCRE\b/,
		sens: "Commission for Racial Equality : commission pour l'égalité raciale",
	},
	{
		abr: "BAME",
		re: /\bBAME\b/,
		sens: "Black, Asian and Minority Ethnic : Noirs, Asiatiques et minorités ethniques",
	},
];

function lexiqueHtml(...textes) {
	const t = textes.filter(Boolean).join("\n");
	const trouves = LEXIQUE.filter((l) => l.re.test(t));
	if (!trouves.length) return "";
	return `<div class="lexique"><i class="bx bx-info-circle"></i><div>${trouves
		.map((l) => `<p><b>${esc(l.abr)}</b> ${esc(l.sens)}</p>`)
		.join("")}</div></div>`;
}

/* ================= Import / export texte ================= */
const SEPARATEURS = {
	auto: { label: "Automatique", re: null },
	tab: { label: "Tabulation (Quizlet)", re: /\t/ },
	derniereVirgule: { label: "Dernière virgule  (événement, date)", re: null },
	pv: { label: "Point-virgule  ;", re: /\s*;\s*/ },
	virgule: { label: "Virgule  ,", re: /\s*,\s*/ },
	tiret: { label: "Tiret  -", re: /\s+[-–—]\s+/ },
	dp: { label: "Deux-points  :", re: /\s*:\s*/ },
};

// Position du séparateur dans une ligne : { index, longueur } ou null
function trouverSeparateur(ligne, cle) {
	if (cle === "derniereVirgule") {
		// la dernière virgule hors parenthèses : « Act of Union (England, Wales), 1536 »
		let prof = 0;
		let pos = -1;
		for (let i = 0; i < ligne.length; i++) {
			if (ligne[i] === "(") prof++;
			else if (ligne[i] === ")") prof = Math.max(0, prof - 1);
			else if (ligne[i] === "," && prof === 0) pos = i;
		}
		return pos < 0 ? null : { index: pos, longueur: 1 };
	}
	const m = ligne.match(SEPARATEURS[cle].re);
	return m ? { index: m.index, longueur: m[0].length } : null;
}

function detecterSeparateur(lignes) {
	const candidats = ["tab", "tiret", "pv", "dp", "virgule"];
	for (const cle of candidats) {
		const ok = lignes.filter((l) => trouverSeparateur(l, cle)).length;
		if (!ok || ok < lignes.length * 0.6) continue;
		if (cle === "virgule") {
			// « événement, date » : si ce qui suit la dernière virgule est une date,
			// on coupe là, même si l'événement contient d'autres virgules
			const dates = lignes.filter((l) => {
				const sep = trouverSeparateur(l, "derniereVirgule");
				return sep && anneeDe(l.slice(sep.index + 1)) !== null;
			}).length;
			if (dates >= lignes.length * 0.6) return "derniereVirgule";
		}
		return cle;
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
	const cartes = [];
	for (const l of lignes) {
		const sep = trouverSeparateur(l, cle);
		if (!sep) continue;
		const recto = l.slice(0, sep.index).trim();
		const verso = l.slice(sep.index + sep.longueur).trim();
		if (recto && verso) cartes.push([recto, verso]);
	}
	return { cartes, sep: cle };
}

const exporterTexte = (paquet) =>
	paquet.cartes
		.map(
			(c) =>
				`${c.recto.replace(/\s*\n\s*/g, " ")}\t${c.verso.replace(/\s*\n\s*/g, " ")}`,
		)
		.join("\n");

/* ================= Routeur ================= */
// #/                      accueil
// #/p/ID                  paquet
// #/p/ID/reviser          répétition espacée
// #/p/ID/apprendre|cartes|quiz|associer[?e=1]   entraînement (e=1 : étoilées seulement)
// #/reglages
function route() {
	const [chemin, requete = ""] = location.hash.replace(/^#/, "").split("?");
	const parts = chemin.split("/").filter(Boolean);
	const params = new URLSearchParams(requete);
	if (parts[0] === "reglages") return { vue: "reglages", cle: "reglages" };
	if (parts[0] === "p" && parts[1]) {
		const mode = parts[2] || "paquet";
		return {
			vue: mode,
			id: parts[1],
			etoiles: params.get("e") === "1",
			cle: location.hash,
		};
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
		apprendre: renderApprendre,
		quiz: renderQuiz,
		associer: renderAssocier,
	};
	if (paquet.virtuel && (r.vue === "paquet" || r.vue === "reviser"))
		return renderTout(app, paquet);
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
				<span class="paquet-pastille">${esc(initiale(p.nom))}</span>
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
			${
				state.paquets.length >= 2
					? `<button class="mix" data-action="ouvrir" data-id="${ID_TOUT}">
				<span class="mix-ic"><i class="bx bx-shuffle"></i></span>
				<span class="pret-corps"><b>Tout mélanger</b><span>${descMix()}</span></span>
				<i class="bx bx-chevron-right mix-fleche"></i>
			</button>`
					: ""
			}
			<div class="titre-section"><h2>Mes paquets</h2></div>
			<div class="liste-paquets">${listePaquets}</div>
			<div class="actions-cartes">
				<button class="btn secondaire" data-action="nouveau-paquet"><i class="bx bx-plus"></i>Nouveau paquet</button>
				<button class="btn secondaire" data-action="paquets-prets"><i class="bx bx-library"></i>Paquets prêts</button>
			</div>`
				: `<section class="vide">
				<div class="vide-ill"><span></span><span></span><span></span></div>
				<h2>Crée ton premier paquet</h2>
				<p>Ajoute tes cartes à la main ou colle un export Quizlet. L'appli te fait ensuite réviser chaque carte au bon moment, juste avant que tu l'oublies.</p>
				<button class="btn large" data-action="paquets-prets"><i class="bx bx-library"></i>Paquets prêts (civi britannique…)</button>
				<button class="btn large secondaire" data-action="nouveau-paquet"><i class="bx bx-plus"></i>Nouveau paquet</button>
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
		? paquet.cartes.filter((c) =>
				normaliser(c.recto + " " + c.verso).includes(q),
			)
		: paquet.cartes;

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
		${grilleModes(paquet, suffixe)}

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
				q2
					? paquet.cartes.filter((c) =>
							normaliser(c.recto + " " + c.verso).includes(q2),
						)
					: paquet.cartes,
			);
		});
	}
}

function grilleModes(paquet, suffixe = "") {
	const modes = [
		{
			mode: "apprendre",
			ic: "bx-bulb",
			nom: "Apprendre",
			desc: descApprendre(paquet),
			fort: true,
		},
		{ mode: "quiz", ic: "bx-list-check", nom: "Quiz", desc: "20 questions" },
		{
			mode: "cartes",
			ic: "bx-copy",
			nom: "Cartes",
			desc: "Retourner et trier",
		},
		{
			mode: "associer",
			ic: "bx-extension",
			nom: "Associer",
			desc: "Le jeu des paires",
		},
	];
	return `<div class="grille-modes">
		${modes
			.map(
				(
					m,
				) => `<a class="mode${m.fort ? " fort" : ""}" href="#/p/${paquet.id}/${m.mode}${suffixe}">
			<i class="bx ${m.ic}"></i><b>${m.nom}</b><span>${m.desc}</span></a>`,
			)
			.join("")}
	</div>`;
}

/* ================= Vue : tous les paquets mélangés ================= */
function renderTout(app, paquet) {
	const exclus = new Set(state.mix.exclus);
	const nb = paquet.cartes.length;
	app.innerHTML = `
	<header class="barre-haut wrap">
		<button class="rond" data-action="accueil" aria-label="Retour"><i class="bx bx-chevron-left"></i></button>
		<span class="rond fantome"></span>
	</header>
	<main class="wrap">
		<div class="paquet-tete">
			<h1>Tous les paquets</h1>
			<p>${pluriel(nb, "carte")} de ${pluriel(paquet.inclus.length, "paquet")}, mélangées</p>
		</div>
		${
			nb
				? grilleModes(paquet)
				: `<section class="vide petit"><h2>Aucun paquet coché</h2><p>Coche au moins un paquet ci-dessous pour le mélanger.</p></section>`
		}
		<div class="titre-section"><h2>Paquets mélangés</h2>
			${exclus.size ? `<button class="puce" data-action="mix-tous"><i class="bx bx-check-double"></i>Tout cocher</button>` : ""}
		</div>
		<div class="liste-cartes">
			${state.paquets
				.map(
					(p) => `<label class="mix-ligne" style="--c:${p.couleur}">
				<span class="paquet-pastille petite">${esc(initiale(p.nom))}</span>
				<span class="pret-corps"><b>${esc(p.nom)}</b><span>${pluriel(p.cartes.length, "carte")}</span></span>
				<input type="checkbox" data-mix="${p.id}" ${exclus.has(p.id) ? "" : "checked"} />
			</label>`,
				)
				.join("")}
		</div>
	</main>`;

	app.querySelectorAll("[data-mix]").forEach((cb) =>
		cb.addEventListener("change", () => {
			const id = cb.dataset.mix;
			state.mix.exclus = cb.checked
				? state.mix.exclus.filter((x) => x !== id)
				: [...state.mix.exclus, id];
			changerMelange();
		}),
	);
}

function descMix() {
	const p = paquetTout();
	const b = state.apprendre[ID_TOUT];
	const prog = !b
		? ""
		: b.file.length
			? ` · Apprendre : ${b.sues} / ${b.total}`
			: " · Apprendre bouclé ✓";
	return `${pluriel(p.cartes.length, "carte")} de ${pluriel(p.inclus.length, "paquet")}${prog}`;
}

// Le mélange a changé : la progression « Apprendre » du mélange repart de zéro
function changerMelange() {
	if (state.apprendre[ID_TOUT]) {
		delete state.apprendre[ID_TOUT];
		toast("Nouveau mélange : Apprendre repart de zéro");
	}
	sauver();
	render();
}

function descApprendre(paquet) {
	const b = state.apprendre[paquet.id];
	if (!b) return "Tout le paquet, vite";
	if (!b.file.length) return "Bouclé ✓";
	return `En cours : ${b.sues} / ${b.total}`;
}

function listeCartesHtml(cartes) {
	if (!cartes.length)
		return recherche ? `<p class="aucun">Aucune carte ne correspond.</p>` : "";
	return cartes
		.map(
			(
				c,
			) => `<button class="ligne-carte" data-action="editer-carte" data-id="${c.id}">
			<span class="lc-recto">${esc(c.recto)}</span>
			<span class="lc-verso">${esc(c.verso)}${c.source ? `<small>${esc(c.source)}</small>` : ""}</span>
			<span class="lc-etat ${etatVisuel(c)}" title="${titreEtat(c)}"></span>
			${c.etoile ? `<i class="bx bxs-star lc-etoile"></i>` : ""}
		</button>`,
		)
		.join("");
}

const etatVisuel = (c) =>
	c.srs.etat === "nouvelle"
		? "m-new"
		: c.srs.etat === "revision" && c.srs.iv >= SEUIL_MAITRISE
			? "m-ok"
			: "m-cours";
const titreEtat = (c) =>
	c.srs.etat === "nouvelle"
		? "Jamais vue"
		: c.srs.etat === "revision" && c.srs.iv >= SEUIL_MAITRISE
			? "Maîtrisée"
			: "En cours";

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
		else if (c.srs.due <= fin)
			(enApprentissage(c) ? apprentissage : revisions).push(c.id);
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
	const prendreNouvelle =
		s.nouvelles.length && (!s.revisions.length || s.faites % 3 === 2);
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
	const type = s.nouvelles.includes(carte.id)
		? "bleu"
		: enApprentissage(carte)
			? "rouge"
			: "vert";
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
			${sourceHtml(carte)}
			<div class="ce-question ${tailleTexte(s.question)}">${esc(s.question)}</div>
			${
				s.retournee
					? `<div class="ce-sep"></div><div class="ce-reponse ${tailleTexte(s.reponse)}">${esc(s.reponse)}</div>`
					: `<p class="ce-aide">Touche la carte pour voir la réponse</p>`
			}
		</div>
		${lexiqueHtml(s.question, s.retournee && s.reponse)}
		<div class="zone-notes">
			${
				s.retournee
					? `<p class="notes-aide">Tu t'en souvenais ?</p><div class="notes">${NOTES.map(
							(n) => {
								const apres = planifier(carte.srs, n.note, maintenant, {
									flou: false,
								});
								return `<button class="note ${n.cls}" data-action="noter" data-note="${n.note}">
							<b>${n.label}</b><span>${formatDelai(apres.due - maintenant)}</span></button>`;
							},
						).join("")}</div>`
					: `<button class="btn large" data-action="retourner"><i class="bx bx-show"></i>Voir la réponse</button>`
			}
		</div>
	</main>`;

	clavier = (e) => {
		if (!s.retournee && (e.key === " " || e.key === "Enter"))
			return (actions.retourner(), true);
		if (s.retournee && ["1", "2", "3", "4"].includes(e.key))
			return (noter(paquet, +e.key), true);
		if (s.retournee && (e.key === " " || e.key === "Enter"))
			return (noter(paquet, 3), true);
		if (e.key === "z" || e.key === "Backspace")
			return (actions["annuler-note"](), true);
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
		if (nd.jour !== jourCle())
			Object.assign(nd, { jour: jourCle(), n: 0, bonus: 0 });
		nd.n++;
		s.nouvelles = s.nouvelles.filter((id) => id !== carte.id);
	}
	s.revisions = s.revisions.filter((id) => id !== carte.id);
	s.apprentissage = s.apprentissage.filter((id) => id !== carte.id);
	if (enApprentissage(carte) && carte.srs.due <= finDeJournee())
		s.apprentissage.push(carte.id);

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
		<h1>${s.faites ? "Séance terminée !" : "Rien à réviser"}</h1>
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
	const cartes = r.etoiles
		? paquet.cartes.filter((c) => c.etoile)
		: paquet.cartes;
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

function finEntrainement(
	app,
	{ titre, texte, liste = [], titreListe = "À retravailler", boutons },
) {
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
				? `<div class="fin-liste"><p class="fin-liste-k">${titreListe}</p>${liste
						.map(
							(c) =>
								`<div class="fin-ligne"><b>${esc(c.recto)}</b><span>${esc(c.verso)}${c.source ? `<small>${esc(c.source)}</small>` : ""}</span></div>`,
						)
						.join("")}</div>`
				: ""
		}
		<div class="fin-actions">${boutons}</div>
	</main>`;
}

/* ================= Mode Cartes (retourner et trier) ================= */
function renderCartes(app, paquet, r) {
	if (!session || session.type !== "cartes") {
		const ids = session?.ids || cartesEntrainement(paquet, r).map((c) => c.id);
		session = {
			type: "cartes",
			ids,
			index: 0,
			retournee: false,
			sais: [],
			revoir: [],
			faces: {},
			melange: !!session?.melange,
		};
	}
	const s = session;

	if (s.index >= s.ids.length) {
		const revoir = s.revoir
			.map((id) => trouverCarte(paquet, id))
			.filter(Boolean);
		return finEntrainement(app, {
			titre: revoir.length
				? { ic: "💪", texte: "Tour terminé" }
				: { ic: "🎉", texte: "Tu sais tout !" },
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
				${sourceHtml(carte)}
				<div class="${tailleTexte(f.question)}">${esc(f.question)}</div>
				<p class="ce-aide">Touche pour retourner</p>
			</div>
			<div class="flip-face verso">
				<div class="${tailleTexte(f.reponse)}">${esc(f.reponse)}</div>
			</div>
		</div>
		${lexiqueHtml(f.question, f.reponse)}
		<div class="tri-boutons">
			<button class="tri rouge" data-action="trier" data-sait="0" aria-label="À revoir"><i class="bx bx-x"></i><span>À revoir</span></button>
			<button class="tri neutre" data-action="tri-annuler" aria-label="Carte précédente" ${s.index ? "" : "disabled"}><i class="bx bx-undo"></i></button>
			<button class="tri vert" data-action="trier" data-sait="1" aria-label="Je sais"><i class="bx bx-check"></i><span>Je sais</span></button>
		</div>
		<p class="astuce">Glisse la carte à droite si tu sais, à gauche sinon</p>
	</main>`;

	activerGlisser($("#flip"), (sens) => trier(sens > 0));

	clavier = (e) => {
		if (
			e.key === " " ||
			e.key === "Enter" ||
			e.key === "ArrowUp" ||
			e.key === "ArrowDown"
		)
			return (actions["retourner-flip"](), true);
		if (e.key === "ArrowRight") return (trier(true), true);
		if (e.key === "ArrowLeft") return (trier(false), true);
		if (e.key === "z" || e.key === "Backspace")
			return (actions["tri-annuler"](), true);
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

/* ================= Questions à choix (Quiz et Apprendre) ================= */
const MOIS_RE =
	/\b(january|february|march|april|may|june|july|august|september|october|november|december|janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[uû]t|septembre|octobre|novembre|d[ée]cembre)\b/i;

// Année approximative d'une réponse (« 1536 », « c. 1000 BC », « 17th century »,
// « 1850s », « 4 July 1776 »…), ou null si ce n'est pas une date avec année.
function anneeDe(texte) {
	const t = String(texte || "");
	const avJC = /\b(BC|av\.? ?J\.?-?C)\b/i.test(t);
	const siecle = t.match(/(\d{1,2})(st|nd|rd|th|e|ème)\s+(century|siècle)/i);
	if (siecle) {
		const base = (Number(siecle[1]) - 1) * 100;
		const decalage = /early|début/i.test(t)
			? 15
			: /late|fin/i.test(t)
				? 85
				: 50;
		return avJC ? -(base + decalage) : base + decalage;
	}
	const longue = t.match(/\b(\d{3,4})\b/);
	if (longue) return avJC ? -Number(longue[1]) : Number(longue[1]);
	if (MOIS_RE.test(t)) return null; // « 23 April » : un jour, pas une année
	const courte = t.match(/\b(\d{1,2})\b/);
	if (courte) return avJC ? -Number(courte[1]) : Number(courte[1]);
	return null;
}

// Fabrique une question à 4 choix. Pour une date, les mauvaises réponses sont
// des dates proches (1534 / 1536 / 1537 plutôt que 1066 / 2026), sinon c'est trop facile.
function questionQCM(paquet, carte) {
	const f = faces(carte, paquet.sens);
	const inverse = f.question === carte.verso && f.question !== carte.recto;
	const bonne = f.reponse;
	const vus = new Set([normaliser(bonne)]);
	const candidats = [];
	for (const autre of melanger(paquet.cartes)) {
		if (autre.id === carte.id) continue;
		const t = inverse ? autre.recto : autre.verso;
		const n = normaliser(t);
		if (!n || vus.has(n)) continue;
		vus.add(n);
		candidats.push({ t, annee: anneeDe(t) });
	}
	const annee = inverse ? null : anneeDe(bonne);
	let tries;
	if (annee !== null) {
		// les plus proches d'abord, sans la même année (« 1958 » contre « since 1958 »)
		const proches = candidats
			.filter((c) => c.annee !== null && c.annee !== annee)
			.sort((a, b) => Math.abs(a.annee - annee) - Math.abs(b.annee - annee));
		tries = [
			...melanger(proches.slice(0, 6)),
			...candidats.filter((c) => !proches.slice(0, 6).includes(c)),
		];
	} else if (!inverse) {
		// réponse sans année (« 23 April ») : d'autres réponses du même genre d'abord
		tries = [
			...candidats.filter((c) => c.annee === null),
			...candidats.filter((c) => c.annee !== null),
		];
	} else {
		tries = candidats;
	}
	const leurres = tries.slice(0, 3).map((c) => c.t);
	const choix = melanger([bonne, ...leurres]);
	return {
		carteId: carte.id,
		question: f.question,
		choix,
		bonne: choix.indexOf(bonne),
	};
}

const assezPourQCM = (paquet) =>
	paquet.cartes.length >= 2 &&
	new Set(paquet.cartes.map((c) => normaliser(c.verso))).size >= 2;

function choixHtml(q, choisi) {
	const repondu = choisi !== null;
	return `<div class="choix">
		${q.choix
			.map((c, i) => {
				let cls = "";
				if (repondu && i === q.bonne) cls = "bon";
				else if (repondu && i === choisi) cls = "faux";
				else if (repondu) cls = "eteint";
				return `<button class="choix-btn ${cls}" data-action="choisir" data-i="${i}" ${repondu ? "disabled" : ""}>
				<span class="choix-n">${i + 1}</span><span>${esc(c)}</span></button>`;
			})
			.join("")}
	</div>`;
}

/* ================= Mode Quiz (QCM) ================= */
function preparerQuiz(paquet, cartes) {
	const questions = melanger(cartes)
		.slice(0, 20)
		.map((carte) => questionQCM(paquet, carte));
	return {
		type: "quiz",
		questions,
		i: 0,
		choisi: null,
		erreurs: [],
		cartesIds: cartes.map((c) => c.id),
	};
}

const PAS_ASSEZ = {
	titre: { ic: "🤏", texte: "Pas assez de cartes" },
	texte:
		"Il faut au moins 2 cartes avec des réponses différentes pour faire un QCM (4 c'est mieux).",
	boutons: `<button class="btn large" data-action="retour-paquet">Retour au paquet</button>`,
};

function renderQuiz(app, paquet, r) {
	if (!assezPourQCM(paquet)) return finEntrainement(app, PAS_ASSEZ);
	if (!session || session.type !== "quiz") {
		const cartes = session?.ids
			? session.ids.map((id) => trouverCarte(paquet, id)).filter(Boolean)
			: cartesEntrainement(paquet, r);
		session = preparerQuiz(paquet, cartes);
	}
	const s = session;

	if (s.i >= s.questions.length) {
		const erreurs = s.erreurs
			.map((id) => trouverCarte(paquet, id))
			.filter(Boolean);
		const score = s.questions.length - erreurs.length;
		const pct = Math.round((score / s.questions.length) * 100);
		return finEntrainement(app, {
			titre: {
				ic: pct === 100 ? "🏆" : pct >= 70 ? "👏" : "📚",
				texte: `${score} / ${s.questions.length}`,
			},
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
			${sourceHtml(trouverCarte(paquet, q.carteId))}
			<div class="ce-question ${tailleTexte(q.question)}">${esc(q.question)}</div>
		</div>
		${lexiqueHtml(q.question, ...q.choix)}
		${choixHtml(q, s.choisi)}
		${repondu && s.choisi !== q.bonne ? `<button class="btn large" data-action="suivante" id="btnSuivante">Continuer<i class="bx bx-right-arrow-alt"></i></button>` : ""}
	</main>`;
	$("#btnSuivante")?.focus();
	clavier = clavierQCM(q, repondu);
}

function clavierQCM(q, repondu) {
	return (e) => {
		if (!repondu && /^[1-4]$/.test(e.key) && +e.key <= q.choix.length)
			return (choisir(+e.key - 1), true);
		if (repondu && e.key === "Enter") return (actions.suivante(), true);
		return false;
	};
}

// Réponse à un QCM (Quiz ou Apprendre). Une bonne réponse passe toute seule
// à la suivante ; une erreur attend « Continuer » pour laisser lire la bonne.
function choisir(i) {
	const s = session;
	if (!s || s.choisi !== null) return;
	const q = s.type === "quiz" ? s.questions[s.i] : s.q;
	if (!q) return;
	s.choisi = i;
	const juste = i === q.bonne;
	if (s.type === "quiz") {
		if (!juste) s.erreurs.push(q.carteId);
	} else {
		noterApprendre(q.carteId, juste);
	}
	vibrer(juste ? 8 : 25);
	render();
	if (juste) {
		setTimeout(() => {
			if (
				session === s &&
				s.choisi === i &&
				(s.type !== "quiz" || s.questions[s.i] === q)
			)
				actions.suivante();
		}, 650);
	}
}

/* ================= Mode Apprendre (avant un examen) ================= */
// Toutes les cartes passent en QCM. Juste du premier coup : la carte est sue.
// Sinon elle revient quelques questions plus tard, jusqu'à être juste
// 2 fois d'affilée. La progression est enregistrée (on peut fermer l'appli).
const RETOUR_APRES_ERREUR = [3, 5]; // la carte ratée revient entre 3 et 5 questions plus tard
const RETOUR_APRES_REUSSITE = [7, 11];

function progressionApprendre(paquet, r) {
	state.apprendre = state.apprendre || {};
	let b = state.apprendre[paquet.id];
	if (b) {
		// cartes supprimées entre-temps
		b.file = b.file.filter((id) => trouverCarte(paquet, id));
		return b;
	}
	const ids = melanger(cartesEntrainement(paquet, r).map((c) => c.id));
	b = {
		file: ids,
		total: ids.length,
		sues: 0,
		serie: {},
		erreurs: {},
		faites: 0,
		debut: Date.now(),
		duree: 0,
	};
	state.apprendre[paquet.id] = b;
	sauver();
	return b;
}

const hasard = ([min, max]) =>
	min + Math.floor(Math.random() * (max - min + 1));

function noterApprendre(carteId, juste) {
	const s = session;
	const b = s.b;
	b.faites++;
	b.file.shift();
	if (juste) {
		b.serie[carteId] = (b.serie[carteId] || 0) + 1;
		const sue = b.erreurs[carteId] ? b.serie[carteId] >= 2 : true;
		if (sue) b.sues++;
		else
			b.file.splice(
				Math.min(b.file.length, hasard(RETOUR_APRES_REUSSITE)),
				0,
				carteId,
			);
	} else {
		b.serie[carteId] = 0;
		b.erreurs[carteId] = (b.erreurs[carteId] || 0) + 1;
		b.file.splice(
			Math.min(b.file.length, hasard(RETOUR_APRES_ERREUR)),
			0,
			carteId,
		);
	}
	// temps passé, sans compter les pauses de plus de 2 minutes
	const maintenant = Date.now();
	b.duree += Math.min(maintenant - (s.derniere || maintenant), 2 * MIN);
	s.derniere = maintenant;
	sauver();
}

function renderApprendre(app, paquet, r) {
	if (!assezPourQCM(paquet)) return finEntrainement(app, PAS_ASSEZ);
	if (!session || session.type !== "apprendre") {
		const b = progressionApprendre(paquet, r);
		// À chaque ouverture, les cartes restantes sont remélangées : sinon on
		// retrouve exactement la même suite en revenant (la progression, elle, est gardée)
		b.file = melanger(b.file);
		sauver();
		session = {
			type: "apprendre",
			b,
			q: null,
			choisi: null,
			derniere: Date.now(),
		};
	}
	const s = session;
	const b = s.b;

	if (!b.file.length && s.choisi === null) {
		const ratees = Object.entries(b.erreurs)
			.sort((x, y) => y[1] - x[1])
			.slice(0, 12)
			.map(([id]) => trouverCarte(paquet, id))
			.filter(Boolean);
		const nbErreurs = Object.values(b.erreurs).reduce((n, x) => n + x, 0);
		return finEntrainement(app, {
			titre: { ic: "🎓", texte: "Tu connais tout le paquet !" },
			texte: `${pluriel(b.total, "carte")} sues en ${Math.max(1, Math.round(b.duree / MIN))} min${nbErreurs ? ` · ${pluriel(nbErreurs, "erreur corrigée", "erreurs corrigées")} en route` : " · sans une erreur"}.${ratees.length ? " Relis celles qui t'ont donné du fil à retordre :" : ""}`,
			liste: ratees,
			titreListe: "Un dernier coup d'œil",
			boutons: `<button class="btn large" data-action="recommencer"><i class="bx bx-revision"></i>Recommencer le paquet</button>
				<button class="btn large secondaire" data-action="retour-paquet">Retour au paquet</button>`,
		});
	}

	// après une réponse, la question reste affichée (avec la correction) jusqu'à « Continuer »
	if (s.choisi === null && (!s.q || s.q.carteId !== b.file[0])) {
		s.q = questionQCM(paquet, trouverCarte(paquet, b.file[0]));
		s.choisi = null;
	}
	const q = s.q;
	const repondu = s.choisi !== null;
	const dejaRatee = b.erreurs[q.carteId];

	app.innerHTML = `
	${enteteEntrainement(`Apprendre <span>${b.sues} / ${b.total}</span>`, b.sues / b.total)}
	<main class="wrap etude">
		<div class="tri-compteurs">
			<span class="tc">${pluriel(b.file.length, "carte restante", "cartes restantes")}</span>
			${dejaRatee ? `<span class="tc orange">À revoir · ${b.serie[q.carteId] ? "plus qu'une fois" : "2 fois juste"}</span>` : ""}
		</div>
		<div class="carte-etude statique">
			${sourceHtml(trouverCarte(paquet, q.carteId))}
			<div class="ce-question ${tailleTexte(q.question)}">${esc(q.question)}</div>
		</div>
		${lexiqueHtml(q.question, ...q.choix)}
		${choixHtml(q, s.choisi)}
		${repondu && s.choisi !== q.bonne ? `<button class="btn large" data-action="suivante" id="btnSuivante">Continuer<i class="bx bx-right-arrow-alt"></i></button>` : ""}
	</main>`;
	$("#btnSuivante")?.focus();
	clavier = clavierQCM(q, repondu);
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
		session = {
			type: "associer",
			tuiles,
			trouvees: new Set(),
			selection: null,
			erreur: null,
			debut: Date.now(),
			penalite: 0,
			fin: null,
		};
	}
	const s = session;

	if (s.fin) {
		const temps = s.fin - s.debut + s.penalite;
		const record = paquet.meilleurAssocier;
		const nouveauRecord = !record || temps < record;
		if (nouveauRecord && !s.recordEnregistre) {
			paquet.meilleurAssocier = temps;
			if (paquet.virtuel) state.mix.meilleurAssocier = temps;
			s.recordEnregistre = true;
			sauver();
		}
		return finEntrainement(app, {
			titre: { ic: nouveauRecord ? "🏆" : "⏱️", texte: formatChrono(temps) },
			texte: nouveauRecord
				? "Nouveau record !"
				: `Record : ${formatChrono(record)}`,
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
			<h2>Abréviations</h2>
			<div class="bloc-texte explications">
				${LEXIQUE.map((l) => `<p><b>${esc(l.abr)}</b> ${esc(l.sens)}</p>`).join("")}
			</div>
		</section>

		<section class="bloc">
			<h2>Comment ça marche ?</h2>
			<div class="bloc-texte explications">
				<p><b>Réviser</b> utilise la répétition espacée. Après chaque carte, dis si tu t'en souvenais. Une carte bien sue revient de plus en plus tard (1 jour, 3 jours, 1 semaine, 1 mois…). Une carte oubliée revient tout de suite. Tu révises donc surtout ce que tu es en train d'oublier.</p>
				<p><b>Conseil :</b> fais tes révisions tous les jours, même 5 minutes. C'est la régularité qui fait tout.</p>
				<p><b>Examen bientôt ?</b> Utilise <b>Apprendre</b> : un QCM sur tout le paquet. Une carte que tu ne sais pas encore revient quelques questions plus tard, jusqu'à ce que tu l'aies juste 2 fois d'affilée. Ta progression est gardée si tu fermes l'appli.</p>
				<p><b>Apprendre, Quiz, Cartes et Associer</b> sont des entraînements libres : ils ne changent pas le planning des révisions.</p>
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
			const remplaces = donnees.paquets.filter((p) =>
				existants.has(p.id),
			).length;
			confirmer({
				titre: "Importer la sauvegarde ?",
				texte: `${pluriel(donnees.paquets.length, "paquet")} trouvés.${remplaces ? ` ${pluriel(remplaces, "paquet")} déjà présent${remplaces > 1 ? "s" : ""} sera remplacé${remplaces > 1 ? "s" : ""}.` : ""} Tes autres paquets sont conservés.`,
				bouton: "Importer",
				surOk: () => {
					for (const p of donnees.paquets) {
						const i = state.paquets.findIndex((x) => x.id === p.id);
						if (i >= 0) state.paquets[i] = p;
						else state.paquets.push(p);
					}
					for (const [j, v] of Object.entries(donnees.journal)) {
						state.journal[j] = {
							revues: Math.max(state.journal[j]?.revues || 0, v.revues || 0),
						};
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
					const p = nouveauPaquet(
						$("#nomPaquet").value,
						new FormData(e.target).get("couleur"),
					);
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
					$("#ajoutInfo").textContent =
						`✓ ${pluriel(ajoutees, "carte ajoutée", "cartes ajoutées")}`;
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
					const { cartes, sep } = analyserImport(
						zone.value,
						$("#sepImport").value,
						$("#sepCartes").value,
					);
					const btn = $("#btnImport");
					btn.disabled = !cartes.length;
					btn.textContent = cartes.length
						? `Importer ${pluriel(cartes.length, "carte")}`
						: "Importer";
					$("#apercu").innerHTML = cartes.length
						? `<p class="apercu-k">${pluriel(cartes.length, "carte détectée", "cartes détectées")}${$("#sepImport").value === "auto" ? ` · séparateur : ${SEPARATEURS[sep].label.toLowerCase()}` : ""}</p>
						${cartes
							.slice(0, 3)
							.map(
								([r, v]) =>
									`<div class="apercu-ligne"><b>${esc(r)}</b><span>${esc(v)}</span></div>`,
							)
							.join(
								"",
							)}${cartes.length > 3 ? `<p class="apercu-plus">… et ${cartes.length - 3} autres</p>` : ""}`
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
					const { cartes } = analyserImport(
						zone.value,
						$("#sepImport").value,
						$("#sepCartes").value,
					);
					if (!cartes.length) return;
					paquet.cartes.push(...cartes.map(([r, v]) => nouvelleCarte(r, v)));
					sauver();
					fermerFeuille();
					toast(
						`${pluriel(cartes.length, "carte importée", "cartes importées")}`,
					);
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
						toast("Copié !");
					} catch {
						$("#texteExport").select();
						toast("Sélectionne le texte et copie-le");
					}
				}),
		},
	);
}

/* ================= Paquets prêts (dossier paquets/) ================= */
let catalogue = null;

async function chargerCatalogue() {
	if (catalogue) return catalogue;
	const res = await fetch("paquets/catalogue.json", { cache: "no-cache" });
	if (!res.ok) throw new Error("HTTP " + res.status);
	catalogue = await res.json();
	return catalogue;
}

const dejaAjoute = (entree) =>
	state.paquets.some((p) => p.source === entree.id);

async function ajouterPaquetPret(entree) {
	const res = await fetch(`paquets/${entree.fichier}`, { cache: "no-cache" });
	if (!res.ok) throw new Error("HTTP " + res.status);
	const d = await res.json();
	const p = nouveauPaquet(d.nom || entree.nom, d.couleur || entree.couleur);
	p.sens = d.sens || "recto";
	p.source = entree.id;
	p.cartes = (d.cartes || []).map(([r, v, source]) =>
		nouvelleCarte(r, v, source),
	);
	state.paquets.push(p);
	return p;
}

async function feuillePaquetsPrets() {
	ouvrirFeuille(
		`<h2>Paquets prêts</h2><p class="feuille-texte">Chargement…</p>`,
	);
	let cat;
	try {
		cat = await chargerCatalogue();
	} catch {
		ouvrirFeuille(
			`<h2>Paquets prêts</h2><p class="feuille-texte">Impossible de charger la liste. Vérifie ta connexion et réessaie.</p>
			<button class="btn large secondaire" data-action="fermer">Fermer</button>`,
		);
		return;
	}
	const dessiner = () => {
		$("#feuille").innerHTML =
			`<div class="feuille-poignee"></div><h2>Paquets prêts</h2>
		${cat.groupes
			.map((g, gi) => {
				const restants = g.paquets.filter((e) => !dejaAjoute(e));
				return `<div class="groupe-prets">
				<div class="groupe-tete"><b>${esc(g.nom)}</b>
					${restants.length ? `<button class="puce" data-action="pret-tout" data-g="${gi}"><i class="bx bx-plus"></i>Tout ajouter (${restants.length})</button>` : ""}
				</div>
				${g.paquets
					.map(
						(e, pi) => `<div class="pret" style="--c:${e.couleur}">
					<span class="paquet-pastille petite">${esc(initiale(e.nom))}</span>
					<span class="pret-corps"><b>${esc(e.nom)}</b><span>${pluriel(e.n, "carte")} · ${esc(e.description || "")}</span></span>
					${
						dejaAjoute(e)
							? `<span class="pret-ok"><i class="bx bx-check"></i></span>`
							: `<button class="rond petit" data-action="pret-un" data-g="${gi}" data-p="${pi}" aria-label="Ajouter"><i class="bx bx-plus"></i></button>`
					}
				</div>`,
					)
					.join("")}
			</div>`;
			})
			.join("")}
		<button class="btn large secondaire" data-action="fermer">Fermer</button>`;
	};
	feuillePaquetsPrets.dessiner = dessiner;
	feuillePaquetsPrets.cat = cat;
	dessiner();
}

// Un paquet prêt peut en remplacer d'anciens (ex. les paquets « par thème »
// remplacés par un paquet par cours) : on propose de les supprimer, sinon
// « Tout mélanger » aurait chaque carte en double.
async function ajouterPrets(entrees) {
	const remplaces = new Set(
		entrees.filter((e) => !dejaAjoute(e)).flatMap((e) => e.remplace || []),
	);
	const anciens = state.paquets.filter(
		(p) => p.source && remplaces.has(p.source),
	);
	if (!anciens.length) return ajouterEtRemplacer(entrees, []);
	confirmer({
		titre: "Remplacer les anciens paquets\u00a0?",
		texte: `Ces paquets par cours remplacent ${pluriel(anciens.length, "ancien paquet", "anciens paquets")} par thème (${anciens
			.map((p) => esc(p.nom))
			.join(
				", ",
			)}). Ils seront supprimés, avec leur progression, pour ne pas avoir les mêmes cartes en double.`,
		bouton: "Remplacer",
		surOk: () => ajouterEtRemplacer(entrees, anciens),
	});
}

async function ajouterEtRemplacer(entrees, anciens) {
	try {
		for (const e of entrees) if (!dejaAjoute(e)) await ajouterPaquetPret(e);
		if (anciens.length) {
			const ids = new Set(anciens.map((p) => p.id));
			state.paquets = state.paquets.filter((p) => !ids.has(p.id));
			for (const id of ids) delete state.apprendre[id];
			state.mix.exclus = state.mix.exclus.filter((id) => !ids.has(id));
		}
		// le mélange a changé : sa progression « Apprendre » repart de zéro
		delete state.apprendre[ID_TOUT];
		sauver();
		toast(
			entrees.length > 1
				? `${pluriel(entrees.length, "paquet ajouté", "paquets ajoutés")}`
				: "Paquet ajouté",
		);
	} catch {
		sauver();
		toast("Erreur de chargement, réessaie");
	}
	if ($("#feuilleFond").classList.contains("ouvert"))
		feuillePaquetsPrets.dessiner?.();
	render();
}

/* ================= Actions (clics) ================= */
const paquetCourant = () =>
	routeCourante?.id && trouverPaquet(routeCourante.id);

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
	"paquets-prets": feuillePaquetsPrets,
	"mix-tous": () => {
		state.mix.exclus = [];
		changerMelange();
	},
	"pret-un": (el) =>
		ajouterPrets([
			feuillePaquetsPrets.cat.groupes[el.dataset.g].paquets[el.dataset.p],
		]),
	"pret-tout": (el) =>
		ajouterPrets(feuillePaquetsPrets.cat.groupes[el.dataset.g].paquets),
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
			titre: "Remettre à zéro ?",
			texte:
				"Toutes les cartes redeviennent « jamais vues ». Les cartes elles-mêmes sont conservées.",
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
			titre: `Supprimer « ${esc(p.nom)} » ?`,
			texte: `${pluriel(p.cartes.length, "carte")} et toute la progression seront effacées. Impossible de revenir en arrière.`,
			bouton: "Supprimer",
			danger: true,
			surOk: () => {
				state.paquets = state.paquets.filter((x) => x.id !== p.id);
				delete state.apprendre[p.id];
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
		if (nd.jour !== jourCle())
			Object.assign(nd, { jour: jourCle(), n: 0, bonus: 0 });
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
		if (type === "apprendre") {
			const p = paquetCourant();
			const reset = () => {
				delete state.apprendre[p.id];
				sauver();
				session = null;
				render();
			};
			const b = session.b;
			if (!b.file.length || !b.faites) return reset();
			return confirmer({
				titre: "Recommencer à zéro ?",
				texte: `Tu en es à ${b.sues} / ${b.total} cartes sues. Ta progression dans Apprendre pour ce paquet repartira de zéro.`,
				bouton: "Recommencer",
				danger: true,
				surOk: reset,
			});
		}
		session =
			type === "cartes"
				? {
						ids: melanger(
							cartesEntrainement(paquetCourant(), routeCourante).map(
								(c) => c.id,
							),
						),
					}
				: null;
		render();
	},
	choisir: (el) => choisir(+el.dataset.i),
	suivante: () => {
		const s = session;
		if (!s || s.choisi === null) return;
		if (s.type === "quiz") s.i++;
		else s.q = null;
		s.choisi = null;
		render();
	},
	"quiz-erreurs": () => {
		session = { ids: [...new Set(session.erreurs)] };
		render();
	},
	associer: (el) => associer(el.dataset.cle),
	"nouvelles-moins": () => {
		state.reglages.nouvellesParJour = Math.max(
			0,
			state.reglages.nouvellesParJour - 5,
		);
		sauver();
		render();
	},
	"nouvelles-plus": () => {
		state.reglages.nouvellesParJour = Math.min(
			400,
			state.reglages.nouvellesParJour + 5,
		);
		sauver();
		render();
	},
	"sauvegarde-exporter": () => {
		const blob = new Blob([JSON.stringify(state, null, 1)], {
			type: "application/json",
		});
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
			titre: "Tout effacer ?",
			texte:
				"Tous les paquets, toutes les cartes et toute la progression seront supprimés de cet appareil.",
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
	if (e.key === "Escape" && $("#feuilleFond").classList.contains("ouvert"))
		return fermerFeuille();
	if ($("#feuilleFond").classList.contains("ouvert")) return;
	const t = e.target;
	if (t.matches?.("input, textarea, select")) return;
	if (e.metaKey || e.ctrlKey || e.altKey) return;
	if (clavier?.(e)) e.preventDefault();
});

window.addEventListener("hashchange", () => {
	// une feuille ouverte (bouton retour du téléphone…) ne doit pas rester par-dessus la nouvelle page
	fermerFeuille();
	render();
});

/* ================= Démarrage ================= */
render();

// Demande au navigateur de ne pas effacer les données en cas de manque de place
navigator.storage?.persist?.().catch(() => {});

if ("serviceWorker" in navigator) {
	// Une nouvelle version vient de s'installer : on recharge pour l'afficher
	// (sauf au tout premier lancement, où il n'y avait pas d'ancienne version)
	if (navigator.serviceWorker.controller) {
		let recharge = false;
		navigator.serviceWorker.addEventListener("controllerchange", () => {
			if (recharge) return;
			recharge = true;
			location.reload();
		});
	}
	window.addEventListener("load", () => {
		navigator.serviceWorker
			.register("./sw.js", { scope: "./" })
			.catch((err) => console.error("Échec enregistrement SW:", err));
	});
}
