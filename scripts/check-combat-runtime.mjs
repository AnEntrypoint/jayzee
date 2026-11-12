import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createCombatRuntime, placePowerups, COMBAT_REFUSAL, DEFAULT_POWERUP_KINDS } from '../src/behaviours/combatRuntime.js'
import { DEFAULT_COMBAT, POWERUP_PICKUP_RADIUS } from '../src/behaviours/combat.js'
import { LagCompensator } from '../src/netcode/lagCompensation.js'
import { PlayerManager } from '../src/netcode/playerManager.js'

const SPAWNS = [[0, 0, 0], [20, 0, 0], [0, 0, 20], [40, 0, 40]]

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

function arena(options = {}) {
  let nowMs = 10000
  const now = () => nowMs
  const manager = new PlayerManager({ now, log: () => {} })
  const sent = []
  const broadcasts = []
  const impulses = []
  const players = {
    list: () => manager.getAllPlayers(),
    get: (id) => manager.getPlayer(id),
    teleport: (id, position) => { const s = manager.getPlayer(id).state; s.position[0] = position[0]; s.position[1] = position[1]; s.position[2] = position[2] },
    applyImpulse: (id, impulse) => impulses.push([id, [...impulse]]),
  }
  const runtime = createCombatRuntime({
    players, now,
    send: (id, message) => sent.push([id, message]),
    broadcast: (message) => broadcasts.push(message),
    spawnPoints: SPAWNS,
    ...options,
  })
  const ids = [0, 1, 2].map(() => manager.addPlayer(null, {}))
  for (const id of ids) runtime.join(id)
  const place = (id, position) => players.teleport(id, position)
  const aim = (from, to) => {
    const a = manager.getPlayer(from).state.position, b = manager.getPlayer(to).state.position
    return [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
  }
  const passInvulnerability = () => { nowMs += DEFAULT_COMBAT.spawnInvulnMs + 1 }
  return { runtime, manager, players, ids, sent, broadcasts, impulses, place, aim, passInvulnerability, advance(ms) { nowMs += ms }, now }
}

const sentTo = (a, id, type) => a.sent.filter(([to, message]) => to === id && message.type === type).map(([, message]) => message)

gate('three players who join are put on three different spawn points, each the farthest from those already placed', () => {
  const a = arena()
  const positions = a.ids.map((id) => a.manager.getPlayer(id).state.position.join(','))
  assert.deepEqual(positions, ['0,0,0', '40,0,40', '20,0,0'])
  assert.equal(sentTo(a, a.ids[0], 'combat_state')[0].hp, 100)
})

gate('a body shot costs one round, takes 20 hp, and tells the target and the shooter', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  const result = a.runtime.handleMessage(shooter, { type: 'fire', direction: a.aim(shooter, target) })
  assert.deepEqual({ ok: result.ok, hit: result.hit, target: result.target, damage: result.damage, headshot: result.headshot, lethal: result.lethal, ammo: result.ammo }, { ok: true, hit: true, target, damage: 20, headshot: false, lethal: false, ammo: 29 })
  assert.equal(a.runtime.stateOf(target).hp, 80)
  assert.deepEqual(sentTo(a, target, 'hit'), [{ type: 'hit', by: shooter, damage: 20, headshot: false, hp: 80 }])
  assert.deepEqual(sentTo(a, shooter, 'hit_confirm'), [{ type: 'hit_confirm', target, damage: 20, headshot: false, lethal: false }])
})

gate('a shot aimed at the top of the capsule is a headshot for 50', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [10, 0, 0])
  const result = a.runtime.fire(shooter, { direction: [10, 1.45 - 0.9, 0] })
  assert.equal(result.headshot, true)
  assert.equal(result.damage, 50)
})

gate('a shot within the spawn invulnerability window lands and does no damage', () => {
  const a = arena()
  const [shooter, target] = a.ids
  const result = a.runtime.fire(shooter, { direction: a.aim(shooter, target) })
  assert.equal(result.hit, true)
  assert.equal(result.invulnerable, true)
  assert.equal(a.runtime.stateOf(target).hp, 100)
})

