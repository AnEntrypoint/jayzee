import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createBuffStack } from '../src/behaviours/buffs.js'
import { createHealth } from '../src/behaviours/health.js'
import { parseDefineSpec, DEFINE_SPEC_SCHEMAS, assertDefineSpecKeys, assertDefineNumber } from '../src/behaviours/specBoundary.js'
import { createTriggerVolume } from '../src/behaviours/triggerVolume.js'
import { definePath } from '../src/behaviours/path.js'
import { createSplineRegistry } from '../src/behaviours/spline.js'
import {
  DEFAULT_COMBAT, UNKNOWN_HEALTH, POWERUP_PICKUP_RADIUS, readHealth, resolveCombatConfig, resolveShotDamage,
  regenerateHealth, isInsidePowerupPickup, createKillStreakTracker, createFallTimers,
} from '../src/behaviours/combat.js'
import { createDestructibleCore, createDebrisTimers, defaultImpactRadius, pieceExtentsFor, pieceMassFor } from '../src/behaviours/destructible.js'
import { defineGameFSM, GameFSMError } from '../src/behaviours/game-fsm.js'
import * as behaviours from '../src/behaviours/index.js'

const behaviourDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'behaviours')

const refusalOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error
  }
  return null
}
const refusedWith = (fn, code) => {
  const error = refusalOf(fn)
  assert.ok(error, 'expected a refusal with ' + code + ', got none')
  assert.equal(error.reasonCode ?? error.code, code)
}
const outcomeDiffers = (actual, expected) => {
  try {
    assert.deepEqual(actual, expected)
    return false
  } catch {
    return true
  }
}
const fails = (fn) => refusalOf(fn) !== null
const near = (actual, expected, eps = 1e-9) => assert.ok(Math.abs(actual - expected) <= eps, `${actual} is not ${expected}`)
const nearVec = (actual, expected, eps = 1e-9) => {
  assert.equal(actual.length, expected.length)
  expected.forEach((value, i) => near(actual[i], value, eps))
}

gate('buffs clamp to maxStack and start from the neutral value 1', () => {
  const stack = createBuffStack({ maxStack: 3 })
  assert.equal(stack.apply('p1', 'speed', 1), 2)
  assert.equal(stack.apply('p1', 'speed', 5), 3)
  assert.equal(stack.get('p1', 'speed'), 3)
  assert.equal(stack.get('p1', 'missing'), 1)
  assert.equal(stack.get('nobody', 'speed'), 1)
})

gate('control: without maxStack the same stacking overshoots 3', () => {
  const stack = createBuffStack({})
  stack.apply('p1', 'speed', 1)
  assert.ok(outcomeDiffers(stack.apply('p1', 'speed', 5), 3))
})

gate('buffs ignore a null player or an empty key', () => {
  const stack = createBuffStack({})
  assert.equal(stack.apply(null, 'speed', 4), 1)
  assert.equal(stack.apply('p1', '', 4), 1)
  assert.deepEqual(stack.getAll('p1'), {})
  assert.equal(stack.set(null, 'speed', 4), 1)
})

gate('control: a null player with a key is stored and reads back', () => {
  const stack = createBuffStack({})
  assert.ok(outcomeDiffers(stack.apply('p1', 'speed', 4), 1))
})

gate('buffs decay toward the target without overshooting, and clear removes entries', () => {
  const stack = createBuffStack({ decayPerSec: 1, decayTarget: 1 })
  stack.set('p1', 'a', 3)
  stack.set('p1', 'b', 0.2)
  stack.tick(0.5)
  near(stack.get('p1', 'a'), 2.5)
  near(stack.get('p1', 'b'), 0.7)
  stack.tick(10)
  assert.equal(stack.get('p1', 'a'), 1)
  assert.equal(stack.get('p1', 'b'), 1)
  stack.clear('p1', 'a')
  assert.deepEqual(stack.getAll('p1'), { b: 1 })
  stack.clearAll()
  assert.deepEqual(stack.getAll('p1'), {})
})

gate('control: with decayPerSec 0 a buff holds its value, so the decay claim is not vacuous', () => {
  const stack = createBuffStack({ decayPerSec: 0 })
  stack.set('p1', 'a', 3)
  stack.tick(10)
  assert.ok(outcomeDiffers(stack.get('p1', 'a'), 1))
})

gate('health applies damage, dies once at zero and ignores hits after death', () => {
  const events = []
  const health = createHealth({
    max: 100,
    onDamage: (event) => events.push(['damage', event]),
    onDeath: (event) => events.push(['death', event]),
  })
  assert.equal(health.damage(30, 'gun'), 70)
  assert.deepEqual(events[0], ['damage', { amount: 30, hp: 70, max: 100, source: 'gun' }])
  assert.equal(health.damage(200, 'gun'), 0)
  assert.equal(health.alive, false)
  assert.deepEqual(events[1], ['death', { source: 'gun' }])
  assert.equal(health.damage(5), 0)
  assert.equal(events.length, 2)
})

gate('control: the damage claim is not vacuous, because a hit of 30 is not 0', () => {
  const health = createHealth({ max: 100 })
  assert.ok(outcomeDiffers(health.damage(30), 0))
})

