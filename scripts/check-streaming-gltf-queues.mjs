import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { LodUnloadManager, VRAM_UNLOAD_TRIGGER_FRACTION, keepPriorityOf } from '../src/packages/streaming-gltf/lod-unload-manager.js'
import { DeferredLoadQueue, LOAD_TIME_WINDOW } from '../src/packages/streaming-gltf/deferred-load-queue.js'
import { createMaterialConvergence, corpusMaterialConvergence, MATERIAL_BUCKET_EXTRAS_KEY } from '../src/packages/streaming-gltf/material-convergence.js'
import { capKtx2Levels, parseKtx2, maxTexDimForDeviceTier, applyKtx2DeviceTierCap } from '../src/packages/streaming-gltf/ktx2-mip-cap.js'

function buildKtx2({ width, height, depth = 0, levels, dfd, kvd, sgd }) {
  const HEADER = 80, ENTRY = 24
  const n = levels.length
  let cursor = HEADER + n * ENTRY
  const dfdOff = cursor; cursor += dfd.length
  const kvdOff = cursor; cursor += kvd.length
  cursor += (8 - (cursor % 8)) % 8
  let sgdBytes = null, sgdOff = 0
  if (sgd) {
    const parts = [sgd.header, ...sgd.descs, sgd.endpoints, sgd.selectors, sgd.tables, sgd.extended]
    const len = parts.reduce((s, p) => s + p.length, 0)
    sgdBytes = new Uint8Array(len); let o = 0
    for (const p of parts) { sgdBytes.set(p, o); o += p.length }
    sgdOff = cursor; cursor += len; cursor += (8 - (cursor % 8)) % 8
  }
  const levelOffs = []
  for (const l of levels) { levelOffs.push(cursor); cursor += l.length }
  const out = new Uint8Array(cursor)
  const v = new DataView(out.buffer)
  out.set([0xAB, 0x4B, 0x54, 0x58, 0x20, 0x32, 0x30, 0xBB, 0x0D, 0x0A, 0x1A, 0x0A], 0)
  v.setUint32(12, 37, true); v.setUint32(16, 1, true); v.setUint32(20, width, true); v.setUint32(24, height, true)
  v.setUint32(28, depth, true); v.setUint32(32, 0, true); v.setUint32(36, 1, true); v.setUint32(40, n, true)
  v.setUint32(44, sgd ? 1 : 0, true); v.setUint32(48, dfdOff, true); v.setUint32(52, dfd.length, true)
  v.setUint32(56, kvdOff, true); v.setUint32(60, kvd.length, true)
  v.setUint32(64, sgdOff, true); v.setUint32(72, sgdBytes ? sgdBytes.length : 0, true)
  for (let i = 0; i < n; i++) {
    v.setUint32(HEADER + i * ENTRY, levelOffs[i], true)
    v.setUint32(HEADER + i * ENTRY + 8, levels[i].length, true)
    v.setUint32(HEADER + i * ENTRY + 16, levels[i].length * 2, true)
  }
  out.set(dfd, dfdOff); out.set(kvd, kvdOff); if (sgdBytes) out.set(sgdBytes, sgdOff)
  levels.forEach((l, i) => out.set(l, levelOffs[i]))
  return out
}
const fill = (len, base) => Uint8Array.from({ length: len }, (_, i) => (base + i) & 255)
const plainKtx2 = () => buildKtx2({ width: 8, height: 4, levels: [fill(32, 10), fill(8, 60), fill(2, 90)], dfd: fill(12, 200), kvd: fill(6, 150) })
const sgdKtx2 = () => {
  const h = new Uint8Array(20); const hv = new DataView(h.buffer)
  hv.setUint16(0, 3, true); hv.setUint16(2, 5, true); hv.setUint32(4, 4, true); hv.setUint32(8, 3, true); hv.setUint32(12, 2, true); hv.setUint32(16, 1, true)
  const descs = [0, 1, 2].map((i) => { const d = new Uint8Array(20); const dv = new DataView(d.buffer); for (let k = 0; k < 5; k++) dv.setUint32(k * 4, 100 * i + k, true); return d })
  return buildKtx2({ width: 8, height: 4, levels: [fill(32, 10), fill(8, 60), fill(2, 90)], dfd: fill(12, 200), kvd: fill(6, 150), sgd: { header: h, descs, endpoints: fill(4, 1), selectors: fill(3, 5), tables: fill(2, 9), extended: fill(1, 13) } })
}
class Prop {
  constructor(type, defaults, values, refs = {}, exts = []) { this.propertyType = type; this._d = defaults; this._v = values; this._r = refs; this._e = exts; this.extras = null; this.parents = []; this.disposed = false }
  getDefaults() { return this._d } get(k) { return this._v[k] } getRef(k) { return this._r[k] ?? null } listExtensions() { return this._e }
  getName() { return this._v.name } getExtras() { return this.extras } setExtras(e) { this.extras = e } listParents() { return this.parents } dispose() { this.disposed = true }
}
class Tex extends Prop { constructor(img, mime) { super('Texture', {}, {}); this.img = img; this.mime = mime } getImage() { return this.img } getMimeType() { return this.mime } }
function makeDoc() {
  const texA = new Tex(Uint8Array.from([1, 2, 3, 4]), 'image/png')
  const texB = new Tex(Uint8Array.from([1, 2, 3, 4]), 'image/png')
  const texC = new Tex(Uint8Array.from([9, 9]), 'image/ktx2')
  const defaults = { name: '', extras: {}, baseColorFactor: [1, 1, 1, 1], baseColorTexture: null, roughnessFactor: 1, alphaMode: 'OPAQUE', extensions: {} }
  const ext = (name, ior) => Object.assign(new Prop('Extension', { ior: 1.5 }, { ior }), { extensionName: name })
  const mat = (name, color, rough, tex, exts = []) => {
    const m = new Prop('Material', defaults, { name, baseColorFactor: color, roughnessFactor: rough, alphaMode: 'OPAQUE', baseColorTexture: tex ? {} : null, extensions: {} }, { baseColorTexture: tex }, exts)
    return m
  }
  const m1 = mat('red', [1, 0, 0, 1], 0.5, texA)
  const m2 = mat('red copy', [1, 0, 0, 1.000001], 0.500001, texB)
  const m3 = mat('', [0, 1, 0, 1], 0.5, texC, [ext('KHR_materials_ior', 1.45)])
  const m4 = mat('green', [0, 1, 0, 1], 0.5, texC, [ext('KHR_materials_ior', 1.45)])
  const m5 = mat('plain', [0.333333333, 0, 0, 1], 1, null)
  const root = { listMaterials: () => [m1, m2, m3, m4, m5], listTextures: () => [texA, texB, texC] }
  const prim = { swaps: [], swap(a, b) { this.swaps.push([a.getName(), b.getName()]) } }
  m2.parents = [root, prim]; m4.parents = [root, prim]
  return { doc: { getRoot: () => root }, mats: [m1, m2, m3, m4, m5], prim, root }
}

