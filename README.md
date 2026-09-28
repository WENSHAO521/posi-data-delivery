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

## Releases and snapshots

**Releases.** [`POSI-R-1.0-SPEC.md`](https://github.com/WENSHAO521/posi-data/blob/master/POSI-R-1.0-SPEC.md)
defines POSI's platform release. The first, **POSI-R-2026.1**, was
published on 2026-09-27. Each release's reviewed manifest is committed to
posi-data's `releases/` and mirrored here under `releases/<release>/`. A
snapshot whose collections are byte-identical to the newest release (the
manifest's `files` checksums) is published as that release:
`type: "official_release"`, `is_official_release: true`,
`release: "POSI-R-2026.1"`.

**Snapshots.** Every publication is a snapshot of whatever is committed to
posi-data. One built from data changed since the latest release is a
`post_release_data_snapshot`: `is_official_release: false`, with
`latest_release` naming the release it follows. Cite a release by its
name, and a snapshot by its id.

**Not editable in place.** Once a snapshot directory is written, it is
never modified — a newer or corrected snapshot gets a new
`snapshots/<date>/` directory and `current.json` is repointed. Anyone who
recorded a specific snapshot id can always fetch exactly what they saw.

## Layout

```
current.json                              -- points at the latest snapshot and names the latest release
releases/
  POSI-R-2026.1/manifest.json             -- release manifest, mirrored from posi-data
snapshots/
  2026-08-13/
    manifest.json                         -- provenance + component versions
    SHA256SUMS                            -- checksums for every file below
    collections/
      core-collection.json                -- POSI Core Collection (small)
      benchmark-curated.json              -- Global Benchmark curated seed
      publisher-catalog.json              -- Global Benchmark publisher-catalog expansion (large)
      pcs.json, pci.json                  -- PCS and PCI indicator records
      citation-ranking.json.gz            -- POSI Citation Ranking edition (POSI-EVAL-1.0: PNCI-1.0,
                                             CITATION-RANK-1.0, POSI-ZONES-2.0), from snapshots after
                                             the first PNCI-1.0 cycle; the only ranking POSI publishes
      pcs-q.json.gz                       -- PCS edition: PCS values. Its PCS-Q rank, percentile and
                                             quartile fields are retired and are not an evaluation result
      citation-rankings.json              -- archive of the retired PCI-based Citation Q (2 records)
```

**Evaluation architecture.** Since 2026-09-28 POSI evaluates journals in five
layers ([POSI-EVAL-1.0-SPEC.md](https://github.com/WENSHAO521/posi-data/blob/master/POSI-EVAL-1.0-SPEC.md)):
PQF (Core Collection eligibility), AJR (AJR Score + AJR Rating A+ … D, in each
corpus record's `early_stage_rating.rating`), the PCI/PNCI/PCS indicators, the
Citation Ranking (rank, percentile, Citation Quartile Q1–Q4, displayed C-Q1–C-Q4,
from PNCI within the PSC category) and POSI Zones. Legacy E-Q/M-Q quartile fields
in the corpus and PCS-Q fields in `pcs-q.json.gz` are kept for the record only.
Snapshot manifests from then on carry `evaluation_version`,
`citation_rank_version`, `pnci_version`, `zones_version` and
`ranking_snapshot_date`.

`current.json`:

```json
{
  "type": "official_release",
  "is_official_release": true,
  "release": "POSI-R-2026.1",
  "latest_release": "POSI-R-2026.1",
  "latest_release_manifest": "/releases/POSI-R-2026.1/manifest.json",
  "snapshot": "2026-09-27",
  "manifest": "/snapshots/2026-09-27/manifest.json",
  "note": "..."
}
```

A consumer should always read `current.json` first, then follow its
`manifest` pointer — never hardcode a snapshot id, since `current.json` is
the only file in this repo that's expected to change in place.

`manifest.json` mirrors POSI-R-1.0-SPEC.md § 4's field set (`lifecycle_version`,
`psc_crosswalk_version`, `ajr_e_version`, `ajr_m_version`, `rank_version`,
`evidence_version`, `diagnostics_version`, `pcs_version`, `pci_version`,
`pjr_release`, `data_commit`, `engine_commit`, plus count fields) . A component not yet backed by real data reports an explicit
`"Pending"` (never an omitted field).

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

**Live now** at the default GitHub Pages URL:
`https://wenshao521.github.io/posi-data-delivery/` (verified — `current.json`,
`manifest.json`, and all three collection files return 200). The custom
domain in the example above is not live yet — see below.

## Custom domain (`data.posi.panorama-sg.com`) — manual step, not automatable here

**Do the DNS step below first, then add the custom domain — not the other
order.** Adding a `CNAME` file / setting the custom domain in repo settings
before the DNS record exists makes GitHub Pages force-redirect the
working default URL above to the not-yet-resolving custom domain,
breaking the only usable URL in the meantime (this repo hit exactly that
and reverted it — see commit history).

1. Whoever manages DNS for `panorama-sg.com` adds, at the registrar/DNS
   provider:

   ```
   Type:  CNAME
   Name:  data.posi
   Value: wenshao521.github.io
   ```

2. Once that record has propagated (can take up to 24h), set the custom
   domain: **Settings → Pages → Custom domain → `data.posi.panorama-sg.com`**
   (or `gh api repos/WENSHAO521/posi-data-delivery/pages -X PUT -f cname=data.posi.panorama-sg.com`),
   which writes the `CNAME` file back.
3. Enable **Settings → Pages → Enforce HTTPS** once GitHub reports the
   domain as verified.

This requires access to the `panorama-sg.com` DNS zone, which is outside
this repository/CI — nothing here can complete step 1 automatically.

## CORS

Confirmed against the live default URL: GitHub Pages serves this repo's
files with `Access-Control-Allow-Origin: *`, so a browser `fetch()` from
`posi.panorama-sg.com` works without a proxy. Re-confirm once the custom
domain is live (step 2 above) — GitHub Pages doesn't support custom
response headers, so there's no way to tune this ourselves if the custom
domain ever behaves differently.

## GitHub Pages limits (per GitHub's published limits, as of this writing)

Published site ≤ 1 GB, ~100 GB/month soft bandwidth cap. At today's scale
(~6 MB per snapshot) this is nowhere close — revisit if/when per-journal
sharded files (`journals/<shard>/<id>.json`, per PJR-SPEC.md § 4's
sharding convention) get added for a much larger corpus.
