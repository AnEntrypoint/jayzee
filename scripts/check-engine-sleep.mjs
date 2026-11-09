import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const BODIES = 64
const SETTLE_TICKS = 1200
const RADIUS = 0.5
const PLANET = { radius: 6371000, cellSize: 1000, gravity: 9.8, maxHeight: 8000 }
const TRANSFORM_WORDS = 7

const boot = async () => {
  const module = await loadEngineModule(glue)
  assert.equal(module._engine_world_configure(2048, 60, -9.8, 0, RADIUS, 0, 8), 0)
  assert.equal(module._engine_world_add_box(-200, -1, -200, 200, 0, 200), 0)
  for (let i = 0; i < BODIES; i++) {
    const at = [(i % 32) * 2 - 32, 2 + (i % 5), Math.floor(i / 32) * 2 - 16]
    assert.equal(module._engine_spawn(at[0], at[1], at[2], 0, 0, 0), i)
  }
  assert.equal(module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight), 0)
  return module
}

const poses = (module) => new Float32Array(module.HEAPU8.buffer, module._engine_transforms(), BODIES * TRANSFORM_WORDS).slice()

const tickUntilAsleep = (module, limit) => {
  let ticks = 0
  while (ticks < limit && module._engine_sim_active_bodies() > 0) {
    module._engine_tick(1)
    ticks += 1
  }
  return ticks
}

gate('bodies dropped onto the ground under radial gravity fall asleep within 1200 ticks, resting at radius height', async () => {
  const module = await boot()
  assert.equal(module._engine_sim_active_bodies(), BODIES)
  const ticks = tickUntilAsleep(module, SETTLE_TICKS)
  assert.equal(module._engine_sim_active_bodies(), 0, 'after ' + ticks + ' ticks ' + module._engine_sim_active_bodies() + ' bodies are still awake')
  const pose = poses(module)
  for (let i = 0; i < BODIES; i++) {
    const y = pose[i * TRANSFORM_WORDS + 1]
    assert.ok(Math.abs(y - RADIUS) < 0.05, 'body ' + i + ' sleeps at y ' + y + ', not at rest on the ground')
  }
})

gate('a sleeping body is not pulled: no body wakes and no pose moves over 120 more ticks', async () => {
  const module = await boot()
  tickUntilAsleep(module, SETTLE_TICKS)
  const before = poses(module)
  for (let i = 0; i < 120; i++) module._engine_tick(1)
  assert.equal(module._engine_sim_active_bodies(), 0, 'bodies woke while asleep')
  const after = poses(module)
  let drift = 0
  for (let i = 0; i < before.length; i++) drift = Math.max(drift, Math.abs(after[i] - before[i]))
  assert.ok(drift < 1e-4, 'a sleeping pose drifted by ' + drift)
})

gate('a sleeping body wakes when it is moved, and settles on the ground again', async () => {
  const module = await boot()
  tickUntilAsleep(module, SETTLE_TICKS)
  const start = poses(module)
  assert.equal(module._engine_set_position(0, start[0], start[1] + 2, start[2]), 0)
  assert.ok(module._engine_sim_active_bodies() >= 1, 'a moved body did not wake')
  tickUntilAsleep(module, SETTLE_TICKS)
  assert.equal(module._engine_sim_active_bodies(), 0, 'the moved body did not sleep again')
  const landed = poses(module)[1]
  assert.ok(Math.abs(landed - RADIUS) < 0.05, 'the moved body rests at y ' + landed)
})

gate('reconfiguring the planet wakes every live body so each one tests its new support', async () => {
  const module = await boot()
  tickUntilAsleep(module, SETTLE_TICKS)
  assert.equal(module._engine_sim_active_bodies(), 0)
  assert.equal(module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight), 0)
  assert.equal(module._engine_sim_active_bodies(), BODIES, 'the reconfigured planet left bodies asleep')
})

finish()
