import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { APP_INVALID, CLIENT_HOOKS, SERVER_HOOKS, createAppRuntime, validateAppModule } from '../src/apps/appRuntime.js'

const TICK_DT = 1 / 64

const collider = (log, name) => ({
  server: {
    onCollision: (ctx, other, contact) => log.push([name, ctx.entity.id, other.id, contact.began, Math.round(contact.normal[0])]),
  },
})

gate('an app module names its hooks: setup, update, onInteract, onCollision, onMessage and teardown on the server, setup and render on the client', () => {
  assert.deepEqual([...SERVER_HOOKS], ['setup', 'update', 'teardown', 'onInteract', 'onCollision', 'onMessage'])
  assert.deepEqual([...CLIENT_HOOKS], ['setup', 'render', 'teardown'])
  validateAppModule('ok', { server: { setup: () => {} }, client: { render: () => {} } })
  assert.throws(() => validateAppModule('bad', { server: { onColide: () => {} } }), { code: APP_INVALID })
  assert.throws(() => validateAppModule('bad', { server: { update: 3 } }), { code: APP_INVALID })
  assert.throws(() => validateAppModule('bad', {}), { code: APP_INVALID })
  assert.throws(() => validateAppModule('bad', { sever: {} }), { code: APP_INVALID })
})

gate('server setup runs once at spawn and update runs every tick with the fixed step', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const log = []
  runtime.registerApp('spin', { server: { setup: (ctx) => log.push('setup'), update: (ctx, dt) => log.push('update:' + dt) } })
  runtime.spawn({ app: 'spin' })
  runtime.tick(0)
  runtime.tick(1)
  assert.deepEqual(log, ['setup', 'update:' + TICK_DT, 'update:' + TICK_DT])
})

gate('onInteract is dispatched to the entity that was interacted with, with the player, in the tick after the call and in call order', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const log = []
  runtime.registerApp('button', { server: { onInteract: (ctx, player) => log.push([ctx.entity.name, player.id, ctx.time.tick]) } })
  runtime.registerApp('rock', { server: { update: () => {} } })
  runtime.spawn({ app: 'button', name: 'red' })
  runtime.spawn({ app: 'button', name: 'blue' })
  const rock = runtime.spawn({ app: 'rock' })
  assert.equal(runtime.interact('blue', { id: 7 }), true)
  assert.equal(runtime.interact('red', { id: 8 }), true)
  assert.equal(runtime.interact(rock, { id: 9 }), true)
  assert.deepEqual(log, [])
  runtime.tick(0)
  runtime.tick(1)
  assert.deepEqual(log, [['blue', 7, 0], ['red', 8, 0]])
})

gate('an interaction with a destroyed entity is refused, one queued before the destroy is dropped, and a full queue counts what it drops', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4, queueCapacity: 2 })
  const log = []
  runtime.registerApp('button', { server: { onInteract: (ctx, player) => log.push(player.id) } })
  const a = runtime.spawn({ app: 'button' })
  const b = runtime.spawn({ app: 'button' })
  runtime.interact(a, { id: 1 })
  runtime.interact(b, { id: 2 })
  assert.equal(runtime.interact(b, { id: 3 }), false)
  assert.equal(runtime.stats.queueDropped, 1)
  runtime.destroy(a)
  assert.equal(runtime.interact(a, { id: 4 }), false)
  runtime.tick(0)
  assert.deepEqual(log, [2])
  assert.equal(runtime.pendingEvents, 0)
})

gate('onCollision is dispatched to both overlapping entities with the other entity and a normal pointing at it, and not to entities that are apart', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8 })
  const log = []
  runtime.registerApp('ball', collider(log, 'ball'))
  const left = runtime.spawn({ app: 'ball', position: [0, 0, 0], radius: 1 })
  const right = runtime.spawn({ app: 'ball', position: [1.5, 0, 0], radius: 1 })
  runtime.spawn({ app: 'ball', position: [10, 0, 0], radius: 1 })
  runtime.spawn({ app: 'ball', position: [0.5, 0, 0] })
  runtime.tick(0)
  assert.deepEqual(log, [['ball', left, right, true, 1], ['ball', right, left, true, -1]])
  assert.equal(runtime.contactCount, 1)
})

