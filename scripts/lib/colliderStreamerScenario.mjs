export const RADIUS = 3000

export const HOST = {
  now: () => performance.now(),
  setTimer: (fn, ms) => setTimeout(fn, ms),
  clearTimer: (handle) => clearTimeout(handle),
  yieldToLoop: () => new Promise((resolve) => setImmediate(resolve)),
  cpuUsage: () => process.cpuUsage(),
}
export const LATTICE_SPEC = { CHUNK: 64, GRID: 4 }
export const STREAMER_RADIUS = 150
export const CENTRES = [[0, 0], [90, 0], [-400, 260], [410, -120]]
const EXCLUDE_SUFFIX = ':0'

const TIMING = /[0-9]+\.[0-9]+ms/g

export function makeSampler() {
  return { radius: RADIUS, heightAt: (d) => 6 * Math.sin(2.1 * d[0]) * Math.cos(1.7 * d[2]) + 3 * d[1] - 3 }
}

function hash32(s) {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0
  return h >>> 0
}

export function placementsFor(chunkKey) {
  const key = String(chunkKey)
  const count = 3 + (hash32(key) % 5)
  const out = []
  for (let i = 0; i < count; i++) {
    const h = hash32(key + ':' + i)
    out.push({ id: key + ':' + i, x: (h % 2001) / 2 - 500, z: ((h >>> 11) % 2001) / 2 - 500, k: h & 1 })
  }
  return out
}

export function bodyArgs(p) {
  return {
    shape: 'box',
    args: new Float32Array([0.5, 0.5 + p.k * 0.25, 0.5]),
    position: [p.x, 0, p.z],
    rotation: [0, 0, 0, 1],
    shapeKey: p.k ? 'rock' : 'veg',
  }
}

function recordingPhysics(log, queued) {
  let next = 1
  const bodies = new Map()
  const addBody = (shape, args, position, type, opts) => {
    const id = next++
    bodies.set(id, { position: [...position], rotation: [...opts.rotation] })
    log.push(['add', id, opts.shapeKey, position[0], position[2]])
    return id
  }
  const removeBody = (id, destroy) => {
    bodies.delete(id)
    log.push(['remove', id, destroy === true])
  }
  const physics = {
    addBody,
    removeBody,
    preallocatePool(shape, args, shapeKey, count) { log.push(['prealloc', shapeKey, count]) },
    getBodyPosition(id) { return bodies.get(id).position },
    getBodyRotation(id) { return bodies.get(id).rotation },
    setBodyTransform(id, position, rotation) {
      bodies.set(id, { position: [...position], rotation: [...rotation] })
      log.push(['transform', id, position[0], position[1], position[2]])
    },
  }
  if (queued) {
    physics.enqueueAdd = (shape, args, position, type, opts, done) => {
      const id = addBody(shape, args, position, type, opts)
      done(id)
    }
    physics.enqueueRemove = (id) => removeBody(id, false)
    physics.drainBodyQueue = () => { log.push(['drain']) }
  }
  return physics
}

function captureConsole(messages) {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  const sink = (kind) => (...args) => {
    messages.push(kind + ' ' + args.map((a) => (typeof a === 'string' ? a : String(a?.message ?? a))).join(' ').replace(TIMING, 'Tms'))
  }
  console.log = sink('log')
  console.warn = sink('warn')
  console.error = sink('error')
  return () => { console.log = saved.log; console.warn = saved.warn; console.error = saved.error }
}

function snapshot(label, s, colliderIds, idCalls) {
  return {
    label,
    liveCount: s.liveCount,
    live: [...s._live].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)),
    center: s.center,
    centers: s.centers,
    rebuildCount: s.rebuildCount,
    centerCounts: s.centerCounts,
    droppedCenters: s.droppedCenters,
    cap: s.cap,
    byteBudget: s.byteBudget,
    residentBytes: s.residentBytes,
    chunkKeys: s.chunkKeys,
    chunkCacheSize: s.chunkCacheSize,
    ringCacheSize: s.ringCacheSize,
    newChunks: s.newChunks,
    ringFresh: s.ringFresh,
    examined: s.examined,
    lastExamined: s.lastExamined,
    nearTests: s.nearTests,
    cands: s.cands,
    settledSkips: s.settledSkips,
    ringCounters: { ...s.ringCounters },
    colliderIds: colliderIds.slice(),
    idCalls,
    starvedClusters: s.starvedClusters,
  }
}

