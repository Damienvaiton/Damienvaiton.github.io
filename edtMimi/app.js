"use strict";

// =========================================================
// ---------------- Configuration ----------------
// =========================================================
// Page ESUP de l'UPHF qui porte le bouton « Export iCal » (derrière l'ENT).
// L'export est un POST JSF propre à sa session : impossible de le déclencher
// depuis ce site, on ne peut qu'ouvrir la page.
const VTMOB_URL =
	"https://vtmob.uphf.fr/esup-vtclient-up4/stylesheets/desktop/welcome.xhtml";

// /edt et /edtMimi partagent la même origine, donc le même localStorage :
// toutes les clés sont préfixées "edtmimi_" pour ne rien écraser.
const STORE_KEY = "edtmimi_ics_v1"; // { text, importedAt, changes }
const HIDE_RES_KEY = "edtmimi_hide_res_v1";

const DAY_NAMES = ["dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi"];
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

let events = [];
let weekCursor = null;
let statusLine;

const el = (id) => document.getElementById(id);

// =========================================================
// ---------------- Date helpers ----------------
// =========================================================
function startOfDay(d) {
	const x = new Date(d);
	x.setHours(0, 0, 0, 0);
	return x;
}
function addDays(d, n) {
	const x = new Date(d);
	x.setDate(x.getDate() + n);
	return x;
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
function hhmm(d) {
	return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function shortDate(d) {
	return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
}
function longDate(d) {
	return `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
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
function stripAccents(s) {
	return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
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
	const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/);
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
			if (cur && cur.start && cur.end) out.push(cur);
			cur = null;
		} else if (cur) {
			const idx = line.indexOf(":");
			if (idx === -1) continue;
			const key = line.slice(0, idx).split(";")[0].toUpperCase();
			const value = line.slice(idx + 1);
			if (key === "SUMMARY") cur.title = unescapeText(value).trim();
			else if (key === "LOCATION") cur.location = unescapeText(value).trim();
			else if (key === "DESCRIPTION") cur.description = unescapeText(value);
			else if (key === "DTSTART") cur.start = parseICSDate(value);
			else if (key === "DTEND") cur.end = parseICSDate(value);
			else if (key === "DTSTAMP") cur.stamp = parseICSDate(value);
		}
	}
	return out;
}

// =========================================================
// ---------------- Format UPHF (ESUP vtclient) ----------------
// SUMMARY    : « CM : RES10 PAN.LIT.BRIT », « TD : … », « TP : … », « DS : … »
//              ou juste « RES » pour une réservation de salle.
// DESCRIPTION: lignes « Enseignement : … », « Prof : … », « Groupe : … »,
//              « Commentaire : … » (ou « Reservation » en 1re ligne).
// Les codes RESxx sont les codes des cours de LLCER, pas des réservations.
// =========================================================
const SUMMARY_RE = /^(CM|TD|TP|DS)\s*:\s*(.+)$/i;
const COURSE_CODE_RE = /^([A-Z]+\d+(?:-LV\d)?)\s+(.+)$/;

// Libellés abrégés de la fac -> nom lisible. Uniquement les cas sûrs
// (recoupés avec le champ « Groupe ») : un libellé inconnu est affiché tel quel.
// Clés en majuscules et sans accents.
const SUBJECT_NAMES = {
	"EXP.ECRITE": "Expression écrite",
	"COMP.ORALE": "Compréhension orale",
	"PROD.ORALE": "Production orale",
	"I.THEME": "Initiation au thème",
	"I.VERSION": "Initiation à la version",
	GRAMMAIRE: "Grammaire anglaise",
	"PAN.LIT.BRIT": "Panorama de la littérature britannique",
	"LECT.OEUVRES BRIT": "Lecture d'œuvres britanniques",
	"INTRO.CIVI.RU": "Introduction à la civilisation du Royaume-Uni",
	"ET.DOC.RU": "Étude de documents de civilisation (Royaume-Uni)",
};

// Langue de la LV2 : lue dans « Enseignement » / « Groupe » (ex. « ITA DEB+INTER »).
const LV2_LANGS = [
	[/\bITALIEN\b|\bITA\b/, "Italien"],
	[/\bESPAGNOL\b|\bESP\b/, "Espagnol"],
	[/\bALLEMAND\b|\bALL\b/, "Allemand"],
	[/\bPORTUGAIS\b/, "Portugais"],
	[/\bJAPONAIS\b/, "Japonais"],
	[/\bCHINOIS\b/, "Chinois"],
	[/\bARABE\b/, "Arabe"],
	[/\bRUSSE\b/, "Russe"],
];

function descField(description, name) {
	const m = (description || "").match(new RegExp(`^\\s*${name}\\s*:\\s*(.+)$`, "im"));
	return m ? m[1].trim() : null;
}

function cleanComment(c) {
	return c ? c.replace(/^\+\s*/, "").trim() || null : null;
}

function subjectName(label, description) {
	const m = label.match(COURSE_CODE_RE);
	if (!m) return label;
	const [, code, rest] = m;
	const key = stripAccents(rest).toUpperCase().trim();

	if (/-LV\d$/.test(code)) {
		const haystack = stripAccents(description || "").toUpperCase();
		const lang = LV2_LANGS.find(([re]) => re.test(haystack));
		const kind = /ECRIT/.test(key) ? "écrit" : /ORAL/.test(key) ? "oral" : rest.toLowerCase();
		return `${lang ? lang[1] : "LV2"} (LV2) · ${kind}`;
	}
	return SUBJECT_NAMES[key] || label;
}

function normalizeEvent(raw) {
	const title = raw.title || "";
	const description = raw.description || "";
	const comment = cleanComment(descField(description, "Commentaire"));
	const base = {
		start: raw.start,
		end: raw.end,
		label: title,
		room: raw.location || null,
		teacher: descField(description, "Prof"),
		group: descField(description, "Groupe"),
		comment,
		// Empreinte utilisée pour comparer deux imports (les UID changent à chaque export).
		fp: `${raw.start.getTime()}|${raw.end.getTime()}|${title}|${raw.location || ""}`,
	};

	// Réservation de salle : labo, intervention, événement de campus… rattachée
	// à son groupe par la fac, donc a priori à suivre aussi.
	if (title.toUpperCase() === "RES" || /^\s*reservation\b/i.test(description)) {
		return { ...base, type: "RES", subject: comment || "Réservation de salle" };
	}

	const m = title.match(SUMMARY_RE);
	if (m) {
		return { ...base, type: m[1].toUpperCase(), subject: subjectName(m[2].trim(), description) };
	}
	return { ...base, type: null, subject: title || "(sans titre)" };
}

function parseCalendar(text) {
	if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error("not-ics");
	const raws = parseICS(text);
	let stamp = null;
	for (const r of raws) if (r.stamp && (!stamp || r.stamp > stamp)) stamp = r.stamp;
	const list = raws.map(normalizeEvent).sort((a, b) => a.start - b.start || a.end - b.end);
	return { events: list, stamp };
}

// =========================================================
// ---------------- Comparaison entre deux imports ----------------
// Seuls les cours à venir comptent : un changement dans le passé n'intéresse personne.
// =========================================================
function summarize(e) {
	return {
		start: e.start.toISOString(),
		end: e.end.toISOString(),
		type: e.type,
		subject: e.subject,
		room: e.room,
	};
}

function diffEvents(oldList, newList, now = new Date()) {
	const upcoming = (list) => list.filter((e) => e.end > now);
	const oldFps = new Set(oldList.map((e) => e.fp));
	const newFps = new Set(newList.map((e) => e.fp));
	return {
		added: upcoming(newList).filter((e) => !oldFps.has(e.fp)).map(summarize),
		removed: upcoming(oldList).filter((e) => !newFps.has(e.fp)).map(summarize),
	};
}

// =========================================================
// ---------------- Stockage local ----------------
// =========================================================
function getStored() {
	try {
		const raw = localStorage.getItem(STORE_KEY);
		return raw ? JSON.parse(raw) : null;
	} catch {
		return null;
	}
}
function setStored(value) {
	try {
		localStorage.setItem(STORE_KEY, JSON.stringify(value));
		return true;
	} catch {
		return false;
	}
}
function hideReservations() {
	try {
		return localStorage.getItem(HIDE_RES_KEY) === "1";
	} catch {
		return false;
	}
}

// =========================================================
// ---------------- Import du fichier ----------------
// =========================================================
async function importFile(file) {
	let text;
	let cal;
	try {
		text = await file.text();
		cal = parseCalendar(text);
	} catch {
		setStatus("Ce fichier n'est pas un export iCal (.ics) de la fac.", "error");
		return;
	}
	if (!cal.events.length) {
		setStatus("Ce fichier ne contient aucun cours.", "error");
		return;
	}

	const prev = getStored();
	let changes = null;
	if (prev) {
		let prevCal = null;
		try {
			prevCal = parseCalendar(prev.text);
		} catch {
			// ancien cache illisible : on le remplace sans comparer
		}
		if (prevCal) {
			if (
				cal.stamp &&
				prevCal.stamp &&
				cal.stamp < prevCal.stamp &&
				!confirm(
					"Ce fichier est plus ancien que l'emploi du temps déjà importé. L'importer quand même ?",
				)
			) {
				return;
			}
			changes = diffEvents(prevCal.events, cal.events);
		}
	}

	// Chaque import remplace tout : pas de doublons même si la fac régénère les UID.
	if (!setStored({ text, importedAt: Date.now(), changes })) {
		setStatus("Impossible d'enregistrer sur cet appareil (stockage plein ou bloqué).", "error");
	}
	events = cal.events;
	weekCursor = defaultWeek();
	renderAll();
	if (changes && !changes.added.length && !changes.removed.length) {
		setStatus("Importé : aucun changement à venir.", "ok");
	}
}

// =========================================================
// ---------------- Affichage (volontairement simple) ----------------
// =========================================================
function setStatus(msg, kind) {
	statusLine.textContent = msg;
	statusLine.className = "status" + (kind ? " " + kind : "");
}

function renderInfo() {
	const stored = getStored();
	if (!stored) {
		setStatus("Aucun emploi du temps importé pour l'instant.");
		return;
	}
	let stamp = null;
	try {
		stamp = parseCalendar(stored.text).stamp;
	} catch {
		// ignoré : on affiche quand même la date d'import
	}
	const imported = new Date(stored.importedAt);
	const parts = [`${events.length} créneaux`];
	if (stamp) parts.push(`version fac du ${shortDate(stamp)} à ${hhmm(stamp)}`);
	parts.push(`importé le ${shortDate(imported)} à ${hhmm(imported)}`);
	setStatus(parts.join(" · "), "ok");
}

function changeLineHtml(c) {
	const s = new Date(c.start);
	const e = new Date(c.end);
	const type = c.type && c.type !== "RES" ? `${c.type} · ` : "";
	const room = c.room ? ` · ${c.room}` : "";
	return `<li>${escapeHtml(`${longDate(s)} ${hhmm(s)}–${hhmm(e)} · ${type}${c.subject}${room}`)}</li>`;
}

function renderChanges() {
	const box = el("changesBox");
	const stored = getStored();
	const changes = stored && stored.changes;
	if (!changes || (!changes.added.length && !changes.removed.length)) {
		box.hidden = true;
		return;
	}
	let html = `<strong>Changements depuis l'import précédent</strong>`;
	if (changes.added.length) {
		html += `<p>Nouveaux créneaux (${changes.added.length}) :</p><ul>${changes.added.map(changeLineHtml).join("")}</ul>`;
	}
	if (changes.removed.length) {
		html += `<p>Créneaux disparus (${changes.removed.length}) :</p><ul>${changes.removed.map(changeLineHtml).join("")}</ul>`;
	}
	html += `<button class="btn" id="dismissChanges">OK, vu</button>`;
	box.innerHTML = html;
	box.hidden = false;
	el("dismissChanges").addEventListener("click", () => {
		const s = getStored();
		if (s) setStored({ ...s, changes: null });
		box.hidden = true;
	});
}

function eventHtml(e) {
	const cls = ["event"];
	if (e.type === "DS") cls.push("exam");
	if (e.type === "RES") cls.push("res");
	const typeLabel = e.type === "RES" ? "Réservation" : e.type || "";
	const lines = [];
	if (e.room) lines.push(escapeHtml(e.room));
	else if (e.type !== "RES") lines.push("Salle non indiquée");
	if (e.teacher) lines.push(escapeHtml(e.teacher));
	const comment = e.comment && e.type !== "RES" ? `<div class="comment">${escapeHtml(e.comment)}</div>` : "";
	return `<div class="${cls.join(" ")}">
		<div class="time">${hhmm(e.start)}<br />${hhmm(e.end)}</div>
		<div class="body">
			<div class="title">${typeLabel ? `<span class="tag">${typeLabel}</span>` : ""}${escapeHtml(e.subject)}</div>
			<div class="meta">${lines.join(" · ")}</div>
			${comment}
		</div>
	</div>`;
}

function renderWeek() {
	const weekStart = weekCursor;
	const weekEnd = addDays(weekStart, 7);
	el("weekLabel").textContent = `Semaine du ${weekStart.getDate()} ${MONTH_NAMES[weekStart.getMonth()]}`;

	const hideRes = hideReservations();
	const visible = events.filter(
		(e) => e.start >= weekStart && e.start < weekEnd && !(hideRes && e.type === "RES"),
	);
	const today = new Date();
	let html = "";
	for (let i = 0; i < 7; i++) {
		const day = addDays(weekStart, i);
		const dayEvents = visible.filter((e) => sameDay(e.start, day));
		// Le week-end n'apparaît que s'il y a quelque chose ce jour-là.
		if (i >= 5 && !dayEvents.length) continue;
		html += `<section class="day${sameDay(day, today) ? " today" : ""}">
			<h2>${longDate(day)}</h2>
			${dayEvents.length ? dayEvents.map(eventHtml).join("") : `<p class="empty">Pas cours</p>`}
		</section>`;
	}
	el("weekList").innerHTML = events.length ? html : "";
}

function renderAll() {
	renderInfo();
	renderChanges();
	renderWeek();
}

// Le week-end, on montre directement la semaine suivante.
function defaultWeek() {
	const today = new Date();
	const dow = today.getDay();
	return startOfWeek(dow === 0 || dow === 6 ? addDays(today, 2) : today);
}

// =========================================================
// ---------------- Initialisation ----------------
// =========================================================
function init() {
	statusLine = el("statusLine");
	el("fetchLink").href = VTMOB_URL;

	el("icsFileInput").addEventListener("change", async (ev) => {
		const file = ev.target.files && ev.target.files[0];
		ev.target.value = ""; // permet de réimporter le même fichier
		if (file) await importFile(file);
	});

	el("hideResInput").checked = hideReservations();
	el("hideResInput").addEventListener("change", (ev) => {
		try {
			localStorage.setItem(HIDE_RES_KEY, ev.target.checked ? "1" : "0");
		} catch {
			// préférence non mémorisée, l'affichage suit quand même
		}
		renderWeek();
	});

	el("prevWeek").addEventListener("click", () => {
		weekCursor = addDays(weekCursor, -7);
		renderWeek();
	});
	el("nextWeek").addEventListener("click", () => {
		weekCursor = addDays(weekCursor, 7);
		renderWeek();
	});
	el("todayBtn").addEventListener("click", () => {
		weekCursor = defaultWeek();
		renderWeek();
	});

	const stored = getStored();
	if (stored) {
		try {
			events = parseCalendar(stored.text).events;
		} catch {
			events = [];
		}
	}
	weekCursor = defaultWeek();
	renderAll();

	if ("serviceWorker" in navigator) {
		window.addEventListener("load", () => {
			navigator.serviceWorker
				.register("./sw.js", { scope: "./" })
				.catch((err) => console.error("Échec enregistrement SW:", err));
		});
	}
}

document.addEventListener("DOMContentLoaded", init);
