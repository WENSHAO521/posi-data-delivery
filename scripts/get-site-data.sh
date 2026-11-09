#!/usr/bin/env bash
# get-site-data.sh <asset> <out>: downloads one asset of the POSI website's site-data release.
#
# GitHub's release downloads answer 502/503/504 for a minute or so now and then (2026-11-08 failed a
# deploy that way). curl retries with backoff (1, 2, 4 ... 32 s); if it still fails, the same asset
# comes through the REST API (gh release download), a separate front end, three more times.
set -uo pipefail
asset=$1 out=$2
repo=${SITE_REPO:-WENSHAO521/Panorama-Open-Scholarly-Index}
curl -fsSL --retry 6 --retry-connrefused --retry-max-time 300 \
  "https://github.com/$repo/releases/download/site-data/$asset" -o "$out" && exit 0
echo "::warning::release download of $asset failed; trying the GitHub API" >&2
for i in 1 2 3; do
  gh release download site-data -R "$repo" -p "$asset" -O "$out" --clobber && exit 0
  sleep $((15 * i))
done
exit 1
