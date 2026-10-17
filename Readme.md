# damienvaiton.fr

Portfolio de **Damien Vaiton**, développeur web PHP/Symfony et React à Bourg-en-Bresse.
En ligne sur **[damienvaiton.fr](https://damienvaiton.fr)** (GitHub Pages).

Site statique en HTML, CSS et JavaScript, sans framework ni étape de build : chaque fichier
poussé sur `main` est publié tel quel.

## Structure

| Chemin | Rôle |
| --- | --- |
| `index.html` | Page d'accueil (projets, stack, parcours, à propos, contact) |
| `projects/*.html` | Une page par projet |
| `en/` | Version anglaise, **générée** par `tools/build-en.py` (ne pas modifier à la main) |
| `404.html` | Page « perdue dans la nuit » servie par GitHub Pages |
| `assets/css/site.css` | Tout le style du site |
| `assets/js/site.js` | Animations, horloge, easter egg, langue, Last.fm |
| `assets/js/i18n.js` | Traductions anglaises |
| `assets/fonts/` | Polices hébergées localement (licence OFL) |
| `assets/img/` | Photo, captures des projets (JPG + WebP), images de partage (`og/`) |
| `tools/build-en.py` | Génère `en/` et `sitemap.xml` à partir des pages françaises |
| `edt/` | Application séparée, à ne pas modifier et non indexée (voir `robots.txt`) |
| `robots.txt`, `sitemap.xml` | Référencement |
| `llms.txt`, `llms-full.txt` | Présentation du site pour les assistants IA |

## Modifier un texte

Le **français** est écrit directement dans le HTML. Les éléments traduits portent un attribut
`data-i18n="clé"` (ou `data-i18n-attr="attribut:clé"` pour un attribut comme `alt`).

L'**anglais** se trouve dans `assets/js/i18n.js`, sous la même clé. Quand un texte français
change, il faut mettre à jour sa traduction au même endroit, puis régénérer les pages anglaises :

```bash
python3 tools/build-en.py
```

Le script recrée `en/` et `sitemap.xml` (avec la date du jour), et signale les traductions
manquantes. Penser aussi à mettre à jour `llms.txt` / `llms-full.txt` si l'information y figure.

## Langue

- Deux versions statiques : français (`/`) et anglais (`/en/`), reliées par `hreflang`.
- Le bouton **FR | EN** du menu passe d'une version à l'autre et mémorise le choix.
- À la première visite, un navigateur qui n'est pas en français est envoyé vers `/en/`
  (jamais les robots d'indexation, qui voient chaque version à son adresse).
- La page 404, unique, se traduit sur place avec `i18n.js`.

## Last.fm

La pastille « En fond sonore » affiche le morceau en cours d'écoute. Elle se règle dans
`index.html`, sur l'élément `.now-playing` :

```html
<div class="now-playing" data-lastfm-user="…" data-lastfm-key="…">
```

La clé est une clé d'API Last.fm en lecture seule. Sans ces deux valeurs, la pastille affiche
simplement « Midnights ».

## Easter egg

Cliquer sur l'horloge du menu, ou taper « midnights » au clavier.

## Lancer le site en local

```bash
python3 -m http.server 8000
# puis ouvrir http://localhost:8000
```
