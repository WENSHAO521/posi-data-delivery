#!/usr/bin/env node
// Assembles the GitHub Pages site for data.posi.panorama-sg.com into _site/:
//
//   current.json, releases/                          from this repository
//   downloads/rankings/                               the newest archive of each year's
//                                                     Citation Ranking (ranking-<year>[-r<n>]
//                                                     releases), with index.json listing them
//   snapshots/                                        manifests from this repository; the
//                                                     collections of the snapshots served
//                                                     whole, from their snapshot-<id> releases
//   site/<format>/                                    the POSI website's data files,
//                                                     from its site-data release
//   deploy.json                                       what this deploy contains
//
//   node scripts/assemble-pages.mjs <site-data dir> <site-data stamp.json>
//
// Served whole: the current snapshot, each release's snapshot and the
// RECENT newest others; older snapshots keep only manifest.json and
// SHA256SUMS here (their collections are in their releases). GitHub Pages
// publishes at most 1 GB: above BUDGET, collections of the oldest served
// snapshots are left out too, never the current one's or a release's.
import { createHash } from 'crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const [siteDir, stampFile] = process.argv.slice(2)
if (!siteDir || !stampFile) { console.error('usage: assemble-pages.mjs <site-data dir> <stamp.json>'); process.exit(1) }

const OUT = '_site'
const BUDGET = 900 * 1024 * 1024
const RECENT = 3
const REPO = process.env.GITHUB_REPOSITORY ?? 'WENSHAO521/posi-data-delivery'

