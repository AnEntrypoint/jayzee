import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { definePickup } from '../src/behaviours/pickup.js'
import { defineShrinkingZone } from '../src/behaviours/shrinkingZone.js'
import { sweepProjectile } from '../src/behaviours/projectile.js'
import { stepProjectile, sweepProjectileGravity } from '../src/behaviours/projectileGravity.js'

const refusedWith = (fn, code) => {
  let error = null
  try {
    fn()
  } catch (caught) {
    error = caught
  }
  assert.ok(error, 'expected a refusal with ' + code + ', got none')
  assert.equal(error.reasonCode, code)
}

const refusedMatching = (fn, pattern) => {
  let error = null
  try {
    fn()
  } catch (caught) {
    error = caught
  }
  assert.ok(error, 'expected a refusal matching ' + pattern + ', got none')
  assert.match(error.message, pattern)
}

const near = (actual, expected) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, actual + ' is not ' + expected)
}

const pickupAppCtx = (players, position = [0, 0, 0]) => ({
  entity: { id: 'pk', position },
  players: { getAll: () => players },
})

const pickupHost = (appCtx) => ({
  position: () => appCtx.entity.position,
  players: { getAll: () => appCtx.players.getAll() },
  context: appCtx,
})

const pickupCtx = (players, position) => pickupHost(pickupAppCtx(players, position))

const pickupSpec = (overrides = {}) => ({
  radius: 2,
  onCollect: (ctx, player) => calls.push(player.id),
  ...overrides,
})

let calls = []

const zoneWorld = (nearby = [], entities = {}) => {
  const log = { spawned: [], destroyed: [], impulses: [], sent: [], nearbyArgs: [] }
  const ring = { position: [0, 0, 0], scale: [1, 1, 1] }
  const world = {
    spawnChild(id, def) { log.spawned.push({ id, def }) },
    getEntity(id) { return id === 'z_zone_ring' ? ring : entities[id] },
    destroy(id) { log.destroyed.push(id) },
    nearby(center, radius) { log.nearbyArgs.push({ center: [...center], radius }); return nearby },
    applyImpulse(id, vector) { log.impulses.push({ id, vector: [...vector] }) },
  }
  return { log, ring, world }
}

const zoneAppCtx = ({ players = [], world = zoneWorld().world } = {}) => ({
  entity: { id: 'z', position: [0, 0, 0] },
  world,
  players: {
    getAll: () => players,
    send: (id, message) => players.sentLog.push({ id, message }),
  },
})

const zoneHost = (appCtx) => ({
  context: appCtx,
  entityId: () => appCtx.entity.id,
  world: appCtx.world,
  players: appCtx.players,
})

const zoneCtx = (options = {}) => zoneHost(zoneAppCtx(options))

const playersWith = (list) => {
  list.sentLog = []
  return list
}

const linearSpec = (overrides = {}) => ({
  center: [0, 0, 0],
  curve: 'linear',
  startRadius: 100,
  endRadius: 10,
  durationSec: 90,
  startDelaySec: 10,
  showRing: false,
  ...overrides,
})

gate('definePickup refuses a missing appCtx, a bad clock and a bad spec', () => {
  refusedWith(() => definePickup(pickupSpec(), null, { now: () => 0 }), 'pickup-context-missing')
  refusedWith(() => definePickup(pickupSpec(), pickupCtx([]), {}), 'pickup-clock-invalid')
  refusedWith(() => definePickup(pickupSpec(), pickupCtx([]), { now: 5 }), 'pickup-clock-invalid')
  refusedWith(() => definePickup(null, pickupCtx([]), { now: () => 0 }), 'define-spec-invalid')
  refusedWith(() => definePickup(pickupSpec({ radius: -1 }), pickupCtx([]), { now: () => 0 }), 'define-spec-invalid-field')
  refusedWith(() => definePickup(pickupSpec({ radius: NaN }), pickupCtx([]), { now: () => 0 }), 'define-spec-invalid-field')
  refusedWith(() => definePickup(pickupSpec({ cooldown: -5 }), pickupCtx([]), { now: () => 0 }), 'define-spec-invalid-field')
  refusedWith(() => definePickup(pickupSpec({ oneShot: 'yes' }), pickupCtx([]), { now: () => 0 }), 'define-spec-invalid-field')
  refusedWith(() => definePickup(pickupSpec({ onCollect: 'x' }), pickupCtx([]), { now: () => 0 }), 'define-spec-invalid-field')
  refusedWith(() => definePickup({ radius: 2 }, pickupCtx([]), { now: () => 0 }), 'define-spec-missing-field')
  refusedWith(() => definePickup(pickupSpec({ colour: 'red' }), pickupCtx([]), { now: () => 0 }), 'define-spec-unknown-key')
})