gate('a wall nearer than the target blocks the shot, and a wall behind the target does not', () => {
  let wallAt = 5
  const a = arena({ raycast: () => ({ distance: wallAt }) })
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [10, 0, 0])
  const blocked = a.runtime.fire(shooter, { direction: [1, 0, 0] })
  assert.deepEqual({ hit: blocked.hit, blocked: blocked.blocked }, { hit: false, blocked: true })
  assert.equal(a.runtime.stateOf(target).hp, 100)
  wallAt = 15
  assert.equal(a.runtime.fire(shooter, { direction: [1, 0, 0] }).hit, true)
  assert.equal(a.runtime.getStats().blocked, 1)
})

gate('the nearest of two players in line takes the hit', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, near, far] = a.ids
  a.place(near, [10, 0, 0])
  a.place(far, [20, 0, 0])
  assert.equal(a.runtime.fire(shooter, { direction: [1, 0, 0] }).target, near)
})

gate('five body shots kill: the kill is broadcast, the scoreboard counts it and the victim cannot fire while dead', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  let last
  for (let i = 0; i < 5; i++) last = a.runtime.fire(shooter, { direction: a.aim(shooter, target) })
  assert.equal(last.lethal, true)
  assert.deepEqual(a.broadcasts.filter((m) => m.type === 'kill'), [{ type: 'kill', killer: shooter, victim: target, cause: 'shot', headshot: false, streak: 1 }])
  assert.deepEqual(a.runtime.scoreboard()[0], { id: shooter, kills: 1, deaths: 0, streak: 1, alive: true })
  assert.equal(a.runtime.fire(target, { direction: [1, 0, 0] }).reason, COMBAT_REFUSAL.DEAD)
  assert.equal(a.runtime.stateOf(target).alive, false)
})

gate('a dead player is not a target: a shot through the body hits the player behind it', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, near, far] = a.ids
  a.place(near, [10, 0, 0])
  a.place(far, [20, 0, 0])
  for (let i = 0; i < 5; i++) a.runtime.fire(shooter, { direction: [1, 0, 0] })
  assert.equal(a.runtime.stateOf(near).alive, false)
  assert.equal(a.runtime.fire(shooter, { direction: [1, 0, 0] }).target, far)
})

gate('the dead player respawns after 1.5 s at the spawn point farthest from the living, with full health and a full magazine', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [3, 0, 0])
  for (let i = 0; i < 5; i++) a.runtime.fire(shooter, { direction: a.aim(shooter, target) })
  a.advance(1400)
  a.runtime.tick(0.016)
  assert.equal(a.runtime.stateOf(target).alive, false)
  a.advance(200)
  a.runtime.tick(0.016)
  const state = a.runtime.stateOf(target)
  assert.deepEqual({ alive: state.alive, hp: state.hp, ammo: state.ammo, invulnerable: state.invulnerable, deaths: state.deaths }, { alive: true, hp: 100, ammo: 30, invulnerable: true, deaths: 1 })
  assert.deepEqual(a.manager.getPlayer(target).state.position, [40, 0, 40])
  assert.deepEqual(a.broadcasts.filter((m) => m.type === 'respawn'), [{ type: 'respawn', player: target, spawnIndex: 3 }])
})

gate('two kills inside 3 s make a streak of 2, and a kill after the window starts again at 1', () => {
  const a = arena({ config: { damagePerHit: 100 } })
  a.passInvulnerability()
  const [shooter, first, second] = a.ids
  a.runtime.fire(shooter, { direction: a.aim(shooter, first) })
  a.advance(1000)
  a.runtime.fire(shooter, { direction: a.aim(shooter, second) })
  assert.deepEqual(a.broadcasts.filter((m) => m.type === 'kill').map((m) => m.streak), [1, 2])
  a.advance(5000)
  a.runtime.tick(0.016)
  a.advance(2000)
  a.runtime.fire(shooter, { direction: a.aim(shooter, first) })
  assert.deepEqual(a.broadcasts.filter((m) => m.type === 'kill').map((m) => m.streak), [1, 2, 1])
})

