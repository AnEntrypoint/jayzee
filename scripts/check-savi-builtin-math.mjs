import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { clamp, clamp01, lerp, MATH_NAMES } from '../src/savi-builtins/math.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-math.md')
const enginePath = join(root, 'scripts', 'fixtures', 'savi', 'engine-deep', 'api-b.md')
const sourceDir = join(root, 'src', 'savi-builtins')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-12) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

gate('the three names are the ones savi documents for math, and the section declares them with those signatures', () => {
  const section = readFileSync(sectionPath, 'utf8')
  const engine = readFileSync(enginePath, 'utf8')
  same(section.includes('clamp(value: number, min: number, max: number): number'), true, 'clamp signature')
  same(section.includes('clamp01(value: number): number'), true, 'clamp01 signature')
  same(section.includes('lerp(a: number, b: number, t: number): number'), true, 'lerp number signature')
  same(engine.includes('`clamp`, `clamp01`, `lerp`'), true, 'engine reference names')
  same(JSON.stringify([...MATH_NAMES]), JSON.stringify(['clamp', 'clamp01', 'lerp']), 'exported names')
})

gate('clamp keeps a value inside [min, max], and returns the bound it passed', () => {
  same(clamp(5, 0, 3), 3, 'above max')
  same(clamp(-1, 0, 3), 0, 'below min')
  same(clamp(2, 0, 3), 2, 'inside')
  same(clamp(0, 0, 3), 0, 'at min')
  same(clamp(3, 0, 3), 3, 'at max')
  same(clamp(4, 4, 4), 4, 'degenerate range')
  mustThrow(() => same(clamp(5, 0, 3), 5, 'above max'))
})

gate('clamp01 is clamp to [0, 1]', () => {
  same(clamp01(-0.5), 0, 'below zero')
  same(clamp01(1.5), 1, 'above one')
  same(clamp01(0.25), 0.25, 'inside')
  mustThrow(() => same(clamp01(1.5), 1.5, 'above one'))
})

gate('lerp is a + (b - a) * t: t 0 gives a, t 1 gives b, and the midpoint lies between', () => {
  same(lerp(2, 10, 0), 2, 'at t 0')
  same(lerp(2, 10, 1), 10, 'at t 1')
  near(lerp(0, 10, 0.25), 2.5, 'quarter point')
  near(lerp(10, 0, 0.5), 5, 'reversed midpoint')
  near(lerp(0, 10, 2), 20, 'unclamped extrapolation, the standard form')
  mustThrow(() => near(lerp(0, 10, 0.25), 3, 'quarter point'))
})

gate('a non-number is refused, and clamp refuses an inverted range instead of guessing one', () => {
  mustThrow(() => clamp('5', 0, 3))
  mustThrow(() => clamp(Number.NaN, 0, 3))
  mustThrow(() => clamp(1, 3, 0))
  mustThrow(() => clamp01('0.5'))
  mustThrow(() => lerp(0, 1, '0.5'))
})

gate('scoped negative: the OKLCH string overload of lerp is refused, because savi documents its signature only', () => {
  mustThrow(() => lerp('oklch(0.7 0.1 200)', 'oklch(0.5 0.2 40)', 0.5))
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

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

gate('src/savi-builtins/math.js is comment-free, imports nothing bare, reads no host global', () => {
  same(readdirSync(sourceDir).includes('math.js'), true, 'math.js present')
  same(findingsIn(readFileSync(join(sourceDir, 'math.js'), 'utf8')).join(','), '', 'findings')
})

finish()
