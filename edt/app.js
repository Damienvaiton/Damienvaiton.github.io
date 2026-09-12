"use strict";

// =========================================================
// ---------------- Configuration ----------------
// =========================================================
const DEFAULT_ICS_URL = "https://edt-poitiers.damientiti01.workers.dev";
const WORKER_BASE_URL = "https://edt-poitiers.damientiti01.workers.dev";
const CROUS_RESTAURANT_ID = 48; // R.U. Rabelais - Poitiers
const CROUS_MEAL_TYPE = "midi";
const VAPID_PUBLIC_KEY =
	"BJnOjwifo7rq3u8zvL-KdGTL3mV7y5FyrMLaY_QFS90NP60Qs1Wyq4LKdhs0wAu8N8cP0AYJUCEx3lBZ9dFfAUs";

function crousDateParam(date) {
	// L'API attend le format DD-MM-YYYY (confirmé par le message d'erreur de l'API)
	return `${pad(date.getDate())}-${pad(date.getMonth() + 1)}-${date.getFullYear()}`;
}
function crousMenuApiUrl(date) {
	return `https://api.croustillant.menu/v1/restaurants/${CROUS_RESTAURANT_ID}/menu/${crousDateParam(date)}`;
}
const TAYLOR_API_URL =
	"https://taylor-swift-api.sarbo.workers.dev/lyrics?shouldRandomizeLyrics=true&numberOfParagraphs=1";

const CACHE_KEY = "edt_ics_cache_v1";
const URL_KEY = "edt_ics_url_v1";
const FP_KEY = "edt_ics_fingerprints_v1";
const VIEW_MODE_KEY = "loulouedt_view_mode";
const TAYLOR_SHOWN_KEY = "loulouedt_taylor_shown_date";
const TAYLOR_LYRIC_KEY = "loulouedt_taylor_lyric";
const GROUP_TD_KEY = "edt_group_td_v1";
const GROUP_LANG_KEY = "edt_group_lang_v1";
const DEFAULT_GROUP_TD = "G8";
const DEFAULT_GROUP_LANG = "GH";

const DAY_GRID_START_HOUR = 7;
const DAY_GRID_END_HOUR = 20;
const HOUR_PX = 72; // hauteur d'une heure dans la grille horaire (px), pour la rendre scrollable

// Mots-clés (sur le TITRE uniquement) qui déclenchent la mise en avant "examen".
// \b = bordure de mot, donc "DS" ne matche pas dans un mot plus long, mais peut
// matcher un code de salle du style "DS12" -> à ajuster ici si ça arrive en pratique.
const EXAM_KEYWORDS = [
	"EXAMEN",
	"EXAM",
	"PARTIEL",
	"DS",
	"CONTR[OÔ]LE",
	"[EÉ]VALUATION",
	"INTERRO",
];
// \b en JS ignore les lettres accentuées (ex: ÉVALUATION) : on redéfinit la
// frontière de mot à la main pour que ça matche correctement.
const EXAM_KEYWORDS_RE = new RegExp(
	`(?<![\\p{L}\\p{N}_])(${EXAM_KEYWORDS.join("|")})(?![\\p{L}\\p{N}_])`,
	"iu",
);

const MONTH_NAMES = [
	"janvier",
	"février",
	"mars",
	"avril",
	"mai",
	"juin",
	"juillet",
	"août",
	"septembre",
	"octobre",
	"novembre",
	"décembre",
];

// =========================================================
// ---------------- State ----------------
// =========================================================
let rawEvents = []; // tous les événements du calendrier source, avant filtrage par groupe
let events = []; // événements filtrés pour le groupe TD / langue sélectionné
let currentView = "day"; // day | week | month
let dayMode = localStorage.getItem(VIEW_MODE_KEY) === "grid" ? "grid" : "list";
let selectedDay = startOfDay(new Date());
let weekCursor = startOfWeek(new Date());
let monthCursor = startOfMonth(new Date());
let fetchInFlight = false;

const el = (id) => document.getElementById(id);
let statusLine;

