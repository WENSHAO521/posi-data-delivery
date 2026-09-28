#!/usr/bin/env node
// Assembles the GitHub Pages site for data.posi.panorama-sg.com into _site/:
//
//   current.json, releases/, snapshots/, downloads/   from this repository
//   site/<format>/                                    the POSI website's data files,
//                                                     from its site-data release
//   deploy.json                                       what this deploy contains
//
//   node scripts/assemble-pages.mjs <site-data dir> <site-data stamp.json>
//
// GitHub Pages publishes at most 1 GB. Above BUDGET, the collections of the
// oldest snapshots are left out (their manifest.json and SHA256SUMS stay),
// never those of the current snapshot or of a release.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

const [siteDir, stampFile] = process.argv.slice(2)
if (!siteDir || !stampFile) { console.error('usage: assemble-pages.mjs <site-data dir> <stamp.json>'); process.exit(1) }

const OUT = '_site'
const BUDGET = 900 * 1024 * 1024
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
if (total > BUDGET) { console.error(`assemble-pages: ${mib(total)} is over the ${mib(BUDGET)} budget even after pruning snapshots`); process.exit(1) }

writeFileSync(join(OUT, 'deploy.json'), JSON.stringify({
  deployed_at: new Date().toISOString(),
  delivery_commit: process.env.GITHUB_SHA ?? null,
  site_data: stamp,
  snapshots_without_collections: pruned,
}, null, 1))
console.log(`assemble-pages: ${mib(total)}; site data ${stamp.format} from ${stamp.commit}${pruned.length ? `; collections left out for ${pruned.join(', ')}` : ''}`)
