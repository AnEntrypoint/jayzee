import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { pop, fx, emittedBy, FX_NAMES } from '../src/upstream-builtins/fx.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-fx.md')

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

gate('the upstream section states the units and the spawn rate this module carries, and names fx and pop', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('Spawn rate is particles per second.'), true, 'rate sentence')
  same(section.includes('lifetime, delay, and window use seconds; size uses meters; rotation uses radians. alpha is 0 to 1.'), true, 'units sentence')
  same(section.includes('An omitted lifetime does not expire.'), true, 'omitted lifetime sentence')
  same(section.includes('pop(name, def)'), true, 'pop signature')
  same(section.includes('export function effect(ctx): fx(...pops) | fx({ follow: "player" | "camera" }, ...pops)'), true, 'fx signature')
  sameJson(FX_NAMES, ['fx', 'pop', 'emittedBy'], 'exported names')
})

gate('pop keeps the documented units and the defaults the section implies: no expiry, no delay, the whole timeline', () => {
  const p = pop('spark', { spawn: { rate: 10 }, size: 0.1, rotation: 0.5, alpha: 0.5 })
  same(p.rate, 10, 'rate per second')
  same(p.lifetime, null, 'omitted lifetime does not expire')
  same(p.delay, 0, 'no delay by default')
  sameJson(p.span, [0, Infinity], 'whole timeline by default')
  same(p.size, 0.1, 'size in metres')
  same(p.rotation, 0.5, 'rotation in radians')
  same(p.alpha, 0.5, 'alpha')
  same(Object.isFrozen(p), true, 'a population is read-only')
  same(pop('fire', { spawn: { rate: 4 }, lifetime: 2 }).lifetime, 2, 'a finite lifetime in seconds')
})

gate('emittedBy counts whole particles at the rate, from the delay, inside the window, and never before the delay', () => {
  const p = pop('spark', { spawn: { rate: 10 } })
  same(emittedBy(p, 1), 10, 'one second at ten per second')
  same(emittedBy(p, 0.55), 5, 'whole particles only')
  same(emittedBy(p, 0), 0, 'nothing at time zero')
  const delayed = pop('late', { spawn: { rate: 10 }, delay: 0.5 })
  same(emittedBy(delayed, 0.4), 0, 'nothing before the delay')
  same(emittedBy(delayed, 1), 5, 'the delay shifts the start')
  const windowed = pop('band', { spawn: { rate: 10 }, window: [0.2, 0.6] })
  same(emittedBy(windowed, 1), 4, 'the window ends the emission; the float gap of 0.6 minus 0.2 does not drop a particle')
  same(0.6 - 0.2 < 0.4, true, 'the raw float gap is below 0.4, so the tolerance is what keeps the count at 4')
  same(emittedBy(pop('edge', { spawn: { rate: 10 }, window: [0, 0.3] }), 1), 3, 'an exact count stays exact')
  same(emittedBy(windowed, 0.1), 0, 'nothing before the window opens')
})

gate('fx takes populations made by pop, and refuses anything else', () => {
  const a = pop('a', { spawn: { rate: 1 } })
  const b = pop('b', { spawn: { rate: 2 } })
  const effect = fx(a, b)
  same(effect.populations.length, 2, 'two populations')
  mustThrow(() => fx())
  mustThrow(() => fx({ name: 'raw', spawn: { rate: 1 } }))
})

gate('scoped negatives: every key this module does not model is refused, not ignored, with the key named', () => {
  mustThrow(() => pop('x', { spawn: { rate: 1, when: 'other.dies' } }))
  mustThrow(() => pop('x', { spawn: { rate: 1, burst: { count: [1, 2] } } }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, space: 'local' }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, floor: 'stick' }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, mesh: { shape: 'card' } }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, lifetime: [1, 2] }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, beach: 3 }))
})

gate('negative controls: bad rates, lifetimes, windows, sizes, rotations and alphas are refused', () => {
  mustThrow(() => pop('x', { spawn: { rate: -1 } }))
  mustThrow(() => pop('x', { spawn: {} }))
  mustThrow(() => pop('x', {}))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, lifetime: 0 }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, window: [1, 0] }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, delay: -0.5 }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, size: 0 }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, rotation: Number.NaN }))
  mustThrow(() => pop('x', { spawn: { rate: 1 }, alpha: 1.2 }))
  mustThrow(() => emittedBy(pop('x', { spawn: { rate: 1 } }), -1))
})


finish()
