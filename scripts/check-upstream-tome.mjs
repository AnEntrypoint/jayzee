import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex, summarizeTome } from '../src/upstream-tome/tomeIndex.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixturePath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'INDEX.md')
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

finish()
