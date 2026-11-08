import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as jzBands from '../src/packages/mapspinner/anchor-field-bands.js'
import * as jzField from '../src/packages/mapspinner/anchor-field.js'
import * as jzHeight from '../src/packages/mapspinner/height-gen.js'
import * as jzCull from '../src/packages/mapspinner/planet-orchestrator-cull.js'
import { PLANET_RADIUS_M } from '../src/packages/mapspinner/planet-radius.js'

const SPOINT_MAPSPINNER = '/workspace/spoint/packages/mapspinner/src/'
const fromSpoint = (file) => import(pathToFileURL(SPOINT_MAPSPINNER + file).href)
const spBands = await fromSpoint('anchor-field-bands.js')
const spField = await fromSpoint('anchor-field.js')
const spHeight = await fromSpoint('height-gen.js')
const spCull = await fromSpoint('planet-orchestrator-cull.js')
const spDefaults = await fromSpoint('terrain-defaults.js')

const seeded = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (rnd, lo, hi) => lo + (hi - lo) * rnd()
const intBetween = (rnd, lo, hi) => Math.floor(between(rnd, lo, hi + 1))
const ok = (condition, what) => {
  if (!condition) throw new Error(what)
}

const same = (a, b, path = '') => {
  if (typeof a === 'number' || typeof b === 'number') {
    if (!Object.is(a, b)) throw new Error(`${path}: ${a} !== ${b}`)
    return
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) throw new Error(`${path}: ${String(a)} !== ${String(b)}`)
    return
  }
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) throw new Error(`${path}: keys ${ka} vs ${kb}`)
  for (const k of ka) same(a[k], b[k], path + '.' + k)
}
const differs = (a, b, what) => {
  let equal = true
  try { same(a, b) } catch { equal = false }
  if (equal) throw new Error('perturbation left the result unchanged: ' + what)
}
const throwsLike = (fn, pattern, what) => {
  try { fn() } catch (error) {
    if (pattern.test(String(error && error.message))) return
    throw new Error(`${what}: wrong error ${error && error.message}`)
  }
  throw new Error(`${what}: did not throw`)
}

const randomDir = (rnd) => {
  const z = between(rnd, -1, 1), a = between(rnd, 0, 2 * Math.PI), r = Math.sqrt(1 - z * z)
  return [r * Math.cos(a), r * Math.sin(a), z]
}
const snap = (sample) => ({ ...sample })

gate('hash3, vnoise and fractal match spoint bit for bit on seeded inputs', () => {
  const rnd = seeded(11)
  for (let k = 0; k < 400; k++) {
    const a = intBetween(rnd, -5000, 5000), b = intBetween(rnd, -5000, 5000), c = intBetween(rnd, -5000, 5000)
    same(jzBands.hash3(a, b, c), spBands.hash3(a, b, c), `hash3 ${k}`)
    const x = between(rnd, -50, 50), y = between(rnd, -50, 50), s = intBetween(rnd, 0, 99999)
    same(jzBands.vnoise(x, y, s), spBands.vnoise(x, y, s), `vnoise ${k}`)
    const oct = intBetween(rnd, 0, 6), lac = between(rnd, 1.5, 2.5), gain = between(rnd, 0.3, 0.7), ridged = rnd() < 0.5
    same(jzBands.fractal(x, y, s, oct, lac, gain, ridged), spBands.fractal(x, y, s, oct, lac, gain, ridged), `fractal ${k}`)
  }
  same(jzBands.hash3(0, 0, 0), 0, 'hash3 of the origin is 0 because every term is 0')
  same(jzBands.vnoise(3, -2, 7), jzBands.hash3(3, -2, 7) * 2 - 1, 'vnoise on a lattice point is its corner hash')
  differs(jzBands.vnoise(0.3, 0.7, 1), jzBands.vnoise(0.3, 0.7, 2), 'a different seed')
})

