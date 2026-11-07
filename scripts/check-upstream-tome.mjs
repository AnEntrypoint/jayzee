import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex, summarizeTome } from '../src/upstream-tome/tomeIndex.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'INDEX.md')
const sourceDir = join(root, 'src', 'upstream-tome')
const TOTAL_BYTES = 119521

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

const text = readFileSync(fixturePath, 'utf8')
const rows = parseTomeIndex(text)
const summary = summarizeTome(rows)

gate('the index holds 69 rows over 68 distinct headings and 69 section files', () => {
  same(summary.rows, 69, 'rows')
  same(summary.distinctHeadings, 68, 'distinct headings')
  same(summary.distinctFiles, 69, 'distinct files')
  mustReject(() => same(summary.rows, 68, 'rows'))
})

gate('World Queries is the one repeated heading, with both of its files kept', () => {
  sameJson(summary.repeatedHeadings, ['World Queries'], 'repeated headings')
  sameJson(rows.filter((row) => row.heading === 'World Queries').map((row) => row.file), ['sections/world-queries.md', 'sections/world-queries-2.md'], 'World Queries files')
})

gate('21 builtin module sections are indexed locally; the owner count of 23 is not claimed here', () => {
  same(summary.builtin, 21, 'builtin sections')
  mustReject(() => same(summary.builtin, 23, 'builtin sections'))
})

gate('the byte column sums to the recorded total and a known row keeps its file and size', () => {
  same(summary.totalBytes, TOTAL_BYTES, 'total bytes')
  const spawn = rows.find((row) => row.heading === 'Spawn game API')
  same(spawn.file, 'sections/spawn-game-api.md', 'file')
  same(spawn.bytes, 2312, 'bytes')
})

gate('a row with a missing cell or a non-count byte value is refused', () => {
  mustReject(() => parseTomeIndex('| Heading | File | Bytes | Source |\n|---|---|---|---|\n| a | sections/a.md | 1 |\n'))
  mustReject(() => parseTomeIndex('| Heading | File | Bytes | Source |\n|---|---|---|---|\n| a | sections/a.md | big | all |\n'))
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

gate('src/upstream-tome is comment-free, imports nothing bare and reads no host global', () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort()
  sameJson(names, ['tomeIndex.js', 'tomeLookup.js', 'tomeSections.js'], 'source files')
  for (const name of names) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, name + ': ' + found.join(', '))
  }
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
