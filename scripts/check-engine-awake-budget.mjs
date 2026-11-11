import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { loadEngineModule } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib-timed.mjs')).href
const BODIES = 256
const BUDGET = 64
const SETTLE_TICKS = 4000
const RADIUS = 0.5
const PLANET = { radius: 6371000, cellSize: 1000, gravity: 9.8, maxHeight: 8000 }
const POSITION_WORDS = 3
const DEFAULT_POINT_SLEEP_SPEED = 0.03
const refused = (status) => status !== 0

const boot = async (settings = {}) => {
  const module = await loadEngineModule(glue)
  assert.equal(module._engine_world_configure(2048, 60, -9.8, 0, RADIUS, 0, 8), 0)
  assert.equal(module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight), 0)
  if (settings.budget !== undefined) assert.equal(module._engine_world_set_awake_budget(settings.budget), 0)
  if (settings.asleep) assert.equal(module._engine_world_set_spawn_asleep(1), 0)
  if (settings.sleep !== undefined) assert.equal(module._engine_world_set_sleep(settings.sleep, DEFAULT_POINT_SLEEP_SPEED), 0)
  for (let i = 0; i < BODIES; i++) {
    const x = (i % 32) * 2 - 32
    const z = Math.floor(i / 32) * 2 - 16
    const y = PLANET.radius + module._engine_planet_height(x, PLANET.radius, z) + 2 + (i % 5)
    assert.equal(module._engine_spawn(x, y, z, 0, 0, 0), i)
  }
  return module
}

const positions = (module) => new Float64Array(module.HEAPU8.buffer, module._engine_positions(), BODIES * POSITION_WORDS).slice()
const heightOf = (at, i) => Math.sqrt(at[i * POSITION_WORDS] ** 2 + at[i * POSITION_WORDS + 1] ** 2 + at[i * POSITION_WORDS + 2] ** 2) - PLANET.radius
const movedSlots = (start, now) => {
  const moved = []
  for (let i = 0; i < BODIES; i++) if (now[i * POSITION_WORDS + 1] !== start[i * POSITION_WORDS + 1]) moved.push(i)
  return moved
}

const settle = (module, each = () => {}) => {
  let ticks = 0
  while (ticks < SETTLE_TICKS && (module._engine_world_active_bodies() > 0 || module._engine_world_held_bodies() > 0)) {
    module._engine_tick(1)
    ticks += 1
    each(ticks)
  }
  return ticks
}

const assertAtRest = (module) => {
  const at = positions(module)
  for (let i = 0; i < BODIES; i++) assert.ok(Math.abs(heightOf(at, i) - RADIUS) < 0.05, 'body ' + i + ' ends ' + heightOf(at, i) + ' m above the surface')
}

gate('control: with no budget every spawned body is awake and none is held', async () => {
  const module = await boot()
  assert.equal(module._engine_world_active_bodies(), BODIES)
  assert.equal(module._engine_world_held_bodies(), 0)
  module._engine_tick(1)
  assert.equal(module._engine_world_active_bodies(), BODIES)
})

gate('a budget of ' + BUDGET + ' wakes the first ' + BUDGET + ' spawns and holds the other ' + (BODIES - BUDGET) + ' where they were spawned', async () => {
  const module = await boot({ budget: BUDGET })
  assert.equal(module._engine_world_active_bodies(), BUDGET)
  assert.equal(module._engine_world_held_bodies(), BODIES - BUDGET)
  const start = positions(module)
  for (let i = 0; i < 20; i++) module._engine_tick(1)
  const moved = movedSlots(start, positions(module))
  assert.deepEqual(moved, Array.from({ length: BUDGET }, (_, i) => i))
})

gate('the awake count never passes the budget, held bodies are released in slot order, and every body ends at rest with none held', async () => {
  const module = await boot({ budget: BUDGET })
  const start = positions(module)
  let peak = 0
  let checks = 0
  let waves = 0
  let lastHeld = BODIES - BUDGET
  const ticks = settle(module, () => {
    peak = Math.max(peak, module._engine_world_active_bodies())
    const held = module._engine_world_held_bodies()
    assert.ok(held <= lastHeld, 'the held count rose from ' + lastHeld + ' to ' + held)
    if (held < lastHeld) waves += 1
    lastHeld = held
    const now = positions(module)
    const moved = movedSlots(start, now)
    for (let i = 0; i < moved.length; i++) assert.equal(moved[i], i, 'slot ' + moved[i] + ' moved before slot ' + i)
    assert.ok(moved.length >= BODIES - held - BUDGET, 'released bodies are not moving')
    checks += 1
  })
  assert.ok(peak <= BUDGET, 'peak awake count ' + peak + ' is over the budget ' + BUDGET)
  assert.equal(peak, BUDGET)
  assert.ok(waves >= 3, 'the held bodies left in ' + waves + ' steps, fewer than the three later waves')
  assert.ok(ticks < SETTLE_TICKS, 'not settled after ' + ticks + ' ticks')
  assert.ok(checks > 100)
  assert.equal(module._engine_world_held_bodies(), 0)
  assert.equal(module._engine_world_active_bodies(), 0)
  assertAtRest(module)
})

