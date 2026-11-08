import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { AccountStateError, accountIdOf, createAccountState } from '../src/apps/AccountState.js'
import { createPersistedStore } from '../src/apps/persistedStore.js'
import { SeatError, createSeatTable, normalizeSeatDef } from '../src/apps/AppSeats.js'
import { tagAppState, untagAppState } from '../src/apps/AppRuntimeState.js'
import { captureTransform, mixinStaticMotion } from '../src/apps/AppRuntimeStaticMotion.js'
import { parseInteractable } from '../src/apps/AppPhysics.js'
import { MAX_FOOTPRINT_INTRUSION_M, capsuleHeightM, capsuleRadiusM, footprintBlockers } from '../src/apps/AppGameplay.js'

const fakeTimers = () => {
  let now = 0
  let nextId = 1
  const pending = new Map()
  return {
    schedule(fn, ms) {
      const id = nextId++
      pending.set(id, { at: now + ms, fn })
      return id
    },
    cancel(id) { pending.delete(id) },
    advance(ms) {
      now += ms
      for (const [id, t] of [...pending]) {
        if (t.at <= now) { pending.delete(id); t.fn() }
      }
    },
    get pending() { return pending.size }
  }
}

const memoryStorage = (initial = {}) => {
  const data = new Map(Object.entries(initial))
  const writes = []
  return {
    data,
    writes,
    get: async k => data.get(k),
    set: async (k, v) => { writes.push(k); data.set(k, structuredClone(v)) }
  }
}

const accounts = { p1: 'acc1', p2: 'acc2', p3: null }
const accountOf = p => (Object.hasOwn(accounts, p) ? accounts[p] : null)

const probes = {}
const probe = async (label, fn) => {
  try {
    probes[label] = { ok: true, value: await fn() }
  } catch (error) {
    probes[label] = { ok: false, error }
  }
}

const expectProbe = (label) => {
  const p = probes[label]
  assert.ok(p, 'probe missing: ' + label)
  if (!p.ok) throw p.error
  return p.value
}

await probe('loads a saved value under the account scope', async () => {
  const storage = memoryStorage({ 'accounts/acc1/stats': { xp: 5 } })
  const timers = fakeTimers()
  const accountState = createAccountState({ storage, accountOf, timers, clone: structuredClone, log: () => {} })
  const handle = accountState.open('p1', 'stats', { xp: 0 })
  await handle.ready
  return { xp: handle.state.xp, account: handle.account }
})

await probe('keeps the initial value when nothing is saved and clones it', async () => {
  const storage = memoryStorage()
  const initial = { xp: 0, list: [1] }
  const accountState = createAccountState({ storage, accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} })
  const handle = accountState.open('p2', 'stats', initial)
  await handle.ready
  initial.xp = 99
  return { xp: handle.state.xp, sameObject: handle.store.value === initial }
})

await probe('a saved value of another type is ignored', async () => {
  const storage = memoryStorage({ 'accounts/acc1/stats': 5 })
  const accountState = createAccountState({ storage, accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} })
  const handle = accountState.open('p1', 'stats', { xp: 1 })
  await handle.ready
  return { xp: handle.state.xp }
})

await probe('writes are debounced and land under the account prefix', async () => {
  const storage = memoryStorage()
  const timers = fakeTimers()
  const accountState = createAccountState({ storage, accountOf, timers, clone: structuredClone, log: () => {} })
  const handle = accountState.open('p1', 'stats', { xp: 0 })
  await handle.ready
  handle.state.xp = 7
  timers.advance(100)
  handle.state.xp = 8
  timers.advance(499)
  const beforeQuiet = storage.writes.length
  timers.advance(1)
  await new Promise(r => setImmediate(r))
  return { beforeQuiet, writes: [...storage.writes], stored: storage.data.get('accounts/acc1/stats'), bare: storage.data.has('stats') }
})