const sha256 = (bytes) => createHash('sha256').update(new Uint8Array(bytes)).digest('hex')
const sha1Hex = (bytes) => createHash('sha1').update(bytes).digest('hex')
const MB = 1024 * 1024

const makeAsset = (url, meshLods, texLods) => {
  const evicted = []
  return {
    url,
    evicted,
    meshLodDescs: [{ lods: meshLods }],
    texLodDescs: [{ lods: texLods }],
    evictMeshLod(d, l) { evicted.push(`mesh:${d}:${l}`); return meshLods[l].freed === undefined ? meshLods[l].bytes : meshLods[l].freed },
    evictTexLod(d, l) { evicted.push(`tex:${d}:${l}`); return texLods[l].freed === undefined ? texLods[l].bytes : texLods[l].freed },
  }
}
const standardAsset = (url = 'a') => makeAsset(url, [{ bytes: 300000 }, { bytes: 200000 }, { bytes: 999999, inline: true }], [{ bytes: 50000 }, { bytes: 400000 }])

gate('lod-unload: defaults match spoint (200 MB budget, 0.85 trigger, 150 and 200 m thresholds, LOD 0 high keep priority)', () => {
  const m = new LodUnloadManager()
  assert.equal(m.vramBudgetBytes, 200 * MB)
  assert.equal(VRAM_UNLOAD_TRIGGER_FRACTION, 0.85)
  assert.equal(m.distanceThresholdFar, 150)
  assert.equal(m.distanceThresholdVeryFar, 200)
  assert.deepEqual([keepPriorityOf(0), keepPriorityOf(1), keepPriorityOf(5)], [1, 0, 0])
})

