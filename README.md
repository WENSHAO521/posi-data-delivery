# posi-data-delivery

The public, versioned, read-only data layer of **POSI (Panorama Open
Scholarly Index)**, served by GitHub Pages at
<https://data.posi.panorama-sg.com>. The POSI website and anyone else fetch
POSI data from here over plain HTTPS.

This is not the source of truth: that is
[posi-data](https://github.com/WENSHAO521/posi-data). Everything here is
generated from it, and nothing here is edited by hand.

## Use

Read `current.json` first, then follow its `manifest` pointer. Never
hard-code a snapshot id: `current.json` is the only file that changes in place.

```js
const base = 'https://data.posi.panorama-sg.com'
const current = await (await fetch(`${base}/current.json`)).json()
const dir = current.manifest.replace(/manifest\.json$/, '')
const core = await (await fetch(`${base}${dir}collections/core-collection.json`)).json()
```

Files are served with `Access-Control-Allow-Origin: *`, so browsers can fetch
them directly.

## Layout

```
current.json                         latest snapshot, and the release it follows
releases/<release>/manifest.json     POSI-R release manifests, mirrored from posi-data
snapshots/<snapshot-id>/
  manifest.json                      provenance, component versions, counts
  SHA256SUMS                         checksum of every file in the snapshot
  collections/
    core-collection.json             Core Collection (PQF, AJR with AJR Rating)
    benchmark-curated.json           Global Benchmark, curated seed
    publisher-catalog.json           Global Benchmark, publisher-catalog expansion
    pcs.json, pci.json               PCS and PCI indicator records
    citation-ranking.json.gz         POSI Citation Ranking edition (PNCI-1.0), from the first PNCI cycle on
    pcs-q.json.gz                    PCS edition: PCS values (its PCS-Q quartiles are retired)
    citation-rankings.json           archive of the retired PCI-based Citation Q
```

Large collections are gzipped (gzip without a timestamp, so the same content
always has the same checksum).

## Evaluation data

POSI evaluates journals in five layers
([POSI-EVAL-1.0-SPEC.md](https://github.com/WENSHAO521/posi-data/blob/master/POSI-EVAL-1.0-SPEC.md)):
PQF (Core Collection eligibility), AJR (AJR Score + AJR Rating A+ … D, in
`early_stage_rating.rating`), the PCI / PNCI / PCS indicators, the Citation
Ranking and POSI Zones. In `citation-ranking.json.gz` each record carries
`pnci`, `citation_rank`, `citation_rank_total`, `citation_percentile`,
`citation_quartile` (Q1–Q4, displayed C-Q1–C-Q4), `posi_zone`, `zone_status`,
`citation_ranking_status` and `ranking_snapshot_date`
([schema](https://github.com/WENSHAO521/posi-data/blob/master/schema/citation-ranking.schema.json)).

The only quartile POSI publishes is the Citation Quartile. The legacy E-Q /
M-Q fields in the corpus and the PCS-Q fields in `pcs-q.json.gz` are kept for
the record and are not evaluation results.

## Snapshots and releases

- **Immutable snapshots.** A snapshot directory is never modified once
  written. A newer or corrected snapshot gets a new id (`YYYY-MM-DD`, then
  `-2`, `-3`, … on the same day) and `current.json` is repointed, so anyone
  who recorded a snapshot id can always fetch exactly what they saw.
- **Releases.** A POSI-R release (for example
  [POSI-R-2026.1](./releases/POSI-R-2026.1/manifest.json)) is a reviewed
  manifest in posi-data. A snapshot whose collections are byte-identical to
  the newest release manifest is published as `type: "official_release"`; any
  other is a `post_release_data_snapshot` naming the release it follows. Cite
  a release by its name and a snapshot by its id.
- **Manifest.** Each `manifest.json` records `data_commit` (posi-data),
  `engine_commit` (posi-engine), the component versions (`evaluation_version`,
  `citation_rank_version`, `pnci_version`, `zones_version`, `ajr_e_version`,
  `ajr_m_version`, `pcs_version`, `pci_version`, `psc_crosswalk_version`, …),
  `ranking_snapshot_date` and record counts. A component without data yet
  reads `"Pending"`, never an omitted field.

## How snapshots are published

`.github/workflows/sync-from-posi-data.yml` runs every 20 minutes. It checks
out posi-data, compares the checksums of the collections posi-data would
publish (`publish-data-snapshot.mjs --checksums-only`) with the current
snapshot (`scripts/collections-changed.mjs`), and only when they differ builds
a new snapshot with posi-data's `scripts/publish-data-snapshot.mjs` and
commits it. A documentation-only change in posi-data publishes nothing.

To publish by hand, from a posi-data checkout:

```bash
node scripts/publish-data-snapshot.mjs --out /path/to/posi-data-delivery --engine-commit <posi-engine sha>
```

## Hosting

GitHub Pages with the custom domain `data.posi.panorama-sg.com` (`CNAME`,
DNS `data.posi` → `wenshao521.github.io`). GitHub Pages
limits the published site to about 1 GB. Each snapshot is currently about
19 MB, most of it the PCS edition, so old snapshots will eventually need
archiving to a release asset.

## Related repositories

- [posi-data](https://github.com/WENSHAO521/posi-data): canonical data and specifications
- [posi-engine](https://github.com/WENSHAO521/posi-engine): calculation engine
- [Panorama-Open-Scholarly-Index](https://github.com/WENSHAO521/Panorama-Open-Scholarly-Index): the website

## License

Data: CC BY 4.0 (see posi-data's LICENSE-DATA). Records aggregated from
upstream sources keep their origin's licence and attribution.
