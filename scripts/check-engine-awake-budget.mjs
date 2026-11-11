import { readFileSync } from 'node:fs'
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

const TRANSFORM_WORDS = 7
const HIT_BODY = 2
const hiddenSlots = (module) => {
  const rows = new Float32Array(module.HEAPU8.buffer, module._engine_transforms(), BODIES * TRANSFORM_WORDS)
  const hidden = []
  for (let i = 0; i < BODIES; i++) {
    const at = i * TRANSFORM_WORDS
    if (rows[at + 3] === 0 && rows[at + 4] === 0 && rows[at + 5] === 0 && rows[at + 6] === 0) hidden.push(i)
  }
  return hidden
}
const range = (from, to) => Array.from({ length: to - from }, (_, i) => from + i)
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

gate('a held body is not in the world: its pose carries the zero rotation that the renderer skips, and a ray through it passes', async () => {
  const module = await boot({ budget: BUDGET })
  assert.deepEqual(hiddenSlots(module), range(BUDGET, BODIES))
  const at = positions(module)
  const held = BODIES - 1
  const woken = 0
  const down = (slot) => module._engine_world_raycast(at[slot * POSITION_WORDS], at[slot * POSITION_WORDS + 1] + 3, at[slot * POSITION_WORDS + 2], 0, -3.4, 0)
  assert.equal(down(woken), 1, 'the ray above a woken body hit nothing')
  assert.equal(down(held), 0, 'the ray above a held body hit something')
  const control = await boot()
  assert.deepEqual(hiddenSlots(control), [])
  assert.equal(control._engine_world_raycast(at[held * POSITION_WORDS], at[held * POSITION_WORDS + 1] + 3, at[held * POSITION_WORDS + 2], 0, -3.4, 0), 1, 'control: with no budget the same ray hits the body')
})

