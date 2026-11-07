import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import * as jzSpline from '../src/terrain-pure/splineCarve.js'
import * as jzErosion from '../src/terrain-pure/terrainErosion.js'
import * as jzCave from '../src/terrain-pure/caveSdf.js'
import * as jzRock from '../src/terrain-pure/rockShapes.js'
import * as jzStamp from '../src/terrain-pure/structureStamp.js'
import * as jzContact from '../src/terrain-pure/contactOcclusionField.js'

const SPOINT_TERRAIN = '/workspace/spoint/src/terrain/'
const fromSpoint = (file) => import(pathToFileURL(SPOINT_TERRAIN + file).href)
const spSpline = await fromSpoint('SplineCarve.js')
const spErosion = await fromSpoint('TerrainErosion.js')
const spCave = await fromSpoint('CaveSDF.js')
const spRock = await fromSpoint('RockShapes.js')
const spStamp = await fromSpoint('StructureStamp.js')
const spContact = await fromSpoint('ContactOcclusionField.js')

class Mismatch extends Error {}

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

const sortPrimitive = (values) => values.slice().sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))

const diff = (a, b, path) => {
  if (typeof a === 'number' || typeof b === 'number') {
    return Object.is(a, b) ? null : `${path}: ${String(a)} != ${String(b)}`
  }
  if (typeof a === 'function' || typeof b === 'function') {
    return typeof a === typeof b ? null : `${path}: function vs ${typeof a}/${typeof b}`
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return Object.is(a, b) ? null : `${path}: ${String(a)} != ${String(b)}`
  }
  if (a === b) return null
  if (ArrayBuffer.isView(a) || ArrayBuffer.isView(b)) {
    if (a.constructor !== b.constructor || a.length !== b.length) return `${path}: view shape ${a.length} != ${b.length}`
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return `${path}: array shape`
    for (let i = 0; i < a.length; i++) {
      const d = diff(a[i], b[i], `${path}[${i}]`)
      if (d) return d
    }
    return null
  }
  if (a instanceof Set || b instanceof Set) {
    if (!(a instanceof Set && b instanceof Set) || a.size !== b.size) return `${path}: set shape`
    return diff(sortPrimitive([...a]), sortPrimitive([...b]), `${path}{set}`)
  }
  if (a instanceof Map || b instanceof Map) {
    if (!(a instanceof Map && b instanceof Map) || a.size !== b.size) return `${path}: map shape`
    const keysA = sortPrimitive([...a.keys()])
    const keysB = sortPrimitive([...b.keys()])
    const dk = diff(keysA, keysB, `${path}{keys}`)
    if (dk) return dk
    for (const key of keysA) {
      const d = diff(a.get(key), b.get(key), `${path}<${key}>`)
      if (d) return d
    }
    return null
  }
  const keysA = Object.keys(a).sort()
  const keysB = Object.keys(b).sort()
  if (keysA.join('|') !== keysB.join('|')) return `${path}: keys ${keysA.join(',')} != ${keysB.join(',')}`
  for (const key of keysA) {
    const d = diff(a[key], b[key], `${path}.${key}`)
    if (d) return d
  }
  return null
}

const same = (a, b, what = 'value') => {
  const d = diff(a, b, what)
  if (d) throw new Mismatch(d)
}

const refutes = (check, what) => {
  try {
    check()
  } catch (error) {
    if (error instanceof Mismatch) return
    throw error
  }
  throw new Error('negative control was not refuted: ' + what)
}

const outcome = (fn) => {
  try {
    return { value: fn() }
  } catch (error) {
    return { threw: error.message }
  }
}

const txHash = (seed, i) => {
  let h = seed | 0
  h = Math.imul(h ^ (i | 0), 0x27d4eb2d) >>> 0
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d) >>> 0
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39) >>> 0
  h ^= h >>> 15
  return (h >>> 0) / 4294967296
}

const TX_CELL_M = 8
const TX_BIG = 1 << 23
const TX_OFF = TX_BIG >> 1
const txCellKey = (cx, cz) => (cx + TX_OFF) * TX_BIG + (cz + TX_OFF)

const txCatmull = (p0, p1, p2, p3, t) => {
  const getX = (p) => (Array.isArray(p) ? p[0] : p.x)
  const getZ = (p) => (Array.isArray(p) ? p[1] : p.z)
  const t2 = t * t
  const t3 = t2 * t
  const x = 0.5 * (
    (2 * getX(p1)) +
    (-getX(p0) + getX(p2)) * t +
    (2 * getX(p0) - 5 * getX(p1) + 4 * getX(p2) - getX(p3)) * t2 +
    (-getX(p0) + 3 * getX(p1) - 3 * getX(p2) + getX(p3)) * t3
  )
  const z = 0.5 * (
    (2 * getZ(p1)) +
    (-getZ(p0) + getZ(p2)) * t +
    (2 * getZ(p0) - 5 * getZ(p1) + 4 * getZ(p2) - getZ(p3)) * t2 +
    (-getZ(p0) + 3 * getZ(p1) - 3 * getZ(p2) + getZ(p3)) * t3
  )
  return { x, z }
}

const txSampleOpen = (pts, stepSize) => {
  if (!pts || pts.length < 2) return []
  const getX = (p) => (Array.isArray(p) ? p[0] : p.x)
  const getZ = (p) => (Array.isArray(p) ? p[1] : p.z)
  const samples = []
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[(i - 1 + pts.length) % pts.length]
    const p1 = pts[i]
    const p2 = pts[(i + 1) % pts.length]
    const p3 = pts[(i + 2) % pts.length]
    const dx = getX(p2) - getX(p1)
    const dz = getZ(p2) - getZ(p1)
    const steps = Math.max(1, Math.ceil(Math.sqrt(dx * dx + dz * dz) / stepSize))
    for (let s = 0; s < steps; s++) samples.push(txCatmull(p0, p1, p2, p3, s / steps))
  }
  const last = pts[pts.length - 1]
  samples.push({ x: getX(last), z: getZ(last) })
  return samples
}

