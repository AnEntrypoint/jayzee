import { createEngineWorld } from '../src/engine/EngineWorld.js'

export const R = 1000
export const CELL = 100
export const MAX_HEIGHT = 50
export const SPAWN = [0, R + 50, 0]
export const VELOCITY = [30, 0, 0]
export const PAGE_FLOATS = 256
export const RESIDENT_PAGES = 4

export function percentile(values, q) {
  if (values.length === 0) throw new RangeError('percentile needs at least one value')
  if (!(q >= 0 && q <= 1)) throw new RangeError('q must be between 0 and 1')
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))]
}

export async function planetWorld() {
  const world = await createEngineWorld({ capacity: 64 })
  world.configurePlanet({ radius: R, cellSize: CELL, gravity: 9.8, maxHeight: MAX_HEIGHT })
  return world
}

export async function flightPath(ticks) {
  const world = await planetWorld()
  const handle = world.spawn(SPAWN, VELOCITY)
  const path = []
  for (let t = 0; t < ticks; t++) {
    world.step()
    path.push(world.position(handle))
  }
  return path
}

export function newStreamerState() {
  return { page: new Float32Array(PAGE_FLOATS), resident: [], lastKey: null }
}

export function streamerPass(world, path, state) {
  const steps = []
  for (const p of path) {
    const started = performance.now()
    const cell = world.locateCell(p)
    const key = world.cellKey(cell.face, cell.cx, cell.cy)
    if (key !== state.lastKey) {
      world.writePage(key, state.page)
      state.resident.push(key)
      if (state.resident.length > RESIDENT_PAGES) world.releasePage(state.resident.shift())
      state.lastKey = key
    }
    steps.push(performance.now() - started)
  }
  return steps
}

export async function streamerSteps(path) {
  const world = await planetWorld()
  return { steps: streamerPass(world, path, newStreamerState()) }
}

if (process.argv[1] && process.argv[1].endsWith('/scripts/streamer-p99.mjs')) {
  const ticks = Number(process.argv[2] ?? 6000)
  const path = await flightPath(ticks)
  const { steps } = await streamerSteps(path)
  console.log(JSON.stringify({ ticks, samples: steps.length, p50Ms: percentile(steps, 0.5), p99Ms: percentile(steps, 0.99), maxMs: Math.max(...steps) }))
}