gate('definePickup radius defaults to 1.5 metres, as spoint does', () => {
  calls = []
  const pickup = definePickup({ onCollect: (ctx, player) => calls.push(player.id) }, pickupCtx([{ id: 'in', state: { position: [1.4, 0, 0] } }, { id: 'out', state: { position: [1.6, 0, 0] } }]), { now: () => 0 })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['in'])
})

gate('definePickup reads the clock at most once per tick, when players are in range with a cooldown', () => {
  calls = []
  let reads = 0
  const players = [{ id: 'a', state: { position: [1, 0, 0] } }, { id: 'b', state: { position: [0, 1, 0] } }]
  const pickup = definePickup(pickupSpec({ radius: 5, cooldown: 100 }), pickupCtx(players), { now: () => { reads += 1; return 1000 } })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'b'])
  assert.equal(reads, 1)
  pickup.tick(0.1)
  assert.equal(reads, 2)
})

gate('definePickup collects a player inside the radius, boundary included', () => {
  calls = []
  const p1 = { id: 'p1', state: { position: [2, 0, 0] } }
  const p2 = { id: 'p2', state: { position: [3, 0, 0] } }
  const pickup = definePickup(pickupSpec(), pickupCtx([p1, p2]), { now: () => 0 })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['p1'])
  assert.equal(pickup.collected, false)
})

gate('definePickup skips players with no position and players outside the radius', () => {
  calls = []
  const pickup = definePickup(pickupSpec(), pickupCtx([{ id: 'a', state: {} }, { id: 'b', state: { position: [0, 0, 2.5] } }]), { now: () => 0 })
  pickup.tick(0.1)
  assert.deepEqual(calls, [])
})

gate('definePickup one-shot collects once, stays spent, and collects again after reset', () => {
  calls = []
  const players = [{ id: 'p1', state: { position: [1, 0, 0] } }, { id: 'p2', state: { position: [0, 1, 0] } }]
  const pickup = definePickup(pickupSpec({ oneShot: true }), pickupCtx(players), { now: () => 0 })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['p1'])
  assert.equal(pickup.collected, true)
  pickup.tick(0.1)
  assert.deepEqual(calls, ['p1'])
  pickup.reset()
  assert.equal(pickup.collected, false)
  pickup.tick(0.1)
  assert.deepEqual(calls, ['p1', 'p1'])
})

gate('definePickup cooldown is per player and measured on the injected clock', () => {
  calls = []
  let t = 1000
  const players = [{ id: 'a', state: { position: [1, 0, 0] } }, { id: 'b', state: { position: [0, 1, 0] } }]
  const pickup = definePickup(pickupSpec({ radius: 5, cooldown: 1000 }), pickupCtx(players), { now: () => t })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'b'])
  t = 1500
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'b'])
  t = 2000
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'b', 'a', 'b'])
})

gate('definePickup does not block the first collection at clock zero', () => {
  calls = []
  let t = 0
  const players = [{ id: 'a', state: { position: [1, 0, 0] } }]
  const pickup = definePickup(pickupSpec({ radius: 5, cooldown: 1000 }), pickupCtx(players), { now: () => t })
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a'])
  t = 999
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a'])
  t = 1000
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'a'])
})

gate('definePickup reads the clock only when a cooldown applies, and refuses a non-finite clock', () => {
  calls = []
  const players = [{ id: 'a', state: { position: [1, 0, 0] } }]
  let reads = 0
  const counting = definePickup(pickupSpec({ radius: 5 }), pickupCtx(players), { now: () => { reads += 1; return 0 } })
  counting.tick(0.1)
  assert.deepEqual(calls, ['a'])
  assert.equal(reads, 0)
  const broken = definePickup(pickupSpec({ radius: 5, cooldown: 100 }), pickupCtx(players), { now: () => NaN })
  refusedWith(() => broken.tick(0.1), 'pickup-clock-invalid')
})