gate('a contact reports began on its first tick only, and begins again after the pair separates and meets again', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const began = []
  runtime.registerApp('ball', { server: { onCollision: (ctx, other, contact) => { if (ctx.entity.id === 0) began.push(contact.began) } } })
  runtime.spawn({ app: 'ball', position: [0, 0, 0], radius: 1 })
  const mover = runtime.getEntity(runtime.spawn({ app: 'ball', position: [1, 0, 0], radius: 1 }))
  runtime.tick(0)
  runtime.tick(1)
  mover.position = [5, 0, 0]
  runtime.tick(2)
  mover.position = [1, 0, 0]
  runtime.tick(3)
  assert.deepEqual(began, [true, false, true])
})

gate('collision dispatch order is the same whatever order the entities sit along the sweep axis', () => {
  const run = (xs) => {
    const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8 })
    const log = []
    runtime.registerApp('ball', collider(log, 'b'))
    for (const x of xs) runtime.spawn({ app: 'ball', position: [x, 0, 0], radius: 1 })
    runtime.tick(0)
    return log.map((entry) => entry[1] + '>' + entry[2]).join(' ')
  }
  assert.equal(run([0, 1, 2]), '0>1 1>0 0>2 2>0 1>2 2>1')
  assert.equal(run([2, 1, 0]), '0>1 1>0 0>2 2>0 1>2 2>1')
})

gate('the pair buffer is a fixed size and counts the contacts it could not hold instead of growing', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 8, pairCapacity: 2 })
  runtime.registerApp('ball', { server: {} })
  for (let i = 0; i < 4; i++) runtime.spawn({ app: 'ball', position: [0, 0, 0], radius: 1 })
  runtime.tick(0)
  assert.equal(runtime.contactCount, 2)
  assert.equal(runtime.stats.pairOverflow, 4)
})

gate('a hook that destroys the other entity in onCollision stops the rest of that contact, and a throwing hook is recorded and does not stop the next entity', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 4 })
  const log = []
  runtime.registerApp('eater', { server: { onCollision: (ctx, other) => { log.push('eat'); ctx.world.destroy(other.id) } } })
  runtime.registerApp('food', { server: { onCollision: () => log.push('food saw it'), update: () => { throw new Error('bad update') } } })
  runtime.registerApp('calm', { server: { update: () => log.push('calm') } })
  runtime.spawn({ app: 'eater', position: [0, 0, 0], radius: 1 })
  const food = runtime.spawn({ app: 'food', position: [1, 0, 0], radius: 1 })
  runtime.spawn({ app: 'calm' })
  runtime.tick(0)
  assert.deepEqual(log, ['calm', 'eat'])
  assert.equal(runtime.getEntity(food), null)
  assert.deepEqual(runtime.errors.map((entry) => [entry.hook, entry.message]), [['update', 'bad update']])
})

gate('onMessage reaches the addressed entity with its payload after the interactions of the same tick', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  const log = []
  runtime.registerApp('door', { server: { onMessage: (ctx, msg) => log.push('msg:' + msg.op), onInteract: () => log.push('interact') } })
  const door = runtime.spawn({ app: 'door' })
  runtime.message(door, { op: 'open' })
  runtime.interact(door, { id: 1 })
  runtime.tick(0)
  assert.deepEqual(log, ['interact', 'msg:open'])
})

gate('client setup runs with the injected engine and client render returns what the app returns for the frame, with a client state apart from the server state', () => {
  const runtime = createAppRuntime({ tickDt: TICK_DT, capacity: 2 })
  runtime.registerApp('lamp', {
    server: { setup: (ctx) => { ctx.state.secret = 1 } },
    client: {
      setup: (ctx) => { ctx.state.scene = ctx.engine.scene },
      render: (ctx, frame) => ({ position: ctx.entity.position, glow: frame.alpha, scene: ctx.state.scene, leaked: 'secret' in ctx.state }),
    },
  })
  const lamp = runtime.spawn({ app: 'lamp', position: [1, 2, 3] })
  const client = runtime.clientApps({ scene: 'main' })
  client.setup(lamp)
  assert.deepEqual(client.render(lamp, { alpha: 0.5 }), { position: [1, 2, 3], glow: 0.5, scene: 'main', leaked: false })
  runtime.destroy(lamp)
  assert.equal(client.render(lamp, { alpha: 1 }), undefined)
})

finish()
