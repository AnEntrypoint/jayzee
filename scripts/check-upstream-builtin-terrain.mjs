import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { shore, SHORE_OPTION_DEFAULTS, TERRAIN_NAMES } from '../src/upstream-builtins/terrain.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-terrain.md')

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

gate('the upstream section gives the sentence, the defaults and the signature this module carries', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('shore changes heights near the supplied water level.'), true, 'shore sentence')
  same(section.includes('Defaults: apron 6, berm 0.3, grade 0.06, rejoin 24, shelf 2.2, shelfReach 6, drop 20, scale 1.'), true, 'defaults sentence')
  same(section.includes('shore(height: number, level: number, opts?: { apron?: number, berm?: number, grade?: number, rejoin?: number, shelf?: number, shelfReach?: number, drop?: number, scale?: number }): number'), true, 'signature')
  sameJson(TERRAIN_NAMES, ['shore'], 'exported names')
})

gate('the exported defaults are the upstream defaults, name for name and value for value', () => {
  sameJson(SHORE_OPTION_DEFAULTS, { apron: 6, berm: 0.3, grade: 0.06, rejoin: 24, shelf: 2.2, shelfReach: 6, drop: 20, scale: 1 }, 'defaults')
  same(Object.isFrozen(SHORE_OPTION_DEFAULTS), true, 'defaults are read-only')
})

gate('scoped negative: shore is refused for every input, because upstream gives the names and defaults but no curve shape', () => {
  mustThrow(() => shore(1, 0))
  mustThrow(() => shore(-3, 0, { apron: 4, drop: 10 }))
})

gate('shore refuses a non-finite height or level, an option upstream does not name, and a non-finite option value', () => {
  mustThrow(() => shore(Number.NaN, 0))
  mustThrow(() => shore(1, Number.POSITIVE_INFINITY))
  mustThrow(() => shore(1, 0, { beach: 3 }))
  mustThrow(() => shore(1, 0, { apron: '6' }))
  mustThrow(() => shore(1, 0, { constructor: 1 }))
})

finish()
