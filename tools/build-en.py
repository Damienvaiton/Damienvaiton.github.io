#!/usr/bin/env python3
"""Génère la version anglaise du site (/en/) et le sitemap.

Les pages françaises (index.html, projects/*.html) sont la source : chaque élément
traduisible porte data-i18n="clé" (ou data-i18n-attr="attribut:clé"), et les textes
anglais sont dans assets/js/i18n.js. Ce script produit des pages anglaises statiques,
que Google peut indexer séparément, puis réécrit sitemap.xml.

À relancer après chaque modification d'une page ou d'une traduction :
    python3 tools/build-en.py
"""
import datetime
import html
import json
import os
import re
import sys
from html.parser import HTMLParser

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BASE = "https://damienvaiton.fr"
VOID = {"area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr",
        "path", "circle", "rect", "ellipse", "line", "polyline", "polygon", "stop"}
PERSON_EN = {
    "jobTitle": "Web developer",
    "description": ("PHP/Symfony and React web developer based in Bourg-en-Bresse (Ain, France), with a Computer "
                    "Science degree (BUT Informatique, IUT Lyon 1). Also builds Discord bots, Android apps and IoT projects."),
}


def pages():
    out = ["index.html"]
    out += sorted("projects/" + f for f in os.listdir(os.path.join(ROOT, "projects")) if f.endswith(".html"))
    return out


def url_fr(page):
    return BASE + "/" if page == "index.html" else f"{BASE}/{page}"


def url_en(page):
    return BASE + "/en/" if page == "index.html" else f"{BASE}/en/{page}"


def load_dict():
    src = open(os.path.join(ROOT, "assets/js/i18n.js"), encoding="utf-8").read()
    return json.loads(src[src.index("{"): src.rindex("}") + 1])


class Locator(HTMLParser):
    """Repère chaque élément portant data-i18n / data-i18n-attr, avec ses positions dans le texte."""

    def __init__(self, text):
        super().__init__(convert_charrefs=False)
        self.text = text
        self.line_starts = [0]
        for m in re.finditer("\n", text):
            self.line_starts.append(m.end())
        self.stack = []      # (tag, élément ou None)
        self.found = []      # éléments complets

    def abs_pos(self):
        line, col = self.getpos()
        return self.line_starts[line - 1] + col

    def handle_starttag(self, tag, attrs):
        start = self.abs_pos()
        raw = self.get_starttag_text()
        a = dict(attrs)
        el = None
        if "data-i18n" in a or "data-i18n-attr" in a:
            el = {"tag": tag, "attrs": a, "start": start, "open_end": start + len(raw), "raw": raw, "close": None}
            self.found.append(el)
        if tag not in VOID and not raw.endswith("/>"):
            self.stack.append((tag, el))

    def handle_endtag(self, tag):
        if tag in VOID:
            return
        pos = self.abs_pos()
        while self.stack:
            t, el = self.stack.pop()
            if el is not None:
                el["close"] = pos
            if t == tag:
                break


def translate(text, en, page, missing):
    loc = Locator(text)
    loc.feed(text)
    edits = []  # (début, fin, remplacement)
    for el in loc.found:
        raw = el["raw"]
        new_raw = raw
        if "data-i18n-attr" in el["attrs"]:
            for pair in el["attrs"]["data-i18n-attr"].split(";"):
                attr, key = pair.split(":", 1)
                if key not in en:
                    missing.add(key)
                    continue
                val = html.escape(en[key], quote=True)
                new_raw = re.sub(rf'(\s{re.escape(attr)}=")[^"]*(")', lambda m: m.group(1) + val + m.group(2), new_raw, count=1)
        if new_raw != raw:
            edits.append((el["start"], el["open_end"], new_raw))
        if "data-i18n" in el["attrs"]:
            key = el["attrs"]["data-i18n"]
            if key not in en:
                missing.add(key)
            elif el["close"] is not None:
                edits.append((el["open_end"], el["close"], en[key]))
    out, last = text, None
    for start, end, rep in sorted(edits, key=lambda e: e[0], reverse=True):
        if last is not None and end > last:   # élément imbriqué dans un autre déjà remplacé
            continue
        out = out[:start] + rep + out[end:]
        last = start
    return out


def rewrite_paths(text):
    """Les pages anglaises sont un dossier plus bas : on corrige les chemins des ressources
    (pas ceux des pages, puisque /en/ reproduit la même arborescence)."""
    def fix(m):
        attr, val = m.group(1), m.group(2)
        if re.match(r"^(https?:|//|#|mailto:|/|data:)", val):
            return m.group(0)
        path = val.split("#")[0]
        if path == "" or path.endswith(".html") or path.endswith("/") or path in (".", ".."):
            return m.group(0)
        return f'{attr}="../{val}"'
    return re.sub(r'\b(href|src|srcset)="([^"]+)"', fix, text)


def meta(text, prop, value, by="property"):
    value = html.escape(value, quote=True)
    return re.sub(rf'(<meta {by}="{re.escape(prop)}" content=")[^"]*(")', lambda m: m.group(1) + value + m.group(2), text)