gate('lod-unload: below 0.85 of budget nothing is evicted and 0 is returned', () => {
  const m = new LodUnloadManager(1)
  const asset = standardAsset()
  m.markInvisible({ asset, _currentDistance: 500 })
  assert.equal(m.scanForUnload(new Map([['a', asset]]), Math.floor(0.85 * MB) - 1), 0)
  assert.deepEqual(asset.evicted, [])
})

gate('lod-unload: medium-priority LODs go first, largest first, and the scan stops once under target; inline LODs are never candidates', () => {
  const m = new LodUnloadManager(1)
  const asset = standardAsset()
  m.markInvisible({ asset, _currentDistance: 250 })
  assert.equal(m.scanForUnload(new Map([['a', asset]]), 1000000), 400000)
  assert.deepEqual(asset.evicted, ['tex:0:1'])
  const deep = standardAsset()
  m.markInvisible({ asset: deep, _currentDistance: 250 })
  m.resetVisibility()
  m.markInvisible({ asset: deep, _currentDistance: 250 })
  assert.equal(m.scanForUnload(new Map([['a', deep]]), 1900000), 950000)
  assert.deepEqual(deep.evicted, ['tex:0:1', 'mesh:0:1', 'mesh:0:0', 'tex:0:0'])
  assert.deepEqual(m.getStats(), { visibleEntities: 0, invisibleEntities: 1, estimatedVramMB: '1.8', vramBudgetMB: 1, unloadedCount: 4, freedMB: '0.91' })
})

gate('lod-unload: between 150 and 200 m only non-zero LODs are eligible; at exactly 150 m nothing is (strict greater-than)', () => {
  const m = new LodUnloadManager(1)
  const asset = standardAsset()
  m.markInvisible({ asset, _currentDistance: 170 })
  m.scanForUnload(new Map([['a', asset]]), 1900000)
  assert.deepEqual(asset.evicted, ['tex:0:1', 'mesh:0:1'])
  const edge = standardAsset()
  const m2 = new LodUnloadManager(1)
  m2.markInvisible({ asset: edge, _currentDistance: 150 })
  assert.equal(m2.scanForUnload(new Map([['a', edge]]), 1900000), 0)
})

gate('lod-unload: the nearest invisible entity decides, LODs a visible entity uses are kept, and a null free is skipped', () => {
  const m = new LodUnloadManager(1)
  const asset = standardAsset()
  asset.texLodDescs[0].lods[1].freed = null
  m.markInvisible({ asset, _currentDistance: 900 })
  m.markInvisible({ asset, _currentDistance: 250 })
  m.markVisible({ asset, trackedMeshes: [{ meshDescIdx: 0, currentLod: 1, texState: [{ currentLod: 0 }] }] })
  assert.equal(m.scanForUnload(new Map([['a', asset]]), 1900000), 300000)
  assert.deepEqual(asset.evicted, ['tex:0:1', 'mesh:0:0'])
  assert.deepEqual([...m._unloadedLods.get('a')], ['mesh:0:0'])
})

gate('lod-unload quirk kept: an asset with no tracked entity counts as infinitely far and is fully eligible', () => {
  const m = new LodUnloadManager(1)
  const orphan = standardAsset('orphan')
  assert.equal(m.scanForUnload(new Map([['orphan', orphan]]), 1900000), 950000)
  assert.equal(orphan.evicted.length, 4)
  m.markVisible(null)
  m.markInvisible(undefined)
  assert.equal(m.getStats().visibleEntities + m.getStats().invisibleEntities, 0)
})

const makeHost = () => {
  const host = { t: 0, timers: [], warnings: [] }
  host.now = () => host.t
  host.setTimer = (fn, ms) => { const timer = { fn, ms, cleared: false }; host.timers.push(timer); return timer }
  host.clearTimer = (timer) => { if (timer) timer.cleared = true }
  host.warn = (line) => host.warnings.push(line)
  return host
}
const deferred = () => {
  let resolve, reject
  const promise = new Promise((res, rej) => { resolve = res; reject = rej })
  return { promise, resolve, reject }
}
const makeLoader = (url) => {
  const calls = []
  const waits = new Map()
  return {
    url,
    calls,
    waits,
    ensureMeshLod(d, l) {
      calls.push(`${d}:${l}`)
      if (l === 'throw') throw new Error('sync boom')
      const w = deferred()
      waits.set(`${d}:${l}`, w)
      return w.promise
    },
  }
}
const flush = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }

const cases = {}
const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}
const check = (label) => gate(label, () => {
  if (!(label in cases)) throw new Error('no probe recorded ' + label)
  if (cases[label]) throw cases[label]
})

