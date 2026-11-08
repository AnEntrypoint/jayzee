import { FACE_FRAME, BANDS } from './anchor-field-bands.js'

export const PARAM_KEYS = ['seaBias', 'elevAmp', 'temp', 'humidity', 'erosion', 'roughness']
const K = PARAM_KEYS.length
const PIDX = Object.create(null)
PARAM_KEYS.forEach((k, i) => { PIDX[k] = i })

const FACE_ROOT_KEY_OFFSET = 8
const FACE_COUNT = 6
const DEFAULT_SEED = 1337
const BAND_SEED_STEP = 101
const FRACTAL_CYCLES_PER_CELL = 0.06
const FACES_AROUND_SPHERE = 4.0
const childKey = (k, q) => k * 4 + q
const parentKey = (k) => Math.floor(k / 4)
const hat = (t) => {
  const a = t < 0 ? -t : t
  return a >= 1 ? 0 : 1 - a
}
const clampCell = (i, n) => i < 0 ? 0 : i >= n ? n - 1 : i

export function dirToFaceUV(d) {
  const ax = Math.abs(d[0]), ay = Math.abs(d[1]), az = Math.abs(d[2])
  let face, sc
  if (ax >= ay && ax >= az) { face = d[0] > 0 ? 0 : 1; sc = 1 / ax }
  else if (ay >= az) { face = d[1] > 0 ? 2 : 3; sc = 1 / ay }
  else { face = d[2] > 0 ? 4 : 5; sc = 1 / az }
  const F = FACE_FRAME[face]
  const u = (d[0] * F.u[0] + d[1] * F.u[1] + d[2] * F.u[2]) * sc
  const v = (d[0] * F.v[0] + d[1] * F.v[1] + d[2] * F.v[2]) * sc
  return { face, fu: u * 0.5 + 0.5, fv: v * 0.5 + 0.5 }
}

const INT32_MIN = -2147483648
const INT32_MAX = 2147483647

export class AnchorFieldError extends Error {
  constructor(code, message) { super(message); this.name = 'AnchorFieldError'; this.code = code; }
}

function resolveSeed(s) {
  if (s == null) return DEFAULT_SEED
  if (!Number.isInteger(s) || s < INT32_MIN || s > INT32_MAX) {
    throw new AnchorFieldError('anchor-field-bad-seed', 'createAnchorField: seed must be an integer in the int32 range, got ' + String(s))
  }
  return s
}