def build_page(page, en, missing):
    src = open(os.path.join(ROOT, page), encoding="utf-8").read()
    fr, enu = url_fr(page), url_en(page)
    out = translate(src, en, page, missing)
    out = rewrite_paths(out)
    out = out.replace('<html lang="fr">', '<html lang="en">', 1)
    out = out.replace(f'<link rel="canonical" href="{fr}" />', f'<link rel="canonical" href="{enu}" />')
    title = html.unescape(re.search(r"<title[^>]*>(.*?)</title>", out, re.S).group(1))
    desc = html.unescape(re.search(r'<meta name="description" content="([^"]*)"', out).group(1))
    out = meta(out, "og:url", enu)
    out = meta(out, "og:title", title)
    out = meta(out, "og:description", desc)
    out = meta(out, "twitter:title", title, by="name")
    out = meta(out, "twitter:description", desc, by="name")
    out = out.replace('<meta property="og:locale" content="fr_FR" />', '<meta property="og:locale" content="en_US" />')
    out = out.replace('<meta property="og:locale:alternate" content="en_US" />', '<meta property="og:locale:alternate" content="fr_FR" />')
    fr_alt = re.search(r'<meta property="og:image:alt" content="([^"]*)"', out)
    if fr_alt:
        name = html.unescape(fr_alt.group(1)).split(" : ")[0]
        slug = os.path.basename(page)[:-5]
        alt = en.get(f"p.{slug}.tagline")
        alt_en = f"{name}: {alt}" if page != "index.html" and alt else "Damien Vaiton, web developer between Symfony and React"
        out = meta(out, "og:image:alt", alt_en)
        out = meta(out, "twitter:image:alt", alt_en, by="name")

    # Données structurées : URL, langue, titre et description de la page anglaise
    def fix_ld(m):
        ld = json.loads(m.group(2))
        for node in ld.get("@graph", []):
            t = node.get("@type")
            if t in ("WebPage", "ProfilePage"):
                old_id = node["@id"]
                node["@id"] = old_id.replace(fr, enu, 1)
                node["url"] = enu
                node["name"], node["description"], node["inLanguage"] = title, desc, "en"
                if "breadcrumb" in node:
                    node["breadcrumb"]["@id"] = node["breadcrumb"]["@id"].replace(fr, enu, 1)
                for part in node.get("hasPart", []):
                    part["url"] = part["url"].replace(BASE + "/projects/", BASE + "/en/projects/")
            elif t == "BreadcrumbList":
                node["@id"] = node["@id"].replace(fr, enu, 1)
                for item in node["itemListElement"]:
                    item["item"] = item["item"].replace(fr, enu, 1) if item["item"] == fr else (
                        BASE + "/en/" if item["item"] == BASE + "/" else item["item"])
            elif t == "SoftwareSourceCode":
                node["url"], node["description"] = enu, desc
            elif t == "Person" and "jobTitle" in node:
                node.update(PERSON_EN)
                if "hasOccupation" in node:
                    node["hasOccupation"]["name"] = "Web developer"
                if node.get("knowsAbout") and node["knowsAbout"][0] == "Développement web":
                    node["knowsAbout"][0] = "Web development"
        return m.group(1) + "\n" + json.dumps(ld, ensure_ascii=False, indent=2) + "\n    " + m.group(3)
    out = re.sub(r'(<script type="application/ld\+json">)(.*?)(</script>)', fix_ld, out, flags=re.S)

    dest = os.path.join(ROOT, "en", page)
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    open(dest, "w", encoding="utf-8").write(out)
    return src


def build_sitemap(sources):
    today = datetime.date.today().isoformat()
    entries = []
    for page in pages():
        src = sources[page]
        imgs = re.findall(r'property="og:image" content="([^"]+)"', src)
        base_dir = os.path.dirname(page)
        for img in re.findall(r'<img[^>]+src="([^"]+)"', src):
            if not img.startswith("http"):
                imgs.append(BASE + "/" + os.path.normpath(os.path.join(base_dir, img)).replace(os.sep, "/"))
        alts = (f'    <xhtml:link rel="alternate" hreflang="fr" href="{url_fr(page)}" />\n'
                f'    <xhtml:link rel="alternate" hreflang="en" href="{url_en(page)}" />\n'
                f'    <xhtml:link rel="alternate" hreflang="x-default" href="{url_fr(page)}" />\n')
        img_xml = "".join(f"    <image:image><image:loc>{i}</image:loc></image:image>\n" for i in dict.fromkeys(imgs))
        for loc in (url_fr(page), url_en(page)):
            entries.append(f"  <url>\n    <loc>{loc}</loc>\n    <lastmod>{today}</lastmod>\n{alts}{img_xml}  </url>\n")
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n'
           '        xmlns:xhtml="http://www.w3.org/1999/xhtml"\n'
           '        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">\n' + "".join(entries) + "</urlset>\n")
    open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8").write(xml)


def main():
    en = load_dict()
    missing, sources = set(), {}
    for page in pages():
        sources[page] = build_page(page, en, missing)
        print(f"en/{page}")
    build_sitemap(sources)
    print("sitemap.xml")
    if missing:
        print("\nTraductions manquantes (texte laissé en français) :", ", ".join(sorted(missing)), file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