gate('vnoise3 and fractal3 match spoint bit for bit on seeded inputs', () => {
  const rnd = seeded(12)
  for (let k = 0; k < 300; k++) {
    const x = between(rnd, -40, 40), y = between(rnd, -40, 40), z = between(rnd, -40, 40), s = intBetween(rnd, 0, 99999)
    same(jzBands.vnoise3(x, y, z, s), spBands.vnoise3(x, y, z, s), `vnoise3 ${k}`)
    const oct = intBetween(rnd, 0, 6), lac = between(rnd, 1.5, 2.5), gain = between(rnd, 0.3, 0.7), ridged = rnd() < 0.5
    same(jzBands.fractal3(x, y, z, s, oct, lac, gain, ridged), spBands.fractal3(x, y, z, s, oct, lac, gain, ridged), `fractal3 ${k}`)
  }
  same(jzBands.fractal3(1, 2, 3, 5, 0, 2, 0.5, true), -1, 'zero octaves of ridged noise is 0 * 2 - 1')
  differs(jzBands.vnoise3(0.3, 0.7, 0.1, 1), jzBands.vnoise3(0.3, 0.7, 0.1, 2), 'a different seed')
})

gate('FACE_FRAME and the five bands keep the spoint names, levels, fractals and params', () => {
  same(jzBands.FACE_FRAME, spBands.FACE_FRAME, 'FACE_FRAME')
  same(jzCull.FACE_FRAME, spCull.FACE_FRAME, 'cull FACE_FRAME')
  same(jzBands.BANDS.map((b) => [b.name, b.level]), [['continental', 3], ['subcontinental', 5], ['regional', 6], ['subregional', 7], ['local', 9]], 'band table')
  same(jzBands.BANDS.map((b) => [b.name, b.level]), spBands.BANDS.map((b) => [b.name, b.level]), 'band table vs spoint')
  const rnd = seeded(13)
  for (let b = 0; b < jzBands.BANDS.length; b++) {
    for (let k = 0; k < 40; k++) {
      const x = between(rnd, -20, 20), y = between(rnd, -20, 20), z = between(rnd, -20, 20), s = intBetween(rnd, 0, 9999)
      same(jzBands.BANDS[b].fractal(x, y, s), spBands.BANDS[b].fractal(x, y, s), `band ${b} fractal ${k}`)
      same(jzBands.BANDS[b].fractal3(x, y, z, s), spBands.BANDS[b].fractal3(x, y, z, s), `band ${b} fractal3 ${k}`)
      const f = between(rnd, -1, 1), lat = between(rnd, -Math.PI / 2, Math.PI / 2)
      same(jzBands.BANDS[b].params(f, lat, x, z), spBands.BANDS[b].params(f, lat, x, z), `band ${b} params ${k}`)
    }
  }
  same(jzBands.BANDS[0].params(0.13).seaBias, 0, 'the continental sea bias is zero at the 0.13 skew offset')
  same(jzBands.BANDS[2].params(0.5), spBands.BANDS[2].params(0.5), 'regional params default lat, fx and fy to 0')
  differs(jzBands.BANDS[2].params(0.5, 0.2), jzBands.BANDS[2].params(0.5, 1.2), 'a different latitude')
})

const SEEDS = [undefined, 0, 1, 42, -7, 2 ** 32 + 5]