await probe('a nested mutation through the state proxy schedules a save', async () => {
  const storage = memoryStorage()
  const timers = fakeTimers()
  const accountState = createAccountState({ storage, accountOf, timers, clone: structuredClone, log: () => {} })
  const handle = accountState.open('p1', 'inv', { items: [] })
  await handle.ready
  handle.state.items.push('sword')
  timers.advance(500)
  await new Promise(r => setImmediate(r))
  return { stored: storage.data.get('accounts/acc1/inv'), writes: storage.writes.length }
})

await probe('the same account and key share one handle, another account does not', async () => {
  const accountState = createAccountState({ storage: memoryStorage(), accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} })
  const a = accountState.open('p1', 'stats', {})
  const b = accountState.open('p1', 'stats', {})
  const c = accountState.open('p2', 'stats', {})
  return { same: a === b, other: a === c }
})

await probe('release flushes the account handles and forgets them', async () => {
  const storage = memoryStorage()
  const timers = fakeTimers()
  const accountState = createAccountState({ storage, accountOf, timers, clone: structuredClone, log: () => {} })
  const first = accountState.open('p1', 'stats', { xp: 0 })
  await first.ready
  first.state.xp = 9
  const released = await accountState.release('p1')
  const reopened = accountState.open('p1', 'stats', { xp: 0 })
  return {
    released,
    stored: storage.data.get('accounts/acc1/stats'),
    pendingTimers: timers.pending,
    freshHandle: reopened !== first
  }
})

await probe('release of an account-less player resolves without writing', async () => {
  const storage = memoryStorage()
  const accountState = createAccountState({ storage, accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} })
  const released = await accountState.release('p3')
  return { released, writes: storage.writes.length }
})

await probe('a storage write failure is logged, not thrown', async () => {
  const logged = []
  const storage = {
    get: async () => undefined,
    set: async () => { throw new Error('disk full') }
  }
  const store = createPersistedStore(storage, 'k', { n: 1 }, { timers: fakeTimers(), log: m => logged.push(m) })
  await store.ready
  store.value = { n: 2 }
  await store.flush()
  return { logged }
})

await probe('a storage read failure is logged and the initial value is kept', async () => {
  const logged = []
  const storage = { get: async () => { throw new Error('read fail') }, set: async () => {} }
  const store = createPersistedStore(storage, 'k', { n: 1 }, { timers: fakeTimers(), log: m => logged.push(m) })
  await store.ready
  return { value: store.value, logged }
})

gate('AccountStateError carries its reason and a prefixed message', () => {
  const err = new AccountStateError('no-account', 'p9')
  assert.equal(err.name, 'AccountStateError')
  assert.equal(err.reason, 'no-account')
  assert.equal(err.message, '[account-state] no-account: p9')
  assert.equal(new AccountStateError('no-storage').message, '[account-state] no-storage')
  assert.ok(err instanceof Error)
})

gate('accountIdOf accepts a non-empty string up to 128 characters', () => {
  assert.equal(accountIdOf({ _nostrPubkey: 'abc' }), 'abc')
  assert.equal(accountIdOf({ _nostrPubkey: 'a'.repeat(128) }), 'a'.repeat(128))
  assert.equal(accountIdOf(undefined), null)
  assert.equal(accountIdOf({}), null)
})

gate('accountIdOf refuses an empty, over-long or non-string id', () => {
  assert.equal(accountIdOf({ _nostrPubkey: '' }), null)
  assert.equal(accountIdOf({ _nostrPubkey: 'a'.repeat(129) }), null)
  assert.equal(accountIdOf({ _nostrPubkey: 42 }), null)
})

gate('createAccountState refuses a missing storage, accountOf, clone, log or timers', () => {
  const ok = { storage: memoryStorage(), accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} }
  const reason = (overrides) => {
    try { createAccountState({ ...ok, ...overrides }); return 'none' } catch (e) { assert.ok(e instanceof AccountStateError); return e.reason }
  }
  assert.equal(reason({ storage: undefined }), 'no-storage')
  assert.equal(reason({ accountOf: 'x' }), 'no-account-of')
  assert.equal(reason({ clone: undefined }), 'no-clone')
  assert.equal(reason({ log: undefined }), 'no-log')
  assert.equal(reason({ timers: undefined }), 'no-timers')
  assert.equal(reason({}), 'none')
})