// =========================================================
// ---------------- Date helpers ----------------
// =========================================================
function startOfDay(d) {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
function startOfMonth(d) {
	return new Date(d.getFullYear(), d.getMonth(), 1);
}
function addDays(d, n) {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
}
function addMonths(d, n) {
	return new Date(d.getFullYear(), d.getMonth() + n, 1);
}
function startOfWeek(d) {
	const x = startOfDay(d);
	const dow = (x.getDay() + 6) % 7;
	return addDays(x, -dow);
}
function sameDay(a, b) {
	return (
		a.getFullYear() === b.getFullYear() &&
		a.getMonth() === b.getMonth() &&
		a.getDate() === b.getDate()
	);
}
function pad(n) {
	return String(n).padStart(2, "0");
}
function dateKey(d) {
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function escapeHtml(s) {
	return String(s).replace(
		/[&<>"']/g,
		(c) =>
			({
				"&": "&amp;",
				"<": "&lt;",
				">": "&gt;",
				'"': "&quot;",
				"'": "&#39;",
			})[c],
	);
}

// =========================================================
// ---------------- Minimal ICS parser ----------------
// =========================================================
function unfoldLines(text) {
	const rawLines = text.split(/\r\n|\n|\r/);
	const out = [];
	for (const line of rawLines) {
		if ((line.startsWith(" ") || line.startsWith("\t")) && out.length) {
			out[out.length - 1] += line.slice(1);
		} else {
			out.push(line);
		}
	}
	return out;
}

function parseICSDate(value) {
	value = value.trim();
	const m = value.match(
		/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/,
	);
	if (!m) return null;
	const [, y, mo, da, h = "0", mi = "0", se = "0", z] = m;
	if (z === "Z") {
		return new Date(Date.UTC(+y, +mo - 1, +da, +h, +mi, +se));
	}
	return new Date(+y, +mo - 1, +da, +h, +mi, +se);
}

function unescapeText(s) {
	return s
		.replace(/\\n/gi, "\n")
		.replace(/\\,/g, ",")
		.replace(/\\;/g, ";")
		.replace(/\\\\/g, "\\");
}

function parseICS(text) {
	const lines = unfoldLines(text);
	const out = [];
	let cur = null;
	for (const line of lines) {
		if (line.startsWith("BEGIN:VEVENT")) {
			cur = {};
		} else if (line.startsWith("END:VEVENT")) {
			if (cur && cur.start) {
				cur.teacher = extractTeacher(cur.description, cur.title);
				out.push(cur);
			}
			cur = null;
		} else if (cur) {
			const idx = line.indexOf(":");
			if (idx === -1) continue;
			const rawKey = line.slice(0, idx);
			const value = line.slice(idx + 1);
			const key = rawKey.split(";")[0].toUpperCase();
			if (key === "SUMMARY") cur.title = unescapeText(value);
			else if (key === "LOCATION") cur.location = unescapeText(value);
			else if (key === "DESCRIPTION") cur.description = unescapeText(value);
			else if (key === "DTSTART") cur.start = parseICSDate(value);
			else if (key === "DTEND") cur.end = parseICSDate(value);
			else if (key === "UID") cur.uid = value;
		}
	}
	return out.filter((e) => e.start && e.end);
}

function dedupeEvents(list) {
	const map = new Map();
	for (const e of list) {
		const key = e.uid || `${e.start.getTime()}|${e.end.getTime()}|${e.title || ""}`;
		map.set(key, e);
	}
	return Array.from(map.values()).sort((a, b) => a.start - b.start);
}

// =========================================================
// ---------------- Extraction de l'enseignant ----------------
// Format ADE Campus : la DESCRIPTION contient plusieurs lignes /
// champs séparés par des virgules mêlant type de cours, groupes
// (G8, GH, GA-L1...) et le nom de l'enseignant. On ignore les
// lignes de groupes et métadonnées et on retient le premier
// segment qui ressemble à "NOM Prénom".
// =========================================================
function extractTeacher(description, title) {
	if (!description) return null;
	const tokens = description
		.split(/\n|,/)
		.map((t) => t.trim())
		.filter(Boolean);

	const groupRe = /^(G\d{1,2}|G[A-K])(-L\d+)?$/i;
	// Convention ADE observée : NOM (tout en majuscules) suivi d'un ou
	// plusieurs prénoms/particules, en majuscules ou en casse normale
	// (ex. "BERNELA BASTIEN", "DUPONT Jean", "PEREZ Maria-Luz").
	const nameRe =
		/^[A-ZÀ-Ÿ]{2,}(?:[-'’][A-ZÀ-Ÿ]{2,})*(?:\s+[A-ZÀ-Ÿa-zà-ÿ][A-Za-zà-ÿ'’-]*){1,3}$/;
	const titleLower = (title || "").trim().toLowerCase();

	for (const token of tokens) {
		if (groupRe.test(token)) continue;
		if (/\d/.test(token)) continue; // exclut dates, salles, groupes numérotés
		if (token.toLowerCase() === titleLower) continue; // ligne = titre du cours répété
		if (nameRe.test(token)) return token.toUpperCase();
	}
	return null;
}

// =========================================================
// ---------------- Détection examens / DS ----------------
// =========================================================
function isExamEvent(e) {
	return EXAM_KEYWORDS_RE.test(e.title || "");
}

// =========================================================
// ---------------- Matières : couleur "album" + vignette ----------------
// Chaque matière est mappée à une des 12 couleurs d'album, et éventuellement
// à une vignette (petite image) quand on en a une (anglais, maths...).
// Pour ajouter/ajuster une matière : modifier SUBJECT_RULES ci-dessous.
// =========================================================
const ALBUM_COLORS = {
	taylorSwift: "#C3E1BD",
	fearless: "#FFDAA3",
	speakNow: "#C3A6C6",
	red: "#D14546",
	nineteen89: "#B1DAED",
	reputation: "#5B5C5E",
	lover: "#F0A9C7",
	folklore: "#C6C1BB",
	evermore: "#BDA58B",
	midnights: "#2E3347",
	ttpd: "#7D7D7D",
	tloas: "#F49402",
};

// Règles de détection (sur le TITRE, en majuscules) -> album + icône + vignette.
// L'ordre compte : la première règle qui matche est utilisée.
const SUBJECT_RULES = [
	{ test: /ANGLAIS|ENGLISH|\bTOEIC\b/, album: "lover", icon: "bx-flag" },
	{ test: /MATH|ALG[EÈ]BRE|ANALYSE|STAT/, album: "nineteen89", icon: "bx-math" },
	{ test: /INFO|ALGO|PROGRAM|DEV|SQL|RESEAU|R[ÉE]SEAU/, album: "midnights", icon: "bx-code-alt" },
	{ test: /FRAN[CÇ]AIS|LETTRES|LITT[ÉE]RATURE/, album: "folklore", icon: "bx-book-open" },
	{ test: /HISTOIRE|G[ÉE]O(GRAPHIE)?/, album: "evermore", icon: "bx-map-alt" },
	{ test: /PHYSIQUE|CHIMIE|SVT|BIOLOGIE/, album: "reputation", icon: "bx-atom" },
	{ test: /SPORT|EPS/, album: "fearless", icon: "bx-run" },
	{ test: /ECO(NOMIE)?|GESTION|COMPTA/, album: "tloas", icon: "bx-line-chart" },
	{ test: /DROIT|JURIDIQUE/, album: "speakNow", icon: "bx-briefcase-alt" },
	{ test: /PROJET|TUTOR/, album: "red", icon: "bx-bulb" },
];
const DEFAULT_SUBJECT = { album: "taylorSwift", icon: "bx-book", thumb: null };

// ---------------- Type de séance : CM vs TD ----------------
// TD = la description contient un groupe précis (G1, G8, GH, GC, ...).
// CM = pas de groupe détecté (amphi, toute la promo).
const SESSION_GROUP_RE = /\b(G\d+|G[A-K])(-L\d+)?\b/i;
function isTD(e) {
	const desc = (e.description || "").toUpperCase();
	return SESSION_GROUP_RE.test(desc);
}

// Vignettes par type de séance (déposer les fichiers dans /assets/).
const THUMBS = {
	cm: "assets/thumb-cm.png",
	anglaisTd: "assets/thumb-anglais-td.png",
	mathsTd: "assets/thumb-maths-td.png",
};
const MATHS_TITLE_RE = /MATH|ALG[EÈ]BRE|ANALYSE|STAT/;
const ANGLAIS_TITLE_RE = /ANGLAIS|ENGLISH|\bTOEIC\b/;

function getSessionThumb(e) {
	const title = (e.title || "").toUpperCase();
	const td = isTD(e);
	if (td && ANGLAIS_TITLE_RE.test(title)) return THUMBS.anglaisTd;
	if (td && MATHS_TITLE_RE.test(title)) return THUMBS.mathsTd;
	if (!td) return THUMBS.cm;
	return null; // TD sans vignette dédiée -> on retombe sur l'icône de matière
}

function getSubjectInfo(e) {
	const title = (e.title || "").toUpperCase();
	const rule = SUBJECT_RULES.find((r) => r.test.test(title));
	const base = rule
		? { album: rule.album, icon: rule.icon || DEFAULT_SUBJECT.icon }
		: DEFAULT_SUBJECT;
	return { ...base, thumb: getSessionThumb(e) };
}

function albumColor(albumKey) {
	return ALBUM_COLORS[albumKey] || ALBUM_COLORS.taylorSwift;
}

// =========================================================
// ---------------- Empreinte (détection de changement) ----------------
// =========================================================
function fingerprint(e) {
	return `${e.title || ""}|${e.start.getTime()}|${e.end.getTime()}|${e.location || ""}`;
}
function sameFingerprintSet(a, b) {
	if (a.length !== b.length) return false;
	const sa = new Set(a);
	for (const x of b) if (!sa.has(x)) return false;
	return true;
}
function getStoredFingerprints() {
	try {
		const raw = localStorage.getItem(FP_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

// =========================================================
// ---------------- Filtre étudiant (groupe TD / langue) ----------------
// =========================================================
function getGroupPrefs() {
	return {
		td: localStorage.getItem(GROUP_TD_KEY) || DEFAULT_GROUP_TD,
		lang: localStorage.getItem(GROUP_LANG_KEY) || DEFAULT_GROUP_LANG,
	};
}

function isEventForStudent(e, prefs) {
	const { td, lang } = prefs || getGroupPrefs();
	const desc = (e.description || "").toUpperCase();
	const title = (e.title || "").toUpperCase();

	// 1. Cours d'anglais : uniquement le groupe de langue choisi
	if (title.includes("ANGLAIS")) {
		return desc.includes(lang);
	}

	// 2. Vérification des sous-groupes (G1 à G12, GA à GK)
	const groupMatch = desc.match(/\b(G\d+|G[A-K])(-L\d+)?\b/);

	if (groupMatch) {
		const group = groupMatch[1];
		// Si c'est un groupe de TD numéroté (G1, G2, etc.), ne garder que le groupe TD choisi
		if (/^G\d+$/.test(group)) {
			return group === td;
		}
		// Écarter les autres groupes de langues parasites
		return false;
	}

	// 3. Conserver tous les cours en amphi communs
	return true;
}

// Détecte les groupes réellement présents dans le calendrier chargé, pour
// remplir les listes déroulantes du picker sans que l'utilisateur ait à
// connaître/taper les codes ADE à la main.
function extractAvailableGroups(list) {
	const td = new Set();
	const lang = new Set();
	for (const e of list) {
		const desc = (e.description || "").toUpperCase();
		const matches = desc.match(/\bG(?:\d{1,2}|[A-K])(?:-L\d+)?\b/g) || [];
		for (const m of matches) {
			const base = m.split("-")[0];
			if (/^G\d+$/.test(base)) td.add(base);
			else lang.add(base);
		}
	}
	// Repli si le calendrier n'est pas encore chargé : plage générique ADE habituelle
	if (!td.size) for (let i = 1; i <= 12; i++) td.add("G" + i);
	if (!lang.size) "ABCDEFGHIJK".split("").forEach((l) => lang.add("G" + l));
	return {
		td: Array.from(td).sort((a, b) => parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)),
		lang: Array.from(lang).sort(),
	};
}

function populateGroupPickers() {
	const tdSelect = el("groupTdSelect");
	const langSelect = el("groupLangSelect");
	if (!tdSelect || !langSelect) return;

	const { td, lang } = extractAvailableGroups(rawEvents);
	const prefs = getGroupPrefs();
	// On garde la valeur enregistrée sélectionnable même si elle n'apparaît
	// pas (encore) dans le calendrier actuellement chargé.
	if (!td.includes(prefs.td)) td.push(prefs.td);
	if (!lang.includes(prefs.lang)) lang.push(prefs.lang);

	tdSelect.innerHTML = td.map((g) => `<option value="${g}">${g}</option>`).join("");
	langSelect.innerHTML = lang.map((g) => `<option value="${g}">${g}</option>`).join("");
	tdSelect.value = prefs.td;
	langSelect.value = prefs.lang;
}

function applyGroupFilter() {
	const prefs = getGroupPrefs();
	events = rawEvents.filter((e) => isEventForStudent(e, prefs));
	setStatus(`${events.length} cours chargés (${prefs.td} & ${prefs.lang})`, "ok");
}

// =========================================================
// ---------------- Carte de cours (partagée) ----------------
// =========================================================
function courseCardHtml(e, idx) {
	const timeStr = `${pad(e.start.getHours())}:${pad(e.start.getMinutes())}`;
	const endStr = `${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`;
	const exam = isExamEvent(e);
	const subject = getSubjectInfo(e);
	const color = albumColor(subject.album);
	const thumbHtml = subject.thumb
		? `<img class="course-thumb" src="${subject.thumb}" alt="" />`
		: `<div class="course-thumb course-thumb-icon"><i class='bx ${subject.icon}'></i></div>`;
	return `<div class="course-card${exam ? " exam" : ""}" data-idx="${idx}" style="--album:${color}">
    <div class="course-time">${timeStr}<div class="end">${endStr}</div></div>
    ${thumbHtml}
    <div class="course-bar"></div>
    <div class="course-body">
      ${exam ? `<div class="exam-badge"><i class='bx bx-error'></i>Examen</div>` : ""}
      <div class="course-title">${escapeHtml(e.title || "Cours")}</div>
      ${e.location ? `<div class="course-loc"><i class='bx bx-map'></i>${escapeHtml(e.location)}</div>` : ""}
      ${e.teacher ? `<div class="course-teacher"><i class='bx bx-user'></i>${escapeHtml(e.teacher)}</div>` : ""}
    </div>
  </div>`;
}

function wireCourseCards(container) {
	container.querySelectorAll(".course-card").forEach((node) => {
		node.addEventListener("click", () => {
			const e = events[+node.dataset.idx];
			openModal(e);
		});
	});
}

// =========================================================
// ---------------- Day view : liste ----------------
// =========================================================
function renderDayList(dayEvents) {
	const list = el("dayList");
	if (dayEvents.length === 0) {
		list.innerHTML = `<div class="day-empty"><i class='bx bx-coffee'></i>Aucun cours ce jour-là.</div>`;
		return;
	}
	list.innerHTML = dayEvents.map((e) => courseCardHtml(e, events.indexOf(e))).join("");
	wireCourseCards(list);
}

// =========================================================
// ---------------- Day view : grille horaire ----------------
// =========================================================
function renderDayGrid(dayEvents) {
	const wrap = el("dayGridWrap");
	const grid = el("dayGrid");
	const startMin = DAY_GRID_START_HOUR * 60;
	const endMin = DAY_GRID_END_HOUR * 60;
	const totalMin = endMin - startMin;

	if (dayEvents.length === 0) {
		wrap.style.display = "none";
		el("dayGridEmpty").style.display = "block";
		return;
	}
	wrap.style.display = "block";
	el("dayGridEmpty").style.display = "none";
	grid.style.height = `${(totalMin / 60) * HOUR_PX}px`;

	let hoursHtml = "";
	for (let h = DAY_GRID_START_HOUR; h <= DAY_GRID_END_HOUR; h++) {
		const top = ((h * 60 - startMin) / totalMin) * 100;
		hoursHtml += `<div class="grid-hour-line" style="top:${top}%"><span>${pad(h)}:00</span></div>`;
	}

	let eventsHtml = "";
	dayEvents.forEach((e) => {
		const s = Math.max(e.start.getHours() * 60 + e.start.getMinutes(), startMin);
		const en = Math.min(e.end.getHours() * 60 + e.end.getMinutes(), endMin);
		if (en <= startMin || s >= endMin) return;
		const top = ((s - startMin) / totalMin) * 100;
		const height = Math.max(((en - s) / totalMin) * 100, 3.5);
		const exam = isExamEvent(e);
		const subject = getSubjectInfo(e);
		const color = albumColor(subject.album);
		eventsHtml += `<div class="grid-event${exam ? " exam" : ""}" data-idx="${events.indexOf(e)}" style="top:${top}%; height:${height}%; --album:${color}">
      <div class="grid-event-time">${pad(e.start.getHours())}:${pad(e.start.getMinutes())}</div>
      <div class="grid-event-title">${exam ? "<i class='bx bx-error'></i> " : ""}${escapeHtml(e.title || "Cours")}</div>
      ${e.location ? `<div class="grid-event-loc">${escapeHtml(e.location)}</div>` : ""}
    </div>`;
	});

	grid.innerHTML = `<div class="grid-hours">${hoursHtml}</div><div class="grid-events">${eventsHtml}</div>`;
	grid.querySelectorAll(".grid-event").forEach((node) => {
		node.addEventListener("click", () => openModal(events[+node.dataset.idx]));
	});
}

// =========================================================
// ---------------- Ligne "heure actuelle" (vue grille) ----------------
// =========================================================
function renderNowLine({ scrollIntoView = false } = {}) {
	const grid = el("dayGrid");
	const wrap = el("dayGridWrap");
	if (!grid || !wrap) return;

	// La grille est reconstruite à chaque rendu (innerHTML), donc l'ancienne
	// ligne a déjà disparu ; on ne fait rien si elle n'existe plus dans le DOM.
	const isGridVisible = wrap.offsetParent !== null;
	const isToday = sameDay(selectedDay, new Date());
	if (!isToday || !isGridVisible) return;

	const now = new Date();
	const startMin = DAY_GRID_START_HOUR * 60;
	const endMin = DAY_GRID_END_HOUR * 60;
	const nowMin = now.getHours() * 60 + now.getMinutes();
	if (nowMin < startMin || nowMin > endMin) return; // hors plage affichée (ex: cours du soir passé)

	const old = grid.querySelector(".now-line");
	if (old) old.remove();

	const top = ((nowMin - startMin) / (endMin - startMin)) * 100;
	const line = document.createElement("div");
	line.className = "now-line";
	line.style.top = `${top}%`;
	grid.appendChild(line);

	if (scrollIntoView) {
		const lineTopPx = (top / 100) * grid.offsetHeight;
		wrap.scrollTop = Math.max(lineTopPx - wrap.clientHeight / 2, 0);
	}
}

function setDayMode(mode) {
	dayMode = mode;
	localStorage.setItem(VIEW_MODE_KEY, mode);
	el("dayModeListBtn").classList.toggle("active", mode === "list");
	el("dayModeGridBtn").classList.toggle("active", mode === "grid");
	el("dayListWrap").style.display = mode === "list" ? "block" : "none";
	el("dayGridOuter").style.display = mode === "grid" ? "block" : "none";
	// On vient d'ouvrir la grille : on saute directement sur l'heure actuelle.
	renderDay({ autoScrollNow: mode === "grid" });
}

// =========================================================
// ---------------- Day view : orchestration ----------------
// =========================================================
function renderDay({ autoScrollNow = false } = {}) {
	const dayLabel = el("dayLabel");
	const today = new Date();
	const isToday = sameDay(selectedDay, today);
	dayLabel.innerHTML = `${selectedDay.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}
    ${isToday ? `<span class="sub">Aujourd'hui</span>` : ""}`;

	const dayEvents = events.filter((e) => sameDay(e.start, selectedDay));

	if (dayMode === "grid") {
		renderDayGrid(dayEvents);
		renderNowLine({ scrollIntoView: autoScrollNow });
	} else {
		renderDayList(dayEvents);
	}

	updateCrousWidget();
	if (isToday) {
		updateVibeWidget();
	} else {
		hideVibeWidget();
	}
}

// =========================================================
// ---------------- Week view ----------------
// =========================================================
function renderWeek() {
	const weekEnd = addDays(weekCursor, 6);
	const label = el("weekLabel");
	if (weekCursor.getMonth() === weekEnd.getMonth()) {
		label.textContent = `${weekCursor.getDate()}–${weekEnd.getDate()} ${MONTH_NAMES[weekCursor.getMonth()]} ${weekCursor.getFullYear()}`;
	} else {
		label.textContent = `${weekCursor.getDate()} ${MONTH_NAMES[weekCursor.getMonth()]} – ${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
	}

	const today = new Date();
	const list = el("weekList");
	let html = "";
	for (let i = 0; i < 7; i++) {
		const d = addDays(weekCursor, i);
		const isToday = sameDay(d, today);
		const dayEvents = events.filter((e) => sameDay(e.start, d));
		html += `<div class="week-day-block">
      <div class="week-day-header${isToday ? " today" : ""}">
        <span class="wd-num">${d.getDate()}</span>
        <span>${d.toLocaleDateString("fr-FR", { weekday: "long", month: "long" })}</span>
      </div>
      ${
				dayEvents.length
					? `<div class="day-list">${dayEvents.map((e) => courseCardHtml(e, events.indexOf(e))).join("")}</div>`
					: `<div class="day-empty" style="padding:14px 4px; text-align:left;"><i class='bx bx-coffee'></i> Aucun cours</div>`
			}
    </div>`;
	}
	list.innerHTML = html;
	wireCourseCards(list);
}

// =========================================================
// ---------------- Month view ----------------
// =========================================================
function renderMonth() {
	const monthLabel = el("monthLabel");
	monthLabel.textContent = `${MONTH_NAMES[monthCursor.getMonth()]} ${monthCursor.getFullYear()}`;

	const grid = el("monthGrid");
	let html = "";
	["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"].forEach((d) => {
		html += `<div class="month-dow">${d}</div>`;
	});

	const firstOfMonth = monthCursor;
	const firstWeekday = (firstOfMonth.getDay() + 6) % 7;
	const gridStart = addDays(firstOfMonth, -firstWeekday);
	const today = new Date();

	for (let i = 0; i < 42; i++) {
		const d = addDays(gridStart, i);
		const inMonth = d.getMonth() === monthCursor.getMonth();
		const isToday = sameDay(d, today);
		const isSelected = sameDay(d, selectedDay);
		const dayList = events.filter((e) => sameDay(e.start, d));
		const dayHasEvents = dayList.length > 0;
		// Une pastille par matière distincte présente ce jour-là (max 4 pour ne pas déborder)
		const albumsToday = [...new Set(dayList.map((e) => getSubjectInfo(e).album))].slice(0, 4);
		const dotsHtml = albumsToday
			.map((a) => `<div class="m-dot" style="background:${albumColor(a)}"></div>`)
			.join("");
		html += `<div class="month-cell${inMonth ? "" : " out"}${isToday ? " today" : ""}${isSelected ? " selected" : ""}" data-date="${d.toISOString()}">
      <div class="m-num">${d.getDate()}</div>
      <div class="m-dots">${dayHasEvents ? dotsHtml : ""}</div>
    </div>`;
	}
	grid.innerHTML = html;

	grid.querySelectorAll(".month-cell").forEach((node) => {
		node.addEventListener("click", () => {
			selectedDay = startOfDay(new Date(node.dataset.date));
			renderMonth();
			renderMonthDayPanel();
		});
	});

	renderMonthDayPanel();
}

function renderMonthDayPanel() {
	const label = el("monthPanelLabel");
	label.textContent = selectedDay.toLocaleDateString("fr-FR", {
		weekday: "long",
		day: "numeric",
		month: "long",
	});

	const dayEvents = events.filter((e) => sameDay(e.start, selectedDay));
	const list = el("monthDayList");
	if (dayEvents.length === 0) {
		list.innerHTML = `<div class="day-empty" style="padding:30px 16px;"><i class='bx bx-coffee'></i>Aucun cours ce jour-là.</div>`;
		return;
	}
	list.innerHTML = dayEvents.map((e) => courseCardHtml(e, events.indexOf(e))).join("");
	wireCourseCards(list);
}

// =========================================================
// ---------------- View switching (jour/semaine/mois) ----------------
// =========================================================
function setView(view) {
	currentView = view;
	el("viewDayBtn").classList.toggle("active", view === "day");
	el("viewWeekBtn").classList.toggle("active", view === "week");
	el("viewMonthBtn").classList.toggle("active", view === "month");
	el("dayView").style.display = view === "day" ? "block" : "none";
	el("weekView").style.display = view === "week" ? "block" : "none";
	el("monthView").style.display = view === "month" ? "block" : "none";
	// On vient d'ouvrir la vue jour : on saute sur l'heure actuelle si on est en grille.
	renderCurrent({ autoScrollNow: view === "day" });
}

function renderCurrent(opts) {
	if (currentView === "day") renderDay(opts);
	else if (currentView === "week") renderWeek();
	else renderMonth();
}

// =========================================================
// ---------------- Modal ----------------
// =========================================================
function openModal(e) {
	el("modalExamRow").style.display = isExamEvent(e) ? "inline-flex" : "none";
	el("modalTitle").textContent = e.title || "Cours";
	el("modalTime").textContent =
		`${e.start.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })} · ` +
		`${pad(e.start.getHours())}:${pad(e.start.getMinutes())} – ${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`;
	el("modalLocRow").style.display = e.location ? "flex" : "none";
	el("modalLoc").textContent = e.location || "";
	el("modalTeacherRow").style.display = e.teacher ? "flex" : "none";
	el("modalTeacher").textContent = e.teacher || "";
	el("modalDescRow").style.display = e.description ? "flex" : "none";
	el("modalDesc").textContent = e.description || "";
	el("modalBg").classList.add("open");
}

// =========================================================
// ---------------- Widget "Vibe du Soir" (Taylor Swift) ----------------
// =========================================================
function lastCourseEndForToday() {
	const today = startOfDay(new Date());
	const todays = events.filter((e) => sameDay(e.start, today));
	if (!todays.length) return null;
	return todays.reduce((max, e) => (e.end > max ? e.end : max), todays[0].end);
}

async function fetchTaylorLyric() {
	try {
		const res = await fetch(TAYLOR_API_URL, { cache: "no-store" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const data = await res.json();
		const text =
			(typeof data === "string" && data) ||
			data?.lyrics ||
			data?.lyric ||
			data?.paragraph ||
			data?.paragraphs ||
			(Array.isArray(data) ? data.join("\n") : null);
		if (!text || typeof text !== "string") throw new Error("Réponse vide");
		return text.trim();
	} catch {
		return null;
	}
}

function renderVibeWidget(text) {
	const box = el("vibeWidget");
	box.innerHTML = `<i class='bx bx-music'></i><div><div class="vibe-text">${escapeHtml(text)}</div><span class="vibe-label">Vibe du soir</span></div>`;
	box.style.display = "flex";
}

function hideVibeWidget() {
	const box = el("vibeWidget");
	box.style.display = "none";
	box.innerHTML = "";
}

async function updateVibeWidget() {
	const today = dateKey(new Date());
	const shownDate = localStorage.getItem(TAYLOR_SHOWN_KEY);
	const cachedLyric = localStorage.getItem(TAYLOR_LYRIC_KEY);

	// La citation du jour a déjà été chargée : on la ré-affiche sans requête.
	if (shownDate === today && cachedLyric) {
		renderVibeWidget(cachedLyric);
		return;
	}

	// Nouveau jour : on nettoie l'ancienne citation.
	if (shownDate && shownDate !== today) {
		localStorage.removeItem(TAYLOR_SHOWN_KEY);
		localStorage.removeItem(TAYLOR_LYRIC_KEY);
	}

	const lastEnd = lastCourseEndForToday();
	if (!lastEnd) {
		hideVibeWidget();
		return;
	}
	const threshold = new Date(lastEnd.getTime() + 60 * 60 * 1000);
	if (new Date() < threshold) {
		hideVibeWidget();
		return;
	}

	const lyric = await fetchTaylorLyric();
	if (!lyric) {
		hideVibeWidget();
		return;
	}

	localStorage.setItem(TAYLOR_SHOWN_KEY, today);
	localStorage.setItem(TAYLOR_LYRIC_KEY, lyric);
	renderVibeWidget(lyric);
}

// =========================================================
// ---------------- Widget Menu CROUS (rendu natif, plus d'iframe) ----------------
// =========================================================
const crousMenuCache = new Map(); // dateKey -> { state: "ok"|"empty"|"error", lines?: string[] }

async function fetchCrousMenu(date) {
	const key = dateKey(date);
	if (crousMenuCache.has(key)) return crousMenuCache.get(key);

	let result;
	try {
		const res = await fetch(crousMenuApiUrl(date), { cache: "no-store" });
		// On lit toujours le corps JSON, même si le statut HTTP n'est pas 2xx :
		// l'API renvoie un objet {success:false, message:"..."} structuré aussi
		// bien pour "date invalide" que pour "aucun menu pour cette date"
		// (typiquement une date trop lointaine, pas encore publiée par le CROUS).
		// Seule une réponse illisible (pas du JSON, réseau coupé) est une vraie erreur.
		const json = await res.json();

		if (!json.success) {
			// Réponse structurée indiquant qu'il n'y a simplement pas de menu
			// pour cette date (pas encore publié, jour sans service, etc.)
			result = { state: "empty" };
		} else if (!json.data) {
			throw new Error("Réponse invalide");
		} else {
			const repas = (json.data.repas || []).find((r) => r.type === CROUS_MEAL_TYPE);
			if (!repas) {
				result = { state: "empty" };
			} else {
				const cats = [...(repas.categories || [])].sort((a, b) => a.ordre - b.ordre);
				const groups = cats
					.map((cat) => {
						const plats = [...(cat.plats || [])].sort((a, b) => a.ordre - b.ordre);
						return { libelle: cat.libelle, plats: plats.map((p) => p.libelle) };
					})
					.filter((g) => g.plats.length);
				result = groups.length ? { state: "ok", groups } : { state: "empty" };
			}
		}
	} catch {
		result = { state: "error" };
	}

	crousMenuCache.set(key, result);
	return result;
}

function crousMenuHtml(result) {
	if (result.state === "error") {
		return `<div class="crous-empty"><i class='bx bx-wifi-off'></i>Impossible de charger le menu.</div>`;
	}
	if (result.state === "empty") {
		return `<div class="crous-empty"><i class='bx bx-food-menu'></i>Menu non disponible pour ce jour.</div>`;
	}
	return result.groups
		.map(
			(g) => `<div class="crous-group">
        <div class="crous-cat">${escapeHtml(g.libelle)}</div>
        <div class="crous-plats">${g.plats.map((p) => `<div class="crous-plat">${escapeHtml(p)}</div>`).join("")}</div>
      </div>`,
		)
		.join("");
}

async function updateCrousWidget() {
	const section = el("crousSection");
	const box = el("crousWidget");
	const dow = selectedDay.getDay(); // 0 = dimanche ... 6 = samedi
	const isWeekday = dow >= 1 && dow <= 5;

	if (!isWeekday) {
		section.style.display = "none";
		return;
	}
	section.style.display = "block";

	const key = dateKey(selectedDay);
	if (box.dataset.loadedDate === key) return; // déjà affiché pour ce jour

	box.dataset.loadedDate = key;
	box.innerHTML = `<div class="crous-loading"><i class='bx bx-loader-alt bx-spin'></i>Chargement du menu…</div>`;

	const result = await fetchCrousMenu(selectedDay);
	// Le jour a pu changer pendant l'attente réseau : on n'écrase pas un autre jour déjà affiché.
	if (box.dataset.loadedDate !== key) return;
	box.innerHTML = crousMenuHtml(result);
}

// =========================================================
// ---------------- Export PDF (impression de la semaine) ----------------
// Repose sur window.print() + une feuille de style @media print dédiée :
// pas de lib PDF, l'utilisateur choisit "Enregistrer au format PDF" dans
// la boîte de dialogue d'impression native (desktop et mobile).
// =========================================================
function weekPrintHtml(cursor) {
	const weekEnd = addDays(cursor, 6);
	let rangeStr;
	if (cursor.getMonth() === weekEnd.getMonth()) {
		rangeStr = `${cursor.getDate()}–${weekEnd.getDate()} ${MONTH_NAMES[cursor.getMonth()]} ${cursor.getFullYear()}`;
	} else {
		rangeStr = `${cursor.getDate()} ${MONTH_NAMES[cursor.getMonth()]} – ${weekEnd.getDate()} ${MONTH_NAMES[weekEnd.getMonth()]} ${weekEnd.getFullYear()}`;
	}

	let daysHtml = "";
	for (let i = 0; i < 7; i++) {
		const d = addDays(cursor, i);
		const dayEvents = events
			.filter((e) => sameDay(e.start, d))
			.sort((a, b) => a.start - b.start);
		const dayLabel = d.toLocaleDateString("fr-FR", {
			weekday: "long",
			day: "numeric",
			month: "long",
		});

		const coursesHtml = dayEvents.length
			? dayEvents
					.map((e) => {
						const exam = isExamEvent(e);
						const meta = [e.location, e.teacher].filter(Boolean).join(" · ");
						return `<div class="print-course${exam ? " exam" : ""}">
              <div class="pc-time">${pad(e.start.getHours())}:${pad(e.start.getMinutes())}–${pad(e.end.getHours())}:${pad(e.end.getMinutes())}</div>
              <div>
                <div class="pc-title">${exam ? "⚠ " : ""}${escapeHtml(e.title || "Cours")}</div>
                ${meta ? `<div class="pc-meta">${escapeHtml(meta)}</div>` : ""}
              </div>
            </div>`;
					})
					.join("")
			: `<div class="print-empty">Aucun cours</div>`;

		daysHtml += `<div class="print-day">
      <h2>${escapeHtml(dayLabel)}</h2>
      ${coursesHtml}
    </div>`;
	}

	return `<h1>Emploi du temps</h1><div class="print-week-range">${escapeHtml(rangeStr)}</div>${daysHtml}`;
}

function printWeek() {
	el("printArea").innerHTML = weekPrintHtml(weekCursor);
	window.print();
}

// =========================================================
// ---------------- Partage de la journée ----------------
// Partage natif (Web Share API) en image si possible, sinon en texte,
// avec repli sur une copie presse-papier si l'appareil ne supporte rien.
// =========================================================
function dayShareText(dayEvents, day) {
	const dateStr = day.toLocaleDateString("fr-FR", {
		weekday: "long",
		day: "numeric",
		month: "long",
	});
	if (!dayEvents.length) {
		return `Ma journée du ${dateStr}\n\nAucun cours ce jour-là.`;
	}
	const lines = dayEvents.map((e) => {
		const t = `${pad(e.start.getHours())}:${pad(e.start.getMinutes())}–${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`;
		const bits = [t, (isExamEvent(e) ? "⚠ " : "") + (e.title || "Cours")];
		if (e.location) bits.push(`(${e.location})`);
		return bits.join(" ");
	});
	return `Ma journée du ${dateStr}\n\n${lines.join("\n")}`;
}

function roundRectPath(ctx, x, y, w, h, r) {
	ctx.beginPath();
	ctx.moveTo(x + r, y);
	ctx.arcTo(x + w, y, x + w, y + h, r);
	ctx.arcTo(x + w, y + h, x, y + h, r);
	ctx.arcTo(x, y + h, x, y, r);
	ctx.arcTo(x, y, x + w, y, r);
	ctx.closePath();
}

function truncateForCanvas(ctx, text, maxWidth) {
	if (ctx.measureText(text).width <= maxWidth) return text;
	let t = text;
	while (t.length > 1 && ctx.measureText(t + "…").width > maxWidth) {
		t = t.slice(0, -1);
	}
	return t + "…";
}

async function buildDayShareImage(dayEvents, day) {
	if (document.fonts && document.fonts.ready) {
		try {
			await document.fonts.ready;
		} catch {
			// tant pis, on dessine avec les polices dispo à cet instant
		}
	}

	const width = 720;
	const padding = 28;
	const headerHeight = 116;
	const rowHeight = 92;
	const height = headerHeight + (dayEvents.length ? dayEvents.length * rowHeight : 90) + padding;
	const scale = 2; // rendu net sur écrans retina

	const canvas = document.createElement("canvas");
	canvas.width = width * scale;
	canvas.height = height * scale;
	const ctx = canvas.getContext("2d");
	ctx.scale(scale, scale);

	// Fond
	ctx.fillStyle = "#0b0f10";
	ctx.fillRect(0, 0, width, height);

	// En-tête (logo + date)
	ctx.fillStyle = "#c4f24b";
	ctx.beginPath();
	ctx.arc(padding + 5, 34, 5, 0, Math.PI * 2);
	ctx.fill();
	ctx.fillStyle = "#f2f4f3";
	ctx.font = "600 18px 'Space Grotesk', sans-serif";
	ctx.fillText("Edt", padding + 18, 40);

	ctx.font = "600 25px 'Space Grotesk', sans-serif";
	const dateStr = day
		.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })
		.replace(/^\p{L}/u, (c) => c.toUpperCase());
	ctx.fillText(dateStr, padding, 78);

	ctx.strokeStyle = "rgba(255,255,255,0.09)";
	ctx.lineWidth = 1;
	ctx.beginPath();
	ctx.moveTo(padding, headerHeight - 16);
	ctx.lineTo(width - padding, headerHeight - 16);
	ctx.stroke();

	if (!dayEvents.length) {
		ctx.fillStyle = "rgba(242,244,243,0.5)";
		ctx.font = "500 16px 'Space Grotesk', sans-serif";
		ctx.fillText("Aucun cours ce jour-là.", padding, headerHeight + 28);
	} else {
		dayEvents.forEach((e, i) => {
			const y = headerHeight + i * rowHeight;
			const exam = isExamEvent(e);
			const accent = exam ? "#ff6b5e" : "#c4f24b";
			const cardH = rowHeight - 14;

			ctx.fillStyle = "#14191b";
			roundRectPath(ctx, padding, y, width - padding * 2, cardH, 12);
			ctx.fill();

			ctx.fillStyle = accent;
			roundRectPath(ctx, padding, y, 4, cardH, 2);
			ctx.fill();

			ctx.font = "500 15px 'IBM Plex Mono', monospace";
			ctx.fillStyle = accent;
			ctx.fillText(`${pad(e.start.getHours())}:${pad(e.start.getMinutes())}`, padding + 20, y + 30);
			ctx.font = "400 12px 'IBM Plex Mono', monospace";
			ctx.fillStyle = "rgba(242,244,243,0.32)";
			ctx.fillText(`${pad(e.end.getHours())}:${pad(e.end.getMinutes())}`, padding + 20, y + 47);

			if (exam) {
				ctx.fillStyle = "rgba(255,107,94,0.16)";
				roundRectPath(ctx, padding + 96, y + 10, 60, 18, 9);
				ctx.fill();
				ctx.fillStyle = "#ff6b5e";
				ctx.font = "700 10px 'Space Grotesk', sans-serif";
				ctx.fillText("EXAMEN", padding + 104, y + 23);
			}

			ctx.fillStyle = "#f2f4f3";
			ctx.font = "600 17px 'Space Grotesk', sans-serif";
			const titleY = exam ? y + 46 : y + 27;
			ctx.fillText(
				truncateForCanvas(ctx, e.title || "Cours", width - padding * 2 - 116),
				padding + 96,
				titleY,
			);

			if (e.location) {
				ctx.fillStyle = "rgba(242,244,243,0.5)";
				ctx.font = "400 13px 'Space Grotesk', sans-serif";
				ctx.fillText(e.location, padding + 96, titleY + 20);
			}
		});
	}

	return new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
}

async function shareDay() {
	const dayEvents = events
		.filter((e) => sameDay(e.start, selectedDay))
		.sort((a, b) => a.start - b.start);
	const text = dayShareText(dayEvents, selectedDay);
	const shareTitle = "Mon emploi du temps";

	// 1. Partage en image si le navigateur sait partager des fichiers.
	try {
		const blob = await buildDayShareImage(dayEvents, selectedDay);
		if (blob) {
			const file = new File([blob], "ma-journee.png", { type: "image/png" });
			if (navigator.canShare && navigator.canShare({ files: [file] })) {
				await navigator.share({ files: [file], title: shareTitle, text });
				return;
			}
		}
	} catch (err) {
		if (err && err.name === "AbortError") return; // annulé par l'utilisateur
		// sinon on retombe sur le partage texte ci-dessous
	}

	// 2. Partage texte natif.
	if (navigator.share) {
		try {
			await navigator.share({ title: shareTitle, text });
			return;
		} catch (err) {
			if (err && err.name === "AbortError") return;
		}
	}

	// 3. Repli : copie dans le presse-papier.
	try {
		await navigator.clipboard.writeText(text);
		setStatus("Journée copiée dans le presse-papier", "ok");
	} catch {
		setStatus("Partage indisponible sur cet appareil", "error");
	}
}

// =========================================================
// ---------------- Confirmation "Vider le cache" ----------------
// =========================================================
let clearConfirmTimeout = null;

function armClearConfirm() {
	const btn = el("clearBtn");
	btn.classList.add("danger-confirm");
	btn.innerHTML = `<i class='bx bx-error'></i>Confirmer ?`;
	clearTimeout(clearConfirmTimeout);
	clearConfirmTimeout = setTimeout(resetClearConfirm, 4000);
}

function resetClearConfirm() {
	const btn = el("clearBtn");
	if (!btn) return;
	btn.classList.remove("danger-confirm");
	btn.innerHTML = `<i class='bx bx-trash'></i>Vider le cache`;
	clearTimeout(clearConfirmTimeout);
	clearConfirmTimeout = null;
}

// =========================================================
// ---------------- Chargement des données / synchronisation ----------------
// Stratégie : pas de polling en arrière-plan. On synchronise
// uniquement au chargement initial, quand l'app redevient visible,
// et au clic sur le bouton de rafraîchissement. Le cache local
// n'expire jamais automatiquement (suppression manuelle uniquement).
// =========================================================
function setStatus(msg, kind) {
	statusLine.className = "status-line" + (kind ? " " + kind : "");
	statusLine.textContent = msg;
}

function getCache() {
	try {
		const raw = localStorage.getItem(CACHE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}

function loadFromText(text, { persist = true } = {}) {
	rawEvents = dedupeEvents(parseICS(text));
	applyGroupFilter();
	if (persist) {
		localStorage.setItem(CACHE_KEY, JSON.stringify({ text, fetchedAt: Date.now() }));
	}
	populateGroupPickers();
	renderCurrent();
}

async function fetchICS(url, { force = false } = {}) {
	if (!url) {
		setStatus("Aucune source configurée — touche l'icône réglages");
		renderCurrent();
		return;
	}
	if (fetchInFlight && !force) return;
	fetchInFlight = true;
	setStatus("Synchronisation…");
	try {
		const res = await fetch(url, { cache: "no-store" });
		if (!res.ok) throw new Error("HTTP " + res.status);
		const text = await res.text();

		const parsed = dedupeEvents(parseICS(text));
		const newFps = parsed.map(fingerprint);
		const oldFps = getStoredFingerprints();
		const hasChanged = oldFps !== null && !sameFingerprintSet(oldFps, newFps);

		rawEvents = parsed;
		applyGroupFilter();
		localStorage.setItem(CACHE_KEY, JSON.stringify({ text, fetchedAt: Date.now() }));
		localStorage.setItem(FP_KEY, JSON.stringify(newFps));
		populateGroupPickers();

		if (hasChanged) {
			setStatus("Emploi du temps mis à jour", "ok");
			if (navigator.vibrate) navigator.vibrate([100, 50, 100]);
		}
		renderCurrent();
	} catch (err) {
		const cached = getCache();
		if (cached) {
			loadFromText(cached.text, { persist: false });
			setStatus("Sync impossible (réseau/CORS) — dernière version en cache", "error");
		} else {
			setStatus("Échec du chargement. Colle le .ics dans les réglages.", "error");
			renderCurrent();
		}
	} finally {
		fetchInFlight = false;
	}
}

// =========================================================
// ---------------- Initialisation ----------------
// =========================================================
function init() {
	statusLine = el("statusLine");

	// Réglages du mode d'affichage jour (liste/grille) selon la préférence stockée
	el("dayListWrap").style.display = dayMode === "list" ? "block" : "none";
	el("dayGridOuter").style.display = dayMode === "grid" ? "block" : "none";
	el("dayModeListBtn").classList.toggle("active", dayMode === "list");
	el("dayModeGridBtn").classList.toggle("active", dayMode === "grid");
	el("dayModeListBtn").addEventListener("click", () => setDayMode("list"));
	el("dayModeGridBtn").addEventListener("click", () => setDayMode("grid"));

	// ---------- Nav wiring ----------
	el("viewDayBtn").addEventListener("click", () => setView("day"));
	el("viewWeekBtn").addEventListener("click", () => setView("week"));
	el("viewMonthBtn").addEventListener("click", () => setView("month"));

	el("prevDay").addEventListener("click", () => {
		selectedDay = addDays(selectedDay, -1);
		renderDay();
	});
	el("nextDay").addEventListener("click", () => {
		selectedDay = addDays(selectedDay, 1);
		renderDay();
	});
	el("todayChipDay").addEventListener("click", () => {
		selectedDay = startOfDay(new Date());
		renderDay({ autoScrollNow: true });
	});

	el("prevWeek").addEventListener("click", () => {
		weekCursor = addDays(weekCursor, -7);
		renderWeek();
	});
	el("nextWeek").addEventListener("click", () => {
		weekCursor = addDays(weekCursor, 7);
		renderWeek();
	});
	el("todayChipWeek").addEventListener("click", () => {
		weekCursor = startOfWeek(new Date());
		renderWeek();
	});

	el("exportPdfBtn").addEventListener("click", () => {
		printWeek();
	});

	el("prevMonth").addEventListener("click", () => {
		monthCursor = addMonths(monthCursor, -1);
		renderMonth();
	});
	el("nextMonth").addEventListener("click", () => {
		monthCursor = addMonths(monthCursor, 1);
		renderMonth();
	});
	el("todayChipMonth").addEventListener("click", () => {
		monthCursor = startOfMonth(new Date());
		selectedDay = startOfDay(new Date());
		renderMonth();
	});

	// Swipe navigation (vue jour)
	(function enableSwipe() {
		const zone = el("dayView");
		let startX = null,
			startY = null;
		zone.addEventListener(
			"touchstart",
			(e) => {
				startX = e.touches[0].clientX;
				startY = e.touches[0].clientY;
			},
			{ passive: true },
		);
		zone.addEventListener(
			"touchend",
			(e) => {
				if (startX === null) return;
				const dx = e.changedTouches[0].clientX - startX;
				const dy = e.changedTouches[0].clientY - startY;
				if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) {
					selectedDay = addDays(selectedDay, dx < 0 ? 1 : -1);
					renderDay();
				}
				startX = null;
				startY = null;
			},
			{ passive: true },
		);
	})();

	// ---------- Partage ----------
	el("shareBtn").addEventListener("click", () => {
		shareDay();
	});

	// ---------- Modal wiring ----------
	el("modalClose").addEventListener("click", () => el("modalBg").classList.remove("open"));
	el("modalBg").addEventListener("click", (ev) => {
		if (ev.target === el("modalBg")) el("modalBg").classList.remove("open");
	});

	// ---------- Setup panel wiring ----------
	el("setupBtn").addEventListener("click", () => {
		const panel = el("setupPanel");
		panel.classList.toggle("open");
		el("icsUrlInput").value = localStorage.getItem(URL_KEY) || DEFAULT_ICS_URL || "";
		populateGroupPickers();
		resetClearConfirm();
	});

	el("groupTdSelect").addEventListener("change", (ev) => {
		localStorage.setItem(GROUP_TD_KEY, ev.target.value);
		applyGroupFilter();
		renderCurrent();
	});
	el("groupLangSelect").addEventListener("change", (ev) => {
		localStorage.setItem(GROUP_LANG_KEY, ev.target.value);
		applyGroupFilter();
		renderCurrent();
	});

	el("saveUrlBtn").addEventListener("click", () => {
		const url = el("icsUrlInput").value.trim();
		if (!url) return;
		localStorage.setItem(URL_KEY, url);
		fetchICS(url, { force: true });
	});

	el("savePasteBtn").addEventListener("click", () => {
		const text = el("icsPasteArea").value.trim();
		if (!text) return;
		loadFromText(text);
	});

	el("icsFileInput").addEventListener("change", (ev) => {
		const file = ev.target.files[0];
		if (!file) return;
		const reader = new FileReader();
		reader.onload = () => loadFromText(String(reader.result));
		reader.readAsText(file);
	});

	// Confirmation à deux temps avant de vider le cache : un premier clic arme
	// le bouton (texte + couleur "danger"), un second clic dans les 4s confirme.
	el("clearBtn").addEventListener("click", () => {
		const btn = el("clearBtn");
		if (!btn.classList.contains("danger-confirm")) {
			armClearConfirm();
			return;
		}
		resetClearConfirm();
		localStorage.removeItem(CACHE_KEY);
		localStorage.removeItem(URL_KEY);
		localStorage.removeItem(FP_KEY);
		rawEvents = [];
		events = [];
		setStatus("Cache local effacé");
		populateGroupPickers();
		renderCurrent();
	});

	el("refreshBtn").addEventListener("click", (e) => {
		e.currentTarget.classList.add("spin");
		setTimeout(() => e.currentTarget.classList.remove("spin"), 700);
		const url = localStorage.getItem(URL_KEY) || DEFAULT_ICS_URL;
		fetchICS(url, { force: true });
	});

	// ---------- Chargement initial ----------
	setView("day");

	const cached = getCache();
	if (cached) {
		loadFromText(cached.text, { persist: false });
	}
	const savedUrl = localStorage.getItem(URL_KEY) || DEFAULT_ICS_URL;
	fetchICS(savedUrl);

	// Repositionne la ligne "heure actuelle" chaque minute (sans re-render
	// complet ni scroll forcé, pour ne pas gêner une lecture en cours).
	setInterval(() => {
		if (currentView === "day" && dayMode === "grid") {
			renderNowLine({ scrollIntoView: false });
		}
	}, 60000);

	// Sync quand l'app redevient visible (pas de setInterval en tâche de fond)
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState !== "visible") return;
		const url = localStorage.getItem(URL_KEY) || DEFAULT_ICS_URL;
		fetchICS(url, { force: true });
		if (currentView === "day" && sameDay(selectedDay, new Date())) {
			updateVibeWidget();
		}
	});

	// Enregistrement PWA (Service Worker)
	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker
				.register("./sw.js", { scope: "./" })
				.then(() => wirePushButton())
				.catch((err) => console.error("Échec enregistrement SW:", err));
		});
	} else {
		wirePushButton(); // masquera le bouton, pushSupported() sera false
	}
}

// =========================================================
// ---------------- Notifications push (menu du RU) ----------------
// =========================================================
function urlBase64ToUint8Array(base64String) {
	const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
	const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
	const rawData = atob(base64);
	const outputArray = new Uint8Array(rawData.length);
	for (let i = 0; i < rawData.length; i++) outputArray[i] = rawData.charCodeAt(i);
	return outputArray;
}

function pushSupported() {
	return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

async function getPushButtonState() {
	if (!pushSupported()) return "unsupported";
	if (Notification.permission === "denied") return "denied";
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	return sub ? "subscribed" : "unsubscribed";
}

function renderPushButton(state) {
	const btn = el("pushBtn");
	if (!btn) return;
	if (state === "unsupported") {
		btn.style.display = "none";
		return;
	}
	btn.style.display = "inline-flex";
	if (state === "subscribed") {
		btn.innerHTML = `<i class='bx bx-bell'></i>Notifs menu activées`;
		btn.classList.add("active");
		btn.disabled = false;
	} else if (state === "denied") {
		btn.innerHTML = `<i class='bx bx-bell-off'></i>Notifs bloquées (réglages du tél.)`;
		btn.classList.remove("active");
		btn.disabled = true;
	} else {
		btn.innerHTML = `<i class='bx bx-bell'></i>Activer les notifs menu`;
		btn.classList.remove("active");
		btn.disabled = false;
	}
}

async function refreshPushButton() {
	renderPushButton(await getPushButtonState());
}

async function subscribeToPush() {
	const permission = await Notification.requestPermission();
	if (permission !== "granted") {
		await refreshPushButton();
		return;
	}
	const reg = await navigator.serviceWorker.ready;
	let sub = await reg.pushManager.getSubscription();
	if (!sub) {
		sub = await reg.pushManager.subscribe({
			userVisibleOnly: true,
			applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
		});
	}
	try {
		await fetch(`${WORKER_BASE_URL}/push/subscribe`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(sub),
		});
	} catch {
		// Pas bloquant pour l'UI : l'abonnement navigateur existe déjà,
		// une prochaine tentative de sync pourra ré-essayer d'enregistrer côté serveur.
	}
	await refreshPushButton();
}

async function unsubscribeFromPush() {
	const reg = await navigator.serviceWorker.ready;
	const sub = await reg.pushManager.getSubscription();
	if (sub) {
		try {
			await fetch(`${WORKER_BASE_URL}/push/unsubscribe`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ endpoint: sub.endpoint }),
			});
		} catch {
			// idem : pas bloquant
		}
		await sub.unsubscribe();
	}
	await refreshPushButton();
}

function wirePushButton() {
	const btn = el("pushBtn");
	if (!btn || !pushSupported()) {
		if (btn) btn.style.display = "none";
		return;
	}
	btn.addEventListener("click", async () => {
		const state = await getPushButtonState();
		if (state === "subscribed") await unsubscribeFromPush();
		else if (state === "unsubscribed") await subscribeToPush();
	});
	refreshPushButton();
}

if (document.readyState === "loading") {
	document.addEventListener("DOMContentLoaded", init);
} else {
	init();
}