const txCarve = (cells, controlPoints, width, depth, kind, baseHeightFn, opts = {}, bankShift = 0) => {
  if (!Array.isArray(controlPoints) || controlPoints.length < 2) return { touched: 0 }
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(depth)) return { touched: 0 }
  if (kind !== 'river' && kind !== 'road') return { touched: 0 }
  const { seed = 0, widthVariance = 0, bankErosion = 0 } = opts
  const isRiver = kind === 'river'
  const spine = txSampleOpen(controlPoints, Math.max(1, width * 0.5))
  if (spine.length === 0) return { touched: 0 }
  const maxHalfWidth = (width * 0.5) * (1 + (isRiver ? widthVariance : 0)) + (isRiver ? bankErosion : 0)
  let touched = 0
  let arcLen = 0
  for (let si = 0; si < spine.length; si++) {
    const sx = spine[si].x
    const sz = spine[si].z
    if (si > 0) arcLen += Math.hypot(sx - spine[si - 1].x, sz - spine[si - 1].z)
    let halfWidth = width * 0.5
    if (isRiver && widthVariance > 0) {
      const t = txHash(seed, Math.round(arcLen * 0.1))
      halfWidth *= 1 + (t * 2 - 1) * widthVariance
    }
    const cx0 = Math.floor((sx - maxHalfWidth) / TX_CELL_M)
    const cx1 = Math.ceil((sx + maxHalfWidth) / TX_CELL_M)
    const cz0 = Math.floor((sz - maxHalfWidth) / TX_CELL_M)
    const cz1 = Math.ceil((sz + maxHalfWidth) / TX_CELL_M)
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const cMinX = cx * TX_CELL_M
        const cMinZ = cz * TX_CELL_M
        const ccx = cMinX + TX_CELL_M * 0.5
        const ccz = cMinZ + TX_CELL_M * 0.5
        let bankOffset = 0
        if (isRiver && bankErosion > 0) {
          const angle = txHash(seed ^ (0x5bd1e995 + bankShift), cx * 92821 + cz) * Math.PI * 2
          bankOffset = (txHash(seed ^ 0x1b873593, cx * 15485863 + cz) * 2 - 1) * bankErosion * (0.5 + 0.5 * Math.cos(angle))
        }
        const cellHalfWidth = halfWidth + bankOffset
        if (cellHalfWidth <= 0) continue
        const nearestX = Math.max(cMinX, Math.min(sx, cMinX + TX_CELL_M))
        const nearestZ = Math.max(cMinZ, Math.min(sz, cMinZ + TX_CELL_M))
        if (Math.hypot(nearestX - sx, nearestZ - sz) > cellHalfWidth) continue
        const dCenter = Math.hypot(ccx - sx, ccz - sz)
        const falloffDist = Math.min(dCenter, cellHalfWidth)
        const falloff = 0.5 * (1 + Math.cos((falloffDist / cellHalfWidth) * Math.PI))
        const key = txCellKey(cx, cz)
        const base = typeof baseHeightFn === 'function' ? baseHeightFn(ccx, ccz) : null
        const targetDelta = Number.isFinite(base) ? -depth * falloff : 0
        const prev = cells.get(key)
        const nextDelta = prev ? Math.min(prev.delta, targetDelta) : targetDelta
        const nextKind = prev && prev.kind === 'river' ? 'river' : kind
        cells.set(key, { delta: nextDelta, kind: nextKind })
        touched++
      }
    }
  }
  return { touched }
}

const txDeltaAt = (cells, x, z) => {
  if (cells.size === 0) return 0
  const c = cells.get(txCellKey(Math.floor(x / TX_CELL_M), Math.floor(z / TX_CELL_M)))
  return c ? c.delta : 0
}

const txKindAt = (cells, x, z) => {
  if (cells.size === 0) return null
  const c = cells.get(txCellKey(Math.floor(x / TX_CELL_M), Math.floor(z / TX_CELL_M)))
  return c ? c.kind : null
}

const txTunnel = (seed, radius, length, axis = 'y', warpAmp = 0.15, warpFreq = 2.5) => (x, y, z) => {
  let along
  let u
  let v
  if (axis === 'x') { along = x; u = y; v = z }
  else if (axis === 'z') { along = z; u = x; v = y }
  else { along = y; u = x; v = z }
  const t = Math.max(-1, Math.min(1, along / (length * 0.5)))
  const sampleIdx = Math.round((t + 1) * 0.5 * 1000)
  const warpU = (txHash(seed, sampleIdx * 2) * 2 - 1) * warpAmp * Math.sin(t * Math.PI * warpFreq + txHash(seed, 1) * 6.28318)
  const warpV = (txHash(seed, sampleIdx * 2 + 1) * 2 - 1) * warpAmp * Math.cos(t * Math.PI * warpFreq + txHash(seed, 2) * 6.28318)
  const du = u - warpU
  const dv = v - warpV
  const dRadial = Math.hypot(du, dv) - radius
  const dAlong = Math.abs(along) - length * 0.5
  const outsideDist = Math.hypot(Math.max(dRadial, 0), Math.max(dAlong, 0))
  const insideDist = Math.min(Math.max(dRadial, dAlong), 0)
  return outsideDist + insideDist
}

const txSpan = (vol, h) => {
  if (vol.kind !== 'sphere') {
    if (h > vol.worldRadius) return 0
    return vol.worldRadius * vol.verticalSpan
  }
  return Math.sqrt(Math.max(0, vol.worldRadius * vol.worldRadius - h * h))
}

const txHeightDelta = (vols, x, z, surfaceY, spanScale = 1) => {
  if (vols.length === 0) return 0
  let delta = 0
  for (const vol of vols) {
    const dx = x - vol.worldX
    const dz = z - vol.worldZ
    const horizontalDist = Math.hypot(dx, dz)
    if (horizontalDist > vol.worldRadius) continue
    const verticalSpan = txSpan(vol, horizontalDist) * spanScale
    if (verticalSpan <= 0) continue
    const caveTop = vol.worldY + verticalSpan
    if (caveTop < surfaceY) continue
    delta -= (caveTop - surfaceY) + verticalSpan
  }
  return delta
}

const txRotatedOffset = (part, rotY) => {
  const c = Math.cos(rotY)
  const s = Math.sin(rotY)
  return [part.x * c + part.z * s, -part.x * s + part.z * c]
}

const txInside = (stamp, x, z) => {
  const dx = x - stamp.x
  const dz = z - stamp.z
  const r = stamp.footprintRadius
  return dx * dx + dz * dz <= r * r
}

const txPosts = (specs, stamps, groundAt, rotSign = 1) => {
  const records = stamps.map((s, index) => {
    const spec = specs[s.template]
    return { index, spec, x: s.x, z: s.z, rotY: s.rotY ?? 0, priority: s.priority ?? 0, footprintRadius: spec.footprintRadius }
  })
  const order = records.slice().sort((a, b) => b.priority - a.priority || a.index - b.index)
  const posts = []
  for (const stamp of order) {
    const baseY = groundAt(stamp.x, stamp.z)
    for (const part of stamp.spec.parts) {
      const [ox, oz] = txRotatedOffset(part, rotSign * stamp.rotY)
      const x = stamp.x + ox
      const z = stamp.z + oz
      if (order.some((higher) => higher.priority > stamp.priority && txInside(higher, x, z))) continue
      posts.push({ model: part.model, x, y: baseY, z, rotY: part.rotY + stamp.rotY, scale: part.scale, stamp: stamp.index })
    }
  }
  return posts
}