gate('deferred-queue improvement: a missing clock or timer host is refused instead of reading performance or setTimeout', () => {
  assert.throws(() => new DeferredLoadQueue(2, 50, 5000), /host\.now/)
  assert.throws(() => new DeferredLoadQueue(2, 50, 5000, { now: () => 0, setTimer: () => 0 }), /host\.clearTimer/)
  const q = new DeferredLoadQueue(undefined, undefined, undefined, { now: () => 0, setTimer: () => 0, clearTimer: () => {} })
  assert.deepEqual([q.maxConcurrent, q.maxQueueSize, q.requestTimeoutMs], [2, 50, 5000])
})

gate('deferred-queue: non-positive or NaN limits clamp to 1, 1 and 1000 with one warning each, as spoint does', () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(0, NaN, -5, host)
  assert.deepEqual([q.maxConcurrent, q.maxQueueSize, q.requestTimeoutMs], [1, 1, 1000])
  assert.equal(host.warnings.length, 3)
  assert.match(host.warnings[0], /maxConcurrent must be >0 \(got 0\); clamped to 1/)
})

await probe('deferred-queue: highest priority loads next, duplicates are refused, and loaded keys stay refused until unloadLod (order matches spoint)', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 50, 5000, host)
  const asset = makeLoader('u')
  assert.equal(q.queueLoad(null, 0, 0), false)
  assert.equal(q.queueLoad(asset, null, 0), false)
  assert.equal(q.queueLoad(asset, 0, 'A', 0), true)
  assert.deepEqual(asset.calls, ['0:A'])
  assert.equal(host.timers[0].cleared, true)
  assert.equal(q.queueLoad(asset, 0, 'A', 9), false)
  q.queueLoad(asset, 0, 'B', 1)
  q.queueLoad(asset, 0, 'C', 5)
  q.queueLoad(asset, 0, 'D', 3)
  assert.equal(q.queueLoad(asset, 0, 'D', 4), false)
  assert.deepEqual(q.getStats(), { queued: 3, inFlight: 1, totalLoaded: 0, avgLoadTimeMs: '0.0', concurrency: 1, maxConcurrency: 1, dropped: 0, failed: 0 })
  for (const key of ['0:A', '0:C', '0:D']) { asset.waits.get(key).resolve(key); await flush() }
  assert.deepEqual(asset.calls, ['0:A', '0:C', '0:D', '0:B'])
  asset.waits.get('0:B').resolve('0:B')
  await flush()
  assert.equal(q.getStats().totalLoaded, 4)
  assert.equal(q.isLodLoaded('u', 0, 'C'), true)
  assert.equal(q.queueLoad(asset, 0, 'C', 0), false)
  q.unloadLod(asset, 0, 'C')
  assert.equal(q.isLodLoaded('u', 0, 'C'), false)
  assert.equal(q.getLoadedLods(asset).size, 3)
  assert.equal(q.getLoadedLods({ url: 'none' }).size, 0)
})
check('deferred-queue: highest priority loads next, duplicates are refused, and loaded keys stay refused until unloadLod (order matches spoint)')

await probe('deferred-queue: a full queue drops an incoming item at or below the lowest priority, else evicts the lowest, counting both as dropped', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 2, 5000, host)
  const asset = makeLoader('u')
  q.queueLoad(asset, 0, 'A', 0)
  q.queueLoad(asset, 0, 'B', 1)
  q.queueLoad(asset, 0, 'C', 2)
  assert.equal(q.queueLoad(asset, 0, 'D', 1), false)
  assert.equal(q.getStats().dropped, 1)
  assert.match(host.warnings.at(-1), /dropped lowest-priority LOD: u:0:D/)
  assert.equal(q.queueLoad(asset, 0, 'E', 5), true)
  assert.equal(q.getStats().dropped, 2)
  assert.match(host.warnings.at(-1), /dropped lowest-priority LOD: u:0:B/)
  assert.equal(host.timers[1].cleared, true)
  assert.deepEqual(q._pending.map((i) => i.lodIdx), ['E', 'C'])
})
check('deferred-queue: a full queue drops an incoming item at or below the lowest priority, else evicts the lowest, counting both as dropped')

