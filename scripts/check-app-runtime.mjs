import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { APP_INVALID, APP_RUNTIME_PHASES, APP_UNKNOWN, createAppRuntime } from '../src/apps/appRuntime.js'
import { EventBus } from '../src/apps/EventBus.js'

const TICK_DT = 1 / 64

const tracer = (log, name) => ({
  server: {
    setup: (ctx) => log.push(name + ':setup'),
    update: (ctx) => log.push(name + ':update'),
    teardown: (ctx) => log.push(name + ':teardown'),
    onCollision: (ctx) => log.push(name + ':collision'),
    onInteract: (ctx) => log.push(name + ':interact'),
    onMessage: (ctx) => log.push(name + ':message'),
  },
})

gate('the lifecycle of one entity is setup at spawn, update each tick, teardown at destroy, and nothing after', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  const log = []
  runtime.registerApp('a', tracer(log, 'a'))
  const id = runtime.spawn({ app: 'a' })
  runtime.tick(0)
  assert.equal(runtime.destroy(id), true)
  assert.equal(runtime.destroy(id), false)
  runtime.tick(1)
  assert.deepEqual(log, ['a:setup', 'a:update', 'a:teardown'])
  assert.equal(runtime.count, 0)
})

gate('one tick runs its phases in the published order: update, timers, collisions, interactions, messages', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const log = []
  const def = tracer(log, 'a')
  def.server.setup = (ctx) => ctx.time.every(TICK_DT, () => log.push('a:timer'))
  runtime.registerApp('a', def)
  const one = runtime.spawn({ app: 'a', radius: 1 })
  runtime.spawn({ app: 'a', radius: 1 })
  runtime.message(one, {})
  runtime.interact(one, {})
  runtime.tick(1)
  assert.deepEqual(log, ['a:update', 'a:update', 'a:timer', 'a:timer', 'a:collision', 'a:collision', 'a:interact', 'a:message'])
  assert.deepEqual([...APP_RUNTIME_PHASES], ['update', 'timers', 'collisions', 'interactions', 'messages'])
})

gate('entities update in slot order, and each ctx carries its own entity, state, time and the shared world and bus', () => {
  const bus = new EventBus({ now: () => 0, error: () => {}, warn: () => {} })
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4, bus })
  const order = []
  runtime.registerApp('a', { server: { update: (ctx) => { order.push(ctx.entity.id); ctx.state.n = (ctx.state.n ?? 0) + 1 } } })
  const ids = [runtime.spawn({ app: 'a', config: { speed: 2 } }), runtime.spawn({ app: 'a' }), runtime.spawn({ app: 'a' })]
  runtime.tick(0)
  runtime.tick(1)
  assert.deepEqual(order, [...ids, ...ids])
  const first = runtime.contextOf(ids[0])
  const second = runtime.contextOf(ids[1])
  assert.equal(first.state.n, 2)
  assert.notEqual(first.state, second.state)
  assert.equal(first.world, second.world)
  assert.equal(first.bus, bus)
  assert.deepEqual(first.config, { speed: 2 })
  assert.equal(first.entity.id, ids[0])
})

gate('a tick that does not advance is refused, so no entity updates twice on one tick', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  let updates = 0
  runtime.registerApp('a', { server: { update: () => { updates += 1 } } })
  runtime.spawn({ app: 'a' })
  runtime.tick(3)
  assert.throws(() => runtime.tick(3), RangeError)
  assert.throws(() => runtime.tick(2), RangeError)
  assert.equal(updates, 1)
})

gate('an unknown app is refused at spawn by name, a duplicate registration is refused, and an invalid module registers nothing', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  assert.throws(() => runtime.spawn({ app: 'ghost' }), { code: APP_UNKNOWN })
  assert.equal(runtime.count, 0)
  runtime.registerApp('a', { server: {} })
  assert.throws(() => runtime.registerApp('a', { server: {} }), RangeError)
  assert.throws(() => runtime.registerApp('b', { server: { tick: () => {} } }), { code: APP_INVALID })
  assert.deepEqual(runtime.appNames(), ['a'])
  assert.equal(runtime.hasApp('b'), false)
})

gate('a setup that throws is recorded with its entity and hook, and the entity stays live and keeps updating', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  let updates = 0
  runtime.registerApp('a', { server: { setup: () => { throw new Error('no setup') }, update: () => { updates += 1 } } })
  const id = runtime.spawn({ app: 'a' })
  runtime.tick(0)
  assert.deepEqual(runtime.errors.map((entry) => [entry.id, entry.hook, entry.message]), [[id, 'setup', 'no setup']])
  assert.equal(updates, 1)
})

gate('two runs of the same script of spawns, destroys, timers and contacts produce the same event log', () => {
  const run = () => {
    const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 16 })
    const log = []
    runtime.registerApp('mote', {
      server: {
        setup: (ctx) => ctx.time.every(3 * TICK_DT, () => log.push('t' + ctx.entity.id)),
        update: (ctx) => {
          const p = ctx.entity.position
          ctx.entity.position = [p[0] + ctx.state.vx, 0, 0]
          if (ctx.time.tick === 20 && ctx.entity.id % 2 === 0) ctx.world.spawn({ app: 'mote', position: [0, 0, 0], radius: 0.5, state: { vx: 0.05 } })
          if (ctx.time.tick === 30 && ctx.entity.id % 3 === 0) ctx.world.destroy(ctx.entity.id)
        },
        onCollision: (ctx, other, contact) => { if (contact.began) log.push('c' + ctx.entity.id + '-' + other.id) },
      },
    })
    for (let i = 0; i < 6; i++) runtime.spawn({ app: 'mote', position: [i * 2, 0, 0], radius: 0.5, state: { vx: (3 - i) * 0.03 } })
    for (let t = 0; t < 60; t++) runtime.tick(t)
    return log.join(' ')
  }
  const first = run()
  assert.ok(first.includes('c') && first.includes('t'), 'the script produced no contacts or timers')
  assert.equal(run(), first)
})

finish()
