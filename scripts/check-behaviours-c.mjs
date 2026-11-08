import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { defineSteering } from '../src/behaviours/steering.js'
import { COLORBLIND_SAFE_PALETTE, resolveTeamColors } from '../src/behaviours/teams.js'
import { settleTrade, createTradeBook } from '../src/behaviours/trade.js'
import { defineWeapon } from '../src/behaviours/weapon.js'
import { createVoxelPart, restoreVoxelPart } from '../src/behaviours/voxelPart.js'

const here = dirname(fileURLToPath(import.meta.url))
const near = (actual, expected, eps = 1e-9) => {
  assert.ok(Math.abs(actual - expected) <= eps, `expected ${expected}, got ${actual}`)
}
const nearVec = (actual, expected) => {
  assert.equal(actual.length, expected.length)
  expected.forEach((v, i) => near(actual[i], v))
}
const throwsWith = (fn, code) => {
  let caught = null
  try {
    fn()
  } catch (err) {
    caught = err
  }
  assert.ok(caught, 'expected a refusal')
  if (code !== undefined) assert.equal(caught.reasonCode, code)
  return caught
}
const throws = (fn) => throwsWith(fn)

const runsSum = (serialized, value) => {
  let total = 0
  for (let k = 0; k < serialized.cells.length; k += 2) if (serialized.cells[k] === value) total += serialized.cells[k + 1]
  return total
}

const steerNoPeers = (spec, host, from, target, dt, peers) => defineSteering(spec, host).step(from, target, dt, peers)

gate('steering default speed is 3 m/s and moves toward the target', () => {
  const r = steerNoPeers({}, {}, [0, 0, 0], [10, 0, 0], 1)
  nearVec(r.position, [3, 0, 0])
  nearVec(r.velocity, [3, 0, 0])
  assert.equal(r.arrived, false)
})

gate('steering speed 3 with dt 0.5 advances 1.5 m', () => {
  nearVec(steerNoPeers({ speed: 3 }, {}, [0, 0, 0], [10, 0, 0], 0.5).position, [1.5, 0, 0])
})

gate('steering slows inside the arrive radius: 0.25 m away gives 1.5 m/s and arrives', () => {
  const r = steerNoPeers({}, {}, [0, 0, 0], [0.25, 0, 0], 1)
  nearVec(r.position, [1.5, 0, 0])
  nearVec(r.velocity, [1.5, 0, 0])
  assert.equal(r.arrived, true)
})

gate('steering on the target stops with zero velocity and arrived', () => {
  const r = steerNoPeers({}, {}, [2, 0, 2], [2, 0, 2], 1)
  nearVec(r.position, [2, 0, 2])
  nearVec(r.velocity, [0, 0, 0])
  assert.equal(r.arrived, true)
})

gate('steering separation pushes away from a peer 1 m off on the near side: 3 m/s becomes 4.5 m/s', () => {
  const r = steerNoPeers({ separation: 2 }, {}, [0, 0, 0], [10, 0, 0], 1, [[-1, 0, 0]])
  nearVec(r.position, [4.5, 0, 0])
  nearVec(r.velocity, [4.5, 0, 0])
})

gate('steering separation ignores a peer beyond the separation radius', () => {
  nearVec(steerNoPeers({ separation: 2 }, {}, [0, 0, 0], [10, 0, 0], 1, [[-3, 0, 0]]).position, [3, 0, 0])
})

gate('steering separation ignores a peer on the same spot (negative control)', () => {
  nearVec(steerNoPeers({ separation: 2 }, {}, [0, 0, 0], [10, 0, 0], 1, [[0, 0, 0]]).position, [3, 0, 0])
})

gate('steering nav cost of 2 halves the speed to 1.5 m/s', () => {
  const host = { navCostAt: () => 2 }
  nearVec(steerNoPeers({ useNavCost: true }, host, [0, 0, 0], [10, 0, 0], 1).position, [1.5, 0, 0])
})

