import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { bucketOf, countBuckets, parseReadmeTotals, sumOf } from '../src/savi-reference/referenceIndex.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readmePath = join(root, 'scripts', 'fixtures', 'savi', 'reference', 'README.md')
const pathsPath = join(root, 'scripts', 'fixtures', 'savi', 'reference', 'PATHS.txt')
const sourceDir = join(root, 'src', 'savi-reference')
const README_SHA256 = 'bb4686a2526d5663dbdf7dc7afe62d0788527c40ab0fed280e9b871059222ecb'
const PATHS_SHA256 = '8c7d332dfe11643f17b58850889a41fd3300f05290f357f1364e98dbd58de847'
const INDEXED = ['tome', 'skills', 'engine', 'cli', 'http', 'guide']

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const sortedKeys = (object) => Object.fromEntries(Object.keys(object).sort().map((key) => [key, object[key]]))
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const sha256Of = (path) => createHash('sha256').update(readFileSync(path)).digest('hex')

const readme = readFileSync(readmePath, 'utf8')
const claimed = parseReadmeTotals(readme)
const paths = readFileSync(pathsPath, 'utf8').split('\n').filter((line) => line.length > 0)
const measured = countBuckets(paths)

gate('the README and the path list are byte copies of savi .spawn/reference at HEAD', () => {
  same(sha256Of(readmePath), README_SHA256, 'README sha256')
  same(sha256Of(pathsPath), PATHS_SHA256, 'PATHS sha256')
})

gate('the README states a total of 208 whose per-job figures sum to 208, by arithmetic only', () => {
  same(claimed.total, 208, 'claimed total')
  sameJson(sortedKeys(claimed.buckets), sortedKeys({ tome: 74, skills: 47, engine: 27, cli: 39, http: 18, guide: 3 }), 'claimed buckets')
  same(sumOf(claimed.buckets, INDEXED), 208, 'sum of claimed buckets')
  mustReject(() => same(sumOf(claimed.buckets, INDEXED), 209, 'sum of claimed buckets'))
})

gate('the tracked reference holds 563 paths in the buckets measured here', () => {
  same(paths.length, 563, 'tracked paths')
  sameJson(sortedKeys(measured), sortedKeys({ tome: 75, skills: 47, engine: 27, cli: 39, 'cli-types': 308, http: 18, guide: 5, 'engine-deep': 40, 'top-level': 4 }), 'measured buckets')
  same(sumOf(measured, Object.keys(measured)), 563, 'bucket sum')
})

gate('the measured indexed buckets differ from the README figures: tome 75 against 74, guide 5 against 3', () => {
  const differing = INDEXED.filter((name) => claimed.buckets[name] !== measured[name]).map((name) => [name, claimed.buckets[name], measured[name]])
  sameJson(differing, [['tome', 74, 75], ['guide', 3, 5]], 'differing buckets')
  same(sumOf(measured, INDEXED), 211, 'measured indexed sum')
  mustReject(() => same(sumOf(measured, INDEXED), 208, 'measured indexed sum'))
})

gate('bucket rules place top-level files, the cli types directory and paths of each reference job correctly', () => {
  same(bucketOf('.spawn/reference/README.md'), 'top-level', 'top-level file')
  same(bucketOf('.spawn/reference/cli/types/Foo.txt'), 'cli-types', 'cli types')
  same(bucketOf('.spawn/reference/cli/INDEX.md'), 'cli', 'cli index')
  same(bucketOf('.spawn/reference/engine-deep/api-b.md'), 'engine-deep', 'engine-deep')
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-reference is comment-free, imports nothing bare and reads no host global', () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort()
  sameJson(names, ['referenceIndex.js'], 'source files')
  for (const name of names) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, name + ': ' + found.join(', '))
  }
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
