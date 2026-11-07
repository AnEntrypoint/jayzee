import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { clamp, clamp01, lerp, smoothstep, inverseLerp, remap, shortestArc, stepAngle, degToRad, radToDeg, MATH_NAMES } from '../src/upstream-builtins/math.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-math.md')
const enginePath = join(root, 'scripts', 'fixtures', 'upstream', 'engine-deep', 'api-b.md')

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

gate('the three names are the ones upstream documents for math, and the section declares them with those signatures', () => {
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

gate('scoped negative: the OKLCH string overload of lerp is refused, because upstream documents its signature only', () => {
  mustThrow(() => lerp('oklch(0.7 0.1 200)', 'oklch(0.5 0.2 40)', 0.5))
})

gate('smoothstep is 0 at the lower edge, 1 at the upper, clamps outside, and refuses equal edges', () => {
  near(smoothstep(0, 1, 0), 0, 'lower edge')
  near(smoothstep(0, 1, 1), 1, 'upper edge')
  near(smoothstep(0, 1, 0.5), 0.5, 'midpoint')
  near(smoothstep(0, 1, -3), 0, 'below')
  near(smoothstep(0, 1, 3), 1, 'above')
  mustThrow(() => smoothstep(1, 1, 0.5))
  mustThrow(() => near(smoothstep(0, 1, 0.25), 0.25, 'quarter'))
})

gate('inverseLerp undoes lerp on a range, and refuses a zero-width range', () => {
  near(inverseLerp(2, 10, 6), 0.5, 'midpoint of range')
  near(inverseLerp(10, 2, 6), 0.5, 'reversed range')
  near(inverseLerp(0, 10, 25), 2.5, 'unclamped beyond range')
  mustThrow(() => inverseLerp(3, 3, 3))
})

gate('remap maps the input range onto the output range, unclamped', () => {
  near(remap(0, 10, 0, 100, 5), 50, 'middle')
  near(remap(0, 10, 100, 0, 2), 80, 'inverted output')
  near(remap(0, 10, 0, 1, 20), 2, 'beyond the input range is not clamped')
  mustThrow(() => near(remap(0, 10, 0, 100, 5), 5, 'middle'))
})

gate('shortestArc returns degrees in (-180, 180], so 180 stays positive and 190 wraps to -170', () => {
  near(shortestArc(0, 190), -170, 'wrap across 180')
  near(shortestArc(0, 180), 180, 'half turn stays at 180')
  near(shortestArc(0, -180), 180, 'minus half turn is also 180')
  near(shortestArc(350, 10), 20, 'wrap across 0')
  near(shortestArc(10, 350), -20, 'wrap the other way')
  mustThrow(() => near(shortestArc(0, 190), 190, 'unwrapped'))
})

gate('stepAngle turns at once when smoothing is 0, and refuses the smoothing curve and maxDegPerSec as scoped negatives', () => {
  const landed = stepAngle(10, 350, 0.1, { smoothing: 0 })
  near(shortestArc(landed, 350), 0, 'lands on the target', 1e-9)
  mustThrow(() => stepAngle(10, 350, 0.1))
  mustThrow(() => stepAngle(10, 350, 0.1, { smoothing: 0.5 }))
  mustThrow(() => stepAngle(10, 350, 0.1, { smoothing: 0, maxDegPerSec: 90 }))
})

gate('degToRad and radToDeg are the standard conversions and invert each other', () => {
  near(degToRad(180), Math.PI, 'half turn')
  near(radToDeg(Math.PI / 2), 90, 'quarter turn')
  near(radToDeg(degToRad(37)), 37, 'round trip', 1e-9)
})

finish()
