import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { shore, SHORE_OPTION_DEFAULTS, TERRAIN_NAMES } from '../src/savi-builtins/terrain.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-terrain.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'terrain.js')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the savi section gives the sentence, the defaults and the signature this module carries', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('shore changes heights near the supplied water level.'), true, 'shore sentence')
  same(section.includes('Defaults: apron 6, berm 0.3, grade 0.06, rejoin 24, shelf 2.2, shelfReach 6, drop 20, scale 1.'), true, 'defaults sentence')
  same(section.includes('shore(height: number, level: number, opts?: { apron?: number, berm?: number, grade?: number, rejoin?: number, shelf?: number, shelfReach?: number, drop?: number, scale?: number }): number'), true, 'signature')
  sameJson(TERRAIN_NAMES, ['shore'], 'exported names')
})

gate('the exported defaults are the savi defaults, name for name and value for value', () => {
  sameJson(SHORE_OPTION_DEFAULTS, { apron: 6, berm: 0.3, grade: 0.06, rejoin: 24, shelf: 2.2, shelfReach: 6, drop: 20, scale: 1 }, 'defaults')
  same(Object.isFrozen(SHORE_OPTION_DEFAULTS), true, 'defaults are read-only')
})

gate('scoped negative: shore is refused for every input, because savi gives the names and defaults but no curve shape', () => {
  mustThrow(() => shore(1, 0))
  mustThrow(() => shore(-3, 0, { apron: 4, drop: 10 }))
})

gate('shore refuses a non-finite height or level, an option savi does not name, and a non-finite option value', () => {
  mustThrow(() => shore(Number.NaN, 0))
  mustThrow(() => shore(1, Number.POSITIVE_INFINITY))
  mustThrow(() => shore(1, 0, { beach: 3 }))
  mustThrow(() => shore(1, 0, { apron: '6' }))
  mustThrow(() => shore(1, 0, { constructor: 1 }))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
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

gate('src/savi-builtins/terrain.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
