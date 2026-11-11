import { createEngineWorld } from '../../src/engine/EngineWorld.js'

export const THREADS_BODIES = 256
export const THREADS_TICKS = 600
export const THREADS_PLAYERS = 64
export const THREADS_WORLD = Object.freeze({ capacity: 512, tickRate: 60, gravity: -9.8, drag: 0.1, radius: 0.35, restitution: 0.2, iterations: 8, players: THREADS_PLAYERS, budgetBytes: 67108864 })

export const runThreadsScenario = async (glue, workers) => {
  const world = await createEngineWorld({ ...THREADS_WORLD, workers }, glue)
  const handles = []
  for (let i = 0; i < THREADS_BODIES; i++) {
    handles.push(world.spawn([(i % 16) - 8, 2 + (i % 5) * 0.4, Math.floor(i / 16) - 8], [0.3 * Math.sin(i), 0, 0.3 * Math.cos(i)]))
  }
  for (let t = 0; t < THREADS_TICKS; t++) world.step()
  const out = []
  for (const handle of handles) {
    const p = [0, 0, 0]
    world.position(handle, p)
    out.push(p[0], p[1], p[2])
  }
  return out
}