gate('steering nav cost of 0, NaN or infinity leaves the speed unchanged (negative control)', () => {
  nearVec(steerNoPeers({ useNavCost: true }, { navCostAt: () => 0 }, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
  nearVec(steerNoPeers({ useNavCost: true }, { navCostAt: () => NaN }, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
  nearVec(steerNoPeers({ useNavCost: true }, { navCostAt: () => Infinity }, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
})

gate('steering never reads nav cost when useNavCost is off or the agent is already on target (negative control)', () => {
  let calls = 0
  const host = { navCostAt: () => { calls++; return 2 } }
  nearVec(steerNoPeers({}, host, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
  steerNoPeers({ useNavCost: true }, host, [0, 0, 0], [0, 0, 0], 1)
  assert.equal(calls, 0)
})

gate('steering clamps y to terrain height plus yOffset: 4 + 0.25 gives 4.25', () => {
  const host = { terrainHeightAt: () => 4 }
  nearVec(steerNoPeers({ clampToTerrain: true, yOffset: 0.25 }, host, [0, 0, 0], [10, 0, 0], 1).position, [3, 4.25, 0])
})

gate('steering keeps y when the terrain height is NaN (negative control)', () => {
  nearVec(steerNoPeers({ clampToTerrain: true }, { terrainHeightAt: () => NaN }, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
})

gate('steering never reads terrain height without clampToTerrain (negative control)', () => {
  let calls = 0
  const host = { terrainHeightAt: () => { calls++; return 9 } }
  nearVec(steerNoPeers({}, host, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
  assert.equal(calls, 0)
})

gate('followPath advances waypoints once inside the arrive radius and reports done after the last', () => {
  const agent = defineSteering({}, {})
  const waypoints = [[1, 0, 0], [2, 0, 0]]
  const state = { i: 0 }
  const first = agent.followPath([0.8, 0, 0], waypoints, 0.5, state)
  assert.equal(first.state, state)
  nearVec(first.position, [1.4, 0, 0])
  assert.equal(first.done, false)
  assert.equal(state.i, 1)
  const second = agent.followPath([1.4, 0, 0], waypoints, 0.5, state)
  nearVec(second.position, [2.9, 0, 0])
  assert.equal(second.done, false)
  assert.equal(state.i, 1)
  const third = agent.followPath([1.9, 0, 0], waypoints, 0.5, state)
  nearVec(third.position, [2.2, 0, 0])
  assert.equal(third.done, true)
  assert.equal(state.i, 2)
})

gate('followPath with no waypoints or an empty list is done and returns a copy of the start', () => {
  const agent = defineSteering({}, {})
  const from = [1, 0, 3]
  const empty = agent.followPath(from, [], 1)
  assert.equal(empty.done, true)
  nearVec(empty.velocity, [0, 0, 0])
  assert.notEqual(empty.position, from)
  nearVec(empty.position, [1, 0, 3])
  assert.equal(agent.followPath(from, undefined, 1).done, true)
})

gate('steering refuses a negative or non-finite speed, arrive radius, separation or yOffset', () => {
  throws(() => defineSteering({ speed: -1 }, {}))
  throws(() => defineSteering({ speed: Infinity }, {}))
  throws(() => defineSteering({ arriveRadius: NaN }, {}))
  throws(() => defineSteering({ separation: -0.5 }, {}))
  throws(() => defineSteering({ yOffset: Infinity }, {}))
})

gate('steering refuses a non-boolean flag, an unknown key, a non-object spec or host', () => {
  throws(() => defineSteering({ clampToTerrain: 'yes' }, {}))
  throws(() => defineSteering({ useNavCost: 1 }, {}))
  throws(() => defineSteering({ bogus: 1 }, {}))
  throws(() => defineSteering(null, {}))
  throws(() => defineSteering({}, null))
})

gate('steering treats an undefined spec value as absent and uses the default', () => {
  nearVec(steerNoPeers({ speed: undefined, clampToTerrain: undefined, yOffset: undefined }, {}, [0, 0, 0], [10, 0, 0], 1).position, [3, 0, 0])
})

gate('steering accepts speed 0 and arrive radius 0 (negative control on the refusals)', () => {
  const still = steerNoPeers({ speed: 0 }, {}, [0, 0, 0], [10, 0, 0], 1)
  nearVec(still.position, [0, 0, 0])
  assert.equal(still.arrived, false)
  assert.equal(steerNoPeers({ arriveRadius: 0 }, {}, [0, 0, 0], [0, 0, 0], 1).arrived, true)
})

gate('colourblind palette holds the eight spoint hex values in order and is frozen', () => {
  assert.deepEqual([...COLORBLIND_SAFE_PALETTE], [0x0072B2, 0xE69F00, 0x009E73, 0xCC79A7, 0xF0E442, 0x56B4E9, 0xD55E00, 0x000000])
  assert.equal(Object.isFrozen(COLORBLIND_SAFE_PALETTE), true)
})

gate('teams with colourblind on take palette colours in order', () => {
  assert.deepEqual(resolveTeamColors(['red', 'blue'], true), [
    { id: 'red', label: 'red', color: 0x0072B2 },
    { id: 'blue', label: 'blue', color: 0xE69F00 },
  ])
})

gate('an explicit team colour is kept and does not use a palette slot', () => {
  const out = resolveTeamColors([{ id: 'red', color: 0xff0000 }, 'a', 'b'], true)
  assert.equal(out[0].color, 0xff0000)
  assert.equal(out[1].color, 0x0072B2)
  assert.equal(out[2].color, 0xE69F00)
})

gate('the palette wraps after eight auto-coloured teams: the ninth gets palette slot 0', () => {
  const ids = Array.from({ length: 9 }, (_, i) => `team${i}`)
  const out = resolveTeamColors(ids, true)
  assert.equal(out[7].color, 0x000000)
  assert.equal(out[8].color, 0x0072B2)
})

gate('colourblind off leaves auto colours null and keeps explicit ones (negative control)', () => {
  assert.deepEqual(resolveTeamColors([{ id: 'x', color: 5 }, 'y'], false), [
    { id: 'x', label: 'x', color: 5 },
    { id: 'y', label: 'y', color: null },
  ])
})

gate('a team with color null is auto-coloured when colourblind is on', () => {
  assert.equal(resolveTeamColors([{ id: 'z', color: null }], true)[0].color, 0x0072B2)
})

gate('a label defaults to the id and an explicit label is kept', () => {
  const out = resolveTeamColors([{ id: 'a', label: 'Alpha' }, 'b'], false)
  assert.equal(out[0].label, 'Alpha')
  assert.equal(out[1].label, 'b')
})

gate('team lists refuse a non-array, duplicate ids, empty ids, numeric ids and null entries', () => {
  throws(() => resolveTeamColors('red', true))
  throws(() => resolveTeamColors(['a', 'a'], true))
  throws(() => resolveTeamColors([''], true))
  throws(() => resolveTeamColors([{ id: 7 }], true))
  throws(() => resolveTeamColors([7], true))
  throws(() => resolveTeamColors([null], true))
  throws(() => resolveTeamColors(['a'], 'yes'))
})

const walletA = () => ({ id: 'A', items: { sword: 2 }, currency: 10 })
const walletB = () => ({ id: 'B', items: { shield: 1 }, currency: 0 })

gate('settleTrade swaps items and currency, dropping a count that reaches zero', () => {
  const a = walletA()
  const b = walletB()
  const r = settleTrade({
    proposer: a,
    responder: b,
    offer: { items: { sword: 1 }, currency: 4 },
    request: { items: { shield: 1 } },
  })
  assert.equal(r.ok, true)
  assert.deepEqual(r.proposer, { id: 'A', items: { sword: 1, shield: 1 }, currency: 6 })
  assert.deepEqual(r.responder, { id: 'B', items: { sword: 1 }, currency: 4 })
  assert.equal('shield' in r.responder.items, false)
})

gate('settleTrade leaves the input wallets unchanged', () => {
  const a = walletA()
  const b = walletB()
  settleTrade({ proposer: a, responder: b, offer: { items: { sword: 1 } }, request: { items: { shield: 1 } } })
  assert.deepEqual(a, walletA())
  assert.deepEqual(b, walletB())
})

gate('settleTrade refuses an offer or request the side does not hold', () => {
  const offerTooMany = throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: { items: { sword: 3 } }, request: {} }), 'trade-not-held')
  assert.match(offerTooMany.message, /does not hold 3 of sword/)
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: {}, request: { items: { shield: 2 } } }), 'trade-not-held')
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: { currency: 11 }, request: {} }), 'trade-not-held')
})

gate('settleTrade refuses a trade with oneself and a withdrawn offer', () => {
  throwsWith(() => settleTrade({ proposer: walletA(), responder: { id: 'A', items: {}, currency: 0 }, offer: {}, request: {} }), 'trade-same-party')
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: {}, request: {}, withdrawn: true }), 'trade-withdrawn')
})