export function createAnchorField(opts = {}) {
  const seed = resolveSeed(opts.seed)

  const bands = BANDS.map((B) => ({
    baseLevel: B.level, bn: 1 << B.level,
    nodes: new Map(), cover: new Map(), maxDepth: 0,
  }))
  const bandScales = BANDS.map(() => ({ seaBiasScale: 1.0, elevAmpScale: 1.0, roughnessScale: 1.0 }))

  function rootKey(bandIdx, face, btx, bty) {
    const bn = bands[bandIdx].bn
    return ((FACE_ROOT_KEY_OFFSET + face) * bn + bty) * bn + btx
  }

  function baseParamsAt(bandIdx, face, fu, fv) {
    const B = BANDS[bandIdx]
    const n = 1 << B.level
    const u = fu * 2.0 - 1.0, v = fv * 2.0 - 1.0
    const F = FACE_FRAME[face]
    let dx = F.c[0] + u * F.u[0] + v * F.v[0]
    let dy = F.c[1] + u * F.u[1] + v * F.v[1]
    let dz = F.c[2] + u * F.u[2] + v * F.v[2]
    const dl = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1
    dx /= dl; dy /= dl; dz /= dl
    const lat = Math.asin(Math.max(-1, Math.min(1, dy)))
    const cyclesPerSphere = n * FRACTAL_CYCLES_PER_CELL * FACES_AROUND_SPHERE
    const sx = dx * cyclesPerSphere, sy = dy * cyclesPerSphere, sz = dz * cyclesPerSphere
    const fval = B.fractal3(sx, sy, sz, seed + bandIdx * BAND_SEED_STEP)
    return B.params(fval, lat, sx, sz)
  }

  function baseParams(bandIdx, face, tx, ty) {
    const n = 1 << BANDS[bandIdx].level
    return baseParamsAt(bandIdx, face, (tx + 0.5) / n, (ty + 0.5) / n)
  }

  function addOverlay(out, bandIdx, face, fu, fv) {
    const band = bands[bandIdx]
    if (band.nodes.size === 0) return
    const bn = band.bn
    const btx = clampCell((fu * bn) | 0, bn), bty = clampCell((fv * bn) | 0, bn)
    let key = rootKey(bandIdx, face, btx, bty)
    let lu = fu * bn - btx, lv = fv * bn - bty
    for (let depth = 0; depth <= band.maxDepth; depth++) {
      const node = band.nodes.get(key)
      if (node) {
        const w = hat((lu - 0.5) * 2.0) * hat((lv - 0.5) * 2.0)
        if (w !== 0) for (let i = 0; i < K; i++) out[i] += node[i] * w
      }
      const cx = lu >= 0.5 ? 1 : 0, cy = lv >= 0.5 ? 1 : 0
      const ck = childKey(key, (cy << 1) | cx)
      if (!band.cover.has(ck) && !band.nodes.has(ck)) break
      key = ck
      lu = lu * 2 - cx
      lv = lv * 2 - cy
    }
  }

  const scratch = {}
  for (const k of PARAM_KEYS) scratch[k] = 0
  const bandAcc = new Float32Array(K), acc = new Float32Array(K)

  function sampleBand(out, bandIdx, face, fu, fv) {
    const p = baseParamsAt(bandIdx, face, fu, fv)
    for (let i = 0; i < K; i++) out[i] += p[PARAM_KEYS[i]]
    addOverlay(out, bandIdx, face, fu, fv)
  }

  const iAmp = PIDX.elevAmp, iRough = PIDX.roughness, iSea = PIDX.seaBias
  function sampleUV(face, fu, fv, maxBandLevel) {
    acc.fill(0)
    let amp = 1.0, rough = 0.0
    for (let b = 0; b < bands.length; b++) {
      if (maxBandLevel !== undefined && BANDS[b].level > maxBandLevel) continue
      bandAcc.fill(0)
      bandAcc[iAmp] = 1.0
      sampleBand(bandAcc, b, face, fu, fv)
      const bs = bandScales[b]
      bandAcc[iSea] *= bs.seaBiasScale
      bandAcc[iAmp] = 1.0 + (bandAcc[iAmp] - 1.0) * bs.elevAmpScale
      bandAcc[iRough] *= bs.roughnessScale
      for (let i = 0; i < K; i++) if (i !== iAmp && i !== iRough) acc[i] += bandAcc[i]
      amp *= bandAcc[iAmp]
      rough = Math.max(rough, bandAcc[iRough])
    }
    acc[iAmp] = amp
    acc[iRough] = rough
    for (let i = 0; i < K; i++) scratch[PARAM_KEYS[i]] = acc[i]
    return scratch
  }

  function sampleTile(face, level, tx, ty) {
    const n = 1 << level
    return sampleUV(face, (tx + 0.5) / n, (ty + 0.5) / n)
  }

  function sampleDir(d) {
    const { face, fu, fv } = dirToFaceUV(d)
    return sampleUV(face, fu, fv)
  }

  function editNode(bandIdx, face, btx, bty, deltas, depth = 0, sx = 0, sy = 0) {
    const band = bands[bandIdx]
    let key = rootKey(bandIdx, face, btx, bty)
    for (let dd = 0; dd < depth; dd++) {
      const sh = depth - 1 - dd
      key = childKey(key, (((sy >> sh) & 1) << 1) | ((sx >> sh) & 1))
    }
    let v = band.nodes.get(key)
    const fresh = !v
    if (!v) {
      v = new Float32Array(K)
      band.nodes.set(key, v)
    }
    for (const k in deltas) {
      const i = PIDX[k]
      if (i !== undefined) v[i] += deltas[k]
    }
    if (fresh) {
      const root = rootKey(bandIdx, face, btx, bty)
      let pk = key
      while (pk !== root) {
        pk = parentKey(pk)
        band.cover.set(pk, (band.cover.get(pk) || 0) + 1)
      }
      if (depth > band.maxDepth) band.maxDepth = depth
    }
    return key
  }

  function editAtDir(bandIdx, d, deltas, depth = 0) {
    const { face, fu, fv } = dirToFaceUV(d)
    const bn = bands[bandIdx].bn
    const btx = Math.min(bn - 1, Math.max(0, Math.floor(fu * bn)))
    const bty = Math.min(bn - 1, Math.max(0, Math.floor(fv * bn)))
    const sub = 1 << depth
    const lu = fu * bn - btx, lv = fv * bn - bty
    const sx = Math.min(sub - 1, Math.max(0, Math.floor(lu * sub)))
    const sy = Math.min(sub - 1, Math.max(0, Math.floor(lv * sub)))
    return editNode(bandIdx, face, btx, bty, deltas, depth, sx, sy)
  }

  function rebuildBand(bandIdx, entries) {
    const band = bands[bandIdx]
    band.nodes = new Map()
    band.cover = new Map()
    band.maxDepth = 0
    const bn = band.bn
    const rootLo = FACE_ROOT_KEY_OFFSET * bn * bn, rootHi = (FACE_ROOT_KEY_OFFSET + FACE_COUNT) * bn * bn
    const isRoot = (k) => k >= rootLo && k < rootHi
    for (const [k, arr] of entries) {
      band.nodes.set(k, arr instanceof Float32Array ? arr : Float32Array.from(arr))
      let pk = k, depth = 0
      while (!isRoot(pk)) {
        pk = parentKey(pk)
        band.cover.set(pk, (band.cover.get(pk) || 0) + 1)
        depth++
      }
      if (depth > band.maxDepth) band.maxDepth = depth
    }
  }

  function serialize() {
    return JSON.stringify({
      seed, version: 2,
      bands: bands.map((b) => ({
        baseLevel: b.baseLevel,
        nodes: Array.from(b.nodes, ([k, arr]) => [k, Array.from(arr)]),
      })),
    })
  }

  function load(json) {
    const o = typeof json === 'string' ? JSON.parse(json) : json
    if (!o) return false
    if (o.version === 2) {
      for (let b = 0; b < bands.length && b < o.bands.length; b++) rebuildBand(b, o.bands[b].nodes)
      return true
    }
    if (o.version === 1) {
      const edits = o.edits || []
      for (let b = 0; b < bands.length && b < edits.length; b++) {
        const bn = bands[b].bn
        for (const [addr, delta] of edits[b]) {
          const face = (addr / (bn * bn)) | 0, rem = addr % (bn * bn)
          editNode(b, face, rem % bn, (rem / bn) | 0, delta, 0)
        }
      }
      return true
    }
    return false
  }

  function nodeParams(bandIdx, face, tx, ty) {
    const p = baseParams(bandIdx, face, tx, ty)
    const node = bands[bandIdx].nodes.get(rootKey(bandIdx, face, tx, ty))
    if (node) for (let i = 0; i < K; i++) p[PARAM_KEYS[i]] += node[i]
    return p
  }

  function bandsInfo() {
    return BANDS.map((B, i) => ({
      band: i, name: B.name, level: B.level,
      anchorsPerFace: (1 << B.level) * (1 << B.level),
      totalAnchors: FACE_COUNT * (1 << B.level) * (1 << B.level),
      editedNodes: bands[i].nodes.size, maxDepth: bands[i].maxDepth,
    }))
  }

  function setBandScales(i, s) {
    if (i >= 0 && i < bandScales.length && s) {
      const b = bandScales[i]
      if (s.seaBiasScale != null) b.seaBiasScale = +s.seaBiasScale
      if (s.elevAmpScale != null) b.elevAmpScale = +s.elevAmpScale
      if (s.roughnessScale != null) b.roughnessScale = +s.roughnessScale
    }
    return bandScales[i]
  }

  return {
    BANDS, PARAM_KEYS,
    sampleUV, sampleTile, sampleDir,
    editNode, editAtDir,
    nodeParams, baseParams, rootKey, dirToFaceUV,
    serialize, load, bandsInfo,
    setBandScales,
    getBandScales: (i) => bandScales[i],
    get totalEdits() { return bands.reduce((s, b) => s + b.nodes.size, 0) },
  }
}