gate('definePickup reset clears the cooldown record', () => {
  calls = []
  let t = 500
  const players = [{ id: 'a', state: { position: [1, 0, 0] } }]
  const pickup = definePickup(pickupSpec({ radius: 5, cooldown: 1000 }), pickupCtx(players), { now: () => t })
  pickup.tick(0.1)
  t = 600
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a'])
  pickup.reset()
  pickup.tick(0.1)
  assert.deepEqual(calls, ['a', 'a'])
})

gate('defineShrinkingZone refuses bad specs and a missing appCtx', () => {
  refusedMatching(() => defineShrinkingZone({}, null), /a host accessor object is required/)
  refusedMatching(() => defineShrinkingZone(null, zoneCtx()), /spec must be an object/)
  refusedMatching(() => defineShrinkingZone({ startRadius: 10, endRadius: 20 }, zoneCtx()), /endRadius must not exceed startRadius/)
  refusedMatching(() => defineShrinkingZone({ curve: 'bogus' }, zoneCtx()), /curve must be/)
  refusedMatching(() => defineShrinkingZone({ curve: 'phases' }, zoneCtx()), /phases must be a non-empty array/)
  refusedMatching(() => defineShrinkingZone({ curve: 'phases', phases: [{}] }, zoneCtx()), /phases\[0\].radius/)
  refusedMatching(() => defineShrinkingZone({ outsidePenalty: 'fire' }, zoneCtx()), /outsidePenalty must be/)
  refusedMatching(() => defineShrinkingZone({ startRadius: 0 }, zoneCtx()), /startRadius must be a positive/)
  refusedMatching(() => defineShrinkingZone({ center: [0, 0] }, zoneCtx()), /center must be/)
  refusedMatching(() => defineShrinkingZone({ showRing: 'yes' }, zoneCtx()), /showRing must be a boolean/)
  refusedMatching(() => defineShrinkingZone({ ringHeight: 0 }, zoneCtx()), /ringHeight must be a positive/)
  refusedMatching(() => defineShrinkingZone({ onComplete: 1 }, zoneCtx()), /onComplete must be a function/)
})

gate('a linear zone waits out the start delay, then shrinks to endRadius and completes once', () => {
  let completions = 0
  const zone = defineShrinkingZone(linearSpec({ onComplete: () => { completions += 1 } }), zoneCtx())
  zone.tick(5)
  assert.equal(zone.radius, 100)
  zone.tick(10)
  near(zone.radius, 95)
  zone.tick(80)
  near(zone.radius, 15)
  assert.equal(zone.completed, false)
  zone.tick(5)
  assert.equal(zone.radius, 10)
  assert.equal(zone.completed, true)
  zone.tick(50)
  assert.equal(zone.radius, 10)
  assert.equal(completions, 1)
  assert.equal(zone.elapsed, 150)
})

gate('isOutside measures planar distance from the centre against the current radius', () => {
  const zone = defineShrinkingZone(linearSpec({ startRadius: 95, endRadius: 95, durationSec: 10, startDelaySec: 0 }), zoneCtx())
  zone.tick(1)
  assert.equal(zone.isOutside([96, 0, 0]), true)
  assert.equal(zone.isOutside([95, 0, 0]), false)
  assert.equal(zone.isOutside([3, 500, 4]), false)
  assert.equal(zone.isOutside([70, 0, 70]), true)
  assert.equal(zone.isOutside('nope'), false)
  zone.setCenter([10, 0, 0])
  assert.deepEqual(zone.center, [10, 0, 0])
  assert.equal(zone.isOutside([96, 0, 0]), false)
  refusedMatching(() => zone.setCenter([NaN, 0, 0]), /setCenter requires/)
})

gate('a phase curve holds, shrinks between phases, reports phase changes, and holds the last radius', () => {
  const changes = []
  const zone = defineShrinkingZone({
    curve: 'phases',
    startDelaySec: 0,
    showRing: false,
    phases: [{ radius: 50, holdSec: 10 }, { radius: 20, shrinkSec: 20 }, { radius: 5 }],
    onPhaseChange: (ctx, z) => changes.push(z.phaseIndex),
  }, zoneCtx())
  zone.tick(5)
  assert.equal(zone.radius, 50)
  assert.equal(zone.phaseIndex, 0)
  zone.tick(15)
  near(zone.radius, 35)
  assert.equal(zone.phaseIndex, 1)
  zone.tick(25)
  near(zone.radius, 12.5)
  assert.equal(zone.phaseIndex, 2)
  zone.tick(15)
  assert.equal(zone.radius, 5)
  assert.equal(zone.completed, true)
  assert.deepEqual(changes, [1, 2])
})