await probe('deferred-queue: a pending request times out after requestTimeoutMs and counts as dropped; a started request is not timed out', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 50, 750, host)
  const asset = makeLoader('u')
  q.queueLoad(asset, 0, 'A', 0)
  q.queueLoad(asset, 0, 'B', 0)
  const timer = host.timers[1]
  assert.equal(timer.ms, 750)
  timer.fn()
  assert.equal(q.getStats().queued, 0)
  assert.equal(q.getStats().dropped, 1)
  assert.match(host.warnings.at(-1), /timed out after 750ms: u:0:B/)
  host.timers[0].fn()
  assert.equal(q.getStats().dropped, 1)
  asset.waits.get('0:A').resolve()
  await flush()
  assert.deepEqual(asset.calls, ['0:A'])
})
check('deferred-queue: a pending request times out after requestTimeoutMs and counts as dropped; a started request is not timed out')

await probe('deferred-queue: load time runs from queue time, including the wait, and averages over the last 20 loads', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 50, 5000, host)
  const asset = makeLoader('u')
  host.t = 100
  q.queueLoad(asset, 0, 'A', 0)
  q.queueLoad(asset, 0, 'B', 0)
  host.t = 130
  asset.waits.get('0:A').resolve()
  await flush()
  host.t = 175
  asset.waits.get('0:B').resolve()
  await flush()
  assert.equal(q.getStats().avgLoadTimeMs, '52.5')
  assert.deepEqual(q._stats.loadTimes, [30, 75])
  for (let i = 0; i < LOAD_TIME_WINDOW; i++) {
    host.t = 1000 * (i + 1)
    q.queueLoad(asset, 1, i, 0)
    host.t += 10
    asset.waits.get(`1:${i}`).resolve()
    await flush()
  }
  assert.equal(q._stats.loadTimes.length, 20)
  assert.equal(q.getStats().avgLoadTimeMs, '10.0')
})
check('deferred-queue: load time runs from queue time, including the wait, and averages over the last 20 loads')

await probe('deferred-queue: a sync throw or a rejection counts as failed, frees the slot and leaves the key loadable', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 50, 5000, host)
  const asset = makeLoader('u')
  q.queueLoad(asset, 0, 'throw', 0)
  q.queueLoad(asset, 0, 'R', 0)
  await flush()
  assert.equal(q.getStats().failed, 1)
  assert.match(host.warnings.at(-1), /LOD load failed: u:0:throw: sync boom/)
  assert.deepEqual(asset.calls, ['0:throw', '0:R'])
  asset.waits.get('0:R').reject('plain')
  await flush()
  assert.equal(q.getStats().failed, 2)
  assert.match(host.warnings.at(-1), /u:0:R: plain/)
  assert.equal(q.isLodLoaded('u', 0, 'R'), false)
  assert.equal(q.getStats().inFlight, 0)
  assert.equal(q.queueLoad(asset, 0, 'R', 0), true)
})
check('deferred-queue: a sync throw or a rejection counts as failed, frees the slot and leaves the key loadable')

await probe('deferred-queue: updatePriorities sets priority to minus distance for entity items, missing distance as minus Infinity, and reheaps', async () => {
  const host = makeHost()
  const q = new DeferredLoadQueue(1, 50, 5000, host)
  const asset = makeLoader('u')
  q.queueLoad(asset, 0, 'busy', 0)
  const near = { _currentDistance: 5 }
  const far = { _currentDistance: 80 }
  q.queueLoad(asset, 0, 'far', 100, far)
  q.queueLoad(asset, 0, 'near', 1, near)
  q.queueLoad(asset, 0, 'free', -10)
  q.queueLoad(asset, 0, 'lost', 50, {})
  q.updatePriorities()
  assert.deepEqual(Object.fromEntries(q._pending.map((i) => [i.lodIdx, i.priority])), { far: -80, near: -5, free: -10, lost: -Infinity })
  assert.equal(q._pending[0].lodIdx, 'near')
  for (const key of ['busy', 'near', 'free', 'far']) { asset.waits.get(`0:${key}`).resolve(); await flush() }
  assert.deepEqual(asset.calls, ['0:busy', '0:near', '0:free', '0:far', '0:lost'])
})
check('deferred-queue: updatePriorities sets priority to minus distance for entity items, missing distance as minus Infinity, and reheaps')

