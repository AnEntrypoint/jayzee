import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { GRAVITY_NOT_VERTICAL, SCHEDULER_UNAVAILABLE, SERVER_CONFIG_INVALID, SERVER_SUBSYSTEMS, createServer, resolveServerConfig } from '../src/sdk/server.js'
import { clientRig, makeClock, randomFillFrom } from './lib/serverRig.mjs'
import { MSG } from '../src/protocol/messages.js'

const build = (options = {}) => {
  const { clock, now } = makeClock()
  const server = createServer({ now, randomFill: randomFillFrom(), ...options })
  return { server, clock, now, rig: clientRig(server, clock, now) }
}

gate('createServer creates its subsystems in the published order, and the scheduler only when timers are injected', () => {
  const { server } = build()
  assert.deepEqual([...server.subsystems], SERVER_SUBSYSTEMS.slice(0, 7))
  for (const name of server.subsystems) assert.ok(server[name], 'subsystem ' + name + ' is missing')
  assert.equal(server.scheduler, null)
  const timed = build({ timers: { setTimer: () => 1, clearTimer: () => {} } })
  assert.deepEqual([...timed.server.subsystems], [...SERVER_SUBSYSTEMS])
})

gate('the subsystems are wired to each other: the app runtime holds the same world, queries and bus, and the tick host steps that world', () => {
  const { server } = build({ apps: { probe: { server: { setup: (ctx) => { ctx.state.bus = ctx.bus; ctx.state.hit = ctx.raycast([0, 5, 0], [0, -1, 0], 10).hit } } } }, config: { entities: [{ id: 'p', app: 'probe' }, { id: 'ball', bodyType: 'dynamic', position: [0, 2, 0] }] } })
  const state = server.appRuntime.contextOf('p').state
  assert.equal(state.bus, server.bus)
  assert.equal(state.hit, false)
  const before = server.world.tick
  server.tick()
  assert.equal(server.world.tick, before + 1)
  assert.equal(server.appRuntime.contextOf('p').raycast([0, 5, 0], [0, -1, 0], 10).entity, server.getEntity('ball').id)
})

gate('the world config reaches the subsystems: tickRate sets the world step and the app step, gravity sets the fall, movement overrides the defaults', () => {
  const { server } = build({ config: { tickRate: 32, gravity: [0, -4, 0], movement: { maxSpeed: 14 }, entities: [{ id: 'ball', bodyType: 'dynamic', position: [0, 50, 0] }] } })
  assert.equal(server.world.stepSeconds, 1 / 32)
  assert.equal(server.appRuntime.time.deltaTime, 1 / 32)
  assert.equal(server.tickHost.dt, 1 / 32)
  assert.equal(server.config.movement.maxSpeed, 14)
  assert.equal(server.config.movement.jumpImpulse, 5.5)
  for (let i = 0; i < 32; i++) server.tick()
  const fall = server.getEntity('ball').velocity[1]
  assert.ok(fall < -3 && fall > -4.01, 'fall speed after one second under gravity -4 is ' + fall)
})

gate('a client that joins through the server is acknowledged, and its snapshots carry the app entities with the positions of that tick', () => {
  const { server, rig } = build({ config: { entities: [{ id: 'crate', model: 'crate.glb', bodyType: 'dynamic', position: [0, 3, 0] }, { id: 'sign', model: 'sign.glb', position: [4, 0, 0] }] } })
  const client = rig.join()
  assert.equal(server.connections.stats.joins, 1)
  rig.run(3)
  const last = rig.snapshots(client.conn.take()).at(-1).decoded
  assert.deepEqual(last.entities.map((entity) => [entity.id, entity.model, entity.bodyType]), [['crate', 'crate.glb', 'dynamic'], ['sign', 'sign.glb', 'static']])
  const crate = server.getEntity('crate').position
  assert.ok(Math.abs(last.entities[0].position[1] - crate[1]) < 0.011, 'snapshot y ' + last.entities[0].position[1] + ' world y ' + crate[1])
  assert.ok(crate[1] < 3, 'the crate did not fall')
})