gate('two worlds with the same budget give the same positions bit for bit at tick 150 and at rest, and the budget changes the path against the control', async () => {
  const run = async (settings) => {
    const module = await boot(settings)
    for (let i = 0; i < 150; i++) module._engine_tick(1)
    const mid = positions(module)
    settle(module)
    return { mid, end: positions(module) }
  }
  const [first, second, control] = [await run({ budget: BUDGET }), await run({ budget: BUDGET }), await run({})]
  const bits = (values) => Buffer.from(values.buffer).toString('hex')
  assert.equal(bits(first.mid), bits(second.mid))
  assert.equal(bits(first.end), bits(second.end))
  assert.notEqual(bits(first.mid), bits(control.mid), 'the budget did not change the state at tick 150, so it is not being applied')
})

gate('setting a velocity or a position on a held body releases that body alone', async () => {
  const module = await boot({ budget: BUDGET })
  const held = BODIES - BUDGET
  assert.equal(module._engine_set_velocity(BODIES - 1, 0, 1, 0), 0)
  assert.equal(module._engine_world_held_bodies(), held - 1)
  assert.equal(module._engine_world_active_bodies(), BUDGET + 1)
  const start = positions(module)
  assert.equal(module._engine_set_position(BODIES - 2, start[(BODIES - 2) * POSITION_WORDS], start[(BODIES - 2) * POSITION_WORDS + 1] + 1, start[(BODIES - 2) * POSITION_WORDS + 2]), 0)
  assert.equal(module._engine_world_held_bodies(), held - 2)
  assert.equal(module._engine_world_active_bodies(), BUDGET + 2)
  settle(module)
  assert.equal(module._engine_world_held_bodies(), 0)
  assertAtRest(module)
})

gate('reconfiguring the planet leaves held bodies held and wakes the released ones that had gone to sleep', async () => {
  const module = await boot({ budget: BUDGET })
  let ticks = 0
  while (ticks < SETTLE_TICKS && module._engine_world_held_bodies() > BODIES - 2 * BUDGET) {
    module._engine_tick(1)
    ticks += 1
  }
  while (ticks < SETTLE_TICKS && module._engine_world_active_bodies() === BUDGET) {
    module._engine_tick(1)
    ticks += 1
  }
  const held = module._engine_world_held_bodies()
  const awake = module._engine_world_active_bodies()
  assert.ok(held > 0 && awake < BUDGET, 'no moment with held bodies and sleeping released ones: held ' + held + ', awake ' + awake)
  assert.equal(module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight), 0)
  assert.equal(module._engine_world_held_bodies(), held)
  assert.equal(module._engine_world_active_bodies(), BODIES - held)
})

gate('a budget lifted to zero releases every held body on the next tick', async () => {
  const module = await boot({ budget: BUDGET })
  assert.equal(module._engine_world_set_awake_budget(0), 0)
  module._engine_tick(1)
  assert.equal(module._engine_world_held_bodies(), 0)
  assert.equal(module._engine_world_active_bodies(), BODIES)
})

gate('spawn-asleep bodies stay where they were spawned, none is held, and a moved one wakes and lands', async () => {
  const module = await boot({ asleep: true })
  assert.equal(module._engine_world_active_bodies(), 0)
  assert.equal(module._engine_world_held_bodies(), 0)
  const start = positions(module)
  for (let i = 0; i < 120; i++) module._engine_tick(1)
  assert.deepEqual(movedSlots(start, positions(module)), [])
  assert.equal(module._engine_set_velocity(7, 0, -1, 0), 0)
  assert.equal(module._engine_world_active_bodies(), 1)
  settle(module)
  const end = positions(module)
  assert.deepEqual(movedSlots(start, end), [7])
  assert.ok(Math.abs(heightOf(end, 7) - RADIUS) < 0.05)
})

gate('the sleep delay refuses zero, a negative and NaN, and a shorter delay puts the world to sleep sooner', async () => {
  const probe = await boot()
  for (const bad of [0, -1, NaN]) {
    assert.ok(refused(probe._engine_world_set_sleep(bad, DEFAULT_POINT_SLEEP_SPEED)), 'a delay of ' + bad + ' was accepted')
    assert.ok(refused(probe._engine_world_set_sleep(0.5, bad)), 'a point speed of ' + bad + ' was accepted')
  }
  const slow = settle(await boot({ sleep: 0.5 }))
  const fast = settle(await boot({ sleep: 0.15 }))
  assert.ok(fast + 10 <= slow, 'a 0.15 s delay slept after ' + fast + ' ticks and a 0.5 s delay after ' + slow)
})

gate('the settings are refused before the world is configured', async () => {
  const module = await loadEngineModule(glue)
  assert.notEqual(module._engine_world_set_awake_budget(BUDGET), 0)
  assert.notEqual(module._engine_world_set_spawn_asleep(1), 0)
  assert.notEqual(module._engine_world_set_sleep(0.25, DEFAULT_POINT_SLEEP_SPEED), 0)
})

finish()