gate('health honours the invulnerability window on the injected clock', () => {
  let clock = 0
  const health = createHealth({ max: 100, invulnMs: 500 }, { now: () => clock })
  assert.equal(health.damage(10), 90)
  clock = 100
  assert.equal(health.damage(10), 90)
  clock = 600
  assert.equal(health.damage(10), 80)
})

gate('control: with no invulnerability window the hit at 100 ms lands', () => {
  let clock = 0
  const health = createHealth({ max: 100 }, { now: () => clock })
  health.damage(10)
  clock = 100
  assert.ok(outcomeDiffers(health.damage(10), 90))
})

gate('health heal caps at max, dead entities do not heal, and non-finite damage is refused', () => {
  const wounded = createHealth({ max: 50, hp: 10 })
  assert.equal(wounded.heal(100), 50)
  const dead = createHealth({ max: 50 })
  dead.kill()
  assert.equal(dead.heal(10), 0)
  const steady = createHealth({ max: 50 })
  assert.equal(steady.damage(NaN), 50)
  assert.equal(steady.damage(-4), 50)
})

gate('control: a healed dead entity would read 10, so the dead-heal claim is not vacuous', () => {
  const dead = createHealth({ max: 50 })
  dead.kill()
  assert.ok(outcomeDiffers(dead.heal(10), 10))
})

gate('health respawn restores max or a given hp, and only a live respawn fires onRespawn', () => {
  let respawns = 0
  const health = createHealth({ max: 50, onRespawn: () => { respawns += 1 } })
  health.damage(60)
  assert.equal(health.alive, false)
  assert.equal(health.respawn(), 50)
  assert.equal(health.alive, true)
  assert.equal(respawns, 1)
  health.kill()
  assert.equal(health.respawn(0), 0)
  assert.equal(health.alive, false)
  assert.equal(respawns, 1)
})

gate('control: a respawn at zero would fire onRespawn, so the respawn claim is not vacuous', () => {
  let respawns = 0
  const health = createHealth({ max: 50, onRespawn: () => { respawns += 1 } })
  health.kill()
  health.respawn(0)
  assert.ok(outcomeDiffers(respawns, 1))
})

gate('health setMax ignores non-positive values and clamps hp down', () => {
  const health = createHealth({ max: 100 })
  assert.equal(health.setMax(40), 40)
  assert.equal(health.hp, 40)
  assert.equal(health.setMax(-1), 40)
  assert.equal(health.setMax(0), 40)
  assert.equal(health.fraction, 1)
  assert.equal(createHealth({ max: 100, hp: 250 }).hp, 100)
  assert.equal(createHealth({ max: 100, hp: 0 }).alive, false)
})

gate('health refuses a missing max and a non-positive max with the spec reason codes', () => {
  refusedWith(() => createHealth({}), 'define-spec-missing-field')
  refusedWith(() => createHealth({ max: 0 }), 'define-spec-invalid-field')
  refusedWith(() => createHealth({ max: 10, bogus: 1 }), 'define-spec-unknown-key')
})

gate('control: a max of 0 passes a schema without the exclusive minimum, so the exclusive minimum is what refuses it', () => {
  const lenientMax = { ...DEFINE_SPEC_SCHEMAS.health, max: { type: 'number', min: 0, required: true } }
  assert.equal(fails(() => parseDefineSpec('defineHealth', { max: 0 }, lenientMax)), false)
  assert.equal(fails(() => createHealth({ max: 0 })), true)
})

gate('specBoundary parses a valid spec with defaults and rejects structural faults', () => {
  const parsed = parseDefineSpec('defineHealth', { max: 10 }, DEFINE_SPEC_SCHEMAS.health)
  assert.deepEqual({ ...parsed }, { max: 10, hp: 10, invulnMs: 0 })
  assert.ok(Object.isFrozen(parsed))
  refusedWith(() => parseDefineSpec('defineHealth', Object.create({ max: 5 }), DEFINE_SPEC_SCHEMAS.health), 'define-spec-inherited-key')
  refusedWith(() => parseDefineSpec('defineNothing', { max: 1 }, undefined), 'define-spec-unknown-factory')
})

gate('control: a spec that drops max is refused, so the required-field claim is not vacuous', () => {
  assert.ok(fails(() => parseDefineSpec('defineHealth', {}, DEFINE_SPEC_SCHEMAS.health)))
})

gate('specBoundary assertDefineSpecKeys refuses unknown keys for a registered factory', () => {
  const spec = { closed: true, spacing: 2 }
  assert.equal(assertDefineSpecKeys('definePathOptions', spec), spec)
  refusedWith(() => assertDefineSpecKeys('definePathOptions', { closed: true, extra: 1 }), 'define-spec-unknown-key')
  refusedWith(() => assertDefineSpecKeys('defineNothing', {}), 'define-spec-unknown-factory')
})

gate('control: a key list that admits extra keys would accept the bogus key, so the key check is not vacuous', () => {
  assert.ok(outcomeDiffers(fails(() => assertDefineSpecKeys('definePathOptions', { closed: true, extra: 1 })), false))
})