gate('sampleUV, sampleTile and sampleDir match spoint for seeds, band caps and band scales', () => {
  const rnd = seeded(21)
  for (const seed of SEEDS) {
    const jz = jzField.createAnchorField({ seed }), sp = spField.createAnchorField({ seed })
    for (let k = 0; k < 25; k++) {
      const face = intBetween(rnd, 0, 5), fu = rnd(), fv = rnd()
      const cap = [undefined, 3, 5, 6, 7, 9, 2][intBetween(rnd, 0, 6)]
      same(snap(jz.sampleUV(face, fu, fv, cap)), snap(sp.sampleUV(face, fu, fv, cap)), `seed ${seed} uv ${k}`)
      const level = intBetween(rnd, 0, 10), n = 1 << level
      const tx = intBetween(rnd, 0, n - 1), ty = intBetween(rnd, 0, n - 1)
      same(snap(jz.sampleTile(face, level, tx, ty)), snap(sp.sampleTile(face, level, tx, ty)), `seed ${seed} tile ${k}`)
      const d = randomDir(rnd)
      same(snap(jz.sampleDir(d)), snap(sp.sampleDir(d)), `seed ${seed} dir ${k}`)
      same(jz.dirToFaceUV(d), sp.dirToFaceUV(d), `seed ${seed} dirToFaceUV ${k}`)
    }
    const scales = { seaBiasScale: 0.5, elevAmpScale: 2, roughnessScale: '3' }
    same(jz.setBandScales(4, scales), sp.setBandScales(4, scales), 'setBandScales')
    same(jz.setBandScales(9, scales), sp.setBandScales(9, scales), 'setBandScales out of range')
    same(jz.getBandScales(4), { seaBiasScale: 0.5, elevAmpScale: 2, roughnessScale: 3 }, 'scales are coerced with +')
    same(snap(jz.sampleUV(1, 0.3, 0.6)), snap(sp.sampleUV(1, 0.3, 0.6)), `seed ${seed} scaled`)
  }
})

gate('seed quirks: 0 and a missing seed both mean 1337, and a seed is taken as int32', () => {
  const sample = (seed) => snap(jzField.createAnchorField({ seed }).sampleUV(2, 0.4, 0.55))
  same(sample(0), sample(1337), 'seed 0')
  same(sample(undefined), sample(1337), 'no seed')
  same(sample(2 ** 32 + 5), sample(5), 'seed 2^32 + 5')
  differs(sample(1), sample(2), 'a different seed')
})

gate('sampleUV returns one shared object that the next call overwrites, as in spoint', () => {
  const jz = jzField.createAnchorField(), sp = spField.createAnchorField()
  const a = jz.sampleUV(0, 0.1, 0.1), b = jz.sampleUV(3, 0.9, 0.2)
  ok(a === b, 'jayzee returns distinct objects')
  ok(sp.sampleUV(0, 0.1, 0.1) === sp.sampleUV(3, 0.9, 0.2), 'spoint returns distinct objects')
})

const editScript = (rnd, n) => Array.from({ length: n }, () => ({
  band: intBetween(rnd, 0, 4),
  dir: randomDir(rnd),
  depth: intBetween(rnd, 0, 4),
  deltas: { seaBias: between(rnd, -500, 500), elevAmp: between(rnd, -0.3, 0.3), roughness: between(rnd, 0, 1), humidity: between(rnd, -0.2, 0.2), bogus: 99 },
}))

const applyEdits = (field, edits) => edits.map((e) => field.editAtDir(e.band, e.dir, e.deltas, e.depth))