const report = createMaterialConvergence(sha1Hex)
const KEY_RED = 'alphaMode:"OPAQUE"|baseColorFactor:[1,0,0,1]|baseColorTexture:tex(12dada1fff4d4787ade3333147202c3b443e376f|image/png)|extensions:[]|roughnessFactor:0.5'
const KEY_GREEN = 'alphaMode:"OPAQUE"|baseColorFactor:[0,1,0,1]|baseColorTexture:tex(0b000dbedeec6e500a9fa717e6aa37b37fd20d12|image/ktx2)|extensions:[KHR_materials_ior{ior:1.45}]|roughnessFactor:0.5'
const KEY_PLAIN = 'alphaMode:"OPAQUE"|baseColorFactor:[0.3333,0,0,1]|baseColorTexture:null|extensions:[]|roughnessFactor:1'

gate('material-convergence: sha1 must be injected', () => {
  assert.throws(() => createMaterialConvergence(), /sha1Hex/)
})

gate('material-convergence: keys round to 4 places, skip name and extras, hash textures by content and sort extensions (matches spoint on this document)', () => {
  const { doc, mats } = makeDoc()
  assert.equal(report.materialKey(mats[0]), KEY_RED)
  assert.equal(report.materialKey(mats[1]), KEY_RED)
  assert.equal(report.materialKey(mats[4]), KEY_PLAIN)
  assert.deepEqual(report.materialConvergenceReport(doc), {
    materialCount: 5, textureCount: 3, uniqueKeyCount: 3, convergenceRatio: 0.6, trivialCollapseCandidates: 2,
    buckets: [{ key: KEY_RED, count: 2, names: ['red', 'red copy'] }, { key: KEY_GREEN, count: 2, names: ['(unnamed)', 'green'] }, { key: KEY_PLAIN, count: 1, names: ['plain'] }],
  })
})

gate('material-convergence negative control: a colour change beyond 4 places, or different texture bytes, splits a bucket', () => {
  const { mats } = makeDoc()
  mats[1]._v.baseColorFactor = [1, 0, 0, 0.9999]
  assert.notEqual(report.materialKey(mats[1]), KEY_RED)
  const other = makeDoc()
  other.mats[1]._r.baseColorTexture.img = Uint8Array.from([1, 2, 3, 5])
  assert.notEqual(report.materialKey(other.mats[1]), KEY_RED)
  const empty = makeDoc()
  empty.mats[0]._r.baseColorTexture.img = new Uint8Array(0)
  assert.match(report.materialKey(empty.mats[0]), /tex\(empty\|image\/png\)/)
  assert.equal(report.textureHash(null), null)
})

gate('material-convergence: an empty document has ratio 1', () => {
  const doc = { getRoot: () => ({ listMaterials: () => [], listTextures: () => [] }) }
  assert.equal(report.materialConvergenceReport(doc).convergenceRatio, 1)
  assert.equal(corpusMaterialConvergence([]).corpusConvergenceRatio, 1)
})

gate('material-convergence: collapse swaps duplicates into the first of each bucket on non-root parents and disposes them', () => {
  const { doc, mats, prim } = makeDoc()
  assert.deepEqual(report.collapseTrivialMaterialVariants(doc), { merged: 2, remaining: 3 })
  assert.deepEqual(prim.swaps, [['red copy', 'red'], ['green', '']])
  assert.deepEqual(mats.map((m) => m.disposed), [false, true, false, true, false])
})

gate('material-convergence: bucket stamps are the sha1 of the key in extras.EP_material_bucket, keeping other extras', () => {
  const { doc, mats } = makeDoc()
  mats[0].extras = { keep: 1 }
  const stamps = report.stampMaterialBucketKeys(doc)
  assert.equal(MATERIAL_BUCKET_EXTRAS_KEY, 'EP_material_bucket')
  assert.deepEqual([...stamps.values()], ['4166f7bc948ffe070136cdb119ffd1850bbb5bf3', '4166f7bc948ffe070136cdb119ffd1850bbb5bf3', '8bfaa12499612928be98daa5598b9e09901e0ef9', '8bfaa12499612928be98daa5598b9e09901e0ef9', 'b3bcb09b51060398a480ba4428930832794d90bb'])
  assert.equal(stamps.get(mats[4]), createHash('sha1').update(KEY_PLAIN).digest('hex'))
  assert.deepEqual(mats[0].extras, { keep: 1, EP_material_bucket: '4166f7bc948ffe070136cdb119ffd1850bbb5bf3' })
})