gate('a released body gets its pose back on the tick it is released, and no pose is hidden once nothing is held', async () => {
  const module = await boot({ budget: BUDGET })
  let checked = 0
  settle(module, () => {
    const held = module._engine_world_held_bodies()
    assert.equal(hiddenSlots(module).length, held)
    checked += 1
  })
  assert.ok(checked > 100)
  assert.deepEqual(hiddenSlots(module), [])
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

const TUNE_RELEASE_BY_SLOT = 16
const eyeAt = (module, slot, lift) => {
  const at = positions(module)
  return [at[slot * POSITION_WORDS], at[slot * POSITION_WORDS + 1] + lift, at[slot * POSITION_WORDS + 2]]
}
const releasedAfter = (module, ticks) => {
  const start = positions(module)
  for (let i = 0; i < ticks; i++) module._engine_tick(1)
  return movedSlots(start, positions(module))
}
const VIEW_COS = 0.5
const RELEASE_VIEW_MARGIN_COS = 0.15
const distanceTo = (start, slot, eye) => Math.sqrt((start[slot * 3] - eye[0]) ** 2 + (start[slot * 3 + 1] - eye[1]) ** 2 + (start[slot * 3 + 2] - eye[2]) ** 2)

gate('with a release view at the last slot the held bodies nearest the eye are released first, and with no view the lowest slots are', async () => {
  const module = await boot({ budget: BUDGET })
  const start = positions(module)
  const eye = eyeAt(module, BODIES - 1, 3)
  assert.equal(module._engine_world_set_release_view(eye[0], eye[1], eye[2], 0, 0, 0, 1, 1000), 0)
  let wave = []
  for (let guard = 0; guard < SETTLE_TICKS && wave.length === 0; guard++) wave = releasedAfter(module, 1).filter((slot) => slot >= BUDGET)
  assert.ok(wave.length > 0, 'no held body was released')
  const held = range(BUDGET, BODIES)
  const byDistance = held.map((slot) => distanceTo(start, slot, eye)).sort((a, b) => a - b)
  const reach = byDistance[wave.length - 1]
  for (const slot of wave) assert.ok(distanceTo(start, slot, eye) <= reach + 0.01, 'slot ' + slot + ' at ' + distanceTo(start, slot, eye) + ' m was released though ' + wave.length + ' held bodies lie within ' + reach + ' m')
  assert.ok(wave.includes(BODIES - 1) && !wave.includes(BUDGET), 'the wave is ' + wave.slice(0, 8))
  const control = await boot({ budget: BUDGET })
  let plain = []
  for (let guard = 0; guard < SETTLE_TICKS && plain.length === 0; guard++) plain = releasedAfter(control, 1).filter((slot) => slot >= BUDGET)
  assert.deepEqual(plain, range(BUDGET, BUDGET + plain.length))
})

gate('a cone, widened by the release margin, picks the bodies in front of the eye before nearer ones behind it, the slot-order tuning ignores the view, and both runs end at rest', async () => {
  const module = await boot({ budget: BUDGET })
  const start = positions(module)
  const mid = BUDGET + Math.floor((BODIES - BUDGET) / 2)
  const eye = eyeAt(module, mid, 3)
  const ahead = [start[(BODIES - 1) * 3] - eye[0], 0, start[(BODIES - 1) * 3 + 2] - eye[2]]
  assert.equal(module._engine_world_set_release_view(eye[0], eye[1], eye[2], ahead[0], ahead[1], ahead[2], VIEW_COS, 1000), 0)
  let wave = []
  for (let guard = 0; guard < SETTLE_TICKS && wave.length === 0; guard++) wave = releasedAfter(module, 1).filter((slot) => slot >= BUDGET)
  const length = Math.sqrt(ahead[0] ** 2 + ahead[2] ** 2)
  assert.ok(readFileSync(new URL('../engine/src/world.h', import.meta.url), 'utf8').includes('kReleaseViewMarginCos = ' + RELEASE_VIEW_MARGIN_COS + ';'))
  const inCone = (cosine) => (slot) => {
    const d = [start[slot * 3] - eye[0], start[slot * 3 + 1] - eye[1], start[slot * 3 + 2] - eye[2]]
    const far = Math.sqrt(d[0] ** 2 + d[1] ** 2 + d[2] ** 2)
    return (d[0] * ahead[0] + d[2] * ahead[2]) / length >= cosine * far
  }
  const inOrderingCone = inCone(VIEW_COS - RELEASE_VIEW_MARGIN_COS)
  const orderedHeld = range(BUDGET, BODIES).filter(inOrderingCone)
  assert.ok(orderedHeld.length > wave.length, 'the cone holds only ' + orderedHeld.length + ' held bodies, fewer than one wave')
  assert.ok(wave.every(inOrderingCone), 'a body outside the widened cone was released while ' + orderedHeld.length + ' in it were held')
  assert.ok(orderedHeld.length > range(BUDGET, BODIES).filter(inCone(VIEW_COS)).length, 'the margin adds no body, so the gate does not test it')
  const before = module._engine_world_unsettled_in_view()
  assert.ok(before > 0 && before <= BODIES)
  settle(module)
  assert.equal(module._engine_world_unsettled_in_view(), 0)
  assertAtRest(module)
  const bySlot = await boot({ budget: BUDGET })
  assert.equal(bySlot._engine_world_set_tuning(TUNE_RELEASE_BY_SLOT), 0)
  assert.equal(bySlot._engine_world_set_release_view(eye[0], eye[1], eye[2], ahead[0], ahead[1], ahead[2], 0.5, 1000), 0)
  let plain = []
  for (let guard = 0; guard < SETTLE_TICKS && plain.length === 0; guard++) plain = releasedAfter(bySlot, 1).filter((slot) => slot >= BUDGET)
  assert.deepEqual(plain, range(BUDGET, BUDGET + plain.length))
})

gate('the release view read from the frame scratch, as the frame path sets it, releases the same first wave as the one passed by value', async () => {
  const firstWave = async (setView) => {
    const module = await boot({ budget: BUDGET })
    const start = positions(module)
    const mid = BUDGET + Math.floor((BODIES - BUDGET) / 2)
    const eye = eyeAt(module, mid, 3)
    const target = [start[(BODIES - 1) * 3], eye[1], start[(BODIES - 1) * 3 + 2]]
    assert.equal(setView(module, eye, target), 0)
    let wave = []
    for (let guard = 0; guard < SETTLE_TICKS && wave.length === 0; guard++) wave = releasedAfter(module, 1).filter((slot) => slot >= BUDGET)
    return wave
  }
  const byValue = await firstWave((module, eye, target) => module._engine_world_set_release_view(eye[0], eye[1], eye[2], target[0] - eye[0], target[1] - eye[1], target[2] - eye[2], 0.5, 1000))
  const byScratch = await firstWave((module, eye, target) => {
    const at = module._engine_frame_scratch() >> 3
    module.HEAPF64.set([eye[0], eye[1], eye[2], 0, target[0], target[1], target[2], 0.5, 1000], at)
    return module._engine_release_view_scratch()
  })
  assert.ok(byValue.length > 0)
  assert.deepEqual(byScratch, byValue)
})

gate('the release view refuses a value that is not finite, a cone outside -1 to 1 and a range that is not above zero', async () => {
  const module = await boot({ budget: BUDGET })
  for (const bad of [[NaN, 0, 0, 1, 0, 0, 0.5, 10], [0, 0, 0, Infinity, 0, 0, 0.5, 10], [0, 0, 0, 1, 0, 0, 1.5, 10], [0, 0, 0, 1, 0, 0, 0.5, 0], [0, 0, 0, 1, 0, 0, 0.5, NaN]]) {
    assert.notEqual(module._engine_world_set_release_view(...bad), 0, 'accepted ' + bad.join(','))
  }
  assert.equal(module._engine_world_clear_release_view(), 0)
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
