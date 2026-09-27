#!/usr/bin/env node
// Prints "yes" when the collections posi-data would publish now differ from
// the current snapshot's, "no" when they are identical.
//
//   node scripts/collections-changed.mjs <checksums.json>
//
// <checksums.json> is the output of posi-data's
// `scripts/publish-data-snapshot.mjs --checksums-only`: { "collections/x.json": "<sha256>" }.
import { readFileSync } from 'fs'

const next = JSON.parse(readFileSync(process.argv[2], 'utf8'))
const current = JSON.parse(readFileSync('current.json', 'utf8'))
const dir = current.manifest.replace(/^\//, '').replace(/manifest\.json$/, '')
const published = Object.fromEntries(
  readFileSync(`${dir}SHA256SUMS`, 'utf8').trim().split('\n')
    .map(line => line.trim().split(/\s+/))
    .filter(([, path]) => path?.startsWith('collections/'))
    .map(([hash, path]) => [path, hash]),
)
const same = Object.keys(next).length === Object.keys(published).length &&
  Object.entries(next).every(([path, hash]) => published[path] === hash)
console.log(same ? 'no' : 'yes')
