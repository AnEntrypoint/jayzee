import { createTerrainStreamer } from '/workspace/spoint/src/terrain/HeightfieldStreamer.js'
import { flightPath, percentile } from './streamer-p99.mjs'

export const EXTENT = 510
export const RESOLUTION = 4
export const INTERVAL_MS = 300
const HEAP_BYTES = 512 * 1024 * 1024

export const analyticHeight = (x, z) => 4 * Math.sin(x / 37) * Math.cos(z / 53) + 2 * Math.sin((x + z) / 191)

export function stubPhysics({ heapFreeBytes = HEAP_BYTES, heapTotalBytes = HEAP_BYTES } = {}) {
  const bodies = new Map()
  let nextId = 1
  let terrainBodyId = null
  return {
    bodies,
    liveWorldCount: 1,
    addHeightField(samples, N, scale, origin) {
      const id = nextId++
      bodies.set(id, { samples, N, scale, origin })
      return id
    },
    removeBody(id) {
      bodies.delete(id)
    },
    setBodyTransform() {},
    setTerrainBodyId(id) {
      terrainBodyId = id
    },
    getTerrainBodyId() {
      return terrainBodyId
    },
    wasmHeapBytes() {
      return { free: heapFreeBytes, total: heapTotalBytes, worlds: 1 }
    },
  }
}

function silenced() {
  const saved = { log: console.log, warn: console.warn, error: console.error }
  const counts = { log: 0, warn: 0, error: 0 }
  for (const key of Object.keys(counts)) console[key] = () => { counts[key] += 1 }
  return { counts, restore: () => Object.assign(console, saved) }
}

export async function coverSteps(path, { heightFn = analyticHeight, physics = stubPhysics(), extent = EXTENT, resolution = RESOLUTION } = {}) {
  let current = null
  const streamer = createTerrainStreamer({
    physics,
    heightFn,
    extent,
    resolution,
    intervalMs: INTERVAL_MS,
    getCenters: () => (current ? [current] : []),
  })
  const logs = silenced()
  const steps = []
  let fieldsAtEnd = 0
  let bodiesAtEnd = 0
  try {
    for (const p of path) {
      current = [p[0], p[2]]
      const started = performance.now()
      await streamer.cover([current])
      steps.push(performance.now() - started)
    }
    fieldsAtEnd = streamer.fields.length
    bodiesAtEnd = physics.bodies.size
  } finally {
    logs.restore()
    streamer.stop()
  }
  return {
    steps,
    builds: streamer.rebuildCount,
    fieldsAtEnd,
    bodiesAtEnd,
    refusals: streamer.refusalCount,
    lastError: streamer.lastError ? streamer.lastError.message : null,
    consoleLines: logs.counts,
    physics,
  }
}

if (process.argv[1] && process.argv[1].endsWith('/scripts/streamer-spoint-p99.mjs')) {
  const ticks = Number(process.argv[2] ?? 6000)
  const path = await flightPath(ticks)
  const run = await coverSteps(path)
  console.log(JSON.stringify({
    side: 'spoint',
    measures: 'HeightfieldStreamer.cover() call time per path point, not frame time',
    heightFn: 'analytic stand-in',
    physics: 'stub',
    ticks,
    samples: run.steps.length,
    builds: run.builds,
    fieldsAtEnd: run.fieldsAtEnd,
    p50Ms: percentile(run.steps, 0.5),
    p99Ms: percentile(run.steps, 0.99),
    maxMs: Math.max(...run.steps),
    refusals: run.refusals,
    lastError: run.lastError,
    consoleLines: run.consoleLines,
  }))
}