gate('editAtDir, editNode, the overlay and bandsInfo match spoint across nested depths', () => {
  const rnd = seeded(31)
  const edits = editScript(rnd, 60)
  const jz = jzField.createAnchorField({ seed: 9 }), sp = spField.createAnchorField({ seed: 9 })
  same(applyEdits(jz, edits), applyEdits(sp, edits), 'edit keys')
  same(jz.editNode(2, 4, 10, 11, { temp: 0.25 }, 3, 5, 2), sp.editNode(2, 4, 10, 11, { temp: 0.25 }, 3, 5, 2), 'editNode at depth 3')
  for (const e of edits.slice(0, 20)) {
    const jitter = [e.dir[0] + 1e-4, e.dir[1] - 1e-4, e.dir[2]]
    same(snap(jz.sampleDir(jitter)), snap(sp.sampleDir(jitter)), 'sample near an edit')
    same(snap(jz.sampleDir(e.dir)), snap(sp.sampleDir(e.dir)), 'sample on an edit')
  }
  same(jz.bandsInfo(), sp.bandsInfo(), 'bandsInfo')
  same(jz.totalEdits, sp.totalEdits, 'totalEdits')
  same(jz.nodeParams(1, 2, 3, 4), sp.nodeParams(1, 2, 3, 4), 'nodeParams')
  same(jz.baseParams(3, 5, 17, 90), sp.baseParams(3, 5, 17, 90), 'baseParams')
  same(jz.rootKey(4, 5, 7, 9), ((8 + 5) * 512 + 9) * 512 + 7, 'rootKey formula')
  same(jz.bandsInfo()[4].totalAnchors, 6 * 512 * 512, 'local band anchors')
  const plain = jzField.createAnchorField({ seed: 9 })
  differs(snap(plain.sampleDir(edits[0].dir)), snap(jz.sampleDir(edits[0].dir)), 'an edited field')
})

gate('an unknown delta key is ignored and still creates an empty node, as in spoint', () => {
  const jz = jzField.createAnchorField(), base = jzField.createAnchorField()
  const key = jz.editNode(0, 1, 2, 3, { seabias: 500 })
  same(jz.totalEdits, 1, 'node count')
  same(JSON.parse(jz.serialize()).bands[0].nodes, [[key, [0, 0, 0, 0, 0, 0]]], 'node values')
  same(snap(jz.sampleTile(1, 3, 2, 3)), snap(base.sampleTile(1, 3, 2, 3)), 'sample unchanged')
})

gate('serialize matches spoint byte for byte, and load v2 and v1 rebuild the same field', () => {
  const rnd = seeded(41)
  const edits = editScript(rnd, 40)
  const jz = jzField.createAnchorField({ seed: 77 }), sp = spField.createAnchorField({ seed: 77 })
  applyEdits(jz, edits)
  applyEdits(sp, edits)
  const text = jz.serialize()
  same(text, sp.serialize(), 'serialize')
  const jzLoaded = jzField.createAnchorField({ seed: 77 }), spLoaded = spField.createAnchorField({ seed: 77 })
  same(jzLoaded.load(text), true, 'load v2')
  spLoaded.load(text)
  same(jzLoaded.bandsInfo(), spLoaded.bandsInfo(), 'loaded bandsInfo')
  same(jzLoaded.bandsInfo(), jz.bandsInfo(), 'loaded bandsInfo vs source')
  for (const e of edits.slice(0, 15)) same(snap(jzLoaded.sampleDir(e.dir)), snap(jz.sampleDir(e.dir)), 'loaded sample')
  same(jzLoaded.serialize(), text, 'round trip')
  const v1 = { version: 1, edits: [[[0, { seaBias: 12 }], [6 * 64 - 1, { elevAmp: 0.5 }]], [], [[3 * 64 * 64 + 5 * 64 + 9, { temp: 0.1, erosion: 0.2 }]]] }
  const jzV1 = jzField.createAnchorField(), spV1 = spField.createAnchorField()
  same(jzV1.load(v1), spV1.load(v1), 'load v1 result')
  same(jzV1.serialize(), spV1.serialize(), 'load v1 serialize')
  same(jzV1.totalEdits, 3, 'v1 edits')
  for (const bad of [null, { version: 3 }, '{"version":0}']) {
    same(jzField.createAnchorField().load(bad), spField.createAnchorField().load(bad), `load ${JSON.stringify(bad)}`)
    same(jzField.createAnchorField().load(bad), false, `load ${JSON.stringify(bad)} refused`)
  }
  throwsLike(() => jzField.createAnchorField().load('{nope'), /JSON/, 'malformed JSON throws')
})

const U = { uNoUnroll: 64, uReliefScale: 1, ...spDefaults.SHAPE_UNIFORM_DEFAULTS }
const hpfStub = (dir) => [Math.sin(dir[0] * 3) * 2000 + dir[1] * 900, 1, 0.5, 0.5]

