import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { seaHeight, seaHeightLF, seaHeightLFBound, seaHeightMean, SEA_OCTAVE_COUNT, SEA_LF_OCTAVE_COUNT } from '../src/packages/mapspinner/sea-waves.js'
import * as barrel from '../src/packages/mapspinner/index.js'

const CHOP = 4
const AMP = 1.5
const SIDE = 220
const STEP = 7.3019

const fieldMean = (fn, time) => {
  let sum = 0
  for (let j = 0; j < SIDE; j++) for (let i = 0; i < SIDE; i++) sum += fn(i * STEP + 11.7, j * STEP - 5.3, time, CHOP, AMP)
  return sum / (SIDE * SIDE)
}

const roughness = (fn) => {
  let sum = 0
  for (let i = 0; i < 4000; i++) {
    const x = i * 3.31
    const z = i * 1.77
    sum += Math.abs(fn(x + 0.05, z, 2, CHOP, AMP) - fn(x, z, 2, CHOP, AMP))
  }
  return sum / 4000
}

gate('seaHeightMean keeps its value: 8 octaves from 0.6 m with gain 0.45 at choppiness 4', () => {
  const mean = seaHeightMean(CHOP, 1)
  assert.ok(mean > 0.3 && mean < 0.6 * (1 - 0.45 ** 8) / 0.55, String(mean))
  assert.equal(seaHeightMean(CHOP, 2), 2 * mean)
  assert.equal(SEA_OCTAVE_COUNT, 8)
})

gate('the spatial mean of seaHeight converges on seaHeightMean at any time', () => {
  const want = seaHeightMean(CHOP, AMP)
  for (const time of [0, 13.25]) {
    const got = fieldMean(seaHeight, time)
    assert.ok(Math.abs(got - want) < 0.02 * want, `t=${time} mean ${got} against ${want}`)
  }
  assert.ok(Math.abs(fieldMean(seaHeight, 0) - seaHeightMean(1, AMP)) > 0.02 * want, 'negative control: the mean of another choppiness is told apart')
})

gate('seaHeightLF keeps the same mean, stays inside the tail bound of seaHeight and is smoother', () => {
  const want = seaHeightMean(CHOP, AMP)
  const got = fieldMean(seaHeightLF, 3)
  assert.ok(Math.abs(got - want) < 0.02 * want, `LF mean ${got} against ${want}`)
  const bound = seaHeightLFBound(AMP)
  assert.ok(bound > 0 && bound < 0.6 * AMP * 0.45 ** SEA_LF_OCTAVE_COUNT / 0.55 + 1e-12)
  let worst = 0
  let differs = 0
  for (let i = 0; i < 5000; i++) {
    const x = i * 2.113
    const z = i * -0.917
    const d = Math.abs(seaHeight(x, z, 1.5, CHOP, AMP) - seaHeightLF(x, z, 1.5, CHOP, AMP))
    if (d > worst) worst = d
    if (d > 1e-6) differs++
  }
  assert.ok(worst <= bound, `worst ${worst} over bound ${bound}`)
  assert.ok(differs > 4900, 'negative control: the full field is not the low-frequency field')
  assert.ok(roughness(seaHeightLF) < 0.9 * roughness(seaHeight), `LF roughness ${roughness(seaHeightLF)} against ${roughness(seaHeight)}`)
})

gate('the field is deterministic, moves with time, is linear in amplitude and bounded by the octave amplitudes', () => {
  const a = seaHeight(12.5, -40.25, 3, CHOP, AMP)
  assert.equal(a, seaHeight(12.5, -40.25, 3, CHOP, AMP))
  assert.notEqual(a, seaHeight(12.5, -40.25, 3.5, CHOP, AMP))
  assert.notEqual(a, seaHeight(13.5, -40.25, 3, CHOP, AMP))
  assert.ok(Math.abs(seaHeight(12.5, -40.25, 3, CHOP, 3) - 2 * a) < 1e-12)
  assert.equal(seaHeight(1, 2, 3, CHOP, 0), 0)
  assert.equal(seaHeightLF(1, 2, 3, CHOP, 0), 0)
  const cap = 0.6 * AMP * (1 - 0.45 ** 8) / 0.55
  for (let i = 0; i < 3000; i++) {
    const h = seaHeight(i * 5.1, i * 0.37, i * 0.01, CHOP, AMP)
    assert.ok(h >= 0 && h <= cap + 1e-12, String(h))
  }
})

gate('non-finite inputs and a non-positive choppiness are refused', () => {
  assert.throws(() => seaHeight(NaN, 0, 0, CHOP, AMP), RangeError)
  assert.throws(() => seaHeight(0, 0, Infinity, CHOP, AMP), RangeError)
  assert.throws(() => seaHeightLF(0, 0, 0, 0, AMP), RangeError)
  assert.throws(() => seaHeightLF(0, 0, 0, CHOP, undefined), RangeError)
  assert.equal(typeof seaHeight(0, 0, 0, 0.5, 1), 'number')
})

gate('the mapspinner barrel exports seaHeight, seaHeightLF and seaHeightMean', () => {
  assert.equal(barrel.seaHeight, seaHeight)
  assert.equal(barrel.seaHeightLF, seaHeightLF)
  assert.equal(barrel.seaHeightMean, seaHeightMean)
})

finish()