gate('settleTrade refuses a bad wallet id, currency or count', () => {
  throwsWith(() => settleTrade({ proposer: { id: '', items: {}, currency: 0 }, responder: walletB(), offer: {}, request: {} }), 'trade-unknown-target')
  throwsWith(() => settleTrade({ proposer: { id: 'A', items: {}, currency: -1 }, responder: walletB(), offer: {}, request: {} }), 'trade-invalid-wallet')
  throwsWith(() => settleTrade({ proposer: { id: 'A', items: { sword: 1.5 }, currency: 0 }, responder: walletB(), offer: {}, request: {} }), 'trade-invalid-wallet')
})

gate('settleTrade refuses a bad side: array, negative count, NaN currency', () => {
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: [], request: {} }), 'trade-invalid-side')
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: { items: { sword: -1 } }, request: {} }), 'trade-invalid-quantity')
  throwsWith(() => settleTrade({ proposer: walletA(), responder: walletB(), offer: { currency: NaN }, request: {} }), 'trade-invalid-quantity')
})

gate('a trade book settles only when both parties accept, and refuses a second settlement', () => {
  const wallets = { A: walletA(), B: walletB() }
  const commits = []
  const book = createTradeBook((id) => wallets[id], (result) => commits.push(result))
  assert.deepEqual(book.offer({ id: 't1', proposerId: 'A', responderId: 'B', offer: { items: { sword: 1 } }, request: { items: { shield: 1 } } }), { ok: true, id: 't1' })
  assert.deepEqual(book.accept({ id: 't1', by: 'A' }), { ok: true, settled: false, waitingFor: 'B' })
  assert.deepEqual(book.status('t1'), { id: 't1', accepted: ['A'], settled: false, withdrawn: false })
  throwsWith(() => book.accept({ id: 't1', by: 'A' }), 'trade-duplicate-accept')
  const done = book.accept({ id: 't1', by: 'B' })
  assert.equal(done.settled, true)
  assert.equal(commits.length, 1)
  assert.equal(done.result.proposer.items.sword, 1)
  throwsWith(() => book.accept({ id: 't1', by: 'B' }), 'trade-already-settled')
})