gate('material-convergence: corpus buckets shared by more than one asset, with summed instance counts', () => {
  const r = [{ name: 'x', report: report.materialConvergenceReport(makeDoc().doc) }, { name: 'y', report: report.materialConvergenceReport(makeDoc().doc) }]
  const corpus = corpusMaterialConvergence(r)
  assert.deepEqual([corpus.assetCount, corpus.totalMaterials, corpus.totalUniqueKeys, corpus.corpusConvergenceRatio], [2, 10, 3, 0.3])
  assert.deepEqual(corpus.crossAssetBuckets.map((b) => [b.assetCount, b.materialInstances, b.assets.join()]), [[2, 4, 'x,y'], [2, 4, 'x,y'], [2, 2, 'x,y']])
  assert.equal(corpusMaterialConvergence([r[0]]).crossAssetBuckets.length, 0)
})

const KTX2_CASES = [
  ['plain', plainKtx2, 2, '51143417aa813ddb', 130],
  ['plain', plainKtx2, 4, '11b6236a2fe40ecf', 162],
  ['sgd', sgdKtx2, 2, '35b516ed498a313e', 186],
  ['sgd', sgdKtx2, 4, '7401c00ffe0292cc', 234],
]

gate('ktx2-mip-cap: capped outputs are byte-identical to spoint capKtx2Levels on the same inputs (sha256 prefixes recorded from spoint)', () => {
  assert.equal(sha256(plainKtx2()).slice(0, 16), 'beda6644a1d4b6db')
  assert.equal(sha256(sgdKtx2()).slice(0, 16), '121abd4d16e84730')
  for (const [name, mk, dim, hash, len] of KTX2_CASES) {
    const out = capKtx2Levels(mk(), dim)
    assert.ok(out instanceof ArrayBuffer, name)
    assert.equal(out.byteLength, len, name + ' ' + dim)
    assert.equal(sha256(out).slice(0, 16), hash, name + ' ' + dim)
  }
})

gate('ktx2-mip-cap: an 8x4 three-level image capped at 4 keeps levels 1 and 2 with halved dimensions and level data intact', () => {
  const src = parseKtx2(plainKtx2())
  const out = parseKtx2(capKtx2Levels(plainKtx2(), 4))
  assert.deepEqual([out.pixelWidth, out.pixelHeight, out.levelCount, out.pixelDepth], [4, 2, 2, 0])
  for (let i = 0; i < 2; i++) {
    const a = src.levels[i + 1]
    const b = out.levels[i]
    assert.deepEqual(out.bytes.slice(b.byteOffset, b.byteOffset + b.byteLength), src.bytes.slice(a.byteOffset, a.byteOffset + a.byteLength))
    assert.equal(b.uncompressedByteLength, a.uncompressedByteLength)
  }
  assert.deepEqual(out.bytes.slice(out.kvdByteOffset, out.kvdByteOffset + out.kvdByteLength), src.bytes.slice(src.kvdByteOffset, src.kvdByteOffset + src.kvdByteLength))
  assert.equal(out.sgdByteOffset % 8, 0)
})

gate('ktx2-mip-cap: BasisLZ global data keeps its header and tables and drops the stripped image descriptors', () => {
  const out = parseKtx2(capKtx2Levels(sgdKtx2(), 4))
  assert.deepEqual(out.sgdHeader, { endpointCount: 3, selectorCount: 5, endpointsByteLength: 4, selectorsByteLength: 3, tablesByteLength: 2, extendedByteLength: 1 })
  assert.deepEqual(out.sgdImageDescs.map((d) => d.imageFlags), [100, 200])
  assert.equal(out.sgdByteLength, 20 + 40 + 10)
})

gate('ktx2-mip-cap: the last level is never stripped, so a cap below the smallest level keeps it alone', () => {
  const out = parseKtx2(capKtx2Levels(plainKtx2(), 1))
  assert.deepEqual([out.pixelWidth, out.pixelHeight, out.levelCount], [2, 1, 1])
})

gate('ktx2-mip-cap negative controls: no cap, a fitting image, one level, bad magic or a short file return the input unchanged', () => {
  const buf = plainKtx2()
  assert.equal(capKtx2Levels(buf, 0), buf)
  assert.equal(capKtx2Levels(buf, undefined), buf)
  assert.equal(capKtx2Levels(buf, 8), buf)
  const one = buildKtx2({ width: 8, height: 8, levels: [new Uint8Array(4)], dfd: new Uint8Array(4), kvd: new Uint8Array(0) })
  assert.equal(capKtx2Levels(one, 2), one)
  const bad = plainKtx2()
  bad[0] = 0
  assert.equal(capKtx2Levels(bad, 2), bad)
  assert.equal(parseKtx2(bad), null)
  assert.equal(parseKtx2(plainKtx2().slice(0, 79)), null)
  assert.equal(parseKtx2(plainKtx2().slice(0, 100)), null)
})