// GitHub answers 502/503/504 for a minute or so now and then: retry with backoff (5, 10, 20, 40 s)
// on a network error, a 429 or a 5xx, so one bad minute does not fail the deploy. Other answers are final.
const BACKOFF_MS = Number(process.env.POSI_RETRY_BASE_MS ?? 5000)
async function fetchRetry(url, init, tries = 5) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(180_000), ...init }).catch(e => ({ ok: false, status: 0, error: e }))
    if (res.ok || attempt >= tries || (res.status && res.status !== 429 && res.status < 500)) return res
    const wait = BACKOFF_MS * 2 ** (attempt - 1)
    console.warn(`assemble-pages: ${res.status || res.error?.message} ${url}; retry ${attempt} of ${tries - 1} in ${wait / 1000} s`)
    await new Promise(r => setTimeout(r, wait))
  }
}
// A release download (github.com/<owner>/<repo>/releases/download/<tag>/<name>) that still fails
// comes through the REST API instead, a separate front end (2026-11-09: release downloads answered
// 504 for over ten minutes while the API served the same assets).
const ghHeaders = accept => ({ 'user-agent': 'posi-data-delivery', accept, ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) })
async function viaApi(url) {
  const m = url.match(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/releases\/download\/([^/]+)\/([^/?#]+)$/)
  if (!m) return null
  const rel = await fetchRetry(`https://api.github.com/repos/${m[1]}/releases/tags/${m[2]}`, { headers: ghHeaders('application/vnd.github+json') }, 3)
  if (!rel.ok) return null
  const asset = (await rel.json()).assets?.find(a => a.name === decodeURIComponent(m[3]))
  if (!asset) return null
  const res = await fetchRetry(asset.url, { headers: ghHeaders('application/octet-stream') }, 3)
  if (res.ok) console.warn(`assemble-pages: ${url} came through the GitHub API`)
  return res.ok ? res : null
}

// Assets checked against a SHA-256 are cached by that hash in POSI_ASSET_CACHE (kept between runs
// by actions/cache), so a served snapshot or ranking archive downloads once, and a GitHub outage
// cannot fail the deploy for a file an earlier run already had. A hash names its content, so a
// cached copy is never stale. Files no longer used are dropped at the end of a run.
const CACHE = process.env.POSI_ASSET_CACHE
const usedHashes = new Set()
const sha256 = b => createHash('sha256').update(b).digest('hex')
async function getAsset(url, hash) {
  if (hash && CACHE && existsSync(join(CACHE, hash))) {
    const b = readFileSync(join(CACHE, hash))
    if (sha256(b) === hash) { usedHashes.add(hash); return b }
  }
  // An asset with no hash to check (a ranking archive's SHA256SUMS; a tag's assets do not change, a
  // revision is a new tag) is cached by its URL, and used only when GitHub does not serve it.
  const key = hash ?? `u-${sha256(url)}`
  let res = await fetchRetry(url)
  if (!res.ok) res = await viaApi(url)
  if (!res?.ok) {
    if (hash || !CACHE || !existsSync(join(CACHE, key))) return null
    console.warn(`assemble-pages: ${url} from the cache`)
    usedHashes.add(key)
    return readFileSync(join(CACHE, key))
  }
  const b = Buffer.from(await res.arrayBuffer())
  if (CACHE && (!hash || sha256(b) === hash)) {
    mkdirSync(CACHE, { recursive: true })
    writeFileSync(join(CACHE, key), b)
    usedHashes.add(key)
  }
  return b
}
const stamp = JSON.parse(readFileSync(stampFile, 'utf-8'))
const size = p => statSync(p).isDirectory() ? readdirSync(p).reduce((n, f) => n + size(join(p, f)), 0) : statSync(p).size
const mib = b => `${(b / 1048576).toFixed(0)} MiB`

rmSync(OUT, { recursive: true, force: true })
mkdirSync(OUT)
for (const f of ['CNAME', '.nojekyll', 'current.json', 'README.md', 'releases', 'downloads', 'snapshots']) {
  if (existsSync(f)) cpSync(f, join(OUT, f), { recursive: true })
}
cpSync(siteDir, join(OUT, 'site', stamp.format), { recursive: true })

// Snapshots the data layer points at are always kept whole.
const current = JSON.parse(readFileSync('current.json', 'utf-8'))
const keep = new Set([current.snapshot])
for (const r of existsSync('releases') ? readdirSync('releases') : []) {
  const m = join('releases', r, 'manifest.json')
  if (existsSync(m)) { const s = JSON.parse(readFileSync(m, 'utf-8')).snapshot; if (s) keep.add(s) }
}
const order = id => { const [, d, n] = id.match(/^(\d{4}-\d{2}-\d{2})(?:-(\d+))?$/) ?? [, id, '1']; return `${d}-${String(n ?? 1).padStart(4, '0')}` }
const snapshots = readdirSync(join(OUT, 'snapshots')).sort((a, b) => order(a).localeCompare(order(b)))
const served = new Set([...keep, ...snapshots.slice(-RECENT)])

// Collections of served snapshots that are not in the tree come from the
// snapshot's release, checked against its SHA256SUMS.
for (const id of snapshots) {
  const dir = join(OUT, 'snapshots', id)
  if (!served.has(id)) { rmSync(join(dir, 'collections'), { recursive: true, force: true }); continue }
  const sums = existsSync(join(dir, 'SHA256SUMS'))
    ? readFileSync(join(dir, 'SHA256SUMS'), 'utf-8').trim().split('\n').map(l => l.trim().split(/\s+/)).filter(([, p]) => p?.startsWith('collections/'))
    : []
  for (const [hash, path] of sums) {
    const file = join(dir, path)
    if (existsSync(file)) continue
    const url = `https://github.com/${REPO}/releases/download/snapshot-${id}/${path.slice('collections/'.length)}`
    const body = await getAsset(url, hash)
    if (!body || sha256(body) !== hash) {
      if (keep.has(id)) { console.error(`assemble-pages: cannot get ${url} (or its checksum differs)`); process.exit(1) }
      console.warn(`assemble-pages: skipping snapshot ${id}: cannot get ${url}`)
      rmSync(join(dir, 'collections'), { recursive: true, force: true })
      break
    }
    mkdirSync(join(dir, 'collections'), { recursive: true })
    writeFileSync(file, body)
  }
}

// Citation Ranking downloads: the newest archive of each year, verified
// against its SHA256SUMS. Before the first archive exists, the repository's
// downloads/ (copied above) is served as it is.
const api = async path => {
  const res = await fetchRetry(`https://api.github.com/repos/${REPO}/${path}`, { headers: { 'user-agent': 'posi-data-delivery', accept: 'application/vnd.github+json', ...(process.env.GH_TOKEN ? { authorization: `Bearer ${process.env.GH_TOKEN}` } : {}) } })
  if (!res.ok) throw new Error(`GitHub API ${path}: ${res.status}`)
  return res.json()
}
const releases = []
for (let page = 1; ; page++) {
  const batch = await api(`releases?per_page=100&page=${page}`)
  releases.push(...batch)
  if (batch.length < 100) break
}
const archives = new Map()
for (const r of releases) {
  const m = r.tag_name.match(/^ranking-(\d{4})(?:-r(\d+))?$/)
  if (!m || r.draft) continue
  const y = Number(m[1]), rev = Number(m[2] ?? 0)
  const a = archives.get(y) ?? { tags: [] }
  a.tags.push({ tag: r.tag_name, rev, published_at: r.published_at })
  if (a.release == null || rev > a.rev) Object.assign(a, { release: r, rev })
  archives.set(y, a)
}
const editions = []
if (archives.size) {
  const dl = join(OUT, 'downloads', 'rankings')
  rmSync(dl, { recursive: true, force: true })
  mkdirSync(dl, { recursive: true })
  const get = async (url, hash) => {
    const b = await getAsset(url, hash)
    if (b) return b
    throw new Error(`cannot download ${url}`)
  }
  for (const [y, a] of [...archives].sort(([x], [z]) => z - x)) {
    const assets = new Map(a.release.assets.map(x => [x.name, x.browser_download_url]))
    const sums = (await get(assets.get('SHA256SUMS'))).toString('utf-8').trim().split('\n').map(l => l.trim().split(/\s+/))
    for (const [hash, name] of sums) {
      const body = await get(assets.get(name), hash)
      if (createHash('sha256').update(body).digest('hex') !== hash) throw new Error(`${a.release.tag_name}/${name}: checksum differs`)
      if (name !== 'SHA256SUMS' && name !== 'EDITION.sha256' && name !== 'DOWNLOADS.format') writeFileSync(join(dl, name), body)
    }
    const idx = JSON.parse(readFileSync(join(dl, `citation-${y}.json`), 'utf-8'))
    editions.push({
      year: y, edition: a.release.tag_name, revision: a.rev,
      archives: a.tags.sort((p, q) => p.rev - q.rev).map(t => t.tag),
      published_at: a.release.published_at,
      ranking_snapshot_date: idx.ranking_snapshot_date, evaluation_version: idx.evaluation_version,
      ranking_methodology_version: idx.ranking_methodology_version, pnci_model_version: idx.pnci_model_version,
      journals: idx.journals, ranked: idx.ranked,
      index: `/downloads/rankings/citation-${y}.json`, edition_file: idx.edition_file, csv: idx.csv, csv_all: idx.csv_all,
    })
  }
  writeFileSync(join(dl, 'index.json'), JSON.stringify({ latest: editions[0]?.year ?? null, editions }, null, 1))
}

let total = size(OUT)
const pruned = []
for (const id of snapshots) {
  if (total <= BUDGET) break
  if (keep.has(id)) continue
  const dir = join(OUT, 'snapshots', id, 'collections')
  if (!existsSync(dir)) continue
  total -= size(dir)
  rmSync(dir, { recursive: true })
  pruned.push(id)
}
// Then the per-category files of the oldest editions (their CSVs, index and
// edition file stay, and every file remains in the edition's release).
const prunedEditions = []
for (const e of [...editions].reverse().slice(0, -1)) {
  if (total <= BUDGET) break
  const dl = join(OUT, 'downloads', 'rankings')
  for (const f of readdirSync(dl).filter(f => f.startsWith(`citation-${e.year}-`) && f.endsWith('.json'))) { total -= size(join(dl, f)); rmSync(join(dl, f)) }
  prunedEditions.push(e.year)
}
if (total > BUDGET) { console.error(`assemble-pages: ${mib(total)} is over the ${mib(BUDGET)} budget even after pruning snapshots`); process.exit(1) }

writeFileSync(join(OUT, 'deploy.json'), JSON.stringify({
  deployed_at: new Date().toISOString(),
  delivery_commit: process.env.GITHUB_SHA ?? null,
  site_data: stamp,
  snapshots_served_whole: [...served].filter(id => existsSync(join(OUT, 'snapshots', id, 'collections'))).sort(),
  snapshots_without_collections: pruned,
  ranking_editions: editions.map(e => e.edition),
  ranking_editions_all: [...archives.values()].flatMap(a => a.tags.map(t => t.tag)).sort(),
  ranking_editions_without_category_files: prunedEditions,
}, null, 1))
if (CACHE && existsSync(CACHE)) for (const f of readdirSync(CACHE)) if (!usedHashes.has(f)) rmSync(join(CACHE, f), { force: true })
console.log(`assemble-pages: ${mib(total)}; site data ${stamp.format} from ${stamp.commit}${pruned.length ? `; collections left out for ${pruned.join(', ')}` : ''}`)
