# posi-data-delivery

Public, versioned, read-only JSON mirror of POSI's corpus data — served as
a static site via GitHub Pages. This is **not** the canonical source of
truth: that's [posi-data](https://github.com/WENSHAO521/posi-data). This
repo exists so the [POSI website](https://github.com/WENSHAO521/Panorama-Open-Scholarly-Index)
(and anyone else) can fetch public data over plain HTTPS from a stable,
versioned URL, without the website repository having to vendor multi-
megabyte JSON files into its own Git history and Cloudflare Pages
deployment (see that repo's `sync-corpus.mjs` header for the incident that
motivated moving data out of the frontend deployment in the first place).

## What this is not

**Not a POSI-R release.** [`POSI-R-1.0-SPEC.md`](https://github.com/WENSHAO521/posi-data/blob/master/POSI-R-1.0-SPEC.md)
defines POSI's platform-release format and is explicit that none has ever
been produced — no pinned end-to-end engine run, no reviewed manifest, no
human-triggered "cut" decision. Every `manifest.json` published here has
`is_official_release: false` and `release: null` for exactly that reason.
What's published instead is a **pre-release data snapshot**: an as-is
mirror of whatever is currently committed to posi-data's `corpus/`,
refreshed on demand. When a real POSI-R release is eventually cut, it will
be published here too — under `releases/POSI-R-{name}/` alongside (not
replacing) the `snapshots/` this README describes, and `current.json` will
point to it. Nothing here should be described publicly as "the current
POSI-R release" until that happens.

**Not editable in place.** Once a snapshot directory is written, it is
never modified — a newer or corrected snapshot gets a new
`snapshots/<date>/` directory and `current.json` is repointed. Anyone who
recorded a specific snapshot id can always fetch exactly what they saw.

## Layout

```
current.json                              -- points at the latest snapshot
snapshots/
  2026-08-13/
    manifest.json                         -- provenance + component versions
    SHA256SUMS                            -- checksums for every file below
    collections/
      core-collection.json                -- POSI Core Collection (small)
      benchmark-curated.json              -- Global Benchmark curated seed
      publisher-catalog.json              -- Global Benchmark publisher-catalog expansion (large)
```

`current.json`:

```json
{
  "type": "pre_release_data_snapshot",
  "is_official_release": false,
  "snapshot": "2026-08-13",
  "manifest": "/snapshots/2026-08-13/manifest.json",
  "note": "..."
}
```

A consumer should always read `current.json` first, then follow its
`manifest` pointer — never hardcode a snapshot id, since `current.json` is
the only file in this repo that's expected to change in place.

`manifest.json` mirrors POSI-R-1.0-SPEC.md § 4's field set (`lifecycle_version`,
`psc_crosswalk_version`, `ajr_e_version`, `ajr_m_version`, `rank_version`,
`evidence_version`, `diagnostics_version`, `pcs_version`, `pci_version`,
`pjr_release`, `data_commit`, `engine_commit`, plus count fields) so that
upgrading a future snapshot into a real POSI-R release is a rename, not a
redesign. A component not yet backed by real data reports an explicit
`"Pending"` (never an omitted field) — currently `pci_version` and
`pcs_version`, since neither the real PCI pipeline nor the uncapped PCS
1.0 Crossref ETL has been run yet.

`data_commit` is the exact posi-data git SHA the snapshot's `corpus/`
files were read from. `engine_commit` is the posi-engine commit the
generating script (`scripts/publish-data-snapshot.mjs` in posi-data)
pairs with — corpus fields computed at different points in this
project's history may individually predate that commit; `engine_commit`
identifies the snapshot tool's own version, not a claim that every number
in the collections was computed by that exact commit.

## Generating a snapshot

Run from a posi-data checkout, pointed at a local clone of this repo:

```
node scripts/publish-data-snapshot.mjs \
  --out /path/to/posi-data-delivery \
  --engine-commit <posi-engine git sha>
```

Then commit and push the result from this repo. The script is idempotent
for a given day (same `--snapshot-id`, default today's date) and will
overwrite that day's directory if re-run — intentional, so a same-day fix
doesn't require a fake `-2` suffix; anything already published under a
prior date's directory is left untouched.

## Consuming this data

```
fetch('https://data.posi.panorama-sg.com/current.json')
  .then(r => r.json())
  .then(({ manifest }) => fetch(`https://data.posi.panorama-sg.com${manifest}`))
```

(Custom domain pending DNS setup — see below. Until then, this repo's
default GitHub Pages URL works identically:
`https://wenshao521.github.io/posi-data-delivery/`.)

## Custom domain (`data.posi.panorama-sg.com`) — manual step, not automatable here

GitHub Pages is enabled on this repo with `CNAME` set to
`data.posi.panorama-sg.com`. For the domain to actually resolve, whoever
manages DNS for `panorama-sg.com` needs to add, at the registrar/DNS
provider:

```
Type:  CNAME
Name:  data.posi
Value: wenshao521.github.io
```

Then enable **Settings → Pages → Enforce HTTPS** once GitHub reports the
domain as verified (can take up to 24h for DNS to propagate). This step
requires access to the `panorama-sg.com` DNS zone, which is outside this
repository/CI — nothing here can complete it automatically.

## CORS

GitHub Pages serves static assets with a permissive `Access-Control-Allow-Origin: *`
by default, which is why a browser `fetch()` from `posi.panorama-sg.com`
against this domain is expected to work without a proxy. Not independently
re-verified against the custom domain yet (pending the DNS step above) —
confirm this holds once `data.posi.panorama-sg.com` is live before relying
on it in production frontend code; GitHub Pages doesn't support custom
response headers (no way to configure this ourselves either way — see
GitHub's own community discussion on the topic), so there's no fallback
tuning available if it doesn't.

## GitHub Pages limits (per GitHub's published limits, as of this writing)

Published site ≤ 1 GB, ~100 GB/month soft bandwidth cap. At today's scale
(~6 MB per snapshot) this is nowhere close — revisit if/when per-journal
sharded files (`journals/<shard>/<id>.json`, per PJR-SPEC.md § 4's
sharding convention) get added for a much larger corpus.