gate('a trade book refuses a duplicate id, a self trade, a non-party, a withdrawn trade and an unknown trade', () => {
  const book = createTradeBook(() => walletA(), () => {})
  book.offer({ id: 't2', proposerId: 'A', responderId: 'B', offer: {}, request: {} })
  throwsWith(() => book.offer({ id: 't2', proposerId: 'A', responderId: 'B', offer: {}, request: {} }), 'trade-duplicate')
  throwsWith(() => book.offer({ id: 't3', proposerId: 'A', responderId: 'A', offer: {}, request: {} }), 'trade-same-party')
  throwsWith(() => book.offer({ id: '', proposerId: 'A', responderId: 'B', offer: {}, request: {} }), 'trade-invalid-id')
  throwsWith(() => book.accept({ id: 't2', by: 'C' }), 'trade-not-a-party')
  throwsWith(() => book.withdraw({ id: 't2', by: 'C' }), 'trade-not-a-party')
  assert.deepEqual(book.withdraw({ id: 't2', by: 'A' }), { ok: true, withdrawn: true })
  throwsWith(() => book.accept({ id: 't2', by: 'B' }), 'trade-withdrawn')
  throwsWith(() => book.accept({ id: 'nope', by: 'A' }), 'trade-unknown-trade')
})

gate('a failed commit rolls back the accepting party so the trade can be retried', () => {
  const wallets = { A: walletA(), B: walletB() }
  let fail = true
  const book = createTradeBook((id) => wallets[id], () => { if (fail) throw new Error('store down') })
  book.offer({ id: 't4', proposerId: 'A', responderId: 'B', offer: {}, request: {} })
  book.accept({ id: 't4', by: 'A' })
  assert.throws(() => book.accept({ id: 't4', by: 'B' }), /store down/)
  assert.deepEqual(book.status('t4'), { id: 't4', accepted: ['A'], settled: false, withdrawn: false })
  fail = false
  assert.equal(book.accept({ id: 't4', by: 'B' }).settled, true)
})

gate('a trade book refuses non-function hooks', () => {
  throwsWith(() => createTradeBook(null, () => {}), 'trade-invalid-hooks')
  throwsWith(() => createTradeBook(() => {}, 'commit'), 'trade-invalid-hooks')
})

const weaponHost = (overrides = {}) => {
  const clock = { t: 0 }
  const raycasts = []
  const warnings = []
  const records = []
  const host = {
    now: () => clock.t,
    raycast: (origin, dir, range, exclude) => {
      raycasts.push({ origin, dir, range, exclude })
      return overrides.hit ?? { hit: false }
    },
    players: { getAll: () => overrides.players ?? [] },
    eventLog: { record: (kind, payload, meta) => records.push({ kind, payload, meta }) },
    warn: (message) => warnings.push(message),
    ...overrides.host,
  }
  return { clock, host, raycasts, warnings, records }
}