gate('the magazine empties after 30 shots: the 30th starts a reload, a shot during it is refused, and 2 s later the magazine is full', () => {
  const a = arena()
  const [shooter] = a.ids
  for (let i = 0; i < 30; i++) assert.equal(a.runtime.fire(shooter, { direction: [0, 1, 0] }).ok, true)
  assert.equal(a.runtime.stateOf(shooter).reloading, true)
  assert.equal(a.runtime.fire(shooter, { direction: [0, 1, 0] }).reason, COMBAT_REFUSAL.RELOADING)
  a.advance(1999)
  a.runtime.tick(0.016)
  assert.equal(a.runtime.stateOf(shooter).ammo, 0)
  a.advance(1)
  a.runtime.tick(0.016)
  assert.deepEqual([a.runtime.stateOf(shooter).ammo, a.runtime.stateOf(shooter).reloading], [30, false])
  assert.deepEqual(sentTo(a, shooter, 'reloaded'), [{ type: 'reloaded', ammo: 30 }])
})

gate('a reload message is refused on a full magazine and accepted after one shot', () => {
  const a = arena()
  const [shooter] = a.ids
  assert.equal(a.runtime.handleMessage(shooter, { type: 'reload' }).reason, COMBAT_REFUSAL.FULL)
  a.runtime.fire(shooter, { direction: [0, 1, 0] })
  assert.equal(a.runtime.handleMessage(shooter, { type: 'reload' }).ok, true)
})

gate('each shot pushes the shooter back by 2 and the target on by 4 along the shot', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [10, 0, 0])
  a.runtime.fire(shooter, { direction: [3, 0, 0] })
  assert.deepEqual(a.impulses, [[shooter, [-2, -0, -0]], [target, [4, 0, 0]]])
})

gate('a player below the fall depth for longer than the 0.5 s grace dies with no killer; a shorter dip does not', () => {
  const a = arena()
  const [faller, dipper] = a.ids
  a.place(faller, [0, -25, 0])
  a.place(dipper, [50, -25, 0])
  for (let i = 0; i < 3; i++) a.runtime.tick(0.1)
  a.place(dipper, [50, 0, 0])
  for (let i = 0; i < 3; i++) a.runtime.tick(0.1)
  assert.equal(a.runtime.stateOf(faller).alive, false)
  assert.equal(a.runtime.stateOf(dipper).alive, true)
  assert.deepEqual(a.broadcasts.filter((m) => m.type === 'kill'), [{ type: 'kill', killer: null, victim: faller, cause: 'fall', headshot: false, streak: 0 }])
})

gate('a damage powerup doubles the next shot to 40 for its 10 s and then lapses to 20', () => {
  const a = arena({ powerups: [{ id: 'p', position: [5, 0, 5], kind: 'damage', multiplier: 2, durationMs: 10000 }] })
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(shooter, [5, 0, 5 + POWERUP_PICKUP_RADIUS - 0.01])
  a.runtime.tick(0.016)
  assert.equal(a.runtime.stateOf(shooter).damageMultiplier, 2)
  assert.equal(a.runtime.fire(shooter, { direction: a.aim(shooter, target) }).damage, 40)
  a.advance(10001)
  assert.equal(a.runtime.fire(shooter, { direction: a.aim(shooter, target) }).damage, 20)
})

gate('a taken powerup is gone for the others, is announced, and comes back after its respawn time', () => {
  const a = arena({ powerups: [{ id: 'p', position: [5, 0, 5], kind: 'health', amount: 50 }], powerupRespawnMs: 4000 })
  const [first, second] = a.ids
  a.place(first, [5, 0, 5])
  a.runtime.tick(0.016)
  a.place(first, [90, 0, 90])
  a.place(second, [5, 0, 5])
  a.runtime.tick(0.016)
  assert.equal(a.broadcasts.filter((m) => m.type === 'powerup_taken').length, 1)
  assert.equal(a.broadcasts.find((m) => m.type === 'powerup_taken').by, first)
  a.advance(4000)
  a.runtime.tick(0.016)
  assert.equal(a.broadcasts.filter((m) => m.type === 'powerup_ready').length, 1)
  a.runtime.tick(0.016)
  assert.equal(a.broadcasts.filter((m) => m.type === 'powerup_taken').length, 2)
})

gate('a player just outside the 1.7 m pickup radius does not take the powerup', () => {
  const a = arena({ powerups: [{ id: 'p', position: [5, 0, 5], kind: 'health', amount: 50 }] })
  a.place(a.ids[0], [5, 0, 5 + POWERUP_PICKUP_RADIUS + 0.01])
  a.runtime.tick(0.016)
  assert.equal(a.runtime.powerupStates()[0].active, true)
})