gate('makeHeight snoise3, continentalBias and composeHeight match spoint bit for bit', () => {
  const rnd = seeded(51)
  const jz = jzHeight.makeHeight(U, hpfStub), sp = spHeight.makeHeight(U, hpfStub)
  for (let k = 0; k < 200; k++) {
    const p = [between(rnd, -30, 30), between(rnd, -30, 30), between(rnd, -30, 30)]
    same(jz.snoise3(p), sp.snoise3(p), `snoise3 ${k}`)
  }
  for (let k = 0; k < 40; k++) {
    const d = randomDir(rnd)
    same(jz.continentalBias(d), sp.continentalBias(d), `continentalBias ${k}`)
    same(jz.composeHeight(d), sp.composeHeight(d), `composeHeight ${k}`)
  }
  same(jz.snoise3([3, -4, 5]), sp.snoise3([3, -4, 5]), 'a lattice point')
})

gate('composeHeight follows the uniforms: unroll, land bias, ocean floor, shelf and relief scale', () => {
  const rnd = seeded(52)
  const dirs = Array.from({ length: 8 }, () => randomDir(rnd))
  const variants = [
    { uNoUnroll: 0 }, { uNoUnroll: 62 }, { uLandBias: 0 }, { uLandBias: -1e9 }, { uLandBias: 2e5 },
    { uBeachShelfM: 5000, uLandBias: 0 }, { uReliefScale: 0.1 }, { uReliefScale: -2 },
  ]
  for (const v of variants) {
    const Uv = { ...U, ...v }
    const jz = jzHeight.makeHeight(Uv, hpfStub), sp = spHeight.makeHeight(Uv, hpfStub)
    for (const d of dirs) same(jz.composeHeight(d), sp.composeHeight(d), JSON.stringify(v))
  }
  const base = jzHeight.makeHeight(U, hpfStub)
  same(jzHeight.makeHeight({ ...U, uNoUnroll: 0 }, hpfStub).composeHeight(dirs[0]), base.composeHeight(dirs[0]), 'uNoUnroll 0 and 64 give the authored octaves')
  differs(jzHeight.makeHeight({ ...U, uNoUnroll: 62 }, hpfStub).composeHeight(dirs[0]), base.composeHeight(dirs[0]), 'uNoUnroll 62 drops two octaves')
  same(jzHeight.makeHeight({ ...U, uLandBias: -1e9 }, hpfStub).composeHeight(dirs[0]), Math.fround(-350000), 'a deep bias rests on the -350 km floor')
  same(jzHeight.makeHeight({ ...U, uLandBias: -1e9, uReliefScale: 0.5 }, hpfStub).composeHeight(dirs[0]), Math.fround(-350000) * 0.5, 'relief scales the floor')
  differs(jzHeight.makeHeight(U, (d) => [0, 0, 0, 0]).composeHeight(dirs[1]), base.composeHeight(dirs[1]), 'a different continental bias')
  same(jzHeight.NOISE_LAYERS.map((l) => [l.ltype, l.numOct, l.ridgeExp, l.warpStr, l.hmin, l.hmax]), [[1, 10, 1.005, 1.6, 0, 1], [0, 18, 1.665, 2.6, -2, 2], [1, 18, 1.1, 0.9, -2, 2]], 'layer table')
  same(jzHeight.CONTINENTAL_BIAS_AMP, 50, 'continental bias amplitude')
})

