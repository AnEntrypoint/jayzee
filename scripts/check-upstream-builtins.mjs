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

gate('the two sources together name 21 builtin modules, so the owner count of 23 is UNVERIFIED here', () => {
  same(new Set([...engineNames, ...tomeNames]).size, 21, 'union of engine and Tome builtin names')
})

gate('every one of the 21 builtin names has its own check:upstream-builtin-<name> script in the npm test chain', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const inChain = new Set([...pkg.scripts.test.matchAll(/npm run (check:upstream-builtin-[a-z0-9-]+)/g)].map((m) => m[1]))
  for (const name of EXPECTED_NAMES) {
    const script = 'check:upstream-builtin-' + name
    assert(typeof pkg.scripts[script] === 'string', script + ' is not defined in package.json')
    assert(inChain.has(script), script + ' is not run by npm test')
  }
})

gate('a builtin name with no check script is detected, so the coverage gate can fail', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  mustReject(() => assert(typeof pkg.scripts['check:upstream-builtin-no-such-module'] === 'string', 'check:upstream-builtin-no-such-module is not defined'))
})

finish()
