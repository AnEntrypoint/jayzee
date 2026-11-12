import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { STATIC_COLLIDERS_MIGRATING, createQueries } from '../src/world/query.js'
import { RAYCAST_UNAVAILABLE, createAppRuntime } from '../src/apps/appRuntime.js'

const TICK_DT = 1 / 64
const BOXES = [[9, -1, -1, 10, 1, 1]]

const build = ({ boxes = BOXES, withQueries = true } = {}) => {
  const world = new World({ capacity: 8, gravity: 0, drag: 0, radius: 0.5 })
  const queries = createQueries(world, { radius: 0.5, boxes })
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8, world, queries: withQueries ? queries : null })
  runtime.registerApp('eye', { server: {} })
  const spawn = (position, name) => runtime.spawn({ app: 'eye', name, body: world.spawn(position) })
  return { world, queries, runtime, spawn }
}

gate('ctx.raycast(origin, direction, maxDistance) returns the nearest body with its entity id, distance, hit point and normal', () => {
  const { runtime, spawn } = build()
  const eye = spawn([0, 0, 0], 'eye')
  const target = spawn([4, 0, 0], 'target')
  spawn([7, 0, 0], 'behind')
  const hit = runtime.contextOf(eye).raycast([0, 0, 0], [1, 0, 0], 20)
  assert.equal(hit.hit, true)
  assert.equal(hit.kind, 'body')
  assert.equal(hit.entity, target)
  assert.ok(Math.abs(hit.distance - 3.5) < 1e-9, 'distance ' + hit.distance)
  assert.deepEqual(hit.position.map((x) => Math.round(x * 10) / 10), [3.5, 0, 0])
  assert.deepEqual(hit.normal.map(Math.round), [-1, 0, 0])
})

gate('the ray skips the body of the entity that casts it, so a ray from its own centre sees what is in front', () => {
  const { runtime, queries, spawn } = build()
  const eye = spawn([0, 0, 0], 'eye')
  const target = spawn([4, 0, 0], 'target')
  assert.equal(queries.raycast([0, 0, 0], [1, 0, 0], 20).id, 0)
  assert.equal(runtime.contextOf(eye).raycast([0, 0, 0], [1, 0, 0], 20).entity, target)
  assert.equal(runtime.contextOf(target).raycast([0, 0, 0], [1, 0, 0], 20).entity, eye)
})

gate('a ray that reaches static geometry first reports the box with no entity, and maxDistance cuts the ray short', () => {
  const { runtime, spawn } = build()
  const eye = spawn([0, 0, 0], 'eye')
  const ctx = runtime.contextOf(eye)
  const wall = ctx.raycast([0, 0, 0], [1, 0, 0], 20)
  assert.deepEqual([wall.hit, wall.kind, wall.entity, wall.body, wall.distance], [true, 'box', null, null, 9])
  const short = ctx.raycast([0, 0, 0], [1, 0, 0], 5)
  assert.equal(short.hit, false)
  assert.equal(short.entity, null)
})

gate('the ray follows a body after kernel steps and stops reporting an entity once it is destroyed', () => {
  const { world, runtime, spawn } = build({ boxes: [] })
  const eye = spawn([0, 0.5, 0], 'eye')
  const target = spawn([4, 5.5, 0], 'target')
  const ctx = runtime.contextOf(eye)
  assert.equal(ctx.raycast([0, 0.5, 0], [1, 0, 0], 20).hit, false)
  world.setVelocity(1, [0, -5, 0])
  for (let i = 0; i < 64; i++) world.step()
  assert.equal(ctx.raycast([0, 0.5, 0], [1, 0, 0], 20).entity, target)
  runtime.destroy(target)
  const after = ctx.raycast([0, 0.5, 0], [1, 0, 0], 20)
  assert.equal(after.entity, null)
})

gate('a ray that would cross a migrating static collider is reported unavailable through ctx.raycast, not answered as a miss', () => {
  const { runtime, queries, spawn } = build()
  const eye = spawn([0, 0, 0], 'eye')
  queries.park(0)
  const hit = runtime.contextOf(eye).raycast([0, 0, 0], [1, 0, 0], 20)
  assert.equal(hit.hit, false)
  assert.equal(hit.unavailable, STATIC_COLLIDERS_MIGRATING)
})

gate('ctx.raycast refuses by name when the runtime has no query module, and refuses a zero direction', () => {
  const bare = build({ withQueries: false })
  const eye = bare.spawn([0, 0, 0], 'eye')
  assert.throws(() => bare.runtime.contextOf(eye).raycast([0, 0, 0], [1, 0, 0], 5), { code: RAYCAST_UNAVAILABLE })
  const full = build()
  const other = full.spawn([0, 0, 0], 'eye')
  assert.throws(() => full.runtime.contextOf(other).raycast([0, 0, 0], [0, 0, 0], 5), RangeError)
})

gate('a hook can raycast during update and act on the entity it hit', () => {
  const { world, queries } = build({ boxes: [] })
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8, world, queries })
  const tagged = []
  runtime.registerApp('turret', { server: { update: (ctx) => { const hit = ctx.raycast(ctx.entity.position, [1, 0, 0], 50); if (hit.entity !== null) tagged.push(ctx.world.getEntity(hit.entity).name) } } })
  runtime.registerApp('drone', { server: {} })
  runtime.spawn({ app: 'turret', body: world.spawn([0, 0, 0]) })
  runtime.spawn({ app: 'drone', name: 'drone-1', body: world.spawn([6, 0, 0]) })
  runtime.tick(0)
  assert.deepEqual(tagged, ['drone-1'])
})

finish()