gate('an outside player with both penalties takes damage and is pushed, and dies once', () => {
  const outside = { id: 'p1', state: { position: [20, 0, 0], velocity: [0, 0, 0], health: 10 } }
  const inside = { id: 'p2', state: { position: [5, 0, 0], velocity: [0, 0, 0], health: 10 } }
  const players = playersWith([outside, inside])
  const zone = defineShrinkingZone(linearSpec({ startRadius: 10, endRadius: 10, durationSec: 100, startDelaySec: 0, outsidePenalty: 'both', damagePerSec: 5, pushForce: 8 }), zoneCtx({ players }))
  zone.tick(1)
  assert.equal(outside.state.health, 5)
  assert.equal(outside.state.velocity[0], -8)
  assert.equal(inside.state.health, 10)
  assert.equal(inside.state.velocity[0], 0)
  const push = players.sentLog.find((entry) => entry.message.type === 'zone_push')
  assert.equal(push.id, 'p1')
  assert.equal(push.message.dirX, -1)
  zone.tick(1)
  assert.equal(outside.state.health, 0)
  assert.equal(outside.state.velocity[0], -16)
  zone.tick(1)
  assert.equal(outside.state.velocity[0], -16)
  assert.equal(players.sentLog.filter((entry) => entry.message.type === 'zone_death').length, 1)
  assert.equal(players.sentLog.filter((entry) => entry.id === 'p2').length, 0)
})

gate('the damage penalty deals no push and the push penalty deals no damage', () => {
  const damaged = { id: 'd', state: { position: [20, 0, 0], velocity: [0, 0, 0], health: 10 } }
  const damagePlayers = playersWith([damaged])
  defineShrinkingZone(linearSpec({ startRadius: 10, endRadius: 10, durationSec: 100, startDelaySec: 0, outsidePenalty: 'damage' }), zoneCtx({ players: damagePlayers })).tick(1)
  assert.equal(damaged.state.health, 5)
  assert.equal(damaged.state.velocity[0], 0)
  assert.equal(damagePlayers.sentLog.length, 0)

  const pushed = { id: 'q', state: { position: [20, 0, 0], velocity: [0, 0, 0], health: 10 } }
  const pushPlayers = playersWith([pushed])
  defineShrinkingZone(linearSpec({ startRadius: 10, endRadius: 10, durationSec: 100, startDelaySec: 0, outsidePenalty: 'push' }), zoneCtx({ players: pushPlayers })).tick(1)
  assert.equal(pushed.state.health, 10)
  assert.equal(pushed.state.velocity[0], -8)
  assert.deepEqual(pushPlayers.sentLog.map((entry) => entry.message.type), ['zone_push'])
})

gate('affectDynamicEntities pushes only dynamic bodies outside the zone, with an impulse', () => {
  const { log, world } = zoneWorld(['z', 'rock', 'wall', 'ball'], {
    rock: { bodyType: 'dynamic', position: [30, 0, 0] },
    wall: { bodyType: 'static', position: [30, 0, 0] },
    ball: { bodyType: 'dynamic', position: [5, 0, 0] },
  })
  const zone = defineShrinkingZone(linearSpec({ startRadius: 10, endRadius: 10, durationSec: 100, startDelaySec: 0, outsidePenalty: 'push', affectDynamicEntities: true, pushForce: 8, showRing: false }), zoneCtx({ world }))
  zone.tick(1)
  assert.equal(log.impulses.length, 1)
  assert.equal(log.impulses[0].id, 'rock')
  assert.equal(log.impulses[0].vector[0], -8)
  assert.equal(log.impulses[0].vector[1], 0)
  assert.deepEqual(log.nearbyArgs[0].radius, 210)
  assert.deepEqual(log.nearbyArgs[0].center, [0, 0, 0])

  const quiet = zoneWorld(['rock'], { rock: { bodyType: 'dynamic', position: [30, 0, 0] } })
  defineShrinkingZone(linearSpec({ startRadius: 10, endRadius: 10, durationSec: 100, startDelaySec: 0, outsidePenalty: 'push', affectDynamicEntities: false }), zoneCtx({ world: quiet.world })).tick(1)
  assert.equal(quiet.log.impulses.length, 0)
})

