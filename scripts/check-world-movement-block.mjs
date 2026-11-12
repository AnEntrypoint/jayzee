import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createServer, resolveServerConfig } from '../src/sdk/server.js'
import { DEFAULT_MOVEMENT } from '../src/motion-pure/movement.js'
import { clientRig, makeClock, randomFillFrom } from './lib/serverRig.mjs'
import { MSG } from '../src/protocol/messages.js'

const readme = JSON.parse(readFileSync(new URL('./fixtures/spoint/world-config.json', import.meta.url), 'utf8'))

const speedAfter = (movement, input, ticks = 160) => {
  const { clock, now } = makeClock()
  const server = createServer({ now, randomFill: randomFillFrom(), config: { tickRate: readme.tickRate, gravity: readme.gravity, movement } })
  const rig = clientRig(server, clock, now)
  const client = rig.join()
  const player = server.tickHost.playerManager.getPlayer(client.playerId)
  let peakUp = 0
  for (let i = 0; i < ticks; i++) {
    client.conn.send({ type: MSG.INPUT, payload: { seq: i + 1, input: { yaw: 0, ...input } } })
    rig.run(1)
    peakUp = Math.max(peakUp, player.state.velocity[1])
  }
  const v = player.state.velocity
  return { ground: Math.hypot(v[0], v[2]), peakUp }
}

gate('the six movement keys of the README block all reach the movement step through the world config', () => {
  const resolved = resolveServerConfig({ movement: readme.movement }).movement
  for (const key of ['maxSpeed', 'sprintSpeed', 'groundAccel', 'airAccel', 'friction', 'stopSpeed', 'jumpImpulse']) assert.equal(resolved[key], readme.movement[key], key)
  assert.equal(resolved.slideDuration, DEFAULT_MOVEMENT.slideDuration)
})

gate('with the README block a walking player settles at maxSpeed 14 and a sprinting player at sprintSpeed 24', () => {
  const walk = speedAfter(readme.movement, { forward: true })
  const sprint = speedAfter(readme.movement, { forward: true, sprint: true })
  assert.ok(Math.abs(walk.ground - 14) < 0.3, 'walk speed ' + walk.ground)
  assert.ok(Math.abs(sprint.ground - 24) < 0.5, 'sprint speed ' + sprint.ground)
})

gate('the control: with no movement block the same walk settles at the module default, so the block is what changed the speed', () => {
  const walk = speedAfter({}, { forward: true })
  assert.ok(Math.abs(walk.ground - DEFAULT_MOVEMENT.maxSpeed) < 0.3, 'default walk speed ' + walk.ground)
  assert.ok(Math.abs(walk.ground - 14) > 3)
})

gate('jumpImpulse sets the take-off speed: the README 5.5 and a doubled block differ by the doubling', () => {
  const normal = speedAfter(readme.movement, { jump: true }, 12)
  const doubled = speedAfter({ ...readme.movement, jumpImpulse: 11 }, { jump: true }, 12)
  assert.ok(normal.peakUp > 4.5 && normal.peakUp <= 5.5 + 1e-9, 'take-off ' + normal.peakUp)
  assert.ok(doubled.peakUp > normal.peakUp + 4, 'doubled take-off ' + doubled.peakUp)
})

gate('friction and stopSpeed bring a released player to rest sooner under a stiffer block', () => {
  const coast = (movement) => {
    const { clock, now } = makeClock()
    const server = createServer({ now, randomFill: randomFillFrom(), config: { tickRate: 64, movement } })
    const rig = clientRig(server, clock, now)
    const client = rig.join()
    const player = server.tickHost.playerManager.getPlayer(client.playerId)
    let seq = 0
    for (let i = 0; i < 120; i++) { client.conn.send({ type: MSG.INPUT, payload: { seq: ++seq, input: { yaw: 0, forward: true } } }); rig.run(1) }
    let ticks = 0
    while (Math.hypot(player.state.velocity[0], player.state.velocity[2]) > 0.05 && ticks < 600) { client.conn.send({ type: MSG.INPUT, payload: { seq: ++seq, input: { yaw: 0 } } }); rig.run(1); ticks += 1 }
    return ticks
  }
  const soft = coast({ ...readme.movement, friction: 2 })
  const stiff = coast({ ...readme.movement, friction: 12 })
  assert.ok(stiff < soft, 'stiff stop took ' + stiff + ' ticks, soft took ' + soft)
  assert.ok(soft < 600, 'the soft block never stopped')
})

gate('a movement value that is not a finite number is refused by name', () => {
  assert.throws(() => resolveServerConfig({ movement: { maxSpeed: Infinity } }), { code: 'server-config-invalid' })
  assert.throws(() => resolveServerConfig({ movement: null }), { code: 'server-config-invalid' })
})

finish()