const txSmooth = (e0, e1, x) => {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}

const txStampTexels = (size, stamp, smoothFn) => {
  const out = new Uint8Array(size * size).fill(255)
  const span = stamp.r1 - stamp.r0
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const dx = (i + 0.5) - stamp.x
      const dz = (j + 0.5) - stamp.z
      const d = Math.sqrt(dx * dx + dz * dz)
      const darkness = stamp.strength * (1 - smoothFn(stamp.r0, stamp.r0 + span, d))
      const light = Math.round((1 - darkness) * 255)
      if (light < out[j * size + i]) out[j * size + i] = light
    }
  }
  return out
}

const layerScenario = (rnd, count) => Array.from({ length: count }, (_, k) => ({
  pts: Array.from({ length: intBetween(rnd, 2, 5) }, () => (k % 2 === 0
    ? [between(rnd, -40, 40), between(rnd, -40, 40)]
    : { x: between(rnd, -40, 40), z: between(rnd, -40, 40) })),
  width: between(rnd, 3, 10),
  depth: between(rnd, 0.5, 4),
  kind: k % 3 === 0 ? 'road' : 'river',
  opts: { seed: intBetween(rnd, 0, 999), widthVariance: between(rnd, 0, 0.4), bankErosion: between(rnd, 0, 1.5) },
}))

const baseFnForCarve = (x, z) => (x > 30 ? NaN : 5 + 0.05 * x - 0.03 * z)

const buildLayer = (lib, scenario) => {
  const layer = lib.createSplineCarveLayer()
  const touched = scenario.map((s) => layer.carve(s.pts, s.width, s.depth, s.kind, baseFnForCarve, s.opts).touched)
  return { layer, touched }
}

const snapshotLayer = (layer, probes) => {
  const wrapped = layer.wrapHeightFn((x, z, y) => 10 + 0.1 * x - 0.2 * z + 0 * y)
  const wc = layer.wrapClimateField({ climateUsesLocalXZ: false, climateAtLocal: (x, z, dir) => ({ t: x + z, dir }) })
  return {
    cells: layer.cellCount,
    splines: layer.splineCount,
    delta: probes.map(([x, z]) => layer.deltaAt(x, z)),
    kind: probes.map(([x, z]) => layer.kindAt(x, z)),
    wrapped: probes.map(([x, z]) => wrapped(x, z, 0)),
    climate: probes.map(([x, z]) => wc.climateAtLocal(x, z, 'N')),
    climateUsesLocalXZ: wc.climateUsesLocalXZ,
    json: layer.toJSON(),
  }
}

const seededProbes = (rnd, count, lo, hi) => Array.from({ length: count }, () => [between(rnd, lo, hi), between(rnd, lo, hi)])

const contactOps = (rnd, count) => Array.from({ length: count }, () => {
  const roll = rnd()
  if (roll < 0.45) {
    const placements = Array.from({ length: intBetween(rnd, 0, 5) }, () => ({
      x: between(rnd, -10, 120),
      z: between(rnd, -10, 120),
      species: intBetween(rnd, 0, 12),
      scale: between(rnd, 0.5, 2.5),
    }))
    const stamps = rnd() < 0.5 ? spContact.treeContactStamps(placements) : spContact.rockContactStamps(placements)
    return { kind: 'load', key: 'c' + intBetween(rnd, 0, 5), stamps }
  }
  if (roll < 0.7) return { kind: 'unload', key: 'c' + intBetween(rnd, 0, 5) }
  return { kind: 'recentre', x: between(rnd, -150, 150), z: between(rnd, -150, 150) }
})

const runContactOps = (lib, ops) => {
  const field = lib.createContactField({ windowM: 96, texelM: 1 })
  return ops.map((op) => {
    let ret
    if (op.kind === 'load') ret = lib.contactFieldLoadChunk(field, op.key, op.stamps)
    else if (op.kind === 'unload') ret = lib.contactFieldUnloadChunk(field, op.key)
    else ret = lib.contactFieldRecentre(field, op.x, op.z)
    return {
      ret,
      data: field.data.slice(),
      originX: field.originX,
      originZ: field.originZ,
      centreX: field.centreX,
      centreZ: field.centreZ,
      dirty: field.dirty,
      chunks: [...field.chunks.entries()],
    }
  })
}

const runCaveScript = (lib, script, probes, surfaces, base) => {
  const layer = lib.createCaveCarveLayer()
  const results = script.map(([method, args]) => layer[method](...args))
  const wrapped = layer.wrapHeightFn(base)
  const snap = {
    results,
    count: layer.volumeCount,
    volumes: layer.volumes.map((v) => ({ worldX: v.worldX, worldY: v.worldY, worldZ: v.worldZ, worldRadius: v.worldRadius, shape: v.shape })),
    ceilings: probes.map(([x, z], i) => layer.heightDeltaAt(x, z, surfaces[i])),
    wrapped: probes.map(([x, z], i) => wrapped(x, z, surfaces[i])),
    json: layer.toJSON(),
  }
  layer.clear()
  snap.afterClear = layer.volumeCount
  const reloaded = lib.loadCaveCarveLayer(snap.json)
  snap.reloaded = probes.map(([x, z], i) => reloaded.heightDeltaAt(x, z, surfaces[i]))
  return snap
}

const describeVolume = (v, poly) => {
  const pts = [[0.3, -0.2, 0.5], [1.5, 0.4, -0.8], [-2, 1, 0.1]]
  return {
    shape: v.shape,
    anchor: [v.worldX, v.worldY, v.worldZ, v.worldRadius],
    sdf: pts.map(([x, y, z]) => v.sdf(x, y, z)),
    localSDF: pts.map(([x, y, z]) => v.localSDF(x, y, z)),
    localToWorld: v.localToWorld(0.3, -0.2, 0.5),
    worldToLocal: v.worldToLocal(1, 2, 3),
    poly,
  }
}

const shapeOf = (lib, args) => outcome(() => {
  const v = lib.createCaveVolume(...args)
  return describeVolume(v, lib.polygonizeCaveVolume(v, 6))
})