gate('open refuses an empty or non-string key and an account-less player', () => {
  const accountState = createAccountState({ storage: memoryStorage(), accountOf, timers: fakeTimers(), clone: structuredClone, log: () => {} })
  assert.throws(() => accountState.open('p1', '', {}), err => err instanceof AccountStateError && err.reason === 'bad-key')
  assert.throws(() => accountState.open('p1', 7, {}), err => err instanceof AccountStateError && err.reason === 'bad-key')
  assert.throws(() => accountState.open('p3', 'stats', {}), err => err instanceof AccountStateError && err.reason === 'no-account' && err.message === '[account-state] no-account: p3')
})

gate('the async account-state probes all resolved without an error', () => {
  for (const label of Object.keys(probes)) expectProbe(label)
})

gate('loading restores the account-scoped value', () => {
  assert.deepEqual(expectProbe('loads a saved value under the account scope'), { xp: 5, account: 'acc1' })
})

gate('the initial value is cloned, so later edits to the caller object do not reach the handle', () => {
  assert.deepEqual(expectProbe('keeps the initial value when nothing is saved and clones it'), { xp: 0, sameObject: false })
})

gate('a saved value of a different type than the initial is not loaded', () => {
  assert.deepEqual(expectProbe('a saved value of another type is ignored'), { xp: 1 })
})

gate('a write fires once, after the debounce quiet period, under accounts/<id>/ and not at the bare key', () => {
  const r = expectProbe('writes are debounced and land under the account prefix')
  assert.equal(r.beforeQuiet, 0, 'a write fired inside the debounce window')
  assert.deepEqual(r.writes, ['accounts/acc1/stats'])
  assert.deepEqual(r.stored, { xp: 8 })
  assert.equal(r.bare, false)
})

gate('a nested push through the state proxy saves the account value', () => {
  const r = expectProbe('a nested mutation through the state proxy schedules a save')
  assert.deepEqual(r.stored, { items: ['sword'] })
  assert.equal(r.writes, 1)
})

gate('the handle is shared per account and key, and an account change gets its own handle', () => {
  assert.deepEqual(expectProbe('the same account and key share one handle, another account does not'), { same: true, other: false })
})

gate('release flushes the pending value at once and leaves no timer behind', () => {
  const r = expectProbe('release flushes the account handles and forgets them')
  assert.equal(r.released, undefined)
  assert.deepEqual(r.stored, { xp: 9 })
  assert.equal(r.pendingTimers, 0)
  assert.equal(r.freshHandle, true)
})

gate('release of an account-less player resolves and writes nothing', () => {
  assert.deepEqual(expectProbe('release of an account-less player resolves without writing'), { released: undefined, writes: 0 })
})

gate('a failed write is logged with its key and does not reject flush', () => {
  const r = expectProbe('a storage write failure is logged, not thrown')
  assert.deepEqual(r.logged, ['[persisted] k write error: disk full'])
})

gate('a failed read is logged with its key and the initial value is kept', () => {
  const r = expectProbe('a storage read failure is logged and the initial value is kept')
  assert.deepEqual(r.value, { n: 1 })
  assert.deepEqual(r.logged, ['[persisted] k load error: read fail'])
})

gate('createPersistedStore refuses a missing timers object or a missing log', () => {
  assert.throws(() => createPersistedStore(undefined, 'k', {}, { log: () => {} }), TypeError)
  assert.throws(() => createPersistedStore(undefined, 'k', {}, { timers: fakeTimers() }), /log must be a function/)
  assert.throws(() => createPersistedStore(undefined, 'k', {}, { timers: { schedule() {} }, log: () => {} }), /timers must provide/)
})

