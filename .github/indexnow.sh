#!/usr/bin/env bash
# Envoie à IndexNow les pages du portfolio modifiées depuis la publication précédente ($PREV).
# Sans $PREV (lancement à la main), envoie toutes les pages du sitemap.
set -euo pipefail
HOST=damienvaiton.fr
KEY=14f9dc3fd37ca1469aa4ffc3c0fa7232

all=$(grep -o '<loc>[^<]*</loc>' sitemap.xml | sed -e 's/<loc>//' -e 's/<\/loc>//')

if [ -z "${PREV:-}" ] || ! git cat-file -e "$PREV^{commit}" 2>/dev/null; then
  urls="$all"
else
  changed=$(git diff --name-only "$PREV" "${TO:-HEAD}")
  # le CSS, le JS, les images ou le sitemap touchent toutes les pages
  if echo "$changed" | grep -qE '^(assets/|sitemap\.xml$)'; then
    urls="$all"
  else
    urls=""
    for u in $all; do
      path=${u#https://$HOST/}
      case "$path" in "" | */) path="${path}index.html" ;; esac
      if echo "$changed" | grep -qxF "$path"; then urls="$urls $u"; fi
    done
  fi
fi

if [ -z "${urls// /}" ]; then
  echo "Aucune page du portfolio n'a changé (edt/, starac/…) : rien à envoyer."
  exit 0
fi

list=$(printf '%s\n' $urls | jq -R . | jq -s .)
echo "$list"
[ -n "${DRY_RUN:-}" ] && exit 0
body=$(jq -n --arg host "$HOST" --arg key "$KEY" --argjson urls "$list" \
  '{host: $host, key: $key, keyLocation: "https://\($host)/\($key).txt", urlList: $urls}')
code=$(curl -sS -o response.txt -w '%{http_code}' -X POST https://api.indexnow.org/indexnow \
  -H 'Content-Type: application/json; charset=utf-8' -d "$body")
echo "Réponse IndexNow : HTTP $code"
cat response.txt
[ "$code" = 200 ] || [ "$code" = 202 ]