const stSpecs = {
  stRow: {
    footprintRadius: 4,
    parts: [
      { model: 'post', x: -2, z: 0, rotY: 0, scale: 1 },
      { model: 'post', x: 2, z: 0, rotY: 0.3, scale: 1 },
      { model: 'beam', x: 0, z: 1.5, rotY: 0, scale: 0.5 },
    ],
  },
  stBig: {
    footprintRadius: 9,
    parts: [
      { model: 'pillar', x: 0, z: 0, rotY: 0, scale: 1 },
      { model: 'pillar', x: 5, z: 5, rotY: 0, scale: 1 },
    ],
  },
}

for (const id of ['stRow', 'stBig']) {
  jzStamp.defineStructureTemplate(id, stSpecs[id])
  spStamp.defineStructureTemplate(id, stSpecs[id])
}

const normalizeTemplate = (t) => ({
  id: t.id,
  footprintRadius: t.footprintRadius,
  frozen: Object.isFrozen(t) && Object.isFrozen(t.parts),
  parts: t.parts.map((p) => ({ ...p })),
})

gate('sampleSpline matches spoint on seeded open and closed splines in both point forms', () => {
  const rnd = seeded(101)
  for (let k = 0; k < 60; k++) {
    const n = intBetween(rnd, 2, 7)
    const asObjects = rnd() < 0.5
    const closed = rnd() < 0.5
    const pts = Array.from({ length: n }, () => (asObjects
      ? { x: between(rnd, -20, 20), z: between(rnd, -20, 20) }
      : [between(rnd, -20, 20), between(rnd, -20, 20)]))
    const step = between(rnd, 0.5, 4)
    same(jzSpline.sampleSpline(pts, step, closed), spSpline.sampleSpline(pts, step, closed), `case ${k}`)
  }
  same(jzSpline.sampleSpline([[1, 2]], 1), spSpline.sampleSpline([[1, 2]], 1), 'one point')
  same(jzSpline.sampleSpline(null, 1), spSpline.sampleSpline(null, 1), 'null input')
  same(jzSpline.sampleSpline([[0, 0], [4, 0], [8, 0]], 1), spSpline.sampleSpline([[0, 0], [4, 0], [8, 0]], 1), 'default open')
  refutes(() => same(jzSpline.sampleSpline([[0, 0], [4, 0], [8, 0]], 0.25), spSpline.sampleSpline([[0, 0], [4, 0], [8, 0]], 1)), 'a finer step')
})

gate('carveSpline matches spoint heights, carved cells and flag on seeded terrain', () => {
  const rnd = seeded(202)
  let carvedSomewhere = 0
  let firstCase = null
  for (let k = 0; k < 30; k++) {
    const width = intBetween(rnd, 6, 14)
    const spacing = between(rnd, 1, 3)
    const heights = new Float32Array(width * width)
    for (let i = 0; i < heights.length; i++) heights[i] = between(rnd, 0, 10)
    const cornerX = between(rnd, -5, 5)
    const cornerZ = between(rnd, -5, 5)
    const span = (width - 1) * spacing
    const pts = Array.from({ length: intBetween(rnd, 2, 5) }, () => [cornerX + between(rnd, 0, span), cornerZ + between(rnd, 0, span)])
    const carveWidth = between(rnd, 1.5, 5)
    const carveDepth = between(rnd, 0.5, 3)
    const opts = k % 2 === 0 ? {} : { bankWidth: between(rnd, 0.5, 3), flag: k % 4 === 1 ? 'river' : 'road' }
    const args = [heights, width, spacing, cornerX, cornerZ, pts, carveWidth, carveDepth, opts]
    const a = jzSpline.carveSpline(...args)
    const b = spSpline.carveSpline(...args)
    same(a, b, `case ${k}`)
    if (a.carvedCells.size > 0) carvedSomewhere++
    if (k === 0) firstCase = { args, carveDepth }
  }
  ok(carvedSomewhere > 0, 'the seeded cases carved at least one cell')
  const { args } = firstCase
  const deeper = args.slice()
  deeper[7] = args[7] * 1.5
  refutes(() => same(jzSpline.carveSpline(...deeper), spSpline.carveSpline(...args)), 'carve depth raised by half')
})

gate('carveSpline returns the input array on early-return paths and carves when width is 2 or more', () => {
  const h = new Float32Array([1, 2, 3, 4])
  const cases = [
    ['width below 2', [h, 1, 1, 0, 0, [[0, 0], [1, 1]], 1, 1]],
    ['spacing zero', [h, 2, 0, 0, 0, [[0, 0], [1, 1]], 1, 1]],
    ['one control point', [h, 2, 1, 0, 0, [[0, 0]], 1, 1]],
    ['non-finite depth', [h, 2, 1, 0, 0, [[0, 0], [1, 1]], 1, NaN]],
  ]
  for (const [label, args] of cases) {
    const a = jzSpline.carveSpline(...args)
    const b = spSpline.carveSpline(...args)
    ok(a.heights === h && b.heights === h, `${label} returns the input array`)
    same(a, b, label)
  }
  ok(jzSpline.carveSpline(h, 2, 1, 0, 0, [[0, 0], [1, 1]], 1, 1).heights !== h, 'a width of 2 is carved, not returned')
})

gate('isCarved and the carved climate filter read spoint carved-cell keys the same way', () => {
  const heights = new Float32Array(144).fill(5)
  const spCells = spSpline.carveSpline(heights, 12, 2, 0, 0, [[0, 4], [20, 10]], 4, 2).carvedCells
  ok(spCells.size > 0, 'the fixture carves cells')
  const cells = []
  for (let cx = -4; cx <= 10; cx++) for (let cz = -4; cz <= 10; cz++) cells.push([cx, cz])
  for (const [cx, cz] of cells) same(jzSpline.isCarved(spCells, cx, cz), spSpline.isCarved(spCells, cx, cz), `cell ${cx},${cz}`)
  same(jzSpline.isCarved(null, 0, 0), spSpline.isCarved(null, 0, 0), 'null set')
  same(jzSpline.isCarved(new Set(), 0, 0), spSpline.isCarved(new Set(), 0, 0), 'empty set')
  const jzFilter = jzSpline.createCarvedClimateFilter(spCells)
  const spFilter = spSpline.createCarvedClimateFilter(spCells)
  for (const [cx, cz] of cells) {
    same(jzFilter({ t: cx }, cx, cz), spFilter({ t: cx }, cx, cz), `filter ${cx},${cz}`)
    same(jzFilter(null, cx, cz), spFilter(null, cx, cz), `filter null ${cx},${cz}`)
  }
  same(jzSpline.createCarvedClimateFilter(new Set()), spSpline.createCarvedClimateFilter(new Set()), 'empty filter')
  refutes(() => {
    for (const [cx, cz] of cells) same(jzSpline.isCarved(spCells, cz, cx), spSpline.isCarved(spCells, cx, cz), `transposed ${cx},${cz}`)
  }, 'transposed cell coordinates')
})