gate('SeatError carries its reason code and a space-separated detail', () => {
  const err = (() => { try { normalizeSeatDef('s1', { role: 'pilot', offset: [0, 0, 0] }) } catch (e) { return e } })()
  assert.ok(err instanceof SeatError)
  assert.equal(err.name, 'SeatError')
  assert.equal(err.reasonCode, 'role-unknown')
  assert.equal(err.message, 'seat role-unknown s1')
  assert.equal(new SeatError('no-driver-seat').message, 'seat no-driver-seat')
})

gate('normalizeSeatDef accepts a driver with a frozen offset and null bone, and grips to left or right only', () => {
  const def = normalizeSeatDef('d', { role: 'driver', offset: [0.5, 1, -0.25], grips: { left: 'hand_l', right: 'hand_r' } })
  assert.equal(def.id, 'd')
  assert.equal(def.role, 'driver')
  assert.deepEqual([...def.offset], [0.5, 1, -0.25])
  assert.equal(def.bone, null)
  assert.deepEqual({ ...def.grips }, { left: 'hand_l', right: 'hand_r' })
  assert.equal(Object.isFrozen(def), true)
  assert.equal(Object.isFrozen(def.offset), true)
  assert.deepEqual({ ...normalizeSeatDef('p', { role: 'passenger', offset: [0, 0, 0], bone: 'Spine' }).grips }, {})
  assert.equal(normalizeSeatDef('p', { role: 'passenger', offset: [0, 0, 0], bone: 'Spine' }).bone, 'Spine')
})

gate('normalizeSeatDef refuses each bad field with its reason code', () => {
  const code = (fn) => { try { fn(); return 'none' } catch (e) { assert.ok(e instanceof SeatError); return e.reasonCode } }
  assert.equal(code(() => normalizeSeatDef('', { role: 'driver', offset: [0, 0, 0] })), 'seat-id-missing')
  assert.equal(code(() => normalizeSeatDef('s', null)), 'def-not-object')
  assert.equal(code(() => normalizeSeatDef('s', { role: 'driver', offset: [0, 0] })), 'offset-not-vec3')
  assert.equal(code(() => normalizeSeatDef('s', { role: 'driver', offset: [0, NaN, 0] })), 'offset-not-vec3')
  assert.equal(code(() => normalizeSeatDef('s', { role: 'driver', offset: [0, 0, 0], grips: [] })), 'grips-not-object')
  assert.equal(code(() => normalizeSeatDef('s', { role: 'driver', offset: [0, 0, 0], grips: { foot: 'x' } })), 'grip-hand-unknown')
  assert.equal(code(() => normalizeSeatDef('s', { role: 'driver', offset: [0, 0, 0], grips: { left: '' } })), 'grip-bone-missing')
})

gate('normalizeSeatDef reports the unknown grip hand with its seat and hand in the message', () => {
  try {
    normalizeSeatDef('seatA', { role: 'driver', offset: [0, 0, 0], grips: { foot: 'x' } })
    assert.fail('no throw')
  } catch (e) {
    assert.equal(e.message, 'seat grip-hand-unknown seatA.foot')
  }
})

gate('define refuses a table with no driver seat, and a non-object seat table', () => {
  const table = createSeatTable()
  assert.throws(() => table.define('car', { p: { role: 'passenger', offset: [0, 0, 0] } }), err => err.reasonCode === 'no-driver-seat')
  assert.throws(() => table.define('car', []), err => err.reasonCode === 'seats-not-object')
  assert.throws(() => table.define(true, { d: { role: 'driver', offset: [0, 0, 0] } }), err => err.reasonCode === 'entity-id-invalid')
  assert.deepEqual(table.vehicleIds(), [])
})

gate('define returns the seat ids in order and numeric entity ids are accepted', () => {
  const table = createSeatTable()
  assert.deepEqual(table.define(7, { d: { role: 'driver', offset: [0, 0, 0] }, p: { role: 'passenger', offset: [1, 0, 0] } }), ['d', 'p'])
  assert.deepEqual(table.vehicleIds(), [7])
  assert.deepEqual(table.seatsOf(7).map(s => s.seatId), ['d', 'p'])
})