gate('ktx2-mip-cap quirk kept: a level length past the end of the file is clamped by slice, not refused', () => {
  const buf = plainKtx2()
  new DataView(buf.buffer).setUint32(80 + 24 + 8, 0xffffff, true)
  const src = parseKtx2(buf)
  const out = capKtx2Levels(buf, 4)
  assert.notEqual(out, buf)
  assert.equal(parseKtx2(out).levels[0].byteLength, buf.length - src.levels[1].byteOffset)
})

gate('ktx2-mip-cap quirk kept: a global data offset past the file throws from the parse, which the rebuild guard does not cover', () => {
  const buf = sgdKtx2()
  new DataView(buf.buffer).setUint32(64, buf.length, true)
  assert.throws(() => capKtx2Levels(buf, 4), RangeError)
})

gate('ktx2-mip-cap: device tier caps are 64 for low mobile, 128 for low desktop and for mobile above medium, otherwise none', () => {
  assert.equal(maxTexDimForDeviceTier({ gpuTier: 'low', isMobile: true }), 64)
  assert.equal(maxTexDimForDeviceTier({ gpuTier: 'low', isMobile: false }), 128)
  assert.equal(maxTexDimForDeviceTier({ gpuTier: 'high', isMobile: true }), 128)
  assert.equal(maxTexDimForDeviceTier({ isMobile: true }), 128)
  assert.equal(maxTexDimForDeviceTier({ gpuTier: 'medium', isMobile: true }), undefined)
  assert.equal(maxTexDimForDeviceTier({ gpuTier: 'high', isMobile: false }), undefined)
  assert.equal(maxTexDimForDeviceTier(null), undefined)
  assert.equal(maxTexDimForDeviceTier('low'), undefined)
})

gate('ktx2-mip-cap: the loader patch caps buffers before the original parse and applies only once', () => {
  const seen = []
  const loader = { parse(buffer, onLoad) { seen.push([this === loader, buffer.byteLength, onLoad]); return 'parsed' } }
  assert.equal(applyKtx2DeviceTierCap(loader, { gpuTier: 'low', isMobile: true }), loader)
  assert.equal(loader._deviceTierMaxDim, 64)
  const patched = loader.parse
  assert.equal(applyKtx2DeviceTierCap(loader, { gpuTier: 'high' }), loader)
  assert.equal(loader.parse, patched)
  const big = buildKtx2({ width: 256, height: 256, levels: [new Uint8Array(64), new Uint8Array(16), new Uint8Array(4)], dfd: new Uint8Array(4), kvd: new Uint8Array(0) })
  assert.equal(loader.parse(big, 'cb'), 'parsed')
  assert.deepEqual(seen[0].slice(0, 1).concat(seen[0][2]), [true, 'cb'])
  assert.ok(seen[0][1] < big.byteLength)
  const plain = { parse: (b) => b }
  applyKtx2DeviceTierCap(plain, { gpuTier: 'high' })
  assert.equal(plain._deviceTierMaxDim, undefined)
  assert.equal(plain.parse(big), big)
  assert.equal(applyKtx2DeviceTierCap(null, {}), null)
})

const SOURCES = ['lod-unload-manager.js', 'deferred-load-queue.js', 'material-convergence.js', 'ktx2-mip-cap.js']
const HOSTS = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'console', 'window', 'globalThis', 'require', 'Buffer', 'fetch']
const scan = (text) => {
  const found = []
  if (text.includes('//') || text.includes('/*')) found.push('comment marker')
  if (text.includes('Math.random')) found.push('Math.random')
  for (const piece of text.split("from '").slice(1)) if (!piece.startsWith('.')) found.push('bare import')
  const words = new Set(text.split(/[^A-Za-z0-9_$]/))
  for (const h of HOSTS) if (words.has(h)) found.push(h)
  return found
}

gate('hygiene: the four ports are comment-free, import nothing bare and read no host global', () => {
  for (const name of SOURCES) {
    const text = readFileSync(new URL('../src/packages/streaming-gltf/' + name, import.meta.url), 'utf8')
    assert.deepEqual(scan(text), [], name)
  }
})

gate('hygiene control: the scanner flags a planted comment, bare import and host clock', () => {
  assert.deepEqual(scan("import x from 'node:crypto'\nconst t = performance.now() // c"), ['comment marker', 'bare import', 'performance'])
})

finish()