gate('the ring spawns with the start radius, follows the radius by scale, and is destroyed', () => {
  const { log, ring, world } = zoneWorld()
  const zone = defineShrinkingZone({ center: [0, 0, 0], curve: 'linear', startRadius: 10, endRadius: 4, durationSec: 6, startDelaySec: 0, ringHeight: 0.2 }, zoneCtx({ world }))
  zone.tick(1)
  assert.equal(log.spawned.length, 1)
  assert.equal(log.spawned[0].id, 'z_zone_ring')
  assert.deepEqual(log.spawned[0].def.config, { r: 10, h: 0.2, color: 0x00ffff })
  assert.equal(zone.ringEntityId, 'z_zone_ring')
  near(ring.scale[0], 18)
  near(ring.scale[2], 18)
  zone.tick(1)
  assert.equal(log.spawned.length, 1)
  zone.destroy()
  assert.deepEqual(log.destroyed, ['z_zone_ring'])
  assert.equal(zone.ringEntityId, null)
})

gate('showRing false spawns no ring entity', () => {
  const { log, world } = zoneWorld()
  defineShrinkingZone(linearSpec({ showRing: false, startDelaySec: 0 }), zoneCtx({ world })).tick(1)
  assert.equal(log.spawned.length, 0)
})

gate('a ring whose spawn throws is not marked as spawned, so the next tick retries it', () => {
  const spawned = []
  let failures = 1
  const world = {
    spawnChild(id, def) {
      if (failures > 0) { failures -= 1; throw new Error('spawn refused') }
      spawned.push({ id, def })
    },
    getEntity: () => null,
    destroy: () => {},
    nearby: () => [],
    applyImpulse: () => {},
  }
  const zone = defineShrinkingZone(linearSpec({ showRing: true, startDelaySec: 0 }), zoneCtx({ world }))
  assert.throws(() => zone.tick(1), /spawn refused/)
  assert.equal(zone.ringEntityId, null)
  zone.tick(1)
  assert.equal(spawned.length, 1)
  assert.equal(zone.ringEntityId, 'z_zone_ring')
})

gate('reset returns a completed zone to its start radius and clock', () => {
  const zone = defineShrinkingZone(linearSpec({ startDelaySec: 0, durationSec: 10 }), zoneCtx())
  zone.tick(10)
  assert.equal(zone.completed, true)
  zone.reset()
  assert.equal(zone.elapsed, 0)
  assert.equal(zone.completed, false)
  assert.equal(zone.radius, 100)
  assert.equal(zone.phaseIndex, 0)
})

gate('sweepProjectile refuses a bad raycast, a bad vector and a bad dt', () => {
  refusedWith(() => sweepProjectile('x', [0, 0, 0], [0, 0, 1], 1), 'projectile-raycast-invalid')
  refusedWith(() => sweepProjectile(() => null, [0, 0], [0, 0, 1], 1), 'vec3-invalid')
  refusedWith(() => sweepProjectile(() => null, [0, 0, 0], [0, 0, 1], -1), 'projectile-dt-invalid')
})

gate('sweepProjectile with no hit moves along the unit direction for speed times dt', () => {
  const seen = []
  const raycast = (from, dir, reach) => { seen.push({ from: [...from], dir: [...dir], reach }); return null }
  const result = sweepProjectile(raycast, [0, 0, 0], [0, 0, 10], 0.5)
  assert.deepEqual(result, { position: [0, 0, 5], hit: null })
  assert.deepEqual(seen, [{ from: [0, 0, 0], dir: [0, 0, 1], reach: 5 }])
})

gate('sweepProjectile reports a raycast hit and its entity, or null without one', () => {
  const withId = sweepProjectile(() => ({ hit: true, position: [0, 0, 3], entityId: 'wall' }), [0, 0, 0], [0, 0, 10], 1)
  assert.deepEqual(withId, { position: [0, 0, 3], hit: { point: [0, 0, 3], entityId: 'wall' } })
  const withoutId = sweepProjectile(() => ({ hit: true, position: [0, 0, 3] }), [0, 0, 0], [0, 0, 10], 1)
  assert.deepEqual(withoutId.hit, { point: [0, 0, 3], entityId: null })
  refusedWith(() => sweepProjectile(() => ({ hit: true, position: [NaN, 0, 0] }), [0, 0, 0], [0, 0, 10], 1), 'vec3-invalid')
})