gate('specBoundary assertDefineNumber accepts absent values and refuses non-finite or out-of-range ones', () => {
  assertDefineNumber('x', 'y', undefined)
  assertDefineNumber('x', 'y', null)
  assertDefineNumber('x', 'y', 4, { max: 5 })
  refusedWith(() => assertDefineNumber('x', 'y', NaN), 'define-spec-invalid-field')
  refusedWith(() => assertDefineNumber('x', 'y', 0, { min: 0, exclusiveMin: true }), 'define-spec-invalid-field')
  refusedWith(() => assertDefineNumber('x', 'y', 6, { max: 5 }), 'define-spec-invalid-field')
})

gate('control: without a max bound the value 6 is accepted, so the max check is what refuses it', () => {
  assert.equal(fails(() => assertDefineNumber('x', 'y', 6, {})), false)
  assert.equal(fails(() => assertDefineNumber('x', 'y', 6, { max: 5 })), true)
})

gate('triggerVolume fires enter and exit with the injected clock and inclusive bounds', () => {
  let clock = 0
  const log = []
  const volume = createTriggerVolume({
    id: 'door',
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    onEnter: (entityId, event) => log.push(['in', entityId, event.atMs]),
    onExit: (entityId) => log.push(['out', entityId]),
    now: () => clock,
  })
  clock = 5
  const inside = volume.update([{ id: 1, position: [5, 5, 5] }, { id: 2, position: [10, 10, 10] }])
  assert.deepEqual(inside.entered, [1, 2])
  assert.equal(volume.state, 'down')
  assert.deepEqual(log, [['in', 1, 5], ['in', 2, 5]])
  clock = 9
  const outside = volume.update([{ id: 1, position: [50, 0, 0] }])
  assert.deepEqual(outside.exited, [1, 2])
  assert.equal(volume.state, 'up')
  assert.equal(volume.update([{ id: 3, position: [-1, 0, 0] }]).entered.length, 0)
})

gate('control: a point inside the box does enter, so the outside result is the bounds check and not an empty update', () => {
  const volume = createTriggerVolume({ id: 'door', bounds: { min: [0, 0, 0], max: [10, 10, 10] } })
  assert.ok(outcomeDiffers(volume.update([{ id: 5, position: [1, 1, 1] }]).entered, []))
})

gate('triggerVolume rearm holds a re-entry until the rearm window passes', () => {
  let clock = 0
  const entered = []
  const volume = createTriggerVolume({
    id: 'pad',
    bounds: { min: [0, 0, 0], max: [10, 10, 10] },
    onEnter: (entityId) => entered.push(entityId),
    rearmMs: 1000,
    now: () => clock,
  })
  volume.update([{ id: 1, position: [5, 5, 5] }])
  clock = 10
  volume.update([])
  assert.equal(volume.armed, false)
  assert.equal(volume.rearmUntilMs, 1010)
  clock = 20
  volume.update([{ id: 1, position: [5, 5, 5] }])
  assert.deepEqual(entered, [1])
  clock = 1010
  volume.update([{ id: 1, position: [5, 5, 5] }])
  assert.deepEqual(entered, [1, 1])
  assert.equal(volume.armed, true)
})

gate('control: without a rearm window the re-entry at 20 ms fires at once', () => {
  let clock = 0
  const entered = []
  const volume = createTriggerVolume({ id: 'pad', bounds: { min: [0, 0, 0], max: [10, 10, 10] }, onEnter: (entityId) => entered.push(entityId), now: () => clock })
  volume.update([{ id: 1, position: [5, 5, 5] }])
  clock = 10
  volume.update([])
  clock = 20
  volume.update([{ id: 1, position: [5, 5, 5] }])
  assert.ok(outcomeDiffers(entered, [1]))
})

gate('triggerVolume refuses bad bounds, a duplicate id, and a linked state written only on change', () => {
  refusedWith(() => createTriggerVolume({ id: 'x', bounds: { min: [1, 0, 0], max: [0, 1, 1] } }), 'trigger-bounds-invalid')
  const volume = createTriggerVolume({ id: 'x', bounds: { min: [0, 0, 0], max: [1, 1, 1] } })
  refusedWith(() => volume.update([{ id: 1, position: [0, 0, 0] }, { id: 1, position: [1, 1, 1] }]), 'trigger-duplicate-id')
  const writes = []
  const linked = createTriggerVolume({ id: 'lamp', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, linkedState: (write) => writes.push(write.state) })
  linked.update([{ id: 1, position: [0, 0, 0] }])
  linked.update([{ id: 1, position: [0, 0, 0] }])
  linked.update([])
  assert.deepEqual(writes, ['down', 'up'])
})

gate('control: a linked state written every tick would record four writes, so the change-only claim is not vacuous', () => {
  const writes = []
  const linked = createTriggerVolume({ id: 'lamp', bounds: { min: [0, 0, 0], max: [1, 1, 1] }, linkedState: (write) => writes.push(write.state) })
  linked.update([{ id: 1, position: [0, 0, 0] }])
  linked.update([{ id: 1, position: [0, 0, 0] }])
  assert.ok(outcomeDiffers(writes, ['down', 'down']))
})

