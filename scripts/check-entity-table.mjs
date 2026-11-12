import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { ENTITY_SLOT_LIMIT, ENTITY_TABLE_FULL, createEntityTable, entityGeneration, entitySlot } from '../src/apps/entityTable.js'
import { createAppRuntime } from '../src/apps/appRuntime.js'

const TICK_DT = 1 / 64

gate('spawn hands out slots lowest first and a handle reads back the position, velocity, rotation, tag and model it was given', () => {
  const table = createEntityTable({ capacity: 4 })
  const a = table.spawn({ position: [1, 2, 3], velocity: [4, 5, 6], tag: 'crate', model: 'crate.glb', custom: { hp: 3 } })
  const b = table.spawn({ name: 'door' })
  assert.deepEqual([a, b], [0, 1])
  const handle = table.getEntity(a)
  assert.deepEqual(handle.position, [1, 2, 3])
  assert.deepEqual(handle.velocity, [4, 5, 6])
  assert.deepEqual(handle.rotation, [0, 0, 0, 1])
  assert.equal(handle.tag, 'crate')
  assert.equal(handle.model, 'crate.glb')
  assert.deepEqual(handle.custom, { hp: 3 })
  assert.equal(table.getEntity('door').id, b)
  assert.equal(table.count, 2)
})

gate('destroy frees the slot, a reused slot gets a new generation, and the stale id and the stale handle both stop resolving', () => {
  const table = createEntityTable({ capacity: 2 })
  const first = table.spawn({ position: [1, 0, 0] })
  const stale = table.getEntity(first)
  assert.equal(table.destroy(first), true)
  assert.equal(table.destroy(first), false)
  const second = table.spawn({ position: [7, 0, 0] })
  assert.equal(entitySlot(second), entitySlot(first))
  assert.equal(entityGeneration(second), entityGeneration(first) + 1)
  assert.equal(second, first + ENTITY_SLOT_LIMIT)
  assert.equal(table.getEntity(first), null)
  assert.equal(stale.alive, false)
  assert.throws(() => stale.position, { code: 'ENTITY_DESTROYED' })
  assert.throws(() => { stale.position = [0, 0, 0] }, { code: 'ENTITY_DESTROYED' })
  assert.deepEqual(table.getEntity(second).position, [7, 0, 0])
})

gate('a full table refuses the next spawn by name and allocates nothing more, and a freed slot is usable again', () => {
  const table = createEntityTable({ capacity: 3 })
  const ids = [table.spawn(), table.spawn(), table.spawn()]
  assert.throws(() => table.spawn(), { code: ENTITY_TABLE_FULL })
  assert.equal(table.count, 3)
  table.destroy(ids[1])
  assert.equal(entitySlot(table.spawn()), 1)
})

gate('query filters by tag, by app and by reach, writes ids in slot order into the caller buffer and reports the full match count', () => {
  const table = createEntityTable({ capacity: 8 })
  const near = table.spawn({ tag: 'coin', position: [1, 0, 0] })
  table.spawn({ tag: 'wall', position: [2, 0, 0] })
  const far = table.spawn({ tag: 'coin', position: [50, 0, 0] })
  const wide = table.spawn({ tag: 'coin', position: [6, 0, 0], radius: 2 })
  const out = new Int32Array(8)
  assert.equal(table.query({ tag: 'coin' }, out), 3)
  assert.deepEqual([...out.subarray(0, 3)], [near, far, wide])
  assert.equal(table.query({ tag: 'coin', center: [0, 0, 0], reach: 4 }, out), 2)
  assert.deepEqual([...out.subarray(0, 2)], [near, wide])
  assert.equal(table.query({ tag: 'nothing' }, out), 0)
  const small = new Int32Array(1)
  assert.equal(table.query({}, small), 4)
  assert.equal(small[0], near)
  assert.throws(() => table.query({ tag: 'coin' }))
})

gate('an entity bound to a World body reads the body after kernel steps and writes through to it', () => {
  const world = new World({ capacity: 4, gravity: 0, drag: 0, radius: 0.5 })
  const body = world.spawn([0, 10, 0], [2, 0, 0])
  const table = createEntityTable({ capacity: 4, world })
  const id = table.spawn({ body })
  for (let i = 0; i < 64; i++) world.step()
  const handle = table.getEntity(id)
  assert.ok(Math.abs(handle.position[0] - 2) < 1e-3, 'x after one second is ' + handle.position[0])
  handle.position = [5, 5, 5]
  assert.deepEqual(world.position(body), [5, 5, 5])
  assert.throws(() => createEntityTable({ capacity: 2 }).spawn({ body: 0 }), TypeError)
})

gate('ctx.world spawn, destroy, getEntity and query work from inside an app hook, and an entity spawned in a tick first updates on the next tick', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8 })
  const seen = []
  runtime.registerApp('bullet', { server: { update: (ctx) => seen.push(['bullet', ctx.time.tick]) } })
  runtime.registerApp('gun', {
    server: {
      update: (ctx) => {
        if (ctx.time.tick === 0) ctx.state.shot = ctx.world.spawn({ app: 'bullet', tag: 'bullet', name: 'shot' })
        if (ctx.time.tick === 2) ctx.world.destroy('shot')
        seen.push(['gun', ctx.time.tick, ctx.world.query({ tag: 'bullet' }).length, ctx.world.getEntity('shot') !== null])
      },
    },
  })
  runtime.spawn({ app: 'gun' })
  for (let t = 0; t < 4; t++) runtime.tick(t)
  assert.deepEqual(seen, [
    ['gun', 0, 1, true],
    ['gun', 1, 1, true],
    ['bullet', 1],
    ['gun', 2, 0, false],
    ['gun', 3, 0, false],
  ])
})

gate('the table refuses a bad capacity, a bad vector, a duplicate name and a non-object custom', () => {
  assert.throws(() => createEntityTable({ capacity: 0 }), RangeError)
  assert.throws(() => createEntityTable({ capacity: ENTITY_SLOT_LIMIT + 1 }), RangeError)
  const table = createEntityTable({ capacity: 2 })
  assert.throws(() => table.spawn({ position: [0, 0] }), TypeError)
  assert.throws(() => table.spawn({ position: [0, NaN, 0] }), TypeError)
  assert.throws(() => table.spawn({ custom: [] }), TypeError)
  table.spawn({ name: 'a' })
  assert.throws(() => table.spawn({ name: 'a' }), RangeError)
  assert.equal(table.count, 1)
})

gate('spawn and destroy over a full churn leave the typed stores at their first size', () => {
  const table = createEntityTable({ capacity: 16 })
  const before = Object.values(table.views).map((view) => view.length)
  for (let round = 0; round < 200; round++) {
    const ids = []
    for (let i = 0; i < 16; i++) ids.push(table.spawn({ radius: 1 }))
    for (const id of ids) table.destroy(id)
  }
  assert.deepEqual(Object.values(table.views).map((view) => view.length), before)
  assert.equal(table.count, 0)
})

finish()