gate('defineWeapon refuses a missing host, a host without players, unknown keys and bad values', () => {
  throws(() => defineWeapon({}))
  throws(() => defineWeapon({}, { now: () => 0, raycast: () => null }))
  throws(() => defineWeapon({}, { now: () => 0, raycast: () => null, players: {} }))
  throws(() => defineWeapon({ bogus: 1 }, weaponHost().host))
  throws(() => defineWeapon({ damage: -1 }, weaponHost().host))
  throws(() => defineWeapon({ range: 0 }, weaponHost().host))
  throws(() => defineWeapon({ onFire: 'x' }, weaponHost().host))
})

gate('an unlimited weapon with no hit reports fired, no hit, infinite ammo and range 100 by default', () => {
  const { host, raycasts } = weaponHost()
  const w = defineWeapon({}, host)
  assert.equal(w.ammo, Infinity)
  assert.deepEqual(w.fire('s', [0, 0, 0], [1, 0, 0]), { fired: true, hit: false, targetPlayerId: null, killed: false, ammo: Infinity })
  assert.equal(raycasts[0].range, 100)
  assert.equal(raycasts[0].exclude, null)
})

gate('fireRateMs 120 refuses a shot 100 ms after the last and allows one at 120 ms', () => {
  const { clock, host } = weaponHost()
  const w = defineWeapon({ fireRateMs: 120 }, host)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).fired, true)
  assert.deepEqual(w.fire('s', [0, 0, 0], [1, 0, 0]), { fired: false, reason: 'cooldown' })
  clock.t = 100
  assert.deepEqual(w.fire('s', [0, 0, 0], [1, 0, 0]), { fired: false, reason: 'cooldown' })
  clock.t = 120
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).fired, true)
})

gate('an empty magazine reloads itself, refuses shots while reloading and refills on the first call after reloadMs', () => {
  const reloads = []
  const { clock, host } = weaponHost()
  const w = defineWeapon({ magazine: 2, fireRateMs: 0, reloadMs: 1500, onReload: (_h, arg) => reloads.push(arg) }, host)
  assert.equal(w.ammo, 2)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).ammo, 1)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).ammo, 0)
  assert.deepEqual(reloads, [{ shooterId: 's' }])
  clock.t = 10
  assert.deepEqual(w.fire('s', [0, 0, 0], [1, 0, 0]), { fired: false, reason: 'reloading' })
  assert.equal(w.reloading, true)
  clock.t = 1499
  assert.equal(w.reloading, true)
  clock.t = 1500
  assert.equal(w.reloading, false)
  assert.equal(w.ammo, 0)
  assert.equal(w.canFire(), true)
  assert.equal(w.ammo, 2)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).fired, true)
})

gate('setAmmo clamps to the magazine, refuses NaN and negatives to 0, and an empty weapon reports empty', () => {
  const { host } = weaponHost()
  const w = defineWeapon({ magazine: 3, fireRateMs: 0 }, host)
  assert.equal(w.setAmmo(99), 3)
  assert.equal(w.setAmmo(NaN), 0)
  assert.equal(w.setAmmo(-5), 0)
  assert.equal(w.setAmmo(0), 0)
  assert.deepEqual(w.fire('s', [0, 0, 0], [1, 0, 0]), { fired: false, reason: 'empty' })
  assert.equal(defineWeapon({}, host).setAmmo(5), Infinity)
})

gate('reload is refused on an unlimited weapon and while already reloading', () => {
  const { host } = weaponHost()
  assert.equal(defineWeapon({}, host).reload('s'), false)
  const w = defineWeapon({ magazine: 3 }, host)
  assert.equal(w.reload('s'), true)
  assert.equal(w.reload('s'), false)
})

gate('a hit on a player inside 2 m of the hit point takes the damage and reports the victim', () => {
  const payloads = []
  const victim = { id: 'v', state: { position: [5.5, 0, 0], health: 100 } }
  const { host, raycasts } = weaponHost({
    hit: { hit: true, position: [5, 0, 0], entityId: 'e1' },
    players: [{ id: 'shooter', state: { position: [0, 0, 0] } }, victim],
  })
  const w = defineWeapon({ damage: 25, fireRateMs: 0, onHit: (_h, p) => payloads.push(p) }, host)
  assert.deepEqual(w.fire('shooter', [0, 0, 0], [1, 0, 0], { excludeBodyId: 'body9' }), { fired: true, hit: true, targetPlayerId: 'v', killed: false, ammo: Infinity })
  assert.equal(victim.state.health, 75)
  assert.deepEqual(payloads, [{ shooterId: 'shooter', targetPlayerId: 'v', targetEntityId: 'e1', point: [5, 0, 0], damage: 25, killed: false }])
  assert.equal(raycasts[0].exclude, 'body9')
})