gate('path measures length, samples points, directions and progress along a polyline', () => {
  const path = definePath([[0, 0, 0], [3, 0, 4]])
  near(path.length, 5)
  assert.equal(path.count, 2)
  nearVec(path.pointAt(2.5), [1.5, 0, 2])
  nearVec(path.directionAt(0), [0.6, 0, 0.8])
  near(path.progressAt([1.5, 0, 2]), 0.5)
  near(path.progressAt([3, 0, 4]), 1)
  nearVec(path.at(9), [3, 0, 4])
})

gate('control: a path of length 5 is not length 4, so the length claim is not vacuous', () => {
  assert.ok(outcomeDiffers(definePath([[0, 0, 0], [3, 0, 4]]).length, 4))
})

gate('path closed ring wraps its last edge and answers nearest and distance queries', () => {
  const ring = definePath([[0, 0, 0], [4, 0, 0], [4, 0, 3]], { closed: true })
  near(ring.length, 12)
  nearVec(ring.at(-1), [4, 0, 3])
  nearVec(ring.at(4), [4, 0, 0])
  near(ring.distance(0, 4), 3.2)
  assert.equal(ring.distance(0, 4, 1), Infinity)
  assert.equal(ring.nearest(0, 4, 1), null)
  near(ring.nearest(0, 4, 4).distance, 3.2)
})

gate('control: the same points as an open path are 7 long, so the closing edge is what makes the ring 12', () => {
  assert.ok(outcomeDiffers(definePath([[0, 0, 0], [4, 0, 0], [4, 0, 3]]).length, 12))
})

gate('path refuses too few points, bad options and a negative spacing', () => {
  refusedWith(() => definePath([[0, 0, 0]]), 'path-points-invalid')
  refusedWith(() => definePath([[0, 0, 0], [1, 0, 0]], { bogus: 1 }), 'define-spec-unknown-key')
  refusedWith(() => definePath([[0, 0, 0], [1, 0, 0]], { spacing: -1 }), 'path-spacing-invalid')
  refusedWith(() => definePath([[0, 0, 0], [1, 0, 0]], { closed: 'yes' }), 'path-closed-invalid')
})

gate('path accepts a valid spacing option on a two-point path', () => {
  assert.equal(refusalOf(() => definePath([[0, 0, 0], [1, 0, 0]], { spacing: 1 })), null)
})

