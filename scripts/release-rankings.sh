#!/usr/bin/env bash
# Archives the current snapshot's Citation Ranking edition as a frozen
# GitHub release: ranking-<year> the first time a year's edition is
# published, ranking-<year>-r1, -r2 ... when that year's edition later
# changes. A published archive is never replaced, so every edition that was
# ever public stays available as it was.
#
# The edition is identified by the SHA-256 of citation-ranking.json.gz in
# the snapshot's SHA256SUMS; an archive records it as EDITION.sha256. When
# the newest archive of the year already holds this edition, nothing is done,
# which makes the script cheap to run on every sync. Needs GH_TOKEN with
# contents: write.
#
#   bash scripts/release-rankings.sh
set -euo pipefail

snap=$(node -p "require('./current.json').snapshot")
dir="snapshots/$snap"
year=$(node -p "require('./$dir/manifest.json').citation_ranking_metric_year ?? ''")
hash=$(awk '$2 == "collections/citation-ranking.json.gz" { print $1 }' "$dir/SHA256SUMS")
if [ -z "$year" ] || [ -z "$hash" ]; then echo "release-rankings: snapshot $snap has no Citation Ranking edition"; exit 0; fi

# Archives of this year, oldest first: ranking-<year>, then -r1, -r2 ...
tags=$(gh release list --limit 1000 --json tagName,isDraft --jq '.[] | select(.isDraft | not) | .tagName' | grep -E "^ranking-$year(-r[0-9]+)?$" | sort -V || true)
latest=$(tail -n1 <<<"$tags")
if [ -n "$latest" ]; then
  have=$(gh release download "$latest" -p EDITION.sha256 -O - 2>/dev/null | tr -d '[:space:]' || true)
  if [ "$have" = "$hash" ]; then echo "release-rankings: $latest already holds the $year edition of snapshot $snap"; exit 0; fi
  n=$(grep -c . <<<"$tags"); tag="ranking-$year-r$n"; revision=$n
else
  tag="ranking-$year"; revision=0
fi

work=$(mktemp -d)
# The snapshot's collections, from the tree or from its release.
mkdir -p "$work/col"
for f in citation-ranking.json.gz core-collection.json pci.json; do
  if [ -f "$dir/collections/$f" ]; then cp "$dir/collections/$f" "$work/col/"
  else gh release download "snapshot-$snap" -p "$f" -D "$work/col" 2>/dev/null || [ "$f" != citation-ranking.json.gz ]; fi
done
echo "$hash  $work/col/citation-ranking.json.gz" | sha256sum -c --quiet

RANKING_TAG="$tag" RANKING_REVISION="$revision" node scripts/build-downloads.mjs "$work/col" "$work/out"
notes="POSI Citation Ranking $year, from data snapshot $snap. A frozen archive: it is never replaced."
[ "$revision" -gt 0 ] && notes="$notes Revision $revision of the $year edition; earlier archives of $year remain published."
# A draft until every file is uploaded, so no reader ever sees part of an
# archive; a draft left by an interrupted run is replaced.
if [ "$(gh release view "$tag" --json isDraft --jq .isDraft 2>/dev/null)" = "true" ]; then gh release delete "$tag" --yes; fi
gh release create "$tag" "$work/out"/* --draft --latest=false --title "Citation Ranking $year$([ "$revision" -gt 0 ] && echo " (revision $revision)")" --notes "$notes"
gh release edit "$tag" --draft=false --latest=false
echo "release-rankings: published $tag from snapshot $snap"
