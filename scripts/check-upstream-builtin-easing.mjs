import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { EASINGS, EASING_NAMES } from '../src/upstream-builtins/easing.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const bodyPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-easing.md')
const body = readFileSync(bodyPath, 'utf8')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const near = (actual, expected, label, tolerance = 1e-9) => {
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
const samples = Array.from({ length: 101 }, (_, i) => i / 100)
const IN_OUT_FAMILY = ['easeInOutQuad', 'easeInOutCubic', 'easeInOutQuart', 'easeInOutQuint', 'easeInOutSine', 'easeInOutExpo', 'easeInOutCirc']
const IN_OUT_PAIRS = ['Quad', 'Cubic', 'Quart', 'Quint', 'Sine', 'Expo', 'Circ']

gate('the 23 implemented easings are exactly the 23 names the upstream builtin-easing body declares', () => {
  const declared = [...new Set([...body.matchAll(/([A-Za-z][A-Za-z0-9]*)\(t\)/g)].map((match) => match[1]))].sort()
  sameJson([...EASING_NAMES].sort(), declared, 'declared against implemented')
  same(EASING_NAMES.length, 23, 'easing count')
})

gate('every easing is 0 at t = 0 and 1 at t = 1', () => {
  for (const name of EASING_NAMES) {
    near(EASINGS[name](0), 0, name + ' at 0')
    near(EASINGS[name](1), 1, name + ' at 1')
  }
})

gate('every easing stays in [0, 1] over 101 samples, and the 22 non-bounce easings never decrease', () => {
  for (const name of EASING_NAMES) {
    let previous = -Infinity
    for (const t of samples) {
      const value = EASINGS[name](t)
      assert(value >= -1e-12 && value <= 1 + 1e-12, name + ' out of range at ' + t)
      if (name !== 'easeOutBounce') assert(value >= previous - 1e-12, name + ' decreases at ' + t)
      previous = value
    }
  }
})

gate('out-bounce returns to 1 at its peaks and drops to its troughs at the standard turning points', () => {
  near(EASINGS.easeOutBounce(1 / 2.75), 1, 'first peak')
  near(EASINGS.easeOutBounce(1.5 / 2.75), 0.75, 'first trough')
  near(EASINGS.easeOutBounce(2 / 2.75), 1, 'second peak')
  near(EASINGS.easeOutBounce(2.25 / 2.75), 0.9375, 'second trough')
  near(EASINGS.easeOutBounce(2.5 / 2.75), 1, 'third peak')
  near(EASINGS.easeOutBounce(2.625 / 2.75), 0.984375, 'third trough')
})

gate('known values: quadratic, cubic, circular and bounce points are the standard ones', () => {
  near(EASINGS.easeInQuad(0.5), 0.25, 'easeInQuad 0.5')
  near(EASINGS.easeOutQuad(0.5), 0.75, 'easeOutQuad 0.5')
  near(EASINGS.easeInOutQuad(0.25), 0.125, 'easeInOutQuad 0.25')
  near(EASINGS.easeInCubic(0.5), 0.125, 'easeInCubic 0.5')
  near(EASINGS.easeInOutExpo(0.5), 0.5, 'easeInOutExpo 0.5')
  near(EASINGS.easeInCirc(0.5), 1 - Math.sqrt(0.75), 'easeInCirc 0.5')
  near(EASINGS.easeOutBounce(0.5), 0.765625, 'easeOutBounce 0.5')
})

gate('the in-out easings are symmetric about one half, and each out easing is the mirror of its in easing', () => {
  for (const name of IN_OUT_FAMILY) {
    for (const t of samples) near(EASINGS[name](t) + EASINGS[name](1 - t), 1, name + ' symmetry at ' + t, 1e-9)
  }
  for (const pair of IN_OUT_PAIRS) {
    for (const t of samples) {
      near(EASINGS['easeOut' + pair](t), 1 - EASINGS['easeIn' + pair](1 - t), 'out ' + pair + ' mirror at ' + t, 1e-9)
    }
  }
})

gate('a value outside [0, 1] or not a number is refused by every easing', () => {
  for (const name of EASING_NAMES) {
    mustThrow(() => EASINGS[name](-0.1))
    mustThrow(() => EASINGS[name](1.1))
    mustThrow(() => EASINGS[name](Number.NaN))
    mustThrow(() => EASINGS[name]('0.5'))
  }
})

finish()