gate('mount seats a player and returns a seat view with a copied offset', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0], bone: 'Seat', grips: { left: 'wheel' } }, p: { role: 'passenger', offset: [1, 0, 0] } })
  const view = table.mount('p1', 'car', 'd')
  assert.deepEqual(view, { entityId: 'car', seatId: 'd', role: 'driver', offset: [0, 0, 0], bone: 'Seat', grips: { left: 'wheel' }, playerId: 'p1' })
  view.offset[0] = 9
  assert.deepEqual(table.seatsOf('car')[0].offset, [0, 0, 0])
  assert.deepEqual(table.seatOf('p1').seatId, 'd')
})

gate('mount refuses an occupied seat, a mounted player, an unknown seat and an unknown vehicle', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0] }, p: { role: 'passenger', offset: [1, 0, 0] } })
  table.mount('p1', 'car', 'd')
  const code = (fn) => { try { fn(); return 'none' } catch (e) { assert.ok(e instanceof SeatError); return e.reasonCode } }
  assert.equal(code(() => table.mount('p2', 'car', 'd')), 'seat-occupied')
  assert.equal(code(() => table.mount('p1', 'car', 'p')), 'player-already-mounted')
  assert.equal(code(() => table.mount('p2', 'car', 'x')), 'seat-unknown')
  assert.equal(code(() => table.mount('p2', 'bike', 'd')), 'vehicle-unknown')
  assert.equal(code(() => table.mount({}, 'car', 'p')), 'player-id-invalid')
})

gate('dismount frees the seat and returns the seat, and a second dismount returns null', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0] } })
  table.mount('p1', 'car', 'd')
  assert.deepEqual(table.dismount('p1'), { entityId: 'car', seatId: 'd', playerId: 'p1' })
  assert.equal(table.dismount('p1'), null)
  assert.equal(table.seatOf('p1'), null)
  assert.equal(table.seatsOf('car')[0].playerId, null)
  assert.equal(table.mount('p2', 'car', 'd').playerId, 'p2')
})

gate('handoff moves the driver seat to another player and refuses a passenger or a mounted target', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0] }, p: { role: 'passenger', offset: [1, 0, 0] } })
  table.mount('p1', 'car', 'd')
  table.mount('p2', 'car', 'p')
  const code = (fn) => { try { fn(); return 'none' } catch (e) { assert.ok(e instanceof SeatError); return e.reasonCode } }
  assert.equal(code(() => table.handoff('p2', 'p3')), 'handoff-not-driver')
  assert.equal(code(() => table.handoff('p1', 'p2')), 'target-already-mounted')
  assert.equal(code(() => table.handoff('nobody', 'p3')), 'source-not-mounted')
  const view = table.handoff('p1', 'p3')
  assert.equal(view.playerId, 'p3')
  assert.equal(table.seatOf('p1'), null)
  assert.equal(table.seatOf('p3').seatId, 'd')
})

gate('undefine returns the released players and clears their riders, and redefine is refused while occupied', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0] }, p: { role: 'passenger', offset: [1, 0, 0] } })
  table.mount('p1', 'car', 'd')
  table.mount('p2', 'car', 'p')
  assert.throws(() => table.define('car', { d: { role: 'driver', offset: [0, 0, 0] } }), err => err.reasonCode === 'redefine-while-occupied')
  assert.deepEqual(table.undefine('car'), ['p1', 'p2'])
  assert.equal(table.seatOf('p1'), null)
  assert.equal(table.seatOf('p2'), null)
  assert.equal(table.undefine('car'), null)
  assert.deepEqual(table.seatsOf('car'), [])
})

