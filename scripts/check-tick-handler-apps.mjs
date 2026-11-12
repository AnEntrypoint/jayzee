import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createServer } from '../src/sdk/server.js'
import { clientRig, makeClock, randomFillFrom } from './lib/serverRig.mjs'
import { MSG } from '../src/protocol/messages.js'

const ORDER = ['beginTick', 'setTick', 'connectedPlayers', 'updateStall', 'adjustSnapshotRate', 'movement', 'playerCollisions', 'chartReanchor', 'physicsStep', 'appRuntimeTick', 'collisionTiles', 'snapshot']

const build = (options = {}) => {
  const { clock, now } = makeClock()
  const trace = []
  const server = createServer({ now, randomFill: randomFillFrom(), onStep: (name) => trace.push(name), ...options })
  return { server, trace, clock, now, rig: clientRig(server, clock, now) }
}

const pairOf = (log) => ({
  ball: {
    server: {
      update: (ctx) => log.push(['update', ctx.entity.name, ctx.time.tick, ctx.entity.position[0]]),
      onCollision: (ctx, other, contact) => { if (contact.began) log.push(['hit', ctx.entity.name, other.name, ctx.time.tick]) },
    },
  },
})

const closing = { tickRate: 64, gravity: [0, 0, 0], entities: [
  { id: 'left', app: 'ball', bodyType: 'dynamic', position: [-2, 0.35, 0] },
  { id: 'right', app: 'ball', bodyType: 'dynamic', position: [2, 0.35, 0] },
] }

gate('with real subsystems one tick runs movement, player collisions, the kernel physics step, the app tick, tiles and the snapshot in the pinned order', () => {
  const { trace, rig } = build({ config: closing, apps: pairOf([]) })
  rig.join()
  trace.length = 0
  rig.run(1)
  assert.deepEqual(trace.filter((name) => ORDER.includes(name)), ORDER)
  assert.ok(trace.indexOf('physicsStep') < trace.indexOf('appRuntimeTick'))
  assert.ok(trace.indexOf('playerCollisions') < trace.indexOf('physicsStep'))
})

gate('the app update of a tick reads the position the kernel physics step of that same tick produced', () => {
  const log = []
  const { server } = build({ config: closing, apps: pairOf(log) })
  server.world.setVelocity(0, [1.28, 0, 0])
  server.tick()
  const seen = log.find((entry) => entry[0] === 'update' && entry[1] === 'left')
  assert.equal(seen[2], 1)
  assert.ok(Math.abs(seen[3] - (-2 + 1.28 / 64)) < 1e-3, 'update read x ' + seen[3])
  assert.notEqual(seen[3], -2)
})

gate('onCollision fires on the tick the kernel first brings two bodies into contact, to both entities, and not before', () => {
  const log = []
  const { server } = build({ config: closing, apps: pairOf(log) })
  server.world.setVelocity(0, [6.4, 0, 0])
  server.world.setVelocity(1, [-6.4, 0, 0])
  let contactTick = -1
  for (let i = 0; i < 64 && contactTick < 0; i++) {
    server.tick()
    const gap = server.getEntity('right').position[0] - server.getEntity('left').position[0]
    if (gap <= 0.7 + 1e-9) contactTick = server.tickNumber
  }
  const hits = log.filter((entry) => entry[0] === 'hit')
  assert.ok(contactTick > 1, 'the bodies never met')
  assert.deepEqual(hits, [['hit', 'left', 'right', contactTick], ['hit', 'right', 'left', contactTick]])
})

gate('the collision step sees the body positions after physics: a contact reported in a tick is a real overlap of that tick, in the snapshot that tick sends', () => {
  const overlaps = []
  const apps = { ball: { server: { onCollision: (ctx, other, contact) => overlaps.push([ctx.time.tick, contact.depth >= 0, Math.abs(other.position[0] - ctx.entity.position[0]) <= 0.7 + 1e-9]) } } }
  const { server, rig } = build({ config: closing, apps })
  const client = rig.join()
  server.world.setVelocity(0, [6.4, 0, 0])
  server.world.setVelocity(1, [-6.4, 0, 0])
  rig.run(40)
  assert.ok(overlaps.length > 0, 'no contact was reported')
  assert.ok(overlaps.every((entry) => entry[1] && entry[2]), 'a reported contact was not an overlap')
  const snaps = rig.snapshots(client.conn.take())
  const first = overlaps[0][0]
  const at = snaps.find((snap) => snap.decoded.tick === first)
  const xs = at.decoded.entities.map((entity) => entity.position[0])
  assert.ok(Math.abs(xs[1] - xs[0]) <= 0.7 + 0.021, 'the snapshot of the contact tick holds a gap of ' + Math.abs(xs[1] - xs[0]))
})

gate('the control: an app tick taken before the physics step reads the position of the tick before', () => {
  const log = []
  const { server } = build({ config: closing, apps: pairOf(log) })
  server.world.setVelocity(0, [1.28, 0, 0])
  const steps = server.tickHost.steps
  steps.appRuntimeTick(1, server.tickHost.dt)
  steps.physicsStep(server.tickHost.dt)
  const seen = log.find((entry) => entry[0] === 'update' && entry[1] === 'left')
  assert.equal(seen[3], -2)
})

gate('two servers fed the same script reach the same world hash and the same app event log', () => {
  const run = () => {
    const log = []
    const { server, rig } = build({ config: { ...closing, gravity: [0, -18, 0] }, apps: pairOf(log) })
    const client = rig.join()
    server.world.setVelocity(0, [3, 4, 0])
    server.world.setVelocity(1, [-3, 4, 0])
    for (let i = 0; i < 90; i++) {
      client.conn.send({ type: MSG.INPUT, payload: { seq: i + 1, input: { forward: i % 3 !== 0, yaw: 0.3 } } })
      rig.run(1)
    }
    return server.world.hash() + ':' + JSON.stringify(log.filter((entry) => entry[0] === 'hit'))
  }
  const first = run()
  assert.equal(run(), first)
})

finish()