gate('createSplineCarveLayer carve, deltas, kinds, wrappers and JSON match spoint on seeded river and road carves', () => {
  const rnd = seeded(303)
  const probes = seededProbes(rnd, 150, -50, 50)
  for (let round = 0; round < 3; round++) {
    const scenario = layerScenario(rnd, 6)
    const a = buildLayer(jzSpline, scenario)
    const b = buildLayer(spSpline, scenario)
    same(a.touched, b.touched, `touched round ${round}`)
    same(snapshotLayer(a.layer, probes), snapshotLayer(b.layer, probes), `layer round ${round}`)
    ok(b.layer.cellCount > 0, 'the scenario carved cells before clear')
    a.layer.clear()
    b.layer.clear()
    same([a.layer.cellCount, a.layer.splineCount, a.layer.deltaAt(0, 0)], [b.layer.cellCount, b.layer.splineCount, b.layer.deltaAt(0, 0)], `cleared round ${round}`)
  }
  const scenario = layerScenario(rnd, 6)
  const perturbed = scenario.map((s, i) => (i === 0 ? { ...s, depth: s.depth + 0.5 } : s))
  refutes(() => same(snapshotLayer(buildLayer(jzSpline, perturbed).layer, probes), snapshotLayer(buildLayer(spSpline, scenario).layer, probes)), 'first carve depth raised by 0.5')
})

gate('loadSplineCarveLayer rebuilds spoint saved layers identically and refuses a dropped spline', () => {
  const rnd = seeded(404)
  const probes = seededProbes(rnd, 120, -50, 50)
  for (let round = 0; round < 3; round++) {
    const saved = buildLayer(spSpline, layerScenario(rnd, 5)).layer.toJSON()
    ok(saved.splines.length > 0, 'the saved layer holds splines')
    same(snapshotLayer(jzSpline.loadSplineCarveLayer(saved, baseFnForCarve), probes), snapshotLayer(spSpline.loadSplineCarveLayer(saved, baseFnForCarve), probes), `load round ${round}`)
    if (round === 0) {
      const dropped = { version: saved.version, cellM: saved.cellM, splines: saved.splines.slice(1) }
      refutes(() => same(snapshotLayer(jzSpline.loadSplineCarveLayer(dropped, baseFnForCarve), probes), snapshotLayer(spSpline.loadSplineCarveLayer(saved, baseFnForCarve), probes)), 'a dropped spline')
    }
  }
})

gate('thermalErode matches spoint on seeded heightfields, NaN cells, defaults and the early return', () => {
  const rnd = seeded(505)
  for (let k = 0; k < 25; k++) {
    const width = intBetween(rnd, 3, 12)
    const heights = new Float32Array(width * width)
    for (let i = 0; i < heights.length; i++) heights[i] = between(rnd, 0, 5)
    if (k % 3 === 0) heights[intBetween(rnd, 0, heights.length - 1)] = NaN
    const spacing = between(rnd, 0.5, 2)
    const talus = between(rnd, 0.2, 0.7)
    const iterations = intBetween(rnd, 1, 20)
    const rate = between(rnd, 0.02, 0.2)
    same(jzErosion.thermalErode(heights, width, spacing, talus, iterations, rate), spErosion.thermalErode(heights, width, spacing, talus, iterations, rate), `case ${k}`)
  }
  const flat = new Float32Array(16)
  for (let i = 0; i < flat.length; i++) flat[i] = (i * 7) % 5
  same(jzErosion.thermalErode(flat, 4, 1), spErosion.thermalErode(flat, 4, 1), 'defaults')
  const early = new Float32Array([1, 2, 3, 4])
  ok(jzErosion.thermalErode(early, 2, 1) === early && spErosion.thermalErode(early, 2, 1) === early, 'width below 3 returns the input array')
  const spike = new Float32Array(25)
  spike[12] = 10
  refutes(() => same(jzErosion.thermalErode(spike, 5, 1, Math.PI / 6, 50, 0.1), spErosion.thermalErode(spike, 5, 1, Math.PI / 6, 50, 0.2)), 'erosion rate doubled on a spike')
})

gate('hydraulicErode matches spoint on seeded fields, seeds and default options', () => {
  const rnd = seeded(606)
  for (let k = 0; k < 12; k++) {
    const width = intBetween(rnd, 5, 10)
    const heights = new Float32Array(width * width)
    for (let i = 0; i < heights.length; i++) heights[i] = between(rnd, 0, 4)
    const opts = {
      drops: intBetween(rnd, 20, 80),
      capacity: between(rnd, 0.005, 0.03),
      deposition: between(rnd, 0.005, 0.03),
      erosion: between(rnd, 0.005, 0.03),
      evaporation: between(rnd, 0.005, 0.03),
      minSlope: between(rnd, 0.0005, 0.005),
      seed: intBetween(rnd, -5, 500),
    }
    same(jzErosion.hydraulicErode(heights, width, 1.5, opts), spErosion.hydraulicErode(heights, width, 1.5, opts), `case ${k}`)
  }
  const field = new Float32Array(36)
  for (let i = 0; i < field.length; i++) field[i] = ((i * 13) % 7) * 0.5
  same(jzErosion.hydraulicErode(field, 6, 1), spErosion.hydraulicErode(field, 6, 1), 'defaults')
  const fixed = { drops: 60, seed: 9 }
  refutes(() => same(jzErosion.hydraulicErode(field, 6, 1, { ...fixed, seed: 10 }), spErosion.hydraulicErode(field, 6, 1, fixed)), 'seed changed by one')
})

