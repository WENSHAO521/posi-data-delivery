#!/usr/bin/env node
// Builds the files of one POSI Citation Ranking edition archive (a release
// ranking-<year>, or ranking-<year>-r<n> for a revision; see
// scripts/release-rankings.sh) from a snapshot's collections:
//
//   citation-ranking-<year>.json.gz  the edition itself, byte for byte as published
//   citation-<year>.json             the edition's versions, thresholds and file list
//   citation-<year>.csv              the ranked journals (official and provisional)
//   citation-<year>-all.csv          every journal of the edition, all statuses
//   citation-<year>-<category>.json  the journals of one PSC category ("unclassified": none)
//   EDITION.sha256                   SHA-256 of the edition file, to tell editions apart
//   SHA256SUMS                       checksums of every file above
//
// The Pages deploy serves the newest archive of each year under
// /downloads/rankings/ (scripts/assemble-pages.mjs).
//
//   RANKING_TAG=ranking-2026 RANKING_REVISION=0 \
//     node scripts/build-downloads.mjs <collections dir> <out dir>
import { createHash } from 'crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { gunzipSync } from 'zlib'

const [collections, OUT] = process.argv.slice(2)
if (!collections || !OUT) { console.error('usage: build-downloads.mjs <collections dir> <out dir>'); process.exit(1) }
const col = name => join(collections, name)
if (!existsSync(col('citation-ranking.json.gz'))) { console.error(`build-downloads: no citation-ranking.json.gz in ${collections}`); process.exit(1) }

const editionBytes = readFileSync(col('citation-ranking.json.gz'))
const edition = JSON.parse(gunzipSync(editionBytes).toString('utf-8'))
const year = edition.metric_year
const tag = process.env.RANKING_TAG ?? `ranking-${year}`
const revision = Number(process.env.RANKING_REVISION ?? 0)
const BASE = '/downloads/rankings'
const UNCLASSIFIED = 'unclassified'

// Core Collection membership and AJR Ratings, as the POSI website shows them.
const core = existsSync(col('core-collection.json')) ? JSON.parse(readFileSync(col('core-collection.json'), 'utf-8')) : []
const coreIds = new Set(core.map(j => j.posi_id))
const AJR_SCALE = [['A+', 90], ['A', 85], ['A−', 80], ['B+', 75], ['B', 70], ['B−', 65], ['C+', 60], ['C', 50], ['D', 0]]
const ajr = new Map()
for (const j of core) {
  const r = j.early_stage_rating
  if (!r || r.version !== 'AJR-E-1.1' || !['official', 'provisional'].includes(r.rating_status) || r.lifecycle_stage === 'mature' || r.total == null) continue
  ajr.set(j.posi_id, r.rating ?? AJR_SCALE.find(([, min]) => r.total >= min)?.[0] ?? null)
}
// PCI for the curated journals, when the edition has none.
const pci = new Map(existsSync(col('pci.json')) ? JSON.parse(readFileSync(col('pci.json'), 'utf-8')).map(r => [r.journal_id, r.pci]) : [])

const catKey = r => r.ranking_category_id ?? UNCLASSIFIED
const row = r => ({
  posi_id: r.journal_id, title: r.title ?? null, publisher: r.publisher ?? null, issn: r.issn ?? [], collection: coreIds.has(r.journal_id) ? 'core' : 'indexed',
  ranking_category_id: r.ranking_category_id ?? null, pnci: r.pnci ?? null, eligible_citable_items: r.eligible_citable_items ?? null, citation_coverage: r.citation_coverage ?? null,
  citation_rank: r.citation_rank ?? null, citation_rank_total: r.citation_rank_total ?? null, citation_percentile: r.citation_percentile ?? null, citation_quartile: r.citation_quartile ?? null,
  posi_zone: r.posi_zone ?? null, zone_status: r.zone_status ?? null, citation_ranking_status: r.citation_ranking_status ?? null, ranking_status_reason: r.ranking_status_reason ?? null,
  ajr_rating: ajr.get(r.journal_id) ?? null, lifecycle_stage: r.lifecycle_stage ?? null, pci: r.pci ?? pci.get(r.journal_id) ?? null, pcs: r.pcs ?? null,
})

const all = edition.records.map(row)
const byRank = (a, b) => (a.citation_rank ?? Infinity) - (b.citation_rank ?? Infinity) || (b.pnci ?? -1) - (a.pnci ?? -1) || a.posi_id.localeCompare(b.posi_id)
all.sort((a, b) => (a.ranking_category_id ?? '~').localeCompare(b.ranking_category_id ?? '~') || byRank(a, b))

const cell = v => { const s = v == null ? '' : Array.isArray(v) ? v.join(' ') : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
const cols = Object.keys(row({}))
const csv = rows => [cols.join(','), ...rows.map(o => cols.map(c => cell(o[c])).join(','))].join('\n') + '\n'

const meta = {
  edition: tag, revision,
  evaluation_version: edition.evaluation_version, ranking_methodology_version: edition.ranking_methodology_version, pnci_model_version: edition.pnci_model_version,
  zones_version: edition.zones_version, metric_year: year, ranking_snapshot_date: edition.snapshot_date, ranking_metric: 'PNCI',
  thresholds: edition.parameters ?? null,
  note: 'Citation Quartiles and POSI Zones are based on PNCI-derived percentiles within eligible PSC categories. PCS and PCI are descriptive.',
}

const cats = new Map()
for (const r of all) {
  const k = r.ranking_category_id ?? UNCLASSIFIED
  if (!cats.has(k)) cats.set(k, [])
  cats.get(k).push(r)
}

mkdirSync(OUT, { recursive: true })
const write = (name, data) => writeFileSync(join(OUT, name), data)
const ranked = all.filter(r => r.citation_rank != null)
copyFileSync(col('citation-ranking.json.gz'), join(OUT, `citation-ranking-${year}.json.gz`))
write(`citation-${year}.csv`, csv(ranked))
write(`citation-${year}-all.csv`, csv(all))
const categories = [...cats.keys()].sort().map(k => {
  const rows = cats.get(k)
  const file = `citation-${year}-${k}.json`
  write(file, JSON.stringify({ ...meta, category: k, journals: rows }))
  return { category: k, file: `${BASE}/${file}`, journals: rows.length, ranked: rows.filter(r => r.citation_rank != null).length, official: rows.filter(r => r.citation_ranking_status === 'official').length }
})
write(`citation-${year}.json`, JSON.stringify({
  ...meta, journals: all.length, ranked: ranked.length,
  edition_file: `${BASE}/citation-ranking-${year}.json.gz`,
  csv: `${BASE}/citation-${year}.csv`, csv_contents: 'ranked journals (official and provisional)',
  csv_all: `${BASE}/citation-${year}-all.csv`, csv_all_contents: 'every journal, all statuses',
  categories,
}, null, 1))
const sha = b => createHash('sha256').update(b).digest('hex')
write('EDITION.sha256', `${sha(editionBytes)}\n`)
write('SHA256SUMS', readdirSync(OUT).filter(f => f !== 'SHA256SUMS').sort().map(f => `${sha(readFileSync(join(OUT, f)))}  ${f}`).join('\n') + '\n')
console.log(`build-downloads: ${tag}, citation ranking ${year}, ${all.length} journals (${ranked.length} ranked), ${categories.length} categories -> ${OUT}/`)
