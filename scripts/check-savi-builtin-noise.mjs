import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  simplex2, simplex3, fbm2, ridged, billowed2, gradient2, domainWarp2, voronoi2, white2, makeSeededRng,
  NOISE_NAMES, NOISE_OPTION_DEFAULTS,
} from '../src/savi-builtins/noise.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-noise.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'noise.js')

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

const grid = []
for (let i = 0; i < 40; i++) grid.push([i * 0.37 - 7, i * 0.61 - 9])

gate('the savi section gives the signatures this module carries, and states no defaults', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('simplex2(opts: { x, z, frequency?, amplitude?, seed? }): number'), true, 'simplex2 signature')
  same(section.includes('fbm2(opts: { x, z, frequency?, amplitude?, octaves?, gain?, lacunarity?, seed? }): number'), true, 'fbm2 signature')
  same(section.includes('ridged(opts: { x, z, frequency?, amplitude?, octaves?, gain?, lacunarity?, ridgeGain?, seed? }): number'), true, 'ridged signature')
  same(section.includes('gradient2(opts: { x, z, frequency?, seed?, delta? }): { x, z, magnitude }'), true, 'gradient2 signature')
  same(section.includes('voronoi2(opts: { x, z, frequency?, seed?, metric? }): { f1, f2, cell }'), true, 'voronoi2 signature')
  same(section.includes('makeSeededRng(seed: number | string): { next(), double(), int32(), uint32(), range(min, max) }'), true, 'makeSeededRng signature')
  sameJson(NOISE_NAMES, ['simplex2', 'simplex3', 'fbm2', 'ridged', 'billowed2', 'gradient2', 'domainWarp2', 'voronoi2', 'white2', 'makeSeededRng'], 'exported names')
  sameJson(NOISE_OPTION_DEFAULTS, { frequency: 1, amplitude: 1, seed: 0, delta: 0.0001, metric: 'euclidean' }, 'stated defaults for the optional options')
})

gate('the seeded generator is deterministic per seed, and its four readers keep their ranges', () => {
  const a = makeSeededRng(7)
  const b = makeSeededRng(7)
  same(a.uint32() === b.uint32() && a.double() === b.double(), true, 'same seed, same sequence')
  same(makeSeededRng(7).int32() !== makeSeededRng(8).int32(), true, 'different seeds differ')
  same(makeSeededRng('lobby').uint32() === makeSeededRng('lobby').uint32(), true, 'string seeds are deterministic')
  const r = makeSeededRng(3)
  for (let i = 0; i < 200; i++) {
    const d = r.double()
    assert(d >= 0 && d < 1, 'double is in [0, 1), got ' + d)
    const s = r.int32()
    assert(Number.isInteger(s) && s >= -2147483648 && s <= 2147483647, 'int32 is a signed 32-bit integer')
    const u = r.uint32()
    assert(Number.isInteger(u) && u >= 0 && u < 4294967296, 'uint32 is an unsigned 32-bit integer')
    const g = r.range(3, 5)
    assert(g >= 3 && g <= 5, 'range stays in [min, max]')
  }
  mustThrow(() => makeSeededRng(1.5))
  mustThrow(() => makeSeededRng(Number.NaN))
  mustThrow(() => makeSeededRng(1).range(5, 3))
})

gate('simplex2 and simplex3 are deterministic, bounded near [-1, 1], vary across space and seeds, and scale with amplitude and frequency', () => {
  const values2 = grid.map(([x, z]) => simplex2({ x, z }))
  for (const v of values2) assert(Math.abs(v) <= 1.01, 'simplex2 bounded, got ' + v)
  same(new Set(values2.map((v) => v.toFixed(9))).size > 30, true, 'simplex2 varies')
  same(simplex2({ x: 1.3, z: -2.2, seed: 'a' }) === simplex2({ x: 1.3, z: -2.2, seed: 'a' }), true, 'deterministic')
  same(grid.some(([x, z]) => simplex2({ x, z, seed: 1 }) !== simplex2({ x, z, seed: 2 })), true, 'seed changes the field')
  near(simplex2({ x: 0.7, z: 0.2, amplitude: 3 }), 3 * simplex2({ x: 0.7, z: 0.2 }), 'amplitude scales')
  near(simplex2({ x: 0.7, z: 0.2, frequency: 2 }), simplex2({ x: 1.4, z: 0.4 }), 'frequency scales the coordinates')
  const values3 = grid.map(([x, z]) => simplex3({ x, y: z * 0.5, z: x * 0.3 }))
  for (const v of values3) assert(Math.abs(v) <= 1.05, 'simplex3 bounded, got ' + v)
  same(new Set(values3.map((v) => v.toFixed(9))).size > 30, true, 'simplex3 varies')
  same(simplex3({ x: 1, y: 2, z: 3 }) === simplex3({ x: 1, y: 2, z: 3 }), true, 'simplex3 deterministic')
})