gate('a headshot doubles the damage by default', () => {
  const victim = { id: 'v', state: { position: [5, 0, 0], health: 100 } }
  const { host } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [victim] })
  defineWeapon({ fireRateMs: 0 }, host).fire('s', [0, 0, 0], [1, 0, 0], { headshot: true })
  assert.equal(victim.state.health, 50)
})

gate('a shot that takes health to 0 or below is a kill and fires onKill with the victim id', () => {
  const kills = []
  const victim = { id: 'v', state: { position: [5, 0, 0], health: 20 } }
  const { host } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [victim] })
  const result = defineWeapon({ damage: 25, fireRateMs: 0, onKill: (_h, k) => kills.push(k) }, host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(result.killed, true)
  assert.equal(victim.state.health, 0)
  assert.deepEqual(kills, [{ shooterId: 's', victimId: 'v' }])
})

gate('a victim with no health field starts at 100 health', () => {
  const victim = { id: 'v', state: { position: [5, 0, 0] } }
  const { host } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [victim] })
  defineWeapon({ damage: 25, fireRateMs: 0 }, host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(victim.state.health, 75)
})

gate('the attribution radius is inclusive at 2 m and a player 2.5 m away is not hit (negative control)', () => {
  const near2 = { id: 'v', state: { position: [7, 0, 0], health: 100 } }
  const payloadsIn = []
  const inside = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [near2] })
  defineWeapon({ damage: 25, fireRateMs: 0, onHit: (_h, p) => payloadsIn.push(p) }, inside.host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(near2.state.health, 75)
  const far = { id: 'v', state: { position: [7.5, 0, 0], health: 100 } }
  const payloadsOut = []
  const outside = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [far] })
  const result = defineWeapon({ damage: 25, fireRateMs: 0, onHit: (_h, p) => payloadsOut.push(p) }, outside.host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(far.state.health, 100)
  assert.equal(result.targetPlayerId, null)
  assert.equal(payloadsOut[0].targetPlayerId, null)
})

gate('a player 2.2 m from the hit point is not hit, pinning the 2 m radius (negative control)', () => {
  const far = { id: 'v', state: { position: [7.2, 0, 0], health: 100 } }
  const { host } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [far] })
  assert.equal(defineWeapon({ damage: 25, fireRateMs: 0 }, host).fire('s', [0, 0, 0], [1, 0, 0]).targetPlayerId, null)
  assert.equal(far.state.health, 100)
})

gate('the shooter and a player without a position are never the victim (negative control)', () => {
  const { host } = weaponHost({
    hit: { hit: true, position: [5, 0, 0] },
    players: [{ id: 's', state: { position: [5, 0, 0], health: 100 } }, { id: 'ghost', state: {} }],
  })
  const result = defineWeapon({ fireRateMs: 0 }, host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(result.hit, true)
  assert.equal(result.targetPlayerId, null)
})

gate('the first player in list order inside the radius is the victim', () => {
  const { host } = weaponHost({
    hit: { hit: true, position: [5, 0, 0] },
    players: [{ id: 'a', state: { position: [5.5, 0, 0], health: 100 } }, { id: 'b', state: { position: [5, 0, 0], health: 100 } }],
  })
  assert.equal(defineWeapon({ fireRateMs: 0 }, host).fire('s', [0, 0, 0], [1, 0, 0]).targetPlayerId, 'a')
})

gate('ten headshots one second apart flag a high headshot ratio once through recordHit', () => {
  const victim = { id: 'v', state: { position: [5, 0, 0], health: 1e9 } }
  const { clock, host, records } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [victim] })
  const w = defineWeapon({ fireRateMs: 0 }, host)
  for (let i = 1; i <= 10; i++) {
    clock.t = i * 1000
    w.fire('gate-weapon-outlier', [0, 0, 0], [1, 0, 0], { headshot: true })
  }
  assert.equal(records.length, 1)
  assert.equal(records[0].kind, 'anticheat_outlier')
  assert.equal(records[0].payload.kind, 'high_headshot_ratio')
  assert.equal(records[0].payload.sampleSize, 10)
})

gate('ten body shots never flag a headshot ratio (negative control)', () => {
  const victim = { id: 'v', state: { position: [5, 0, 0], health: 1e9 } }
  const { clock, host, records } = weaponHost({ hit: { hit: true, position: [5, 0, 0] }, players: [victim] })
  const w = defineWeapon({ fireRateMs: 0 }, host)
  for (let i = 1; i <= 10; i++) {
    clock.t = i * 1000
    w.fire('gate-weapon-quiet', [0, 0, 0], [1, 0, 0])
  }
  assert.equal(records.length, 0)
})