gate('a regen powerup heals a hurt player at 10 percent of full health per second and stops at full', () => {
  const a = arena({ powerups: [{ id: 'p', position: [20, 0, 0], kind: 'regen', durationMs: 60000 }] })
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [10, 0, 0])
  for (let i = 0; i < 2; i++) a.runtime.fire(shooter, { direction: a.aim(shooter, target) })
  assert.equal(a.runtime.stateOf(target).hp, 60)
  a.place(target, [20, 0, 0])
  a.runtime.tick(0)
  for (let i = 0; i < 10; i++) a.runtime.tick(0.1)
  assert.ok(Math.abs(a.runtime.stateOf(target).hp - 70) < 1e-9, 'hp ' + a.runtime.stateOf(target).hp)
  for (let i = 0; i < 100; i++) a.runtime.tick(0.1)
  assert.equal(a.runtime.stateOf(target).hp, 100)
})

gate('a health powerup heals 50 and never past full health', () => {
  const a = arena({ powerups: [{ id: 'p', position: [20, 0, 0], kind: 'health', amount: 50 }] })
  a.passInvulnerability()
  const [shooter, target] = a.ids
  a.place(target, [10, 0, 0])
  a.runtime.fire(shooter, { direction: a.aim(shooter, target) })
  a.place(target, [20, 0, 0])
  a.runtime.tick(0.016)
  assert.equal(a.runtime.stateOf(target).hp, 100)
})

gate('the scoreboard orders by kills, then fewer deaths, then id, and a scoreboard message sends it to the asker', () => {
  const a = arena({ config: { damagePerHit: 100 } })
  a.passInvulnerability()
  const [one, two, three] = a.ids
  a.runtime.fire(two, { direction: a.aim(two, one) })
  a.advance(4000)
  a.runtime.tick(0.016)
  a.passInvulnerability()
  a.runtime.fire(three, { direction: a.aim(three, one) })
  const rows = a.runtime.handleMessage(one, { type: 'scoreboard' }).rows
  assert.deepEqual(rows.map((row) => [row.id, row.kills, row.deaths]), [[two, 1, 0], [three, 1, 0], [one, 0, 2]])
  assert.deepEqual(sentTo(a, one, 'scoreboard')[0].rows, rows)
})

gate('a shot with a view tick is resolved against the rewound target: it hits where the target was, not where it is', () => {
  let nowMs = 0
  const lag = new LagCompensator(1000, 60, () => nowMs)
  const a = arena({ lagComp: lag })
  a.passInvulnerability()
  const [shooter, target, bystander] = a.ids
  a.place(bystander, [0, 0, -60])
  for (let tick = 1; tick <= 30; tick++) {
    nowMs += 1000 / 60
    a.place(target, [10, 0, tick < 20 ? 0 : 8])
    lag.beginTick(tick)
    for (const id of a.ids) lag.recordPlayerPosition(id, a.manager.getPlayer(id).state.position, [0, 0, 0, 1], [0, 0, 0], tick)
  }
  const rewound = a.runtime.fire(shooter, { direction: [1, 0, 0], viewTick: 10 })
  assert.deepEqual([rewound.hit, rewound.target, rewound.rewound], [true, target, true])
  const present = a.runtime.fire(shooter, { direction: [1, 0, 0], viewTick: 29 })
  assert.equal(present.hit, false)
})

gate('message refusals name the cause: not an object, no type, an unknown type, a sender who has not joined, a zero direction', () => {
  const a = arena()
  const [shooter] = a.ids
  assert.equal(a.runtime.handleMessage(shooter, 'fire').reason, COMBAT_REFUSAL.MESSAGE_SHAPE)
  assert.equal(a.runtime.handleMessage(shooter, {}).reason, COMBAT_REFUSAL.MESSAGE_SHAPE)
  assert.equal(a.runtime.handleMessage(shooter, { type: 'dance' }).reason, COMBAT_REFUSAL.UNKNOWN_MESSAGE)
  assert.equal(a.runtime.handleMessage(999, { type: 'fire', direction: [1, 0, 0] }).reason, COMBAT_REFUSAL.NOT_JOINED)
  assert.equal(a.runtime.handleMessage(shooter, { type: 'fire', direction: [0, 0, 0] }).reason, COMBAT_REFUSAL.DIRECTION)
  assert.equal(a.runtime.stateOf(shooter).ammo, 30)
  assert.equal(a.runtime.join(shooter).reason, COMBAT_REFUSAL.ALREADY_JOINED)
  assert.equal(a.runtime.getStats().refused, 6)
})