gate('sweepProjectile skips the raycast on zero dt or zero velocity and returns a copy', () => {
  let calls = 0
  const raycast = () => { calls += 1; return null }
  const from = [1, 2, 3]
  const zeroDt = sweepProjectile(raycast, from, [0, 0, 10], 0)
  const zeroVelocity = sweepProjectile(raycast, from, [0, 0, 0], 1)
  assert.equal(calls, 0)
  assert.deepEqual(zeroDt, { position: [1, 2, 3], hit: null })
  assert.deepEqual(zeroVelocity, { position: [1, 2, 3], hit: null })
  assert.notEqual(zeroDt.position, from)
})

gate('stepProjectile applies gravity to the vertical velocity and the half step to position', () => {
  const next = stepProjectile({ position: [0, 10, 0], velocity: [2, 0, 0], gravity: -10, dt: 0.5 })
  assert.deepEqual(next, { position: [1, 8.75, 0], velocity: [2, -5, 0] })
})

gate('stepProjectile defaults to -9.81 m/s^2 gravity', () => {
  const next = stepProjectile({ position: [0, 0, 0], velocity: [0, 0, 0], dt: 1 })
  near(next.velocity[1], -9.81)
  near(next.position[1], -4.905)
})

gate('stepProjectile refuses bad gravity, dt and vectors', () => {
  refusedWith(() => stepProjectile({ position: [0, 0, 0], velocity: [0, 0, 0], gravity: NaN, dt: 1 }), 'projectile-gravity-invalid')
  refusedWith(() => stepProjectile({ position: [0, 0, 0], velocity: [0, 0, 0], dt: 0 }), 'projectile-dt-invalid')
  refusedWith(() => stepProjectile({ position: [0, 0], velocity: [0, 0, 0], dt: 1 }), 'vec3-invalid')
})

gate('sweepProjectileGravity samples the arc and ends where a single step ends', () => {
  const expected = { ok: true, hit: null, position: [2, 5, 0], velocity: [2, -10, 0], points: [[0, 10, 0], [1, 8.75, 0], [2, 5, 0]] }
  assert.deepEqual(sweepProjectileGravity({ from: [0, 10, 0], velocity: [2, 0, 0], gravity: -10, dt: 1, steps: 2 }), expected)
  for (const steps of [1, 4]) {
    const result = sweepProjectileGravity({ from: [0, 10, 0], velocity: [2, 0, 0], gravity: -10, dt: 1, steps })
    assert.deepEqual(result.position, [2, 5, 0])
    assert.equal(result.points.length, steps + 1)
  }
})

gate('sweepProjectileGravity stops at the first raycast hit and keeps the points before it', () => {
  const calls = []
  const raycast = (from, to) => {
    calls.push({ from: [...from], to: [...to] })
    return to[0] >= 1.5 ? { id: 'wall' } : null
  }
  const result = sweepProjectileGravity({ from: [0, 10, 0], velocity: [2, 0, 0], gravity: -10, dt: 1, steps: 2, raycast })
  assert.deepEqual(result.hit, { id: 'wall' })
  assert.deepEqual(result.position, [2, 5, 0])
  assert.deepEqual(result.velocity, [2, -10, 0])
  assert.deepEqual(result.points, [[0, 10, 0], [1, 8.75, 0]])
  assert.deepEqual(calls[0], { from: [0, 10, 0], to: [1, 8.75, 0] })
  assert.equal(calls.length, 2)
})

gate('sweepProjectileGravity refuses bad steps, a bad raycast and a missing dt', () => {
  refusedWith(() => sweepProjectileGravity({ from: [0, 0, 0], velocity: [0, 0, 0], dt: 1, steps: 0 }), 'projectile-steps-invalid')
  refusedWith(() => sweepProjectileGravity({ from: [0, 0, 0], velocity: [0, 0, 0], dt: 1, steps: 1.5 }), 'projectile-steps-invalid')
  refusedWith(() => sweepProjectileGravity({ from: [0, 0, 0], velocity: [0, 0, 0], dt: 1, raycast: 3 }), 'projectile-raycast-invalid')
  refusedWith(() => sweepProjectileGravity({ from: [0, 0, 0], velocity: [0, 0, 0], dt: NaN }), 'projectile-dt-invalid')
})

finish()