gate('a reload of 0 ms on a clock at 0 refills the magazine on the next shot', () => {
  const { host } = weaponHost()
  const w = defineWeapon({ magazine: 1, fireRateMs: 0, reloadMs: 0 }, host)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).ammo, 0)
  assert.equal(w.fire('s', [0, 0, 0], [1, 0, 0]).fired, true)
})

gate('a throwing callback is reported to warn and does not stop the shot', () => {
  const { host, warnings } = weaponHost({ hit: { hit: true, position: [5, 0, 0] } })
  const result = defineWeapon({ onFire: () => { throw new Error('boom') } }, host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(result.fired, true)
  assert.deepEqual(warnings, ['[weapon] onFire threw: boom'])
})

gate('callbacks receive the host as their first argument', () => {
  let seen = null
  const { host } = weaponHost()
  defineWeapon({ onFire: (h) => { seen = h } }, host).fire('s', [0, 0, 0], [1, 0, 0])
  assert.equal(seen, host)
})

const cubeOf = (size, palette) => createVoxelPart({ size, palette })

gate('createVoxelPart starts with every cell at palette index 0 and reports size, palette and cell count', () => {
  const part = cubeOf([2, 2, 2], ['stone', 'dirt'])
  assert.deepEqual(part.size, [2, 2, 2])
  assert.deepEqual(part.palette, ['stone', 'dirt'])
  assert.equal(part.cellCount, 8)
  assert.equal(part.get(0, 0, 0), 0)
})

gate('set returns the part for chaining and get reads the written index', () => {
  const part = cubeOf([2, 2, 2], ['stone', 'dirt'])
  assert.equal(part.set(1, 0, 1, 1), part)
  assert.equal(part.get(1, 0, 1), 1)
  assert.equal(part.get(0, 0, 1), 0)
})

gate('fill accepts reversed corners and covers the whole box', () => {
  const part = cubeOf([2, 2, 2], ['a', 'b'])
  part.fill({ from: [1, 1, 1], to: [0, 0, 0] }, 1)
  assert.deepEqual(part.serialize().cells, [1, 8])
})

gate('fill covers only the requested box: the bottom layer of a 2x2x2 part', () => {
  const part = cubeOf([2, 2, 2], ['a', 'b'])
  part.fill([[0, 0, 0], [1, 1, 0]], 1)
  assert.deepEqual(part.serialize().cells, [1, 4, 0, 4])
})

gate('hollowBox of thickness 1 in a 3x3x3 box leaves only the centre empty: 26 shell cells', () => {
  const part = cubeOf([3, 3, 3], ['a', 'b'])
  part.hollowBox([[0, 0, 0], [2, 2, 2]], 1, 1)
  const s = part.serialize()
  assert.equal(runsSum(s, 1), 26)
  assert.equal(part.get(1, 1, 1), 0)
})

gate('sphere of radius 1 at the centre of a 3x3x3 part covers the centre and its six face neighbours: 7 cells', () => {
  const part = cubeOf([3, 3, 3], ['a', 'b'])
  part.sphere([1, 1, 1], 1, 1)
  assert.equal(runsSum(part.serialize(), 1), 7)
  assert.equal(part.get(0, 1, 1), 1)
  assert.equal(part.get(0, 0, 0), 0)
})

gate('serialize run-length encodes runs of equal index', () => {
  assert.deepEqual(cubeOf([4, 1, 1], ['a', 'b']).serialize(), { size: [4, 1, 1], palette: ['a', 'b'], cells: [0, 4] })
  const part = cubeOf([2, 1, 1], ['a', 'b'])
  part.set(1, 0, 0, 1)
  assert.deepEqual(part.serialize().cells, [0, 1, 1, 1])
})

gate('restoreVoxelPart reproduces the cells of a serialized part', () => {
  const part = cubeOf([3, 2, 1], ['a', 'b', 'c'])
  part.set(2, 1, 0, 2)
  part.fill([[0, 0, 0], [0, 0, 0]], 1)
  const copy = restoreVoxelPart(part.serialize())
  assert.deepEqual(copy.serialize(), part.serialize())
  assert.equal(copy.get(2, 1, 0), 2)
  assert.equal(copy.get(0, 0, 0), 1)
})

gate('part.restore replaces size, palette and cells and returns the part', () => {
  const part = cubeOf([1, 1, 1], ['a'])
  assert.equal(part.restore({ size: [2, 1, 1], palette: ['a', 'b'], cells: [1, 2] }), part)
  assert.deepEqual(part.size, [2, 1, 1])
  assert.equal(part.get(0, 0, 0), 1)
})

gate('size and palette getters return copies, so a caller cannot change the part', () => {
  const part = cubeOf([2, 2, 2], ['a'])
  part.size.push(9)
  part.palette.push('z')
  assert.deepEqual(part.size, [2, 2, 2])
  assert.deepEqual(part.palette, ['a'])
})

gate('createVoxelPart refuses a bad size: wrong length, zero, fraction, and over 4194304 cells', () => {
  throwsWith(() => createVoxelPart({ size: [0, 1, 1], palette: ['a'] }), 'voxel-size-invalid')
  throwsWith(() => createVoxelPart({ size: [2, 2], palette: ['a'] }), 'voxel-size-invalid')
  throwsWith(() => createVoxelPart({ size: [1.5, 1, 1], palette: ['a'] }), 'voxel-size-invalid')
  throwsWith(() => createVoxelPart({ size: [256, 256, 256], palette: ['a'] }), 'voxel-size-invalid')
})

gate('createVoxelPart accepts exactly 4194304 cells (negative control on the size limit)', () => {
  assert.equal(createVoxelPart({ size: [128, 128, 256], palette: ['a'] }).cellCount, 4194304)
})

gate('createVoxelPart refuses a bad palette and a non-object spec', () => {
  throwsWith(() => createVoxelPart({ size: [1, 1, 1], palette: [] }), 'voxel-palette-invalid')
  throwsWith(() => createVoxelPart({ size: [1, 1, 1], palette: [1] }), 'voxel-palette-invalid')
  throwsWith(() => createVoxelPart(null), 'voxel-spec-invalid')
  throwsWith(() => createVoxelPart([]), 'voxel-spec-invalid')
})

gate('voxel writes refuse an out-of-range coordinate, a bad palette index, and a bad box', () => {
  const part = cubeOf([2, 2, 2], ['a', 'b'])
  throwsWith(() => part.set(2, 0, 0, 0), 'voxel-out-of-bounds')
  throwsWith(() => part.get(-1, 0, 0), 'voxel-out-of-bounds')
  throwsWith(() => part.get(0.5, 0, 0), 'voxel-out-of-bounds')
  throwsWith(() => part.set(0, 0, 0, 2), 'voxel-index-invalid')
  throwsWith(() => part.set(0, 0, 0, 0.5), 'voxel-index-invalid')
  throwsWith(() => part.fill('box', 0), 'voxel-box-invalid')
  throwsWith(() => part.fill([[0, 0, 0], [2, 0, 0]], 0), 'voxel-out-of-bounds')
  throwsWith(() => part.hollowBox([[0, 0, 0], [1, 1, 1]], 0, 0), 'voxel-thickness-invalid')
  throwsWith(() => part.sphere([0, 0, 0], 0, 0), 'voxel-radius-invalid')
  throwsWith(() => part.sphere([5, 0, 0], 1, 0), 'voxel-out-of-bounds')
})

gate('a sphere centre may be fractional inside the part (negative control on the centre rule)', () => {
  const part = cubeOf([2, 1, 1], ['a', 'b'])
  part.sphere([0.5, 0, 0], 0.5, 1)
  assert.equal(part.get(0, 0, 0), 1)
  assert.equal(part.get(1, 0, 0), 1)
})

gate('restoreVoxelPart refuses a malformed record', () => {
  throwsWith(() => restoreVoxelPart(null), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [1, 1, 1], palette: ['a'] }), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [1, 1, 1], palette: ['a'], cells: [0] }), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [1, 1, 1], palette: ['a'], cells: [5, 1] }), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [1, 1, 1], palette: ['a'], cells: [0, 0] }), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [2, 1, 1], palette: ['a'], cells: [0, 1] }), 'voxel-record-invalid')
  throwsWith(() => restoreVoxelPart({ size: [2, 1, 1], palette: ['a'], cells: [0, 3] }), 'voxel-record-invalid')
})

gate('the five modules carry no comments and no host globals', () => {
  const names = ['steering.js', 'teams.js', 'trade.js', 'weapon.js', 'voxelPart.js']
  const banned = [/\/\//, /\/\*/, /\bDate\.now\b/, /\bperformance\./, /\bconsole\./, /\bsetTimeout\b/, /\bglobalThis\b/, /\bMath\.random\b/, /\bprocess\./, /\bwindow\./]
  for (const name of names) {
    const text = readFileSync(join(here, '..', 'src', 'behaviours', name), 'utf8')
    for (const pattern of banned) assert.equal(pattern.test(text), false, `${name} matches ${pattern}`)
  }
})

finish()
