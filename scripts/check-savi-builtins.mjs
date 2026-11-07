import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseTomeIndex } from '../src/savi-tome/tomeIndex.js'
import { builtinNamesFromEngine, builtinNamesFromTome, compareNameSets } from '../src/savi-builtins/builtinModules.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const engineFixture = join(root, 'scripts', 'fixtures', 'savi', 'engine-deep', 'api-b.md')
const tomeFixture = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'INDEX.md')
const sourceDir = join(root, 'src', 'savi-builtins')
const ENGINE_SHA256 = 'c72d910ba3f3fecc965bfaf2d914827c4af43a67ae415d1e91871e875628b85e'
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

gate('the engine-deep copy is a byte copy of savi api-b.md at HEAD', () => {
  same(createHash('sha256').update(readFileSync(engineFixture)).digest('hex'), ENGINE_SHA256, 'sha256')
})

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

gate('src/savi-builtins is comment-free, imports nothing bare and reads no host global', () => {
  const names = readdirSync(sourceDir).filter((name) => name.endsWith('.js')).sort()
  sameJson(names, ['ballistics.js', 'builtinBodies.js', 'builtinModules.js', 'easing.js', 'env.js', 'math.js', 'nav.js', 'noise.js', 'path.js', 'roomRouting.js', 'spline.js', 'terrain.js', 'tween.js', 'vec3.js'], 'source files')
  for (const name of names) {
    const found = findingsIn(readFileSync(join(sourceDir, name), 'utf8'))
    assert(found.length === 0, name + ': ' + found.join(', '))
  }
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