export async function runStreamerScenario(deps, { queued = false, maxCenters, cap = 24 } = {}) {
  const { createColliderStreamer, createPlanetFrame, snapshotChart, createChartTransfer } = deps
  const sampler = makeSampler()
  const frame = createPlanetFrame({ sampler, anchorDir: [0, 1, 0] })
  const log = []
  const messages = []
  const restore = captureConsole(messages)
  const physics = recordingPhysics(log, queued)
  const centres = CENTRES.map((c) => c.slice())
  let colliderIds = []
  let idCalls = 0
  const records = []
  try {
    const s = createColliderStreamer({
      physics,
      frame,
      latticeSpec: { ...LATTICE_SPEC },
      idField: 'id',
      placementsFor,
      bodyArgs,
      setColliderIds(ids) {
        colliderIds = [...ids].sort((a, b) => a - b)
        idCalls++
      },
      getCenters: () => centres.map((c) => [c[0], c[1]]),
      radius: STREAMER_RADIUS,
      cap,
      intervalMs: 300000,
      ...HOST,
      logTag: '[gate]',
      ...(maxCenters === undefined ? {} : { maxCenters }),
    })
    await s.start()
    records.push(snapshot('start', s, colliderIds, idCalls))

    await s.refresh()
    records.push(snapshot('refresh-settled', s, colliderIds, idCalls))

    s.setExclude((id) => id.endsWith(EXCLUDE_SUFFIX))
    const swept = s.sweepExcluded()
    s.setExclude(null)
    records.push({ event: 'sweep-excluded', swept, ...snapshot('after-sweep', s, colliderIds, idCalls) })

    const firstId = [...s._live.keys()].sort()[0]
    const released = s.release(firstId)
    records.push({ event: 'release', firstId, released, ...snapshot('after-release', s, colliderIds, idCalls) })

    const frame2 = createPlanetFrame({ sampler, anchorDir: [0.02, 1, -0.03] })
    const from = snapshotChart(frame)
    const to = snapshotChart(frame2)
    const transfer = createChartTransfer(from, to)
    const moved = s.reanchor({ from, to, transfer, epoch: 1 })
    const repeat = s.reanchor({ from, to, transfer, epoch: 1 })
    records.push({ event: 'reanchor', moved, repeat, ...snapshot('after-reanchor', s, colliderIds, idCalls) })

    await s.refresh()
    records.push(snapshot('refresh-after-reanchor', s, colliderIds, idCalls))

    s.stop()
    records.push({ event: 'stop', ...snapshot('after-stop', s, colliderIds, idCalls) })
  } finally {
    restore()
  }
  return { records, log, messages }
}

export function runFieldLatticeScenario(deps) {
  const { createFieldLattice, createPlanetFrame, snapshotChart } = deps
  const sampler = makeSampler()
  const anchor = { up: [0, 1, 0] }
  const liveFrame = createPlanetFrame({ sampler, anchorDir: [0.03, 1, -0.02] })
  const liveHeightFn = (x, z) => {
    if (x === 77) return NaN
    if (x === 78) throw new Error('no height at 78')
    return 0.4 * Math.sin(x * 0.01) + 0.2 * z * 0.001
  }
  const lattice = createFieldLattice({ sampler, offsetY: 0, reliefScale: undefined, anchor, liveFrame, liveHeightFn })
  const corners = [[0, 0], [64, 0], [-128, 64], [300, -200]]
  const latticePts = [[10, 5], [77, 3], [78, 3], [-50, 120]]
  const chartPts = [[10, 5], [-50, 120], [200, -30]]
  return {
    anchor: snapshotChart(createPlanetFrame({ sampler, anchorDir: anchor.up })),
    tiltDeg: lattice.tiltDeg,
    placements: corners.map(([x, z]) => lattice.placement(x, z)),
    toLattice: latticePts.map(([x, z]) => lattice.toLattice(x, z)),
    toChart: chartPts.map(([x, z]) => lattice.toChart(x, z)),
    heightAt: lattice.heightFn(10, 5),
  }
}