gate('a beach shelf of 1 m or less falls back to spoint\'s 150 m shelf', () => {
  const dir = randomDir(seeded(53))
  const heightAt = (mod, landBias, shelf) => mod.makeHeight({ ...U, uLandBias: landBias, uBeachShelfM: shelf }, hpfStub).composeHeight(dir)
  let lo = -2e6, hi = 2e6, landBias = NaN
  for (let k = 0; k < 64 && Number.isNaN(landBias); k++) {
    const mid = (lo + hi) / 2, h = heightAt(jzHeight, mid, 0)
    if (h <= 0) lo = mid
    else if (h >= 150) hi = mid
    else landBias = mid
  }
  ok(!Number.isNaN(landBias), 'no land bias puts the height on the shelf')
  const onShelf = heightAt(jzHeight, landBias, 0)
  ok(onShelf > 0 && onShelf < 150, `height ${onShelf} is on the default shelf`)
  for (const shelf of [0, 1, -5, 150, 151, 1.5]) same(heightAt(jzHeight, landBias, shelf), heightAt(spHeight, landBias, shelf), `shelf ${shelf} vs spoint`)
  same(heightAt(jzHeight, landBias, 1), onShelf, 'a 1 m shelf is the default')
  same(heightAt(jzHeight, landBias, 150), onShelf, 'the default is 150 m')
  differs(heightAt(jzHeight, landBias, 151), onShelf, 'a 151 m shelf')
})

const perspective = (fovy, aspect, near, far) => {
  const f = 1 / Math.tan(fovy / 2)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, far / (near - far), -1, 0, 0, (near * far) / (near - far), 0]
}
const lookAtRotation = (eye, target, up) => {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const norm = (a) => { const l = Math.hypot(a[0], a[1], a[2]); return [a[0] / l, a[1] / l, a[2] / l] }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, 0, 0, 0, 1]
}
const mul4 = (a, b) => {
  const o = new Array(16).fill(0)
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]
  return o
}

gate('worldToFaceLocal, pickFace and extractFrustumPlanes match spoint', () => {
  const rnd = seeded(61)
  const R = PLANET_RADIUS_M
  for (let k = 0; k < 120; k++) {
    const d = randomDir(rnd), alt = R * between(rnd, 0.5, 3)
    const cam = [d[0] * alt, d[1] * alt, d[2] * alt]
    const face = intBetween(rnd, 0, 5)
    same(jzCull.worldToFaceLocal(face, cam, R), spCull.worldToFaceLocal(face, cam, R), `worldToFaceLocal ${k}`)
    same(jzCull.pickFace(cam), spCull.pickFace(cam), `pickFace ${k}`)
    const m = Array.from({ length: 16 }, () => between(rnd, -2, 2))
    const a = new Float64Array(24), b = new Float64Array(24)
    jzCull.extractFrustumPlanes(m, a)
    spCull.extractFrustumPlanes(m, b)
    same(Array.from(a), Array.from(b), `planes ${k}`)
  }
  same(jzCull.pickFace([0, 5, 0]), 2, '+y is face 2')
  same(jzCull.pickFace([0, 0, 0]), 0, 'the origin picks face 0')
  same(jzCull.worldToFaceLocal(1, [R, 0, 0], R), [R, R, -R], 'a camera behind the face pins to the seam')
  same(jzCull.worldToFaceLocal(0, [1, 5, 5], R), [-R, R, 1], 'cc of exactly 1 is not in front, and u is -z on face 0')
  const identity = new Float64Array(24)
  jzCull.extractFrustumPlanes([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], identity)
  const l = Math.hypot(1, 0, 0)
  same(Array.from(identity.slice(0, 4)), [1 / l, 0, 0, 1.06 / l], 'identity left plane carries the 0.06 margin')
  same(Array.from(identity.slice(16, 20)), [0, 0, 1, 1], 'identity near plane has no margin')
  same(jzCull.CULL_ELEV_FRAC, 500000 / 6360000, 'CULL_ELEV_FRAC')
  same(jzCull.CULL_ELEV_FRAC, spCull.CULL_ELEV_FRAC, 'CULL_ELEV_FRAC vs spoint')
})

