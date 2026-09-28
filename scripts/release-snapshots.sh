#!/usr/bin/env bash
# Moves snapshot data out of git: for every snapshots/<id>/collections/ in
# the working tree, publishes a GitHub release `snapshot-<id>` holding the
# collection files, manifest.json and SHA256SUMS, checks every asset is
# there at the right size, and only then deletes the collections from the
# tree. manifest.json and SHA256SUMS stay in git (collections-changed.mjs
# and the Pages deploy read them); the deploy downloads the collections it
# serves from the release (scripts/assemble-pages.mjs).
#
# Idempotent: a snapshot already released is only re-checked. Needs GH_TOKEN
# with contents: write.
#
#   bash scripts/release-snapshots.sh
set -euo pipefail

moved=0
for dir in snapshots/*/collections; do
  [ -d "$dir" ] || continue
  snap=$(dirname "$dir"); id=$(basename "$snap"); tag="snapshot-$id"
  files=("$dir"/* "$snap/manifest.json" "$snap/SHA256SUMS")
  if ! gh release view "$tag" >/dev/null 2>&1; then
    gh release create "$tag" "${files[@]}" --latest=false \
      --title "Snapshot $id" \
      --notes "POSI data snapshot $id: the collection files of https://data.posi.panorama-sg.com/snapshots/$id/, with manifest.json and SHA256SUMS. Generated from posi-data; see the README."
  else
    gh release upload "$tag" "${files[@]}" --clobber
  fi
  # Delete from git only once every file is in the release at its size.
  assets=$(gh release view "$tag" --json assets --jq '.assets[] | "\(.name) \(.size)"')
  for f in "${files[@]}"; do
    want="$(basename "$f") $(stat -c %s "$f")"
    grep -qxF "$want" <<<"$assets" || { echo "release-snapshots: $tag is missing $want" >&2; exit 1; }
  done
  rm -rf "$dir"
  moved=$((moved + 1))
  echo "release-snapshots: $id -> release $tag"
done
echo "release-snapshots: moved $moved snapshot(s)"