gate('spline registry evaluates a straight three-point spline exactly', () => {
  const registry = createSplineRegistry()
  const described = registry.add('line', [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
  assert.equal(described.segments, 2)
  near(registry.length('line'), 10, 1e-6)
  nearVec(registry.sample('line', 0).position, [0, 0, 0], 1e-6)
  nearVec(registry.sample('line', 1).position, [10, 0, 0], 1e-6)
  nearVec(registry.sample('line', 0.5).position, [5, 0, 0], 1e-6)
  nearVec(registry.sample('line', 0.5).tangent, [1, 0, 0], 1e-6)
  nearVec(registry.frameAt('line', 2.5).position, [2.5, 0, 0], 1e-6)
  const frame = registry.sample('line', 0.3)
  near(Math.hypot(...frame.rotation), 1, 1e-9)
})

gate('control: a spline of length 10 is not length 12, so the length claim is not vacuous', () => {
  const registry = createSplineRegistry()
  registry.add('line', [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
  assert.ok(outcomeDiffers(registry.length('line'), 12))
})

gate('spline project returns the nearest point, distance and fraction along the curve', () => {
  const registry = createSplineRegistry()
  registry.add('line', [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
  const hit = registry.project(4, 3, 0)
  assert.equal(hit.id, 'line')
  near(hit.distance, 3, 1e-6)
  near(hit.t, 0.4, 1e-6)
  nearVec(hit.point, [4, 0, 0], 1e-6)
})

gate('spline refuses unknown ids, out-of-range t and distance, degenerate and short inputs', () => {
  const registry = createSplineRegistry()
  registry.add('line', [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
  refusedWith(() => registry.get('missing'), 'spline-unknown-id')
  refusedWith(() => registry.sample('line', 1.5), 'spline-t-invalid')
  refusedWith(() => registry.frameAt('line', 11), 'spline-distance-invalid')
  refusedWith(() => registry.add('short', [[0, 0, 0]]), 'spline-too-few-points')
  refusedWith(() => registry.add('flat', [[1, 1, 1], [1, 1, 1]]), 'spline-degenerate')
  refusedWith(() => registry.add('axis', [[0, 0, 0], [1, 0, 0]], { tangentAxis: 'y' }), 'spline-tangent-axis-invalid')
  refusedWith(() => createSplineRegistry().project(0, 0, 0), 'spline-no-splines')
  assert.equal(registry.remove('line'), true)
  refusedWith(() => registry.get('line'), 'spline-unknown-id')
})

gate('control: a sample at t 0.5 on a length-10 line is not at x 4, so the midpoint claim is not vacuous', () => {
  const registry = createSplineRegistry()
  registry.add('line', [[0, 0, 0], [5, 0, 0], [10, 0, 0]])
  assert.ok(outcomeDiffers(registry.sample('line', 0.5).position[0], 4))
})

gate('spline closed loop returns to its start', () => {
  const registry = createSplineRegistry()
  registry.add('ring', [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], { closed: true })
  nearVec(registry.sample('ring', 1).position, registry.sample('ring', 0).position, 1e-6)
})

gate('combat config merges defaults and refuses an out-of-rule override', () => {
  assert.deepEqual(resolveCombatConfig({}), { ...DEFAULT_COMBAT })
  assert.equal(resolveCombatConfig({ health: 150 }).health, 150)
  assert.throws(() => resolveCombatConfig({ health: 0 }), (error) => error instanceof TypeError && error.message.includes('spec.config.health'))
  assert.throws(() => resolveCombatConfig({ headshotZone: 1.5 }), (error) => error.message.includes('spec.config.headshotZone'))
})

gate('control: a health of 1 is accepted, so the refusal at 0 is the lower bound and not a blanket refusal', () => {
  assert.equal(resolveCombatConfig({ health: 1 }).health, 1)
  assert.equal(fails(() => resolveCombatConfig({ health: 0 })), true)
})

gate('combat shot damage applies buffs, headshot zone and a clamped kill', () => {
  const body = resolveShotDamage({ config: DEFAULT_COMBAT, hitRatio: 0.1, targetHp: 100 })
  assert.deepEqual(body, { baseDamage: 20, damage: 20, headshot: false, hp: 80, lethal: false })
  const head = resolveShotDamage({ config: DEFAULT_COMBAT, hitRatio: 0.7, targetHp: 100 })
  assert.deepEqual(head, { baseDamage: 20, damage: 50, headshot: true, hp: 50, lethal: false })
  const buffed = resolveShotDamage({ config: DEFAULT_COMBAT, buffDamage: 1.5, hitRatio: 0.7, targetHp: 100 })
  assert.equal(buffed.baseDamage, 30)
  assert.equal(buffed.damage, 75)
  assert.equal(buffed.hp, 25)
  const lethal = resolveShotDamage({ config: DEFAULT_COMBAT, hitRatio: 0, targetHp: 15 })
  assert.deepEqual([lethal.hp, lethal.lethal], [0, true])
  assert.throws(() => resolveShotDamage({ config: DEFAULT_COMBAT, hitRatio: 0, targetHp: NaN }), TypeError)
})

gate('control: a headshot at 0.6 of the zone is not a headshot, so the zone threshold is not vacuous', () => {
  const shot = resolveShotDamage({ config: DEFAULT_COMBAT, hitRatio: 0.6, targetHp: 100 })
  assert.ok(outcomeDiffers(shot.headshot, true))
})

gate('combat health reads are unknown without a finite hp, and regeneration caps at the configured health', () => {
  assert.deepEqual(readHealth({ health: 40 }), { known: true, hp: 40 })
  assert.equal(readHealth({}).known, false)
  assert.throws(() => UNKNOWN_HEALTH.hp, TypeError)
  assert.equal(regenerateHealth(95, DEFAULT_COMBAT, 1), 100)
  near(regenerateHealth(50, DEFAULT_COMBAT, 0.5), 55)
})

gate('control: regeneration without a cap would read 105, so the cap claim is not vacuous', () => {
  assert.ok(outcomeDiffers(regenerateHealth(95, DEFAULT_COMBAT, 1), 105))
})

gate('combat kill streaks count kills inside the window and reset after it', () => {
  let clock = 0
  const tracker = createKillStreakTracker({ now: () => clock })
  assert.equal(tracker.record('a'), 1)
  clock = 2000
  assert.equal(tracker.record('a'), 2)
  clock = 4999
  assert.equal(tracker.record('a'), 3)
  clock = 9000
  assert.equal(tracker.record('a'), 1)
  tracker.forget('a')
  assert.equal(tracker.streakOf('a'), 0)
})

gate('control: a streak that never resets would read 4 at 9000 ms, so the window claim is not vacuous', () => {
  let clock = 0
  const tracker = createKillStreakTracker({ now: () => clock })
  tracker.record('a')
  clock = 9000
  tracker.record('a')
  assert.ok(outcomeDiffers(tracker.record('a'), 3))
})

gate('combat fall timers fire after the grace and reset when the player stops falling', () => {
  const timers = createFallTimers({ graceSec: 0.5 })
  assert.equal(timers.advance('p', 0.3, true), false)
  assert.equal(timers.advance('p', 0.3, true), true)
  assert.equal(timers.advance('p', 0.1, true), false)
  assert.equal(timers.advance('p', 0.1, false), false)
  assert.equal(timers.elapsedOf('p'), 0)
})

gate('control: a fall timer that never resets would fire on the next 0.1 s, so the reset claim is not vacuous', () => {
  const timers = createFallTimers({ graceSec: 0.5 })
  timers.advance('p', 0.4, true)
  timers.advance('p', 0.1, false)
  assert.ok(outcomeDiffers(timers.advance('p', 0.1, true), true))
})

gate('combat powerup pickup is inclusive of its radius', () => {
  assert.equal(isInsidePowerupPickup([1, 0, 0], [0, 0, 0]), true)
  assert.equal(isInsidePowerupPickup([POWERUP_PICKUP_RADIUS, 0, 0], [0, 0, 0]), true)
  assert.equal(isInsidePowerupPickup([2, 0, 0], [0, 0, 0]), false)
})

gate('control: a pickup of 2 m would take a player at 2 m, so the radius claim is not vacuous', () => {
  assert.ok(outcomeDiffers(isInsidePowerupPickup([2, 0, 0], [0, 0, 0], 2), false))
})

gate('destructible accumulates damage to its health, destroys once and ignores later damage', () => {
  let destroyedCount = 0
  const core = createDestructibleCore({ health: 100, onDestroyed: () => { destroyedCount += 1 } })
  assert.equal(core.damage(60), false)
  assert.equal(core.damage(40), true)
  assert.equal(core.damage(10), true)
  assert.equal(core.damageTaken, 100)
  assert.equal(destroyedCount, 1)
})

gate('control: a destructible that never destroys would stay intact at 100 damage, so the destroy claim is not vacuous', () => {
  const core = createDestructibleCore({ health: 100 })
  core.damage(100)
  assert.ok(outcomeDiffers(core.destroyed, false))
})

gate('destructible impact needs a speed at or above the threshold and a zero threshold disables it', () => {
  const core = createDestructibleCore({ health: 50, impactThreshold: 5 })
  assert.equal(core.impact([3, 0, 0]), false)
  assert.equal(core.damageTaken, 0)
  assert.equal(core.impact([0, 4, 3]), true)
  assert.equal(createDestructibleCore({ health: 1 }).impact([100, 0, 0]), false)
})

gate('control: an impact at speed 3 under a threshold of 5 would destroy the core, so the threshold claim is not vacuous', () => {
  const core = createDestructibleCore({ health: 50, impactThreshold: 1 })
  assert.ok(outcomeDiffers(core.impact([3, 0, 0]), false))
})

gate('destructible respawns after its delay on tick and refuses a respawn while intact', () => {
  let respawns = 0
  const core = createDestructibleCore({ health: 10, respawnDelay: 2, onRespawn: () => { respawns += 1 } })
  assert.equal(core.respawn(), false)
  core.destroy()
  core.tick(1)
  assert.equal(core.destroyed, true)
  core.tick(1.5)
  assert.equal(core.destroyed, false)
  assert.equal(core.damageTaken, 0)
  assert.equal(respawns, 1)
})

gate('control: with no respawn delay tick never restores the destructible', () => {
  const core = createDestructibleCore({ health: 10 })
  core.destroy()
  core.tick(100)
  assert.ok(outcomeDiffers(core.destroyed, false))
})

gate('debris timers expire after their lifetime and report the expired ids', () => {
  const timers = createDebrisTimers({ lifetime: 1 })
  const world = { isAtRest: () => false, setMotionType: () => true }
  timers.track('c')
  assert.deepEqual(timers.tick(0.5, world), [])
  assert.deepEqual(timers.tick(0.6, world), ['c'])
  assert.deepEqual(timers.snapshot(), [])
})

gate('control: a debris piece with a 1 s lifetime is not still present at 1.1 s, so the expiry claim is not vacuous', () => {
  const timers = createDebrisTimers({ lifetime: 1 })
  const world = { isAtRest: () => false, setMotionType: () => true }
  timers.track('c')
  timers.tick(1.1, world)
  assert.ok(outcomeDiffers(timers.snapshot().length, 1))
})

gate('debris LOD steps physical, frozen, static and force-freezes at freezeAfter', () => {
  const calls = []
  const world = { isAtRest: () => false, setMotionType: (id, type) => { calls.push([id, type]); return true } }
  const timers = createDebrisTimers({ lifetime: 0, settleGrace: 0.5, freezeAfter: 3 })
  timers.track('b')
  timers.tick(1, world)
  assert.equal(timers.snapshot()[0].lod, 'physical')
  timers.tick(2.5, world)
  assert.equal(timers.snapshot()[0].lod, 'frozen')
  timers.tick(0.1, world)
  assert.equal(timers.snapshot()[0].lod, 'static')
  assert.deepEqual(calls, [['b', 'kinematic'], ['b', 'static']])
})

gate('control: a debris piece that never freezes would stay physical at 3.5 s, so the freeze claim is not vacuous', () => {
  const world = { isAtRest: () => false, setMotionType: () => false }
  const timers = createDebrisTimers({ lifetime: 0, settleGrace: 0.5, freezeAfter: 3 })
  timers.track('b')
  timers.tick(3.5, world)
  assert.ok(outcomeDiffers(timers.snapshot()[0].lod, 'frozen'))
})

gate('destructible geometry helpers give the default impact radius, piece extents and piece mass', () => {
  near(defaultImpactRadius([1, 2, 0.5]), 3)
  assert.deepEqual(pieceExtentsFor(null, [8, 8, 8], 8), [4, 4, 4])
  assert.deepEqual(pieceExtentsFor({ hx: 1, hy: 2, hz: 3 }, [8, 8, 8], 8), [1, 2, 3])
  assert.equal(pieceMassFor(null, 80, 8), 10)
  assert.equal(pieceMassFor(0.01, 80, 8), 0.1)
  assert.equal(pieceMassFor(null, undefined, 1), 50)
})

gate('control: a piece of extent 8 split across 8 pieces is not extent 8, so the division claim is not vacuous', () => {
  assert.ok(outcomeDiffers(pieceExtentsFor(null, [8, 8, 8], 8), [8, 8, 8]))
})

gate('game FSM refuses an undeclared initial state and an unknown transition target', () => {
  const invalidInitial = refusalOf(() => defineGameFSM({ initial: 'nope', states: { a: {} } }, {}))
  assert.ok(invalidInitial instanceof GameFSMError)
  assert.equal(invalidInitial.code, 'game-fsm-initial-undeclared')
  const unknownTarget = refusalOf(() => defineGameFSM({ initial: 'a', states: { a: { on: { GO: 'zzz' } } } }, {}))
  assert.equal(unknownTarget.code, 'game-fsm-transition-unknown-target')
})

gate('game FSM runs exit, then the transition action, then entry, and runs entry on start', () => {
  const log = []
  const fsm = defineGameFSM({
    initial: 'a',
    states: {
      a: { enter: () => log.push('enter a'), exit: () => log.push('exit a'), on: { GO: { target: 'b', action: () => log.push('action') } } },
      b: { enter: () => log.push('enter b') },
    },
  }, {})
  assert.deepEqual(log, ['enter a'])
  assert.deepEqual(fsm.send('GO'), { ok: true, event: 'GO', state: 'b' })
  assert.deepEqual(log, ['enter a', 'exit a', 'action', 'enter b'])
})

gate('control: a machine with no action on its transition logs three entries, so the action claim is not vacuous', () => {
  const log = []
  const fsm = defineGameFSM({
    initial: 'a',
    states: {
      a: { enter: () => log.push('enter a'), exit: () => log.push('exit a'), on: { GO: 'b' } },
      b: { enter: () => log.push('enter b') },
    },
  }, {})
  fsm.send('GO')
  assert.ok(outcomeDiffers(log, ['enter a', 'exit a', 'action', 'enter b']))
})

gate('game FSM takes the first candidate whose guard passes and reads the app context', () => {
  const build = () => defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: [{ target: 'b', guard: (ctx) => ctx.open }, { target: 'c' }] } }, b: {}, c: {} },
  }, { open: false })
  const closed = build()
  closed.send('GO')
  assert.equal(closed.state, 'c')
  const appCtx = { open: true }
  const opened = defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: [{ target: 'b', guard: (ctx) => ctx.open }, { target: 'c' }] } }, b: {}, c: {} },
  }, appCtx)
  opened.send('GO')
  assert.equal(opened.state, 'b')
})

