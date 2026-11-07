import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  BakedFieldError,
  HF_MAGIC,
  checkBakedJson,
  createHeightField,
  dequantizeSectors,
  parseHeightfieldHeader,
  resolveBakedField,
} from '../src/terrain-pure/heightfieldPhysics.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-6) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const mustThrowCode = (check, code) => {
  let caught = null
  try {
    check()
  } catch (error) {
    caught = error
  }
  assert(caught instanceof BakedFieldError, 'expected a BakedFieldError, got ' + (caught && caught.name))
  same(caught.code, code, 'error code')
}

const TCFG = { radius: 100, reliefScale: 1, anchorDir: [0, 1, 0] }
const artifact = (extra = {}) => ({
  N: 2,
  extent: 1,
  center: [0, 0],
  heights: [0, 1, 0, 1],
  codeVersion: 'abc',
  hashVersion: 3,
  radius: 100,
  reliefScale: 1,
  anchorDir: [0, 1, 0],
  chartEpoch: 0,
  ...extra,
})

gate('the sampler interpolates bilinearly across the grid and reads the grid centre from its samples', () => {
  const field = createHeightField(artifact())
  near(field.heightAtLocal(0, 0), 0.5, 'centre height')
  near(field.heightAtLocal(-0.5, 0), 0, 'low x edge')
  near(field.heightAtLocal(0.5, 0), 1, 'high x edge')
  same(field.covers(0.4, 0.4), true, 'covers inside')
  same(field.covers(0.6, 0), false, 'covers outside')
  mustReject(() => near(field.heightAtLocal(0, 0), 0, 'centre height'))
})

gate('a field bound to a moved chart epoch refuses: covers is false and the height is NaN', () => {
  let epoch = 0
  const field = createHeightField(artifact({ chartEpoch: 0 }), { epochOf: () => epoch })
  same(field.covers(0, 0), true, 'covers at the baked epoch')
  epoch = 1
  same(field.covers(0, 0), false, 'covers after a reanchor')
  same(Number.isNaN(field.heightAtLocal(0, 0)), true, 'height after a reanchor')
})

gate('a sectorised artifact dequantises each sample between its sector bounds, and a flat sector returns its low bound', () => {
  const sectorized = {
    N: 2,
    sectors: { nodesPerSector: 1, gridS: 2, qmax: 255 },
    sectorMin: [1, 4, 0, 0],
    sectorMax: [3, 4, 3, 0],
    q: [0, 255, 255, 0],
  }
  const heights = dequantizeSectors(sectorized)
  near(heights[0], 1, 'low quantum')
  near(heights[1], 4, 'flat sector low bound')
  near(heights[2], 3, 'high quantum')
  near(heights[3], 0, 'flat zero sector')
  mustReject(() => near(heights[2], 1, 'high quantum'))
})

gate('a stale bake throws, and a bake for another hash version falls back to the CPU height', () => {
  const stale = () => resolveBakedField({ url: 'x.json', artifact: artifact({ codeVersion: 'old' }), hashVersion: 3, bakeCode: 'new', tcfg: TCFG })
  mustThrowCode(stale, 'stale-bake')
  const other = resolveBakedField({ url: 'x.json', artifact: artifact({ hashVersion: 2 }), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG })
  same(other.field, null, 'field for another hash version')
  assert(other.fallback.startsWith('hashVersion'), 'fallback reason ' + other.fallback)
  mustReject(() => mustThrowCode(() => resolveBakedField({ url: 'x.json', artifact: artifact({ hashVersion: 2 }), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG }), 'stale-bake'))
})

gate('a matching code version is verified, a runtime with no bake sources keeps the field unverified, and no version at all falls back', () => {
  const verified = resolveBakedField({ url: 'x.json', artifact: artifact(), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG })
  same(verified.field.codeVersionVerified, true, 'verified flag')
  const unverified = resolveBakedField({ url: 'x.json', artifact: artifact(), hashVersion: 3, bakeCode: null, tcfg: TCFG })
  same(unverified.field.codeVersionVerified, false, 'unverified flag')
  const none = resolveBakedField({ url: 'x.json', artifact: artifact({ codeVersion: undefined }), hashVersion: 3, bakeCode: null, tcfg: TCFG })
  same(none.field, null, 'field without any code version')
  same(none.fallback, 'no-code-version', 'fallback reason')
  mustReject(() => same(verified.field, null, 'verified field'))
})

gate('a chart epoch, radius or relief mismatch falls back to the CPU height instead of reading another ground', () => {
  const frame = { chartEpoch: 2 }
  same(resolveBakedField({ url: 'x', artifact: artifact(), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG, frame }).fallback.includes('chartEpoch'), true, 'epoch fallback')
  same(resolveBakedField({ url: 'x', artifact: artifact({ radius: 50 }), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG }).fallback.startsWith('radius'), true, 'radius fallback')
  same(resolveBakedField({ url: 'x', artifact: artifact({ reliefScale: 2 }), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG }).fallback.startsWith('reliefScale'), true, 'relief fallback')
  same(resolveBakedField({ url: 'x', artifact: null, hashVersion: 3, bakeCode: 'abc', tcfg: TCFG }).fallback, 'no-artifact', 'no artifact')
  mustReject(() => same(resolveBakedField({ url: 'x', artifact: artifact({ radius: 50 }), hashVersion: 3, bakeCode: 'abc', tcfg: TCFG }).fallback, null, 'fallback'))
})

gate('a JSON bake refuses a sample count that does not match N, and a bake with no samples', () => {
  checkBakedJson('x.json', { N: 2, heights: [0, 1, 0, 1] })
  mustThrowCode(() => checkBakedJson('x.json', { N: 2, heights: [0, 1, 0] }), 'bad-artifact')
  mustThrowCode(() => checkBakedJson('x.json', { N: 2 }), 'bad-artifact')
  mustReject(() => checkBakedJson('x.json', { N: 2, heights: [0, 1, 0] }))
})

const binary = ({ N = 2, gridS = 1, nodesPerSector = 2, bits = 8, magic = HF_MAGIC, extraBytes = 0, dropBytes = 0 } = {}) => {
  const header = Buffer.from(JSON.stringify({ N, sectors: { gridS, nodesPerSector, bits } }))
  const body = 8 * gridS * gridS + (bits === 16 ? 2 : 1) * N * N + extraBytes - dropBytes
  const out = new Uint8Array(8 + header.length + Math.max(0, body))
  const view = new DataView(out.buffer)
  view.setUint32(0, magic, true)
  view.setUint32(4, header.length, true)
  out.set(header, 8)
  return out
}

gate('a binary heightfield header is read when its size is exact, and a truncated, long, mis-magic or unsupported-bit file is refused', () => {
  const ok = parseHeightfieldHeader('x.hf', binary())
  same(ok.N, 2, 'N')
  same(ok.bits, 8, 'bits')
  mustThrowCode(() => parseHeightfieldHeader('x.hf', binary({ dropBytes: 1 })), 'bad-artifact')
  mustThrowCode(() => parseHeightfieldHeader('x.hf', binary({ extraBytes: 1 })), 'bad-artifact')
  mustThrowCode(() => parseHeightfieldHeader('x.hf', binary({ magic: 0x12345678 })), 'bad-artifact')
  mustThrowCode(() => parseHeightfieldHeader('x.hf', binary({ bits: 12 })), 'bad-artifact')
  mustReject(() => parseHeightfieldHeader('x.hf', binary({ extraBytes: 1 })))
})

finish()