gate('makeSphereCaveSDF, makeCylinderCaveSDF and makeTunnelCaveSDF match spoint on seeded probes', () => {
  const rnd = seeded(707)
  const probes = Array.from({ length: 120 }, () => [between(rnd, -3, 3), between(rnd, -3, 3), between(rnd, -3, 3)])
  const at = (f) => probes.map(([x, y, z]) => f(x, y, z))
  for (let k = 0; k < 30; k++) {
    const c = [between(rnd, -2, 2), between(rnd, -2, 2), between(rnd, -2, 2)]
    const radius = between(rnd, 0.2, 2)
    const halfHeight = between(rnd, 0.2, 2)
    const axis = ['x', 'y', 'z', undefined][k % 4]
    same(at(jzCave.makeSphereCaveSDF(...c, radius)), at(spCave.makeSphereCaveSDF(...c, radius)), `sphere ${k}`)
    same(at(jzCave.makeCylinderCaveSDF(...c, radius, halfHeight, axis)), at(spCave.makeCylinderCaveSDF(...c, radius, halfHeight, axis)), `cylinder ${k}`)
    const seed = intBetween(rnd, -100000, 100000)
    const length = between(rnd, 1, 6)
    const warpAmp = k % 2 ? between(rnd, 0.05, 0.3) : undefined
    const warpFreq = k % 2 ? between(rnd, 1, 4) : undefined
    same(at(jzCave.makeTunnelCaveSDF(seed, radius, length, axis, warpAmp, warpFreq)), at(spCave.makeTunnelCaveSDF(seed, radius, length, axis, warpAmp, warpFreq)), `tunnel ${k}`)
  }
  refutes(() => same(at(jzCave.makeSphereCaveSDF(0, 0, 0, 1.001)), at(spCave.makeSphereCaveSDF(0, 0, 0, 1))), 'sphere radius off by 0.001')
})

gate('transcribed tunnelHash and tunnel SDF reproduce spoint makeTunnelCaveSDF (transcription)', () => {
  const rnd = seeded(808)
  const probes = Array.from({ length: 120 }, () => [between(rnd, -3, 3), between(rnd, -3, 3), between(rnd, -3, 3)])
  const at = (f) => probes.map(([x, y, z]) => f(x, y, z))
  for (let k = 0; k < 30; k++) {
    const seed = intBetween(rnd, -100000, 100000)
    const radius = between(rnd, 0.2, 2)
    const length = between(rnd, 1, 6)
    const axis = ['x', 'y', 'z'][k % 3]
    const warpAmp = k % 2 ? between(rnd, 0.05, 0.3) : undefined
    const warpFreq = k % 2 ? between(rnd, 1, 4) : undefined
    same(at(txTunnel(seed, radius, length, axis, warpAmp, warpFreq)), at(spCave.makeTunnelCaveSDF(seed, radius, length, axis, warpAmp, warpFreq)), `tunnel ${k}`)
  }
  refutes(() => same(at(txTunnel(7, 1, 4, 'y')), at(spCave.makeTunnelCaveSDF(8, 1, 4, 'y'))), 'seed changed by one in the transcription')
})

gate('marchRockSurface and polygonizeCaveSDF match spoint marching output', () => {
  for (const res of [4, 6, 8]) {
    for (const radius of [0.7, 1.1, 1.4]) {
      const sdfJz = jzCave.makeSphereCaveSDF(0.05, -0.03, 0.02, radius)
      const sdfSp = spCave.makeSphereCaveSDF(0.05, -0.03, 0.02, radius)
      same(jzRock.marchRockSurface(res, sdfJz), spRock.marchRockSurface(res, sdfSp), `rock res ${res} radius ${radius}`)
      same(jzCave.polygonizeCaveSDF(sdfJz, res), spCave.polygonizeCaveSDF(sdfSp, res), `cave res ${res} radius ${radius}`)
    }
  }
  refutes(() => same(jzRock.marchRockSurface(7, jzCave.makeSphereCaveSDF(0, 0, 0, 1)), spRock.marchRockSurface(8, spCave.makeSphereCaveSDF(0, 0, 0, 1))), 'resolution 7 against 8')
})

gate('createCaveVolume and polygonizeCaveVolume match spoint for sphere, cylinder and tunnel specs and refusals', () => {
  const anchors = [[1, 2, 3, 2], [-4, 0.5, 2, 0.75]]
  const specs = [
    undefined,
    { kind: 'sphere' },
    { kind: 'cylinder', halfHeight: 1.5, axis: 'x' },
    { kind: 'cylinder', halfHeight: 0.7 },
    { kind: 'cylinder', halfHeight: 0 },
    { kind: 'tunnel', length: 6, axis: 'z', seed: 9, warpAmp: 0.2, warpFreq: 3 },
    { kind: 'tunnel' },
    { kind: 'tunnel', length: -1 },
    { kind: 'mystery' },
    null,
  ]
  for (const anchor of anchors) {
    for (const spec of specs) {
      const args = spec === undefined ? [...anchor] : [...anchor, spec]
      same(shapeOf(jzCave, args), shapeOf(spCave, args), `anchor ${anchor.join(',')} spec ${JSON.stringify(spec)}`)
    }
  }
  refutes(() => same(shapeOf(jzCave, [1, 2, 3, 2.01, { kind: 'sphere' }]), shapeOf(spCave, [1, 2, 3, 2, { kind: 'sphere' }])), 'anchor radius off by 0.01')
})

gate('createCaveCarveLayer matches spoint for seeded volumes, refusals, clear and reload', () => {
  const rnd = seeded(909)
  const script = [
    ['addSphereCave', [0, 0, 0, 3]],
    ['addCylinderCave', [6, 1, -2, 2.5, 1.2, 'x']],
    ['addTunnelCave', [-5, -1, 4, 2, 10, 'y', 42, 0.2, 2]],
    ['addSphereCave', [1, 1, 1, 0]],
    ['addCylinderCave', [2, 0, 2, 1, 0]],
    ['addCaveVolume', [{ worldX: 9, worldY: 4, worldZ: 9, worldRadius: 1.5, kind: 'tunnel', length: 4, axis: 'x', seed: 3 }]],
    ['addCaveVolume', [{ worldX: NaN, worldY: 0, worldZ: 0, worldRadius: 1, kind: 'sphere' }]],
  ]
  for (let k = 0; k < 8; k++) {
    const pick = k % 3
    if (pick === 0) script.push(['addSphereCave', [between(rnd, -8, 8), between(rnd, -2, 4), between(rnd, -8, 8), between(rnd, 0.5, 4)]])
    else if (pick === 1) script.push(['addCylinderCave', [between(rnd, -8, 8), between(rnd, -2, 4), between(rnd, -8, 8), between(rnd, 0.5, 3), between(rnd, 0.2, 2), 'z']])
    else script.push(['addTunnelCave', [between(rnd, -8, 8), between(rnd, -2, 4), between(rnd, -8, 8), between(rnd, 0.5, 2), between(rnd, 1, 8), 'z', intBetween(rnd, 0, 999), 0.15, 2.5]])
  }
  const probes = seededProbes(rnd, 120, -10, 10)
  const surfaces = probes.map(() => between(rnd, -1, 5))
  const base = (x, z, y) => 4 + 0.1 * x + 0.05 * z
  same(runCaveScript(jzCave, script, probes, surfaces, base), runCaveScript(spCave, script, probes, surfaces, base), 'cave carve layer')
  const perturbed = script.map((entry, i) => (i === 0 ? ['addSphereCave', [0, 0, 0, 3.01]] : entry))
  refutes(() => same(runCaveScript(jzCave, perturbed, probes, surfaces, base), runCaveScript(spCave, script, probes, surfaces, base)), 'first sphere radius off by 0.01')
})