gate('control: with the guard removed the first candidate always wins, so the guard claim is not vacuous', () => {
  const fsm = defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: [{ target: 'b' }, { target: 'c' }] } }, b: {}, c: {} },
  }, { open: false })
  fsm.send('GO')
  assert.ok(outcomeDiffers(fsm.state, 'c'))
})

gate('game FSM final states accept no events and skip their tick hook', () => {
  let ticks = 0
  const fsm = defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: 'done' } }, done: { final: true, tick: () => { ticks += 1 } } },
  }, {})
  fsm.send('GO')
  assert.equal(fsm.send('GO').reason, 'unhandled')
  assert.equal(fsm.can('GO'), false)
  fsm.tick(1)
  assert.equal(ticks, 0)
})

gate('control: a final state with a tick hook would count one tick, so the final-skip claim is not vacuous', () => {
  let ticks = 0
  const fsm = defineGameFSM({ initial: 'done', states: { done: { tick: () => { ticks += 1 } } } }, {})
  fsm.tick(1)
  assert.ok(outcomeDiffers(ticks, 0))
})

gate('game FSM self-target runs exit and entry, and listeners fire only on a value change', () => {
  const log = []
  const seen = []
  const fsm = defineGameFSM({
    initial: 'a',
    states: {
      a: { enter: () => log.push('enter a'), exit: () => log.push('exit a'), on: { LOOP: 'a', GO: 'b' } },
      b: {},
    },
  }, {})
  fsm.onTransition((state) => seen.push(state))
  fsm.send('LOOP')
  assert.deepEqual(log, ['enter a', 'exit a', 'enter a'])
  assert.deepEqual(seen, [])
  fsm.send('GO')
  assert.deepEqual(seen, ['b'])
})