gate('quadOutsideFrustum matches spoint on seeded cameras and culls both ways', () => {
  const rnd = seeded(71)
  const R = PLANET_RADIUS_M
  let culled = 0, kept = 0
  for (let k = 0; k < 300; k++) {
    const d = randomDir(rnd), alt = R * (1 + between(rnd, 0.00001, 2))
    const eye = [d[0] * alt, d[1] * alt, d[2] * alt]
    const look = rnd() < 0.5 ? [0, 0, 0] : randomDir(rnd).map((c) => c * R * 3)
    const up = Math.abs(d[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]
    const proj = perspective(between(rnd, 0.4, 1.4), between(rnd, 0.6, 2), between(rnd, 1, 1000), R * between(rnd, 0.01, 4))
    const vpr = mul4(proj, lookAtRotation(eye, look, up))
    const face = intBetween(rnd, 0, 5), level = intBetween(rnd, 0, 8)
    const l = (2 * R) / (1 << level)
    const n = 1 << level
    const ox = -R + l * intBetween(rnd, 0, n - 1), oy = -R + l * intBetween(rnd, 0, n - 1)
    const useEye = rnd() < 0.8 ? eye : undefined
    const a = jzCull.quadOutsideFrustum(face, ox, oy, l, R, vpr, useEye)
    same(a, spCull.quadOutsideFrustum(face, ox, oy, l, R, vpr, useEye), `quad ${k}`)
    if (a) culled++
    else kept++
  }
  ok(culled > 20 && kept > 20, `the seeded set must cull both ways, got ${culled} culled and ${kept} kept`)
  const R0 = R
  const eye = [0, 0, R0 * 2]
  const vpr = mul4(perspective(1, 1, 10, R0 * 10), lookAtRotation(eye, [0, 0, 0], [0, 1, 0]))
  same(jzCull.quadOutsideFrustum(4, -R0, -R0, 2 * R0, R0, vpr, eye), false, 'the face under the camera is kept')
  same(jzCull.quadOutsideFrustum(5, -R0, -R0, 2 * R0, R0, vpr, eye), false, 'the far face is kept, since the test has no planet occlusion')
  const away = mul4(perspective(1, 1, 10, R0 * 10), lookAtRotation(eye, [0, 0, R0 * 4], [0, 1, 0]))
  same(jzCull.quadOutsideFrustum(5, -R0, -R0, 2 * R0, R0, away, eye), true, 'a face wholly behind a camera that looks away is culled')
  same(jzCull.quadOutsideFrustum(5, -R0, -R0, 2 * R0, R0, away, eye), spCull.quadOutsideFrustum(5, -R0, -R0, 2 * R0, R0, away, eye), 'the behind case vs spoint')
  same(jzCull.quadOutsideFrustum(4, -R0, -R0, 2 * R0, R0, vpr, undefined), spCull.quadOutsideFrustum(4, -R0, -R0, 2 * R0, R0, vpr, undefined), 'a missing eye is the origin')
})

gate('a clip w of 1e-6 or less counts as behind the near plane, as in spoint', () => {
  const R = PLANET_RADIUS_M
  const flatW = (w) => {
    const m = new Array(16).fill(0)
    m[15] = w
    return m
  }
  for (const w of [1e-6, 2e-6, 5e-7, 1e-3, 0, -1]) {
    same(jzCull.quadOutsideFrustum(0, -R, -R, 2 * R, R, flatW(w), undefined), spCull.quadOutsideFrustum(0, -R, -R, 2 * R, R, flatW(w), undefined), `w ${w} vs spoint`)
  }
  same(jzCull.quadOutsideFrustum(0, -R, -R, 2 * R, R, flatW(1e-6), undefined), true, 'every sample at w 1e-6 is behind, so the quad is culled')
  same(jzCull.quadOutsideFrustum(0, -R, -R, 2 * R, R, flatW(2e-6), undefined), false, 'every sample at w 2e-6 is in front and on screen, so the quad is kept')
})

finish()
