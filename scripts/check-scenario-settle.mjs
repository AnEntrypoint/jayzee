import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const BODIES = 256
const RADIUS = 0.5
const TICKS = 240
const SETTLE_WINDOW = 30
const DRIFT_LIMIT_M = 1e-3
const REST_TOLERANCE_M = 0.01

const scenario = async () => {
  const world = await createEngineWorld({ capacity: BODIES, tickRate: 60, gravity: -9.8, drag: 0, radius: RADIUS, restitution: 0, players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 }, glue)
  const handles = []
  for (let i = 0; i < BODIES; i++) {
    handles.push(world.spawn([(i % 16) * 2 - 15, 2 + (i % 7) * 0.6, Math.floor(i / 16) * 2 - 15]))
  }
  const trail = []
  const p = [0, 0, 0]
  for (let t = 0; t < TICKS; t++) {
    world.step()
    if (t >= TICKS - SETTLE_WINDOW) {
      const frame = new Float64Array(BODIES * 3)
      handles.forEach((handle, i) => {
        world.position(handle, p)
        frame.set(p, i * 3)
      })
      trail.push(frame)
    }
  }
  const finalPositions = Array.from(trail[trail.length - 1])
  return { trail, finalPositions }
}

const first = await scenario()

gate('the 256 bodies settle: every final body sits at the ground radius within tolerance', () => {
  for (let i = 0; i < BODIES; i++) {
    const y = first.finalPositions[i * 3 + 1]
    assert.ok(Math.abs(y - RADIUS) <= REST_TOLERANCE_M, 'body ' + i + ' rests at y ' + y)
  }
})

gate('the settled bodies do not drift horizontally over the last 30 ticks', () => {
  const last = first.trail[first.trail.length - 1]
  const earliest = first.trail[0]
  for (let i = 0; i < BODIES; i++) {
    for (const axis of [0, 2]) {
      const drift = Math.abs(last[i * 3 + axis] - earliest[i * 3 + axis])
      assert.ok(drift <= DRIFT_LIMIT_M, 'body ' + i + ' axis ' + axis + ' drifted ' + drift)
    }
  }
})

gate('two runs of the scenario agree bit for bit on every settled position', async () => {
  const second = await scenario()
  const a = new Float32Array(first.finalPositions)
  const b = new Float32Array(second.finalPositions)
  assert.deepEqual(new Uint32Array(b.buffer), new Uint32Array(a.buffer))
})

finish()