gate('control: a self-target that notifies would add a listener call, so the change-only claim is not vacuous', () => {
  const seen = []
  const fsm = defineGameFSM({ initial: 'a', states: { a: { on: { LOOP: 'a' } } } }, {})
  fsm.onTransition((state) => seen.push(state))
  fsm.send('LOOP')
  assert.ok(outcomeDiffers(seen, ['a']))
})

gate('game FSM after timers fire on tick once the injected clock passes the delay', () => {
  let clock = 0
  const fsm = defineGameFSM({
    initial: 'a',
    states: { a: { after: { 500: 'b' } }, b: {} },
  }, {}, { now: () => clock })
  clock = 400
  fsm.tick(0.4)
  assert.equal(fsm.state, 'a')
  clock = 500
  fsm.tick(0.1)
  assert.equal(fsm.state, 'b')
  clock = 600
  near(fsm.timeInState, 100)
})

gate('control: an after timer with no clock advance never fires, so the timer claim is not vacuous', () => {
  let clock = 0
  const fsm = defineGameFSM({ initial: 'a', states: { a: { after: { 500: 'b' } }, b: {} } }, {}, { now: () => clock })
  fsm.tick(1)
  assert.ok(outcomeDiffers(fsm.state, 'b'))
})

gate('game FSM guards and actions receive the send payload and a payload may not override type', () => {
  const fsm = defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: { target: 'b', guard: (ctx, rt, payload) => payload.amount > 2 } } }, b: {} },
  }, {})
  assert.equal(fsm.send('GO', { amount: 1 }).reason, 'unhandled')
  assert.equal(fsm.send('GO', { amount: 3 }).ok, true)
  assert.throws(() => defineGameFSM({ initial: 'a', states: { a: { on: { GO: 'a' } } } }, {}).send('GO', { type: 'X' }), (error) => error.code === 'game-fsm-payload-overrides-type')
  assert.throws(() => defineGameFSM({ initial: 'a', states: { a: { on: { GO: 'a' } } } }, {}).send('GO', 5), (error) => error.code === 'game-fsm-payload-not-object')
})