gate('fbm2 with one octave is simplex2; more octaves stay within the geometric bound; octaves, gain and lacunarity must be given', () => {
  for (const [x, z] of grid.slice(0, 10)) {
    near(fbm2({ x, z, octaves: 1, gain: 0.5, lacunarity: 2 }), simplex2({ x, z }), 'one octave is simplex2')
  }
  for (const [x, z] of grid) {
    const bound = 1 + 0.5 + 0.25 + 0.125
    assert(Math.abs(fbm2({ x, z, octaves: 4, gain: 0.5, lacunarity: 2 })) <= bound * 1.01, 'four octaves within the bound')
  }
  mustThrow(() => fbm2({ x: 1, z: 1, gain: 0.5, lacunarity: 2 }))
  mustThrow(() => fbm2({ x: 1, z: 1, octaves: 0, gain: 0.5, lacunarity: 2 }))
  mustThrow(() => fbm2({ x: 1, z: 1, octaves: 2.5, gain: 0.5, lacunarity: 2 }))
  mustThrow(() => fbm2({ x: 1, z: 1, octaves: 2, lacunarity: 2 }))
})

gate('ridged is never negative and billowed2 is centred on zero within its bound; ridgeGain is required for ridged', () => {
  for (const [x, z] of grid) {
    const r = ridged({ x, z, octaves: 4, gain: 0.5, lacunarity: 2, ridgeGain: 2 })
    assert(r >= 0 && r <= 1 + 0.5 + 0.25 + 0.125 + 1e-9, 'ridged in [0, bound], got ' + r)
    const b = billowed2({ x, z, octaves: 3, gain: 0.5, lacunarity: 2 })
    assert(Math.abs(b) <= 1 + 0.5 + 0.25 + 1e-9, 'billowed2 within its bound, got ' + b)
  }
  mustThrow(() => ridged({ x: 1, z: 1, octaves: 3, gain: 0.5, lacunarity: 2 }))
})

gate('gradient2 is the central difference of its own field, with delta as the step', () => {
  for (const [x, z] of grid.slice(0, 12)) {
    const g = gradient2({ x, z, frequency: 1.5, seed: 4 })
    const fine = 1e-6
    const fx = (simplex2({ x: x + fine, z, frequency: 1.5, seed: 4 }) - simplex2({ x: x - fine, z, frequency: 1.5, seed: 4 })) / (2 * fine)
    const fz = (simplex2({ x, z: z + fine, frequency: 1.5, seed: 4 }) - simplex2({ x, z: z - fine, frequency: 1.5, seed: 4 })) / (2 * fine)
    near(g.x, fx, 'gradient x', 1e-3)
    near(g.z, fz, 'gradient z', 1e-3)
    near(g.magnitude, Math.hypot(g.x, g.z), 'magnitude is the length')
  }
  mustThrow(() => gradient2({ x: 1, z: 1, delta: 0 }))
})

gate('domainWarp2 with zero warp is fbm2, and every warp term must be given', () => {
  for (const [x, z] of grid.slice(0, 10)) {
    near(domainWarp2({ x, z, warpAmp: 0, warpFrequency: 0.5, octaves: 3, gain: 0.5, lacunarity: 2 }), fbm2({ x, z, octaves: 3, gain: 0.5, lacunarity: 2 }), 'zero warp is fbm2')
  }
  mustThrow(() => domainWarp2({ x: 1, z: 1, warpFrequency: 0.5, octaves: 3, gain: 0.5, lacunarity: 2 }))
  mustThrow(() => domainWarp2({ x: 1, z: 1, warpAmp: 0.5, octaves: 3, gain: 0.5, lacunarity: 2 }))
})

gate('voronoi2 gives f1 <= f2 with a whole-number cell, deterministically; only the euclidean metric is implemented', () => {
  for (const [x, z] of grid) {
    const v = voronoi2({ x, z, seed: 9 })
    assert(v.f1 >= 0 && v.f2 >= v.f1, 'f1 is the nearest distance, f2 the second')
    assert(Number.isInteger(v.cell) && v.cell >= 0, 'cell is a whole number')
  }
  sameJson(voronoi2({ x: 2.2, z: -1.1, seed: 9 }), voronoi2({ x: 2.2, z: -1.1, seed: 9 }), 'deterministic')
  mustThrow(() => voronoi2({ x: 1, z: 1, metric: 'manhattan' }))
})

gate('white2 is in [-1, 1], deterministic, and constant within one unit cell at frequency 1', () => {
  for (const [x, z] of grid) {
    const w = white2({ x, z, seed: 5 })
    assert(w >= -1 && w <= 1, 'white2 in [-1, 1]')
  }
  near(white2({ x: 0.1, z: 0.1, seed: 5 }), white2({ x: 0.9, z: 0.9, seed: 5 }), 'one cell, one value')
})

gate('scoped negatives: unknown options and bad inputs are refused, because savi names the options and no more', () => {
  mustThrow(() => simplex2({ x: 1, z: 1, lacunarity: 2 }))
  mustThrow(() => simplex2({ z: 1 }))
  mustThrow(() => simplex2({ x: '1', z: 1 }))
  mustThrow(() => simplex2({ x: 1, z: 1, seed: 1.5 }))
  mustThrow(() => simplex2({ x: 1, z: 1, seed: Number.NaN }))
  mustThrow(() => simplex3({ x: 1, z: 1 }))
  mustThrow(() => white2({ x: 1, z: 1, ridgeGain: 1 }))
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

gate('src/savi-builtins/noise.js is comment-free, imports nothing bare, reads no host global, and uses no Math.random', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