gate('transcribed volumeVerticalSpan and heightDeltaAt reproduce spoint cave ceilings (transcription)', () => {
  const rnd = seeded(1010)
  const specs = [
    ['addSphereCave', [0, 0, 0, 3]],
    ['addCylinderCave', [6, 1, -2, 2.5, 1.2, 'x']],
    ['addTunnelCave', [-5, -1, 4, 2, 10, 'y', 42, 0.2, 2]],
  ]
  const layer = spCave.createCaveCarveLayer()
  for (const [method, args] of specs) layer[method](...args)
  const vols = [
    { worldX: 0, worldY: 0, worldZ: 0, worldRadius: 3, kind: 'sphere' },
    { worldX: 6, worldY: 1, worldZ: -2, worldRadius: 2.5, kind: 'cylinder', verticalSpan: 1.2 },
    { worldX: -5, worldY: -1, worldZ: 4, worldRadius: 2, kind: 'tunnel', verticalSpan: 1 },
  ]
  const probes = seededProbes(rnd, 200, -10, 10)
  const surfaces = probes.map(() => between(rnd, -3, 4))
  const spValues = probes.map(([x, z], i) => layer.heightDeltaAt(x, z, surfaces[i]))
  const txValues = probes.map(([x, z], i) => txHeightDelta(vols, x, z, surfaces[i]))
  same(txValues, spValues, 'ceilings')
  const jzLayer = jzCave.createCaveCarveLayer()
  for (const [method, args] of specs) jzLayer[method](...args)
  same(probes.map(([x, z], i) => jzLayer.heightDeltaAt(x, z, surfaces[i])), spValues, 'jayzee ceilings against spoint')
  refutes(() => same(probes.map(([x, z], i) => txHeightDelta(vols, x, z, surfaces[i], 1.01)), spValues), 'span scaled by 1.01')
})

gate('defineStructureTemplate and structureTemplate match spoint on valid templates and refusals', () => {
  const cases = [
    ['valid', ['tOk1', { footprintRadius: 3, parts: [{ model: 'post', x: 1, z: -1, rotY: 0.5, scale: 2 }] }]],
    ['defaults', ['tOk2', { footprintRadius: 2.5, parts: [{ model: 'post' }] }]],
    ['duplicate id', ['tOk1', { footprintRadius: 3, parts: [{ model: 'post' }] }]],
    ['zero radius', ['tBad1', { footprintRadius: 0, parts: [{ model: 'a' }] }]],
    ['negative radius', ['tBad2', { footprintRadius: -1, parts: [{ model: 'a' }] }]],
    ['infinite radius', ['tBad3', { footprintRadius: Infinity, parts: [{ model: 'a' }] }]],
    ['empty id', ['', { footprintRadius: 1, parts: [{ model: 'a' }] }]],
    ['no parts', ['tBad4', { footprintRadius: 1, parts: [] }]],
    ['NaN part x', ['tBad5', { footprintRadius: 1, parts: [{ model: 'a', x: NaN }] }]],
    ['empty model', ['tBad6', { footprintRadius: 1, parts: [{ model: '' }] }]],
  ]
  for (const [label, args] of cases) {
    const a = outcome(() => normalizeTemplate(jzStamp.defineStructureTemplate(...args)))
    const b = outcome(() => normalizeTemplate(spStamp.defineStructureTemplate(...args)))
    same(a, b, label)
  }
  same(outcome(() => normalizeTemplate(jzStamp.structureTemplate('tOk1'))), outcome(() => normalizeTemplate(spStamp.structureTemplate('tOk1'))), 'lookup')
  same(outcome(() => jzStamp.structureTemplate('nope')), outcome(() => spStamp.structureTemplate('nope')), 'unknown lookup')
  refutes(() => {
    const a = normalizeTemplate(jzStamp.defineStructureTemplate('tNeg', { footprintRadius: 3.01, parts: [{ model: 'a' }] }))
    const b = normalizeTemplate(spStamp.defineStructureTemplate('tNeg', { footprintRadius: 3, parts: [{ model: 'a' }] }))
    same(a, b, 'footprint radius')
  }, 'footprint radius 3.01 against 3')
})

gate('stampStructures matches spoint post placement, priority order, footprint culling and refusals', () => {
  const rnd = seeded(1111)
  const groundAt = (x, z) => 1 + 0.1 * x - 0.07 * z
  for (let k = 0; k < 40; k++) {
    const stamps = Array.from({ length: intBetween(rnd, 1, 6) }, () => ({
      template: rnd() < 0.5 ? 'stRow' : 'stBig',
      x: between(rnd, -20, 20),
      z: between(rnd, -20, 20),
      rotY: between(rnd, -3, 3),
      priority: intBetween(rnd, 0, 2),
    }))
    same(jzStamp.stampStructures(stamps, groundAt), spStamp.stampStructures(stamps, groundAt), `case ${k}`)
  }
  same(outcome(() => jzStamp.stampStructures(null, groundAt)), outcome(() => spStamp.stampStructures(null, groundAt)), 'not an array')
  same(outcome(() => jzStamp.stampStructures([], undefined)), outcome(() => spStamp.stampStructures([], undefined)), 'no ground sampler')
  same(outcome(() => jzStamp.stampStructures([{ template: 'stRow', x: 0, z: 0 }], () => NaN)), outcome(() => spStamp.stampStructures([{ template: 'stRow', x: 0, z: 0 }], () => NaN)), 'no ground under a post')
  same(outcome(() => jzStamp.stampStructures([{ template: 'nope', x: 0, z: 0 }], groundAt)), outcome(() => spStamp.stampStructures([{ template: 'nope', x: 0, z: 0 }], groundAt)), 'unknown template')
  const stamps = [{ template: 'stRow', x: 1, z: 2, rotY: 0.7, priority: 1 }, { template: 'stBig', x: 4, z: 3, rotY: -0.4 }]
  refutes(() => same(jzStamp.stampStructures(stamps, (x, z) => groundAt(x, z) + 0.5), spStamp.stampStructures(stamps, groundAt)), 'ground raised by 0.5')
})