gate('a seat with no occupant reads back as playerId null', () => {
  const table = createSeatTable()
  table.define('car', { d: { role: 'driver', offset: [0, 0, 0] }, p: { role: 'passenger', offset: [1, 0, 0] } })
  table.mount('p1', 'car', 'd')
  assert.deepEqual(table.seatsOf('car').map(s => s.playerId), ['p1', null])
  assert.equal(table.seatOf('nobody'), null)
})

gate('tagAppState turns a Map and a Set into tagged plain objects in insertion order', () => {
  const tagged = tagAppState({ m: new Map([['a', 1], ['b', 2]]), s: new Set([3, 4]), n: 5 })
  assert.deepEqual(tagged, { m: { __type: 'Map', entries: [['a', 1], ['b', 2]] }, s: { __type: 'Set', values: [3, 4] }, n: 5 })
})

gate('tagAppState and untagAppState return null for a falsy state', () => {
  assert.equal(tagAppState(null), null)
  assert.equal(tagAppState(undefined), null)
  assert.equal(tagAppState(0), null)
  assert.equal(untagAppState(null), null)
  assert.equal(untagAppState(''), null)
})

gate('untagAppState restores a Map and a Set, including nested ones, from a tagged state', () => {
  const original = { board: new Map([['x', new Set(['u', 'v'])]]), turn: 3 }
  const back = untagAppState(tagAppState(original))
  assert.ok(back.board instanceof Map)
  assert.ok(back.board.get('x') instanceof Set)
  assert.deepEqual([...back.board.get('x')], ['u', 'v'])
  assert.equal(back.turn, 3)
})

gate('untagAppState leaves an object alone when its __type has no matching entries or values array', () => {
  const plain = { __type: 'Map', entries: 'not-an-array' }
  assert.deepEqual(untagAppState(plain), { __type: 'Map', entries: 'not-an-array' })
  const setLike = { __type: 'Set', values: { 0: 1 } }
  assert.deepEqual(untagAppState(setLike), { __type: 'Set', values: { 0: 1 } })
})

