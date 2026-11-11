import { createEngineWorld } from '../../src/engine/EngineWorld.js'
import { solverIterationsFor } from '../../src/engine/solverIterations.js'

export const STATE_TIER = Object.freeze({ players: 1024, capacity: 10240, ticks: 120, budgetBytes: 536870912 })
export const STATE_KEY = 'tier1024-solver' + solverIterationsFor(STATE_TIER.players)
export const FIXED_GLUE = 'engine/out/engine-core-512mib.mjs'
export const THREADED_GLUE = 'engine/out/engine-core-512mib-threads.mjs'
export const THREADED_WORKERS = 4
export const THREAD_COUNTS = Object.freeze([2, 4, 7, 8])

export const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

export const fnvWords = (hash, words) => {
  let h = hash
  for (let i = 0; i < words.length; i++) {
    h ^= words[i]
    h = Math.imul(h, FNV_PRIME) >>> 0
  }
  return h
}

export const positionWords = (positions) => {
  const floats = new Float32Array(positions)
  return new Uint32Array(floats.buffer)
}

export const stateHash = (positions) => fnvWords(FNV_OFFSET, positionWords(positions)).toString(16).padStart(8, '0')

export const runStateScenario = async (glue, workers) => {
  const world = await createEngineWorld({
    capacity: STATE_TIER.capacity,
    tickRate: 60,
    gravity: -9.8,
    drag: 0,
    radius: 0.5,
    restitution: 0,
    players: STATE_TIER.players,
    workers,
    budgetBytes: STATE_TIER.budgetBytes,
  }, glue)
  const handles = []
  for (let i = 0; i < STATE_TIER.capacity; i++) {
    const x = (i % 128) - 64
    const z = Math.floor(i / 128) - 40
    const y = 2 + (i % 7) * 0.6
    handles.push(world.spawn([x, y, z], [0.3 * Math.sin(i), 0, 0.3 * Math.cos(i)]))
  }
  for (let t = 0; t < STATE_TIER.ticks; t++) world.step()
  const out = []
  const p = [0, 0, 0]
  for (const handle of handles) {
    world.position(handle, p)
    out.push(p[0], p[1], p[2])
  }
  return out
}