gate('transcribed rotatedOffset, footprint culling and post order reproduce spoint stampStructures (transcription)', () => {
  const rnd = seeded(1212)
  const groundAt = (x, z) => 1 + 0.1 * x - 0.07 * z
  for (let k = 0; k < 40; k++) {
    const stamps = Array.from({ length: intBetween(rnd, 1, 6) }, () => ({
      template: rnd() < 0.5 ? 'stRow' : 'stBig',
      x: between(rnd, -20, 20),
      z: between(rnd, -20, 20),
      rotY: between(rnd, -3, 3),
      priority: intBetween(rnd, 0, 2),
    }))
    same(txPosts(stSpecs, stamps, groundAt), spStamp.stampStructures(stamps, groundAt), `case ${k}`)
  }
  const stamps = [{ template: 'stRow', x: 1, z: 2, rotY: 0.7, priority: 1 }, { template: 'stBig', x: 4, z: 3, rotY: -0.4 }]
  refutes(() => same(txPosts(stSpecs, stamps, groundAt, -1), spStamp.stampStructures(stamps, groundAt)), 'rotation sign flipped')
})

gate('CONTACT_FIELD constants, tree stamps and rock stamps match spoint', () => {
  same(jzContact.CONTACT_FIELD, spContact.CONTACT_FIELD, 'constants')
  ok(Object.isFrozen(jzContact.CONTACT_FIELD) && Object.isFrozen(spContact.CONTACT_FIELD), 'constants are frozen in both')
  const rnd = seeded(1313)
  const placements = [
    { x: 1, z: 2, species: 4, scale: 1.2 },
    { x: -3, z: 5, species: 9, scale: 0.8 },
    { x: 7, z: -2, species: 10, scale: 2 },
    { x: 0, z: 0, species: 1, scale: 1.5 },
    ...Array.from({ length: 26 }, () => ({ x: between(rnd, -50, 50), z: between(rnd, -50, 50), species: intBetween(rnd, 0, 12), scale: between(rnd, 0.4, 2.5) })),
  ]
  same(jzContact.treeContactStamps(placements), spContact.treeContactStamps(placements), 'tree stamps')
  same(jzContact.rockContactStamps(placements), spContact.rockContactStamps(placements), 'rock stamps')
  refutes(() => same(jzContact.treeContactStamps(placements.map((p) => ({ ...p, species: 1 }))), spContact.treeContactStamps(placements)), 'bushes read as trees')
  refutes(() => same(jzContact.rockContactStamps(placements.map((p) => ({ ...p, scale: p.scale + 0.1 }))), spContact.rockContactStamps(placements)), 'rock scale off by 0.1')
})

gate('createContactField and the contactOcclusionField singleton match spoint', () => {
  same(jzContact.createContactField({ windowM: 64, texelM: 1 }), spContact.createContactField({ windowM: 64, texelM: 1 }), 'small field')
  same(jzContact.createContactField(), spContact.createContactField(), 'default field')
  same(jzContact.contactOcclusionField, spContact.contactOcclusionField, 'singleton')
  refutes(() => same(jzContact.createContactField({ windowM: 64, texelM: 2 }), spContact.createContactField({ windowM: 64, texelM: 1 })), 'texel size 2 against 1')
})

gate('contactFieldLoadChunk, contactFieldUnloadChunk and contactFieldRecentre match spoint over a seeded sequence', () => {
  const rnd = seeded(1414)
  for (let round = 0; round < 3; round++) {
    const ops = contactOps(rnd, 30)
    same(runContactOps(jzContact, ops), runContactOps(spContact, ops), `sequence ${round}`)
  }
  const ops = contactOps(rnd, 12)
  const extra = { kind: 'load', key: 'neg', stamps: spContact.rockContactStamps([{ x: 48, z: 48, species: 0, scale: 2 }]) }
  refutes(() => same(runContactOps(jzContact, [...ops, extra]), runContactOps(spContact, ops)), 'an extra rock chunk loaded')
})

gate('transcribed smoothstep and stamp rasterisation reproduce spoint texels for single stamps (transcription)', () => {
  const stamps = [
    { x: 32, z: 30, r0: 4, r1: 14, strength: 0.5 },
    { x: 20, z: 44, r0: 1, r1: 6, strength: 0.45 },
    { x: 50, z: 50, r0: 0.5, r1: 12, strength: 0.9 },
  ]
  for (const stamp of stamps) {
    const expected = txStampTexels(96, stamp, txSmooth)
    for (const lib of [spContact, jzContact]) {
      const field = lib.createContactField({ windowM: 96, texelM: 1 })
      lib.contactFieldLoadChunk(field, 'one', [stamp])
      same(field.data, expected, `stamp at ${stamp.x},${stamp.z}`)
    }
  }
  refutes(() => {
    const field = jzContact.createContactField({ windowM: 96, texelM: 1 })
    jzContact.contactFieldLoadChunk(field, 'one', [stamps[0]])
    same(field.data, txStampTexels(96, stamps[0], (e0, e1, x) => txSmooth(e1, e0, x)))
  }, 'smoothstep edges swapped')
})

gate('transcribed carveHash, cellKey, catmullRom and carve reproduce spoint layer deltas (transcription)', () => {
  const rnd = seeded(1515)
  const probes = seededProbes(rnd, 150, -50, 50)
  const scenario = layerScenario(rnd, 6)
  scenario.push({ pts: [[-30, 0], [30, 4]], width: 8, depth: 2, kind: 'river', opts: { seed: 77, widthVariance: 0.3, bankErosion: 1.2 } })
  const spLayer = spSpline.createSplineCarveLayer()
  const txCells = new Map()
  const spTouched = scenario.map((s) => spLayer.carve(s.pts, s.width, s.depth, s.kind, baseFnForCarve, s.opts).touched)
  const txTouched = scenario.map((s) => txCarve(txCells, s.pts, s.width, s.depth, s.kind, baseFnForCarve, s.opts).touched)
  same(txTouched, spTouched, 'touched counts')
  same(probes.map(([x, z]) => txDeltaAt(txCells, x, z)), probes.map(([x, z]) => spLayer.deltaAt(x, z)), 'deltas')
  same(probes.map(([x, z]) => txKindAt(txCells, x, z)), probes.map(([x, z]) => spLayer.kindAt(x, z)), 'kinds')
  same(txCells.size, spLayer.cellCount, 'cell count')
  const negCells = new Map()
  scenario.forEach((s) => txCarve(negCells, s.pts, s.width, s.depth, s.kind, baseFnForCarve, s.opts, 1))
  refutes(() => same(probes.map(([x, z]) => txDeltaAt(negCells, x, z)), probes.map(([x, z]) => spLayer.deltaAt(x, z))), 'bank angle hash shifted by one')
})
finish()
