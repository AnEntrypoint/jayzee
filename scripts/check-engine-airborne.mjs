import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib-timed.mjs')).href
const BODIES = 256
const RADIUS = 0.5
const DROP_M = 40
const EDGE_CLEARANCE_M = 16
const PLANET = { radius: 6371000, cellSize: 1000, gravity: 9.8, maxHeight: 8000 }
const POSITION_WORDS = 3
const TUNE_AIRBORNE = 4
const TUNE_BROADPHASE_INTERVAL = 8
const SETTLE_TICKS = 2400
const MID_TICK = 60

const boot = async (tuning) => {
  const module = await loadEngineModule(glue)
  assert.equal(module._engine_world_configure(2048, 60, -9.8, 0, RADIUS, 0, 8), 0)
  assert.equal(module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight), 0)
  assert.equal(module._engine_world_set_tuning(tuning), 0)
  for (let i = 0; i < BODIES; i++) {
    const x = EDGE_CLEARANCE_M + (i % 32) * 2
    const z = EDGE_CLEARANCE_M + Math.floor(i / 32) * 2
    const y = PLANET.radius + module._engine_planet_height(x, PLANET.radius, z) + DROP_M + (i % 5)
    assert.equal(module._engine_spawn(x, y, z, 0, 0, 0), i)
  }
  return module
}

const positions = (module) => new Float64Array(module.HEAPU8.buffer, module._engine_positions(), BODIES * POSITION_WORDS).slice()
const bits = (values) => Buffer.from(values.buffer).toString('hex')

const run = async (tuning) => {
  const module = await boot(tuning)
  const airborne = []
  let mid = null
  let ticks = 0
  while (ticks < SETTLE_TICKS && (ticks < MID_TICK || module._engine_world_active_bodies() > 0)) {
    module._engine_tick(1)
    ticks += 1
    airborne.push(module._engine_world_airborne_bodies())
    if (ticks === MID_TICK) mid = positions(module)
  }
  return { module, airborne, mid, end: positions(module), ticks }
}

const plain = await run(0)
const skipped = await run(TUNE_AIRBORNE)
const interval = await run(TUNE_BROADPHASE_INTERVAL)
const both = await run(TUNE_AIRBORNE | TUNE_BROADPHASE_INTERVAL)

gate('control: with no tuning no body is ever in the airborne layer', () => {
  assert.equal(Math.max(...plain.airborne), 0)
})

gate('bodies dropped from ' + DROP_M + ' m are all in the airborne layer while they fall and none is once they have landed', () => {
  assert.equal(skipped.airborne[10], BODIES, 'at tick 10 only ' + skipped.airborne[10] + ' of ' + BODIES + ' were airborne')
  assert.equal(skipped.airborne.at(-1), 0)
  assert.ok(skipped.ticks < SETTLE_TICKS, 'not settled after ' + skipped.ticks + ' ticks')
})

gate('skipping the planet pair for airborne bodies changes no position: tick ' + MID_TICK + ' and the resting state equal the plain run bit for bit', () => {
  assert.equal(skipped.ticks, plain.ticks)
  assert.equal(bits(skipped.mid), bits(plain.mid))
  assert.equal(bits(skipped.end), bits(plain.end))
})

gate('rebuilding the broadphase tree every fourth step changes no position, alone or with the airborne skip', () => {
  assert.equal(bits(interval.mid), bits(plain.mid))
  assert.equal(bits(interval.end), bits(plain.end))
  assert.equal(bits(both.mid), bits(plain.mid))
  assert.equal(bits(both.end), bits(plain.end))
})

gate('every body rests on the surface in each run', () => {
  for (const result of [plain, skipped, interval, both]) {
    for (let i = 0; i < BODIES; i++) {
      const height = Math.sqrt(result.end[i * 3] ** 2 + result.end[i * 3 + 1] ** 2 + result.end[i * 3 + 2] ** 2) - PLANET.radius
      assert.ok(Math.abs(height - RADIUS) < 0.05, 'body ' + i + ' rests ' + height + ' m above the surface')
    }
  }
})

gate('a body moved into the ground from the air is back in the grounded layer on the next tick, and switching the tuning off clears the airborne layer', async () => {
  const module = await boot(TUNE_AIRBORNE)
  for (let i = 0; i < 5; i++) module._engine_tick(1)
  assert.equal(module._engine_world_airborne_bodies(), BODIES)
  const at = positions(module)
  const ground = PLANET.radius + module._engine_planet_height(at[0], PLANET.radius, at[2])
  assert.equal(module._engine_set_position(0, at[0], ground + RADIUS, at[2]), 0)
  module._engine_tick(1)
  assert.equal(module._engine_world_airborne_bodies(), BODIES - 1)
  assert.equal(module._engine_world_set_tuning(0), 0)
  assert.equal(module._engine_world_airborne_bodies(), 0)
})

gate('an unknown tuning bit is refused', async () => {
  const module = await boot(0)
  assert.notEqual(module._engine_world_set_tuning(1 << 20), 0)
})

finish()
