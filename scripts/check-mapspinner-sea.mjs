import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { seaHeight, seaHeightLF, seaHeightMean, seaOctave, seaOctaveMean, SEA_OCTAVES, SEA_FREQ, SEA_FREQ_LF, SEA_SPEED } from '../src/packages/mapspinner/sea-waves.js'
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

const mix = (a, b, t) => a + (b - a) * t
const reference = (x, y, t, choppy0, amp0, oStart, oEnd) => {
  let freq = 0.2
  let amp = amp0 * 0.6
  let choppy = choppy0
  let h = 0
  const seaTime = [t * 2.4 * 0.6, t * 2.4 * 0.4]
  for (let i = 0; i < 8; i++) {
    if (i >= oStart && i < oEnd) {
      const a = i * 1.57079633
      const sa = Math.sin(a)
      const ca = Math.cos(a)
      const duv = [ca * x + sa * y, ca * y - sa * x]
      const ts = 1.0 - 0.08 * i
      h += seaOctave((duv[0] + seaTime[0] * ts) * freq, (duv[1] + seaTime[1] * ts) * freq, choppy) * amp
    }
    freq *= 1.9
    amp *= 0.45
    choppy = mix(choppy, 1.0, 0.3)
  }
  return h
}

gate('the constants are spoint sea-waves-tsl values: 8 octaves, frequency 0.2, low frequency 0.16, speed 2.4', () => {
  assert.deepEqual([SEA_OCTAVES, SEA_FREQ, SEA_FREQ_LF, SEA_SPEED], [8, 0.2, 0.16, 2.4])
})

gate('seaHeight follows the spoint octave loop: rotated by a quarter turn per octave, slowed by 0.08 per octave, gain 0.45, frequency 1.9', () => {
  for (let i = 0; i < 400; i++) {
    const x = Math.sin(i * 1.3) * 900
    const y = Math.cos(i * 0.7) * 700
    const t = i * 0.37
    const got = seaHeight(x, y, t, CHOP, AMP)
    const want = reference(x, y, t, CHOP, AMP, 0, 8)
    assert.ok(Math.abs(got - want) <= 1e-12, `${got} against ${want}`)
  }
  assert.ok(Math.abs(seaHeight(40, 0, 0, CHOP, AMP, 1, 2) - seaOctave(0, -40 * 0.2 * 1.9, 4 + (1 - 4) * 0.3) * AMP * 0.6 * 0.45) < 1e-6, 'octave 1 reads the point turned a quarter turn')
})

gate('the octave window sums: octaves 0 to 3 plus octaves 3 to 8 make the full height, and an empty window is zero', () => {
  for (const [x, y, t] of [[12.5, -40.25, 3], [800, 15, 91.5], [-3, -7, 0]]) {
    const full = seaHeight(x, y, t, CHOP, AMP)
    assert.ok(Math.abs(seaHeight(x, y, t, CHOP, AMP, 0, 3) + seaHeight(x, y, t, CHOP, AMP, 3, 8) - full) < 1e-12)
    assert.equal(seaHeight(x, y, t, CHOP, AMP, 5, 5), 0)
    assert.notEqual(seaHeight(x, y, t, CHOP, AMP, 0, 3), full)
  }
})

gate('seaHeightLF is the mean of two seaOctave samples at frequency 0.16 drifting along (0.866, 0.5) and (-0.5, 0.866)', () => {
  for (let i = 0; i < 200; i++) {
    const x = i * 3.7 - 200
    const y = i * -1.9 + 55
    const t = i * 0.21
    const a = seaOctave(x * 0.16 + 0.866 * t * 2.4 * 0.6, y * 0.16 + 0.5 * t * 2.4 * 0.6, CHOP)
    const b = seaOctave(x * 0.16 - 0.5 * t * 2.4 * 0.4, y * 0.16 + 0.866 * t * 2.4 * 0.4, CHOP)
    assert.ok(Math.abs(seaHeightLF(x, y, t, CHOP, AMP) - (a + b) * AMP * 0.6 * 0.5) <= 1e-12)
  }
  assert.ok(Math.abs(seaHeightLF(5, 9, 0, CHOP, AMP) - seaOctave(0.8, 1.44, CHOP) * AMP * 0.6) < 1e-12, 'at time zero both samples coincide')
})

gate('the spatial mean of seaHeight converges on seaHeightMean, and of seaHeightLF on the first octave mean', () => {
  const want = seaHeightMean(CHOP, AMP)
  for (const time of [0, 13.25]) {
    const got = fieldMean(seaHeight, time)
    assert.ok(Math.abs(got - want) < 0.02 * want, `t=${time} mean ${got} against ${want}`)
  }
  assert.ok(Math.abs(fieldMean(seaHeight, 0) - seaHeightMean(1, AMP)) > 0.02 * want, 'negative control: the mean of another choppiness is told apart')
  const lf = fieldMean(seaHeightLF, 3)
  const lfWant = AMP * 0.6 * seaOctaveMean(CHOP, 0)
  assert.ok(Math.abs(lf - lfWant) < 0.02 * lfWant, `LF mean ${lf} against ${lfWant}`)
  assert.ok(lf < want, 'the low-frequency field carries one octave of amplitude, less than the eight')
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
    const l = seaHeightLF(i * 5.1, i * 0.37, i * 0.01, CHOP, AMP)
    assert.ok(l >= 0 && l <= 0.6 * AMP + 1e-12, String(l))
  }
})

gate('non-finite inputs, a non-positive choppiness and a bad octave are refused', () => {
  assert.throws(() => seaHeight(NaN, 0, 0, CHOP, AMP), RangeError)
  assert.throws(() => seaHeight(0, 0, Infinity, CHOP, AMP), RangeError)
  assert.throws(() => seaHeight(0, 0, 0, CHOP, AMP, 0.5, 8), RangeError)
  assert.throws(() => seaHeightLF(0, 0, 0, 0, AMP), RangeError)
  assert.throws(() => seaHeightLF(0, 0, 0, CHOP, undefined), RangeError)
  assert.throws(() => seaOctaveMean(CHOP, 8), RangeError)
  assert.equal(typeof seaHeight(0, 0, 0, 0.5, 1), 'number')
})

gate('the mapspinner barrel exports seaHeight, seaHeightLF and seaHeightMean', () => {
  assert.equal(barrel.seaHeight, seaHeight)
  assert.equal(barrel.seaHeightLF, seaHeightLF)
  assert.equal(barrel.seaHeightMean, seaHeightMean)
})

finish()