gate('control: a payload that is not delivered would leave the guard with amount undefined, so delivery is not vacuous', () => {
  const fsm = defineGameFSM({
    initial: 'a',
    states: { a: { on: { GO: { target: 'b', guard: (ctx, rt, payload) => payload === null } } }, b: {} },
  }, {})
  assert.ok(outcomeDiffers(fsm.send('GO', { amount: 3 }).ok, true))
})

gate('game FSM stop refuses events, clears its clock and rejects undeclared state names', () => {
  const fsm = defineGameFSM({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: {} } }, {})
  assert.equal(fsm.is('a'), true)
  assert.throws(() => fsm.is('zz'), (error) => error.code === 'game-fsm-undeclared-state-name')
  fsm.stop()
  assert.deepEqual(fsm.send('GO'), { ok: false, reason: 'stopped', event: 'GO', state: 'a' })
  assert.equal(fsm.timeInState, 0)
})

gate('control: a stopped machine that still transitions would read b, so the stop claim is not vacuous', () => {
  const fsm = defineGameFSM({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: {} } }, {})
  fsm.stop()
  fsm.send('GO')
  assert.ok(outcomeDiffers(fsm.state, 'b'))
})

gate('behaviour sources import no app context, physics world, renderer or external runtime', () => {
  const forbidden = /from '(\.\.\/(physics|apps|sdk|fluid|animation|client|terrain|render)\/|xstate|@dimforge)|appCtx\.(world|entity|players)|\bctx\.(world|players|raycast)/
  const sources = readdirSync(behaviourDir).filter((name) => name.endsWith('.js'))
  for (const name of sources) {
    const text = readFileSync(join(behaviourDir, name), 'utf8')
    assert.equal(forbidden.test(text), false, name + ' reaches outside the pure set')
  }
})

gate('control: the boundary matcher flags a synthetic physics import, so the boundary check is not vacuous', () => {
  const forbidden = /from '(\.\.\/(physics|apps|sdk|fluid|animation|client|terrain|render)\/|xstate|@dimforge)/
  assert.equal(forbidden.test("import { World } from '../physics/World.js'"), true)
})

gate('behaviour sources carry no comments', () => {
  const sources = readdirSync(behaviourDir).filter((name) => name.endsWith('.js'))
  for (const name of sources) {
    const text = readFileSync(join(behaviourDir, name), 'utf8')
    assert.equal(/^\s*\/\/|^\s*\/\*|\S\s\/\/\s|\*\//m.test(text), false, name + ' has a comment')
  }
})

gate('control: a source with a leading line comment is flagged, so the comment check is not vacuous', () => {
  assert.equal(/^\s*\/\/|^\s*\/\*|\S\s\/\/\s|\*\//m.test('const a = 1\n// note\n'), true)
})

gate('the behaviours barrel re-exports every public name by name', () => {
  const names = [
    'NEUTRAL_BUFF', 'createBuffStack',
    'DEFAULT_COMBAT', 'UNKNOWN_HEALTH', 'POWERUP_PICKUP_RADIUS', 'KILL_STREAK_WINDOW_MS', 'readHealth', 'resolveCombatConfig', 'resolveShotDamage',
    'regenerateHealth', 'isInsidePowerupPickup', 'createKillStreakTracker', 'createFallTimers',
    'defaultImpactRadius', 'pieceExtentsFor', 'pieceMassFor', 'createDestructibleCore', 'createDebrisTimers',
    'GameFSMError', 'defineGameFSM', 'createHealth', 'definePath',
    'DEFINE_SPEC_SCHEMAS', 'DEFINE_SPEC_KEYS', 'parseDefineSpec', 'assertDefineSpecKeys', 'assertDefineNumber',
    'createSplineRegistry', 'createTriggerVolume'
  ]
  assert.deepEqual(names.filter((name) => behaviours[name] === undefined), [])
  assert.equal(behaviours.createHealth, createHealth)
  assert.equal(behaviours.defineGameFSM, defineGameFSM)
})

finish()