gate('a player who leaves is no longer a target and no longer on the scoreboard', () => {
  const a = arena()
  a.passInvulnerability()
  const [shooter, target] = a.ids
  assert.equal(a.runtime.leave(target), true)
  assert.equal(a.runtime.fire(shooter, { direction: a.aim(shooter, target) }).hit, false)
  assert.equal(a.runtime.scoreboard().some((row) => row.id === target), false)
})

gate('powerup placement is seeded: 6 powerups on the ground inside the area, each pair at least 3.4 m apart, the same list for the same seed', () => {
  const groundAt = (x, z) => 0.1 * x + 0.05 * z
  const run = (seed) => placePowerups({ count: 6, min: [0, -5, 0], max: [40, 20, 40], random: mulberry(seed), groundAt })
  const first = run(11)
  assert.equal(first.powerups.length, 6)
  assert.equal(first.short, 0)
  for (const p of first.powerups) {
    assert.ok(p.position[0] >= 0 && p.position[0] <= 40 && p.position[2] >= 0 && p.position[2] <= 40, 'outside the area')
    assert.ok(Math.abs(p.position[1] - groundAt(p.position[0], p.position[2])) < 1e-12, 'off the ground')
    assert.ok(DEFAULT_POWERUP_KINDS.some((kind) => kind.kind === p.kind), 'unknown kind ' + p.kind)
  }
  for (let i = 0; i < 6; i++) for (let j = i + 1; j < 6; j++) {
    const a = first.powerups[i].position, b = first.powerups[j].position
    assert.ok(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) >= 2 * POWERUP_PICKUP_RADIUS, 'powerups ' + i + ' and ' + j + ' overlap')
  }
  assert.deepEqual(run(11), first)
  assert.notDeepEqual(run(12).powerups, first.powerups)
})

gate('placement skips ground that is missing and reports how many it could not place', () => {
  const none = placePowerups({ count: 3, min: [0, 0, 0], max: [10, 10, 10], random: mulberry(1), groundAt: () => null })
  assert.deepEqual([none.powerups.length, none.short, none.tries], [0, 3, 96])
  const cramped = placePowerups({ count: 5, min: [0, 0, 0], max: [3, 1, 3], random: mulberry(1), groundAt: () => 0 })
  assert.ok(cramped.powerups.length >= 1 && cramped.short >= 1, cramped.powerups.length + ' placed in a 3 m square')
})

gate('placed powerups feed the runtime: a player standing on one takes it', () => {
  const placed = placePowerups({ count: 2, min: [50, 0, 50], max: [70, 0, 70], random: mulberry(3), groundAt: () => 0 })
  const a = arena({ powerups: placed.powerups })
  a.place(a.ids[0], placed.powerups[1].position)
  a.runtime.tick(0.016)
  assert.deepEqual(a.runtime.powerupStates().map((p) => p.active), [true, false])
})

gate('the runtime refuses to be built without players, a clock, send and broadcast, or with a bad spawn list or config', () => {
  const base = { players: { list: () => [], get: () => null }, now: () => 0, send: () => {}, broadcast: () => {} }
  assert.throws(() => createCombatRuntime({ ...base, players: {} }), TypeError)
  assert.throws(() => createCombatRuntime({ ...base, now: null }), TypeError)
  assert.throws(() => createCombatRuntime({ ...base, send: null }), TypeError)
  assert.throws(() => createCombatRuntime({ ...base, spawnPoints: [] }), TypeError)
  assert.throws(() => createCombatRuntime({ ...base, config: { magazineSize: 0 } }), TypeError)
  assert.throws(() => createCombatRuntime({ ...base, powerups: [{ id: 'x' }] }), TypeError)
  assert.throws(() => createCombatRuntime(base).tick(NaN), RangeError)
})

gate('the module reads no host clock or random source and carries no comment', () => {
  const source = readFileSync(new URL('../src/behaviours/combatRuntime.js', import.meta.url), 'utf8')
  assert.equal(source.includes('//') || source.includes('/*'), false)
  for (const host of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random']) assert.equal(source.includes(host), false, host)
})

finish()
