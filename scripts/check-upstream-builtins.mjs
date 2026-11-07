import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex } from '../src/upstream-tome/tomeIndex.js'
import { builtinNamesFromEngine, builtinNamesFromTome, compareNameSets } from '../src/upstream-builtins/builtinModules.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engineFixture = join(root, 'scripts', 'fixtures', 'upstream', 'engine-deep', 'api-b.md')
const tomeFixture = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'INDEX.md')
const EXPECTED_NAMES = ['ballistics', 'easing', 'env', 'fx', 'lighting', 'math', 'nav', 'noise', 'path', 'physics', 'postfx', 'room-routing', 'spline', 'terrain', 'three', 'tsl', 'tween', 'vec3', 'vibe', 'voxels', 'water']

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

const engineText = readFileSync(engineFixture, 'utf8')
const engineNames = builtinNamesFromEngine(engineText)
const tomeNames = builtinNamesFromTome(parseTomeIndex(readFileSync(tomeFixture, 'utf8')))
const comparison = compareNameSets(engineNames, tomeNames)

gate('the engine reference lists 21 builtin modules, each once', () => {
  same(engineNames.length, 21, 'engine builtin rows')
  same(comparison.duplicatesLeft, 0, 'engine duplicates')
  mustReject(() => same(engineNames.length, 23, 'engine builtin rows'))
})

gate('the Tome index and the engine reference name the same 21 builtin modules', () => {
  same(tomeNames.length, 21, 'tome builtin sections')
  sameJson(comparison.onlyLeft, [], 'named only by the engine reference')
  sameJson(comparison.onlyRight, [], 'named only by the Tome index')
  sameJson([...tomeNames].sort(), EXPECTED_NAMES, 'builtin names')
})

gate('the owner count of 23 is not claimed: no 23-name set is reproduced from these sources', () => {
  mustReject(() => same(new Set([...tomeNames, 'extra-one', 'extra-two']).size, 21, 'padded set'))
})

finish()