gate('an entity spawned or destroyed through the server appears in and leaves the next snapshot', () => {
  const { server, rig } = build()
  const client = rig.join()
  server.spawnEntity({ id: 'late', model: 'late.glb', position: [1, 0, 1] })
  rig.run(1)
  assert.deepEqual(rig.snapshots(client.conn.take()).at(-1).decoded.entities.map((entity) => entity.id), ['late'])
  assert.equal(server.destroyEntity('late'), true)
  rig.run(1)
  assert.deepEqual(rig.snapshots(client.conn.take()).at(-1).decoded.entities, [])
})

gate('a player interaction routed through the server reaches onInteract with the player id and position, and an unknown player is refused', () => {
  const seen = []
  const { server, rig } = build({ apps: { button: { server: { onInteract: (ctx, player) => seen.push([ctx.entity.name, player.id, player.position.length]) } } }, config: { entities: [{ id: 'red', app: 'button' }] } })
  const client = rig.join()
  assert.equal(server.interact(client.playerId, 'red'), true)
  assert.equal(server.interact(999, 'red'), false)
  rig.run(1)
  assert.deepEqual(seen, [['red', client.playerId, 3]])
})

gate('reloadApp swaps the code of a running app between ticks and keeps its state', () => {
  const { server } = build({ apps: { counter: { server: { update: (ctx) => { ctx.state.n = (ctx.state.n ?? 0) + 1 } } } }, config: { entities: [{ id: 'c', app: 'counter' }] } })
  server.tick()
  server.tick()
  assert.equal(server.reloadApp('counter', { server: { update: (ctx) => { ctx.state.n += 100 } } }), 1)
  server.tick()
  assert.equal(server.appRuntime.contextOf('c').state.n, 102)
})

gate('start and stop drive the tick host from the injected timers and clock, and are refused by name without timers', () => {
  const { clock, now } = makeClock()
  const pending = []
  const timers = { setTimer: (fn, ms) => { const timer = { fn, at: clock.t + ms, live: true }; pending.push(timer); return timer }, clearTimer: (timer) => { timer.live = false } }
  const server = createServer({ now, timers, config: { tickRate: 50 } })
  server.start()
  for (let step = 0; step < 200; step++) {
    clock.t += 1
    for (const timer of pending.splice(0)) {
      if (!timer.live) continue
      if (timer.at <= clock.t) timer.fn()
      else pending.push(timer)
    }
  }
  server.stop()
  assert.ok(server.tickNumber >= 9 && server.tickNumber <= 10, 'ticks in 200 ms at 50 Hz: ' + server.tickNumber)
  const ticked = server.tickNumber
  clock.t += 500
  for (const timer of pending.splice(0)) if (timer.live) timer.fn()
  assert.equal(server.tickNumber, ticked)
  assert.throws(() => build().server.start(), { code: SCHEDULER_UNAVAILABLE })
})

gate('a bad world config is refused by name before any subsystem exists', () => {
  const { now } = makeClock()
  assert.throws(() => createServer({ now, config: { gravity: [1, -18, 0] } }), { code: GRAVITY_NOT_VERTICAL })
  assert.throws(() => createServer({ now, config: { tickRate: 0 } }), { code: SERVER_CONFIG_INVALID })
  assert.throws(() => createServer({ now, config: { entities: [{ id: 'a' }, { id: 'a' }] } }), { code: SERVER_CONFIG_INVALID })
  assert.throws(() => createServer({ now, config: { entities: [{ id: 'a', bodyType: 'ghost' }] } }), { code: SERVER_CONFIG_INVALID })
  assert.throws(() => createServer({ now, config: { movement: { maxSpeed: 'fast' } } }), { code: SERVER_CONFIG_INVALID })
  assert.throws(() => createServer({ config: {} }), TypeError)
  assert.deepEqual(resolveServerConfig({}).gravity, [0, -18, 0])
  assert.equal(resolveServerConfig({}).tickRate, 64)
})

gate('the server opens no socket and reads no host clock: it runs whole with only the injected clock', () => {
  const { server, rig } = build()
  const client = rig.join()
  rig.run(5)
  assert.ok(client.conn.take().some((m) => m.type === MSG.SNAPSHOT))
  assert.equal(typeof server.listen, 'undefined')
})

finish()
