import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseManifest, parseSkillIndex, summarizeSkills } from '../src/savi-skills/skillIndex.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureDir = join(root, 'scripts', 'fixtures', 'savi', 'skills')
const sourceDir = join(root, 'src', 'savi-skills')
const INDEX_SHA256 = 'ce4eb97163c7082d0a78c40d66bcefec44db8c2dd99f6229965173466603f400'
const MANIFEST_SHA256 = '0c842ad5055a197beeae506b307645fbf63547387107a8bca4c7cdc5f197897f'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
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

const indexPath = join(fixtureDir, 'INDEX.md')
const manifestPath = join(fixtureDir, 'MANIFEST.txt')
const index = parseSkillIndex(readFileSync(indexPath, 'utf8'))
const manifest = parseManifest(readFileSync(manifestPath, 'utf8'))
const summary = summarizeSkills(index, manifest)

gate('the index and the manifest are byte copies of the recorded savi files', () => {
  same(sha256Of(indexPath), INDEX_SHA256, 'INDEX.md sha256')
  same(sha256Of(manifestPath), MANIFEST_SHA256, 'MANIFEST.txt sha256')
})

gate('23 skills are served, with unique ids, and the directory holds 47 entries', () => {
  same(summary.served, 23, 'served skills')
  same(new Set(index.map((row) => row.id)).size, 23, 'unique ids')
  same(summary.entries, 47, 'directory entries')
  same(summary.json, 23, 'json entries')
  same(summary.md, 24, 'md entries including INDEX.md')
  mustReject(() => same(summary.entries, 46, 'directory entries'))
})

gate('every served skill has its json and its md in the directory', () => {
  sameJson(summary.missingJson, [], 'missing json')
  sameJson(summary.missingMd, [], 'missing md')
})

gate('the byte column minus the md file size is +1 for 21 skills, −12 for cameras and +27 for heightmap-terrain, savi\'s expression', () => {
  same(summary.byteColumnOffsets.length, 23, 'skills with an offset')
  const delta = (offset) => offset.indexBytes - offset.fileBytes
  same(summary.byteColumnOffsets.filter((offset) => delta(offset) === 1).length, 21, 'one byte above the file')
  sameJson(summary.byteColumnOffsets.filter((offset) => delta(offset) !== 1).map((offset) => [offset.id, delta(offset)]), [['cameras', -12], ['heightmap-terrain', 27]], 'other offsets')
  mustReject(() => same(summary.byteColumnOffsets.length, 0, 'skills with an offset'))
})

gate('a malformed index row or manifest line is refused rather than dropped', () => {
  mustReject(() => parseSkillIndex('| id | name | description | bytes |\n|---|---|---|---|\n| a | A | d |\n'))
  mustReject(() => parseSkillIndex('| id | name | description | bytes |\n|---|---|---|---|\n| a | A | d | big |\n'))
  mustReject(() => parseManifest('abc 12 physics.md\n'))
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

gate('src/savi-skills is comment-free, imports nothing bare and reads no host global', () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort()
  sameJson(names, ['skillBodies.js', 'skillIndex.js'], 'source files')
  for (const name of names) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, name + ': ' + found.join(', '))
  }
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