gate('captureTransform reports a change once, then copies the new pose into the snapshot', () => {
  const xf = new Float64Array(11)
  const e = { position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  assert.equal(captureTransform(xf, e), true)
  assert.deepEqual([...xf.subarray(0, 10)], [1, 2, 3, 0, 0, 0, 1, 1, 1, 1])
  assert.equal(captureTransform(xf, e), false)
})

gate('captureTransform flags a change in each of position, rotation and scale', () => {
  const base = () => ({ position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  const xf = new Float64Array(11)
  captureTransform(xf, base())
  const moved = { ...base(), position: [0, 0, 0.5] }
  assert.equal(captureTransform(xf, moved), true)
  assert.equal(captureTransform(xf, { ...moved, rotation: [0, 0.1, 0, 1] }), true)
  assert.equal(captureTransform(xf, { ...moved, rotation: [0, 0.1, 0, 1], scale: [1, 2, 1] }), true)
  assert.equal(captureTransform(xf, { ...moved, rotation: [0, 0.1, 0, 1], scale: [1, 2, 1] }), false)
})

gate('captureTransform never touches the idle counter slot', () => {
  const xf = new Float64Array(11)
  xf[10] = 4
  captureTransform(xf, { position: [5, 5, 5], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })
  assert.equal(xf[10], 4)
})

gate('captureTransform reports NaN as a change on every call (negative control: a NaN pose is never settled)', () => {
  const xf = new Float64Array(11)
  const e = { position: [NaN, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] }
  assert.equal(captureTransform(xf, e), true)
  assert.equal(captureTransform(xf, e), true)
})

const staticRuntime = () => {
  const runtime = {
    entities: new Map(),
    _staticEntityIds: new Set(),
    _movedStaticIds: new Set(),
    _staticVersion: 0
  }
  mixinStaticMotion(runtime)
  return runtime
}
const place = (rt, id, x) => rt.entities.set(id, { position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] })

gate('trackStaticMotion marks a static body moving on its first change and demotes it after the idle count', () => {
  const rt = staticRuntime()
  rt._staticEntityIds.add('a')
  place(rt, 'a', 0)
  rt.trackStaticMotion(3)
  assert.equal(rt._movedStaticIds.has('a'), false)
  place(rt, 'a', 1)
  rt.trackStaticMotion(3)
  assert.equal(rt._movedStaticIds.has('a'), true)
  rt.trackStaticMotion(3)
  rt.trackStaticMotion(3)
  assert.equal(rt._movedStaticIds.has('a'), true, 'demoted before the third idle snapshot')
  assert.equal(rt._staticVersion, 0)
  rt.trackStaticMotion(3)
  assert.equal(rt._movedStaticIds.has('a'), false)
  assert.equal(rt._staticVersion, 1)
})

gate('a movement during a pending static re-encode is not marked moving', () => {
  const rt = staticRuntime()
  rt._staticEntityIds.add('a')
  place(rt, 'a', 0)
  rt.trackStaticMotion(3)
  rt._staticVersion += 1
  place(rt, 'a', 2)
  rt.trackStaticMotion(3)
  assert.equal(rt._movedStaticIds.has('a'), false)
})

gate('a movement that resumes after demotion marks the body moving again', () => {
  const rt = staticRuntime()
  rt._staticEntityIds.add('a')
  place(rt, 'a', 0)
  rt.trackStaticMotion(1)
  place(rt, 'a', 1)
  rt.trackStaticMotion(1)
  assert.equal(rt._movedStaticIds.has('a'), true)
  rt.trackStaticMotion(1)
  assert.equal(rt._movedStaticIds.has('a'), false)
  place(rt, 'a', 4)
  rt.trackStaticMotion(1)
  assert.equal(rt._movedStaticIds.has('a'), true)
})

gate('a static id with no entity is skipped, and _forgetStaticMotion drops its snapshot and moving mark', () => {
  const rt = staticRuntime()
  rt._staticEntityIds.add('ghost')
  rt._staticEntityIds.add('a')
  place(rt, 'a', 0)
  rt.trackStaticMotion(3)
  place(rt, 'a', 1)
  rt.trackStaticMotion(3)
  assert.equal(rt._staticXf.has('ghost'), false)
  assert.equal(rt._movedStaticIds.has('a'), true)
  rt._forgetStaticMotion('a')
  assert.equal(rt._staticXf.has('a'), false)
  assert.equal(rt._movedStaticIds.has('a'), false)
})

gate('parseInteractable defaults to a radius of 3, a cooldown of 500 and the prompt Press E', () => {
  assert.deepEqual(parseInteractable(), { prompt: 'Press E', radius: 3, cooldown: 500 })
  assert.deepEqual(parseInteractable({ radius: 1.5 }), { prompt: 'Press E', radius: 1.5, cooldown: 500 })
})

gate('parseInteractable keeps zero and an empty prompt, and treats null as unset', () => {
  assert.deepEqual(parseInteractable({ radius: 0, cooldown: 0, prompt: '' }), { prompt: '', radius: 0, cooldown: 0 })
  assert.deepEqual(parseInteractable({ radius: null }), { prompt: 'Press E', radius: 3, cooldown: 500 })
})

gate('parseInteractable refuses a negative, non-finite or non-number radius and cooldown', () => {
  const message = (cfg) => { try { parseInteractable(cfg); return 'none' } catch (e) { assert.ok(e instanceof TypeError); return e.message } }
  assert.equal(message({ radius: -1 }), 'interactable: radius must be a non-negative finite number')
  assert.equal(message({ radius: Infinity }), 'interactable: radius must be a non-negative finite number')
  assert.equal(message({ radius: '2' }), 'interactable: radius must be a non-negative finite number')
  assert.equal(message({ cooldown: NaN }), 'interactable: cooldown must be a non-negative finite number')
  assert.equal(message({ cooldown: -5 }), 'interactable: cooldown must be a non-negative finite number')
})

gate('parseInteractable refuses a prompt that is not a string', () => {
  try {
    parseInteractable({ prompt: 5 })
    assert.fail('no throw')
  } catch (e) {
    assert.equal(e.message, 'interactable: prompt must be a string')
  }
})

gate('MAX_FOOTPRINT_INTRUSION_M is 0.15 metres', () => {
  assert.equal(MAX_FOOTPRINT_INTRUSION_M, 0.15)
})

gate('capsuleRadiusM is the square root of radiusSq, and falls back to 0.6 for a missing or non-positive radiusSq', () => {
  assert.ok(Math.abs(capsuleRadiusM({ radiusSq: 0.36 }) - 0.6) < 1e-12)
  assert.equal(capsuleRadiusM(undefined), 0.6)
  assert.equal(capsuleRadiusM({ radiusSq: 0 }), 0.6)
  assert.equal(capsuleRadiusM({ radiusSq: -1 }), 0.6)
})

gate('capsuleHeightM uses height, then twice centerHeight, then the default height', () => {
  assert.equal(capsuleHeightM({ height: 2 }), 2)
  assert.equal(capsuleHeightM({ centerHeight: 1 }), 2)
  assert.equal(capsuleHeightM({}), 1.8)
  assert.equal(capsuleHeightM({ height: 0, centerHeight: 0 }), 1.8)
})

const flatAt = (surfaceY) => (origin) => ({ hit: true, position: [origin[0], surfaceY, origin[2]], distance: 1 })
const nothingBelow = () => ({ hit: false })
const sp = [10, 0, -4]

gate('footprintBlockers reports no blocker on flat ground at the feet height', () => {
  assert.deepEqual(footprintBlockers(flatAt(0), sp, 0), [])
})

gate('footprintBlockers reports the centre sample when ground under it rises above the intrusion limit', () => {
  const blockers = footprintBlockers(flatAt(0.5), sp, 0)
  const centre = blockers.filter(b => b.offsetM === 0)
  assert.equal(centre.length, 1)
  assert.equal(centre[0].kind, 'intruding')
  assert.equal(centre[0].x, 10)
  assert.equal(centre[0].z, -4)
  assert.ok(Math.abs(centre[0].intrusionM - 0.5) < 1e-12)
  assert.equal(centre[0].surfaceY, 0.5)
})

gate('the intrusion limit is strict: a rise of exactly 0.15 is not a blocker, a rise of 0.16 is', () => {
  const centreAt = (h) => footprintBlockers(flatAt(h), sp, 0).filter(b => b.offsetM === 0)
  assert.equal(centreAt(0.15).length, 0)
  assert.equal(centreAt(0.16).length, 1)
  assert.equal(centreAt(0.16)[0].kind, 'intruding')
})

gate('a ring sample inside the contact disc on flat ground at the limit gives no blocker (negative control on the ring)', () => {
  assert.equal(footprintBlockers(flatAt(0.15), sp, 0).length, 0)
})

gate('footprintBlockers reports a void for each sample inside the contact disc with no support below', () => {
  const blockers = footprintBlockers(nothingBelow, sp, 0)
  assert.ok(blockers.every(b => b.kind === 'void' && b.intrusionM === null && b.surfaceY === null))
  const inner = blockers.filter(b => b.offsetM < 0.5)
  assert.equal(inner.length, 9, 'centre plus eight samples on the 0.3 m ring')
  assert.equal(inner.filter(b => b.offsetM === 0).length, 1)
})

gate('footprintBlockers passes the probe a ray that starts below the top of the capsule and points down', () => {
  const seen = []
  footprintBlockers((origin, dir, len) => { seen.push({ origin, dir, len }); return { hit: false } }, sp, 0)
  assert.deepEqual(seen[0].dir, [0, -1, 0])
  assert.ok(Math.abs(seen[0].origin[1] - (1.8 - 0.02)) < 1e-12)
  assert.ok(Math.abs(seen[0].len - (1.8 + 1.5)) < 1e-12)
  assert.equal(seen[0].origin[0], 10)
  assert.equal(seen[0].origin[2], -4)
})

finish()
