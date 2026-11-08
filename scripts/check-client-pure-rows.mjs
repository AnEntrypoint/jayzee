import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { commitTileExtent } from '../src/client-pure/tileExtent.js'
import { DEFAULT_KEY_BINDINGS, DEFAULT_PAD_BINDINGS, KEY_BINDINGS_STORAGE_KEY, PAD_BUTTON_MAX } from '../src/client-pure/keybindingDefaults.js'
import { KeyBindingError, createKeyBindings } from '../src/client-pure/keyBindings.js'
import { STRIDE, applyPlayerTransform, ensureBatchCapacity, lerpEntityTransform, tickBatch } from '../src/client-pure/transformLerp.js'
import { CACHE_REVALIDATE_DEADLINE_MS, CACHE_REVALIDATE_FIRST_SWEEP_MS, CACHE_REVALIDATE_MAX_SWEEPS, CACHE_REVALIDATE_SWEEP_INTERVAL_MS, CACHE_REVALIDATE_STALE_MS, createCacheRevalidationSweep } from '../src/client-pure/cacheRevalidationSweep.js'
import { createExactPatchFrame } from '../src/client-pure/exactPatchFrame.js'
import { NoGroundHeightError } from '../src/terrain-pure/planetFrame.js'

const refutes = (fn, message) => {
  let threw = false
  try { fn() } catch { threw = true }
  assert.ok(threw, message)
}

const near = (actual, expected, eps, message) => {
  assert.ok(Math.abs(actual - expected) <= eps, `${message}: got ${actual}, want ${expected}`)
}

const cases = {}
const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}
const checkProbe = (label) => gate(label, () => {
  if (!(label in cases)) throw new Error('no probe recorded ' + label)
  if (cases[label]) throw cases[label]
})

const mustThrow = (fn, Ctor, code) => {
  let caught = null
  try { fn() } catch (error) { caught = error }
  assert.ok(caught instanceof Ctor, `expected ${Ctor.name}, got ${caught && caught.name}`)
  if (code !== undefined) assert.equal(caught.reasonCode, code)
  return caught
}

gate('tile extent: a known extent passes through without sampling and keeps its padding out', () => {
  let calls = 0
  const heightFn = () => { calls++; return 0 }
  const out = commitTileExtent('known extent', heightFn, [0, 0], [-1, -2, 3, 4], 1, 5, 2)
  assert.deepEqual(out, { empty: false, aabbMin: [-1, 1, -2], aabbMax: [3, 5, 4] })
  assert.equal(calls, 0)
})

gate('tile extent: an empty list samples the ground at sampleXZ and pads it by padM', () => {
  const seen = []
  const heightFn = (x, z) => { seen.push([x, z]); return x + z + 0.5 }
  const out = commitTileExtent('empty list', heightFn, [10, 20], [1, 2, 3, 4], Infinity, -Infinity, 2)
  assert.deepEqual(seen, [[10, 20]])
  assert.deepEqual(out, { empty: false, aabbMin: [1, 28.5, 2], aabbMax: [3, 32.5, 4] })
})

gate('tile extent: a null ground sample is an empty extent with null corners', () => {
  const out = commitTileExtent('null ground', () => null, [0, 0], [0, 0, 1, 1], Infinity, -Infinity, 1)
  assert.deepEqual(out, { empty: true, aabbMin: null, aabbMax: null })
})

gate('tile extent: a surface solve refusal becomes an empty extent and is logged once per where', () => {
  const lines = []
  const log = (line) => lines.push(line)
  const throwing = () => { throw new NoGroundHeightError(1, 2) }
  const first = commitTileExtent('tile extent refusal gate', throwing, [1, 2], [0, 0, 1, 1], Infinity, -Infinity, 1, log)
  const second = commitTileExtent('tile extent refusal gate', throwing, [1, 2], [0, 0, 1, 1], Infinity, -Infinity, 1, log)
  assert.deepEqual(first, { empty: true, aabbMin: null, aabbMax: null })
  assert.deepEqual(second, { empty: true, aabbMin: null, aabbMax: null })
  assert.equal(lines.length, 1)
  assert.ok(lines[0].includes('no ground height at chart-local (1, 2)'))
})

gate('tile extent: an error that is not a surface solve refusal propagates', () => {
  assert.throws(() => commitTileExtent('tile extent propagate', () => { throw new Error('boom') }, [0, 0], [0, 0, 1, 1], Infinity, -Infinity, 1), /boom/)
})

gate('tile extent: a non-finite ground sample is refused, not turned into NaN corners', () => {
  mustThrow(() => commitTileExtent('tile extent nan', () => NaN, [0, 0], [0, 0, 1, 1], Infinity, -Infinity, 1), RangeError)
  mustThrow(() => commitTileExtent('tile extent undefined', () => undefined, [0, 0], [0, 0, 1, 1], Infinity, -Infinity, 1), RangeError)
})

gate('tile extent: bad arguments are refused before any sample is taken', () => {
  let calls = 0
  const heightFn = () => { calls++; return 0 }
  mustThrow(() => commitTileExtent('', heightFn, [0, 0], [0, 0, 1, 1], 0, 1, 1), TypeError)
  mustThrow(() => commitTileExtent('bad height', null, [0, 0], [0, 0, 1, 1], 0, 1, 1), TypeError)
  mustThrow(() => commitTileExtent('bad xz', heightFn, [0, NaN], [0, 0, 1, 1], Infinity, -Infinity, 1), RangeError)
  mustThrow(() => commitTileExtent('bad bounds', heightFn, [0, 0], [0, 0, 1], Infinity, -Infinity, 1), RangeError)
  mustThrow(() => commitTileExtent('nan min', heightFn, [0, 0], [0, 0, 1, 1], NaN, 1, 1), RangeError)
  mustThrow(() => commitTileExtent('negative pad', heightFn, [0, 0], [0, 0, 1, 1], Infinity, -Infinity, -1), RangeError)
  assert.equal(calls, 0)
})

gate('tile extent control: an empty extent with the wrong pad is not the same result', () => {
  const out = commitTileExtent('tile extent control', () => 30.5, [10, 20], [1, 2, 3, 4], Infinity, -Infinity, 2)
  refutes(() => assert.deepEqual(out, { empty: false, aabbMin: [1, 30.5, 2], aabbMax: [3, 30.5, 4] }), 'a zero pad was accepted')
})

gate('keybindings: the default table matches spoint client/core/keybindings.js', () => {
  assert.deepEqual(DEFAULT_KEY_BINDINGS, { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], interact: ['KeyE'] })
  assert.deepEqual(DEFAULT_PAD_BINDINGS, { jump: [0], interact: [2] })
  assert.equal(KEY_BINDINGS_STORAGE_KEY, 'spoint.keybindings')
  assert.equal(PAD_BUTTON_MAX, 31)
  assert.ok(Object.isFrozen(DEFAULT_KEY_BINDINGS))
  assert.ok(Object.isFrozen(DEFAULT_PAD_BINDINGS))
})

gate('keybindings: lookups return the default actions and copies', () => {
  const store = createKeyBindings()
  assert.deepEqual(store.keysFor('forward'), ['KeyW'])
  assert.equal(store.actionForKey('KeyS'), 'back')
  assert.equal(store.actionForKey('KeyQ'), null)
  assert.equal(store.actionForPad(2), 'interact')
  assert.equal(store.actionForPad(7), null)
  store.keysFor('forward').push('KeyX')
  assert.deepEqual(store.keysFor('forward'), ['KeyW'])
})

gate('keybindings: a rebind replaces the keys and frees the old code', () => {
  const store = createKeyBindings()
  assert.deepEqual(store.rebindKeys('forward', ['ArrowUp']), ['ArrowUp'])
  assert.equal(store.actionForKey('KeyW'), null)
  assert.equal(store.actionForKey('ArrowUp'), 'forward')
  assert.deepEqual(DEFAULT_KEY_BINDINGS.forward, ['KeyW'])
})

gate('keybindings: a rebind onto a code another action holds is a conflict that names the holder', () => {
  const store = createKeyBindings()
  const error = mustThrow(() => store.rebindKeys('back', ['KeyW']), KeyBindingError, 'conflict')
  assert.ok(error.message.includes('already bound to forward'))
  assert.deepEqual(store.keysFor('back'), ['KeyS'])
})

gate('keybindings: unknown actions, including prototype names, and malformed codes are refused', () => {
  const store = createKeyBindings()
  mustThrow(() => store.keysFor('fly'), KeyBindingError, 'unknown-action')
  mustThrow(() => store.keysFor('constructor'), KeyBindingError, 'unknown-action')
  mustThrow(() => store.rebindKeys('jump', []), KeyBindingError, 'bad-keys')
  mustThrow(() => store.rebindKeys('jump', ['']), KeyBindingError, 'bad-keys')
  mustThrow(() => store.rebindKeys('jump', 'Space'), KeyBindingError, 'bad-keys')
})

gate('keybindings: pad buttons must be whole numbers from 0 to 31 and conflicts are refused', () => {
  const store = createKeyBindings()
  mustThrow(() => store.rebindPad('jump', [32]), KeyBindingError, 'bad-pad')
  mustThrow(() => store.rebindPad('jump', [1.5]), KeyBindingError, 'bad-pad')
  mustThrow(() => store.rebindPad('jump', [-1]), KeyBindingError, 'bad-pad')
  mustThrow(() => store.rebindPad('jump', [2]), KeyBindingError, 'conflict')
  assert.deepEqual(store.rebindPad('jump', [31]), [31])
  assert.equal(store.actionForPad(31), 'jump')
})

gate('keybindings: methods keep working when destructured from the store', () => {
  const store = createKeyBindings()
  const { rebindKeys, keysFor, actionForKey } = store
  assert.deepEqual(rebindKeys('jump', ['KeyJ']), ['KeyJ'])
  assert.deepEqual(keysFor('jump'), ['KeyJ'])
  assert.equal(actionForKey('KeyJ'), 'jump')
})

gate('keybindings: save and a new store restore the same table through injected storage', () => {
  const map = new Map()
  const storage = { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => { map.set(k, v) } }
  const first = createKeyBindings({ storage })
  first.rebindKeys('jump', ['KeyJ'])
  assert.equal(first.save(), true)
  assert.deepEqual(JSON.parse(map.get('spoint.keybindings')).keys.jump, ['KeyJ'])
  const second = createKeyBindings({ storage })
  assert.deepEqual(second.keysFor('jump'), ['KeyJ'])
  assert.deepEqual(second.keysFor('forward'), ['KeyW'])
  assert.equal(createKeyBindings().save(), false)
})

gate('keybindings: a stored record with an unknown action or a non-object is refused', () => {
  const build = (raw) => createKeyBindings({ storage: { getItem: () => raw, setItem: () => {} } })
  mustThrow(() => build('[1]'), KeyBindingError, 'bad-record')
  mustThrow(() => build('{"keys":{"fly":["KeyF"]}}'), KeyBindingError, 'unknown-action')
  mustThrow(() => build('{"pad":{"jump":[99]}}'), KeyBindingError, 'bad-pad')
})

gate('keybindings: reset returns every action to its default', () => {
  const store = createKeyBindings()
  store.rebindKeys('forward', ['ArrowUp'])
  store.rebindPad('jump', [5])
  store.resetAll()
  assert.deepEqual(store.snapshot(), { keys: { forward: ['KeyW'], back: ['KeyS'], left: ['KeyA'], right: ['KeyD'], jump: ['Space'], interact: ['KeyE'] }, pad: { jump: [0], interact: [2] } })
})

gate('keybindings control: the same code is refused for a second action', () => {
  const store = createKeyBindings()
  assert.deepEqual(store.rebindKeys('forward', ['KeyW']), ['KeyW'])
  refutes(() => store.rebindKeys('back', ['KeyW']), 'a code held by forward was accepted for back')
})

gate('transform lerp: a position moves a fraction of the way to the velocity-extrapolated target', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(mesh, { x: 10, y: 20, z: -4, vx: 2 }, 0.5, 0.5)
  assert.deepEqual(mesh.position, { x: 5.5, y: 10, z: -2 })
  assert.deepEqual(mesh.quaternion, { x: 0, y: 0, z: 0, w: 1 })
})

gate('transform lerp: a rotation step is normalised back to unit length', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(mesh, { x: 0, y: 0, z: 0, rx: 0, ry: 1, rz: 0, rw: 0 }, 0.5, 0)
  const root = Math.SQRT1_2
  near(mesh.quaternion.x, 0, 1e-12, 'x')
  near(mesh.quaternion.y, root, 1e-12, 'y')
  near(mesh.quaternion.z, 0, 1e-12, 'z')
  near(mesh.quaternion.w, root, 1e-12, 'w')
})

gate('transform lerp: the rotation takes the short way, so an opposite-sign target does not turn 180 degrees', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(mesh, { x: 0, y: 0, z: 0, rx: 0, ry: 0, rz: 0, rw: -1 }, 0.5, 0)
  assert.deepEqual(mesh.quaternion, { x: 0, y: 0, z: 0, w: 1 })
  refutes(() => assert.deepEqual(mesh.quaternion, { x: 0, y: 0, z: 0, w: -1 }), 'the sign flip was lost')
})

gate('transform lerp: a half step toward a sign-flipped target lands on the short-way midpoint', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(mesh, { x: 0, y: 0, z: 0, rx: -0.6, ry: 0, rz: 0, rw: -0.8 }, 0.5, 0)
  near(mesh.quaternion.x, Math.sqrt(0.1), 1e-12, 'short-way x')
  near(mesh.quaternion.y, 0, 1e-12, 'short-way y')
  near(mesh.quaternion.z, 0, 1e-12, 'short-way z')
  near(mesh.quaternion.w, Math.sqrt(0.9), 1e-12, 'short-way w')
})

gate('transform lerp: a non-finite target rotation moves the position and keeps the rotation', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(mesh, { x: 4, y: 0, z: 0, rx: NaN, ry: 0, rz: 0, rw: 1 }, 0.5, 0)
  assert.deepEqual(mesh.position, { x: 2, y: 0, z: 0 })
  assert.deepEqual(mesh.quaternion, { x: 0, y: 0, z: 0, w: 1 })
})

gate('transform lerp: the first applied position snaps, a later one lerps, and an undefined factor snaps', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 }, userData: {} }
  applyPlayerTransform(mesh, { x: 3, y: 4, z: 5 }, 0.5)
  assert.deepEqual(mesh.position, { x: 3, y: 4, z: 5 })
  assert.equal(mesh.userData.initialized, true)
  applyPlayerTransform(mesh, { x: 13, y: 4, z: 5 }, 0.5)
  assert.deepEqual(mesh.position, { x: 8, y: 4, z: 5 })
  applyPlayerTransform(mesh, { x: -2, y: 1, z: 0 }, undefined)
  assert.deepEqual(mesh.position, { x: -2, y: 1, z: 0 })
})

gate('transform lerp: the batch buffer keeps 17 floats per record and doubles from 64 floats', () => {
  assert.equal(STRIDE, 17)
  const state = {}
  assert.equal(ensureBatchCapacity(state, 1).length, 64)
  state.buf[0] = 7
  assert.equal(ensureBatchCapacity(state, 5).length, 128)
  assert.equal(state.buf[0], 7)
  assert.equal(ensureBatchCapacity(state, 3).length, 128)
})

gate('transform lerp: a batch tick matches the single-entity lerp and writes float32 positions', () => {
  const single = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  lerpEntityTransform(single, { x: 10, y: 20, z: -4, vx: 2 }, 0.5, 0.5)
  const batched = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  const records = [{ mesh: batched, target: { x: 10, y: 20, z: -4, vx: 2 }, last: { hasRot: false } }]
  assert.equal(tickBatch({}, records, 0.5, 0.5), true)
  assert.deepEqual(batched.position, single.position)
  assert.equal(tickBatch({}, [], 0.5, 0.5), false)
  const third = { position: { x: 0.1, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  tickBatch({}, [{ mesh: third, target: { x: 0.3, y: 0, z: 0 }, last: { hasRot: false } }], 1, 0)
  assert.equal(third.position.x, Math.fround(0.3))
})

gate('transform lerp: a batch half step toward a sign-flipped target takes the short way', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  tickBatch({}, [{ mesh, target: { x: 0, y: 0, z: 0, rx: -0.6, ry: 0, rz: 0, rw: -0.8 }, last: { hasRot: true } }], 0.5, 0)
  near(mesh.quaternion.x, Math.sqrt(0.1), 1e-6, 'batch short-way x')
  near(mesh.quaternion.y, 0, 1e-6, 'batch short-way y')
  near(mesh.quaternion.w, Math.sqrt(0.9), 1e-6, 'batch short-way w')
})

gate('transform lerp: a batch record without a fresh rotation leaves its quaternion untouched', () => {
  const mesh = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  tickBatch({}, [{ mesh, target: { x: 0, y: 0, z: 0, rx: 0, ry: 1, rz: 0, rw: 0 }, last: { hasRot: false } }], 0.5, 0)
  assert.deepEqual(mesh.quaternion, { x: 0, y: 0, z: 0, w: 1 })
  const turned = { position: { x: 0, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }
  tickBatch({}, [{ mesh: turned, target: { x: 0, y: 0, z: 0, rx: 0, ry: 1, rz: 0, rw: 0 }, last: { hasRot: true } }], 0.5, 0)
  near(turned.quaternion.y, Math.fround(Math.SQRT1_2), 1e-6, 'batch y')
  near(turned.quaternion.w, Math.fround(Math.SQRT1_2), 1e-6, 'batch w')
})

const clockHarness = () => {
  const clock = { t: 0 }
  const list = []
  let nextId = 1
  const add = (fn, ms, repeat) => {
    const t = { id: nextId++, at: clock.t + ms, ms, repeat, fn }
    list.push(t)
    return t.id
  }
  const remove = (id) => {
    const i = list.findIndex((t) => t.id === id)
    if (i >= 0) list.splice(i, 1)
  }
  const advance = (ms) => {
    const target = clock.t + ms
    for (;;) {
      let next = null
      for (const t of list) if (t.at <= target && (next === null || t.at < next.at)) next = t
      if (next === null) break
      clock.t = next.at
      if (next.repeat) next.at += next.ms
      else remove(next.id)
      next.fn()
    }
    clock.t = target
  }
  const timers = {
    after: (fn, ms) => add(fn, ms, false),
    cancelAfter: (id) => remove(id),
    every: (fn, ms) => add(fn, ms, true),
    stopEvery: (id) => remove(id),
  }
  return { clock, timers, advance, pending: () => list.length }
}

const sweepHarness = ({ entries = [], revalidate = async () => ({ changed: false }), listFails = false, log = [], opts = {} } = {}) => {
  const clock = clockHarness()
  const queue = []
  const scheduler = { enqueue: (rec) => { queue.push(rec); return true }, size: () => queue.length }
  const state = { entries }
  const sweep = createCacheRevalidationSweep({
    scheduler,
    listEntries: async () => {
      if (listFails) throw new Error('store offline')
      return state.entries
    },
    revalidate,
    now: () => clock.clock.t,
    timers: clock.timers,
    log: (line) => log.push(line),
    ...opts,
  })
  return { ...clock, sweep, queue, state }
}

const flush = async () => {
  for (let i = 0; i < 30; i++) await Promise.resolve()
}

gate('cache revalidation: the default constants match spoint CacheRevalidationSweep.js', () => {
  assert.equal(CACHE_REVALIDATE_STALE_MS, 1800000)
  assert.equal(CACHE_REVALIDATE_SWEEP_INTERVAL_MS, 300000)
  assert.equal(CACHE_REVALIDATE_FIRST_SWEEP_MS, 15000)
  assert.equal(CACHE_REVALIDATE_MAX_SWEEPS, 288)
  assert.equal(CACHE_REVALIDATE_DEADLINE_MS, 86400000)
})

await probe('cache revalidation: start arms a first sweep at 15 s and then one every 5 min', async () => {
  const h = sweepHarness()
  assert.equal(h.sweep.start(), true)
  assert.equal(h.pending(), 2)
  assert.equal(h.sweep.start(), false)
  h.advance(14999)
  assert.equal(h.sweep.getStats().sweeps, 0)
  h.advance(1)
  assert.equal(h.sweep.getStats().sweeps, 1)
  h.advance(284999)
  assert.equal(h.sweep.getStats().sweeps, 1)
  h.advance(1)
  assert.equal(h.sweep.getStats().sweeps, 2)
  h.sweep.stop()
})
checkProbe('cache revalidation: start arms a first sweep at 15 s and then one every 5 min')

await probe('cache revalidation: a sweep enqueues only entries whose revalidation is at or before the cutoff', async () => {
  const h = sweepHarness({ entries: [
    { url: 'a', lastRevalidated: 8200000 },
    { url: 'b', lastRevalidated: 8200001 },
    { url: 'c', lastRevalidated: 0 },
  ] })
  h.clock.t = 10000000
  assert.equal(await h.sweep.sweepOnce(), 2)
  assert.deepEqual(h.queue.map((r) => r.id), ['cacheRevalidate:a', 'cacheRevalidate:c'])
  assert.equal(h.sweep.getStats().candidatesSeen, 3)
  assert.equal(h.queue[0].kind, 'cacheRevalidate')
  assert.deepEqual(h.queue[0].features, { distance: 100000, screenSize: 1, inFrustum: false, gameplayBoost: 0 })
})
checkProbe('cache revalidation: a sweep enqueues only entries whose revalidation is at or before the cutoff')

await probe('cache revalidation: one sweep enqueues at most eight entries', async () => {
  const entries = Array.from({ length: 10 }, (_, i) => ({ url: 'u' + i, lastRevalidated: 0 }))
  const h = sweepHarness({ entries })
  h.clock.t = 10000000
  assert.equal(await h.sweep.sweepOnce(), 8)
  assert.equal(h.queue.length, 8)
  assert.equal(h.sweep.getStats().candidatesSeen, 8)
})
checkProbe('cache revalidation: one sweep enqueues at most eight entries')

await probe('cache revalidation: an entry in flight is not enqueued again until its revalidation settles', async () => {
  const pending = new Map()
  const h = sweepHarness({
    entries: [{ url: 'a', lastRevalidated: 0 }, { url: 'c', lastRevalidated: 0 }],
    revalidate: (url) => new Promise((resolve) => pending.set(url, resolve)),
  })
  h.clock.t = 10000000
  assert.equal(await h.sweep.sweepOnce(), 2)
  assert.equal(await h.sweep.sweepOnce(), 0)
  h.queue[0].run()
  pending.get('a')({ changed: true })
  await flush()
  assert.equal(h.sweep.getStats().revalidated, 1)
  assert.equal(h.sweep.getStats().changed, 1)
  assert.equal(h.sweep.getStats().inFlight, 1)
  assert.equal(await h.sweep.sweepOnce(), 1)
})
checkProbe('cache revalidation: an entry in flight is not enqueued again until its revalidation settles')

await probe('cache revalidation: a failed revalidation counts an error and frees its slot', async () => {
  const h = sweepHarness({
    entries: [{ url: 'a', lastRevalidated: 0 }, { url: 'c', lastRevalidated: 0 }],
    revalidate: async (url) => {
      if (url === 'c') throw new Error('network')
      return { changed: false }
    },
  })
  h.clock.t = 10000000
  await h.sweep.sweepOnce()
  for (const rec of h.queue) rec.run()
  await flush()
  const s = h.sweep.getStats()
  assert.equal(s.enqueued, 2)
  assert.equal(s.revalidated, 1)
  assert.equal(s.errors, 1)
  assert.equal(s.changed, 0)
  assert.equal(s.inFlight, 0)
})
checkProbe('cache revalidation: a failed revalidation counts an error and frees its slot')

await probe('cache revalidation: an unavailable list counts a sweep and enqueues nothing', async () => {
  const log = []
  const h = sweepHarness({ listFails: true, log })
  assert.equal(await h.sweep.sweepOnce(), 0)
  assert.equal(h.sweep.getStats().sweeps, 1)
  assert.equal(h.queue.length, 0)
  assert.ok(log.some((line) => line.includes('sweep list-unavailable')))
})
checkProbe('cache revalidation: an unavailable list counts a sweep and enqueues nothing')

await probe('cache revalidation: the sweep cap stops the timers after the configured count', async () => {
  const log = []
  const h = sweepHarness({ log, opts: { maxSweeps: 2 } })
  h.sweep.start()
  h.advance(300000)
  assert.equal(h.sweep.stopped, true)
  assert.deepEqual(h.sweep.verdict, { reason: 'cap', sweeps: 2, ms: 300000 })
  assert.equal(h.pending(), 0)
  assert.ok(log.some((line) => line.startsWith('[cache-revalidate] cap after 2 sweeps / 300000ms')))
})
checkProbe('cache revalidation: the sweep cap stops the timers after the configured count')

await probe('cache revalidation: the deadline stops the sweep once the window is past', async () => {
  const h = sweepHarness({ opts: { sweepDeadlineMs: 20000 } })
  h.sweep.start()
  h.advance(15000)
  assert.equal(h.sweep.stopped, false)
  h.advance(285000)
  assert.equal(h.sweep.stopped, true)
  assert.deepEqual(h.sweep.verdict, { reason: 'cap', sweeps: 2, ms: 300000 })
})
checkProbe('cache revalidation: the deadline stops the sweep once the window is past')

await probe('cache revalidation control: with the defaults, two sweeps leave the sweep running', async () => {
  const h = sweepHarness()
  h.sweep.start()
  h.advance(300000)
  assert.equal(h.sweep.stopped, false)
  assert.equal(h.sweep.verdict, null)
  h.sweep.stop()
})
checkProbe('cache revalidation control: with the defaults, two sweeps leave the sweep running')

await probe('cache revalidation: stop records a verdict once, and restart runs only when stopped', async () => {
  const h = sweepHarness()
  h.sweep.start()
  h.advance(15000)
  const first = h.sweep.stop()
  assert.deepEqual(first, { reason: 'stopped', sweeps: 1, ms: 15000 })
  assert.equal(h.sweep.stop(), first)
  assert.equal(h.pending(), 0)
  assert.equal(h.sweep.restart(), true)
  assert.equal(h.sweep.restart(), false)
  assert.equal(h.sweep.verdict, null)
  h.sweep.stop()
})
checkProbe('cache revalidation: stop records a verdict once, and restart runs only when stopped')

await probe('cache revalidation: sweepOnce keeps working when destructured from the sweep', async () => {
  const h = sweepHarness({ entries: [{ url: 'a', lastRevalidated: 0 }] })
  h.clock.t = 10000000
  const { sweepOnce } = h.sweep
  assert.equal(await sweepOnce(), 1)
})
checkProbe('cache revalidation: sweepOnce keeps working when destructured from the sweep')

gate('cache revalidation: bad options and missing dependencies are refused at construction', () => {
  const base = () => ({
    scheduler: { enqueue: () => true, size: () => 0 },
    listEntries: async () => [],
    revalidate: async () => ({}),
    now: () => 0,
    timers: { after: () => 0, cancelAfter: () => {}, every: () => 0, stopEvery: () => {} },
  })
  mustThrow(() => createCacheRevalidationSweep({ ...base(), maxPerSweep: 0 }), RangeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), staleMs: -1 }), RangeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), staleMs: NaN }), RangeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), sweepDeadlineMs: Infinity }), RangeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), scheduler: {} }), TypeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), now: undefined }), TypeError)
  mustThrow(() => createCacheRevalidationSweep({ ...base(), timers: undefined }), TypeError)
  assert.equal(typeof createCacheRevalidationSweep(base()).start, 'function')
})

const grid = (x, z) => x + z

gate('exact patch frame: without a mesh the placement frame reads the planet frame', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid }
  const patch = createExactPatchFrame(frame)
  assert.equal(patch.placementFrame.elevationAtDir([0, 1, 0]), 7)
  assert.equal(patch.placementFrame.groundHeightLocal(3, 5), 8)
  assert.equal(patch.placementFrame.radius, 100)
  assert.notEqual(patch.placementFrame, frame)
  assert.equal(patch.missing, false)
})

gate('exact patch frame: a constant mesh height is the ground and the elevation along the up direction', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, renderMeshHeightAtLocal: () => 5 }
  const patch = createExactPatchFrame(frame)
  assert.equal(patch.placementFrame.groundHeightLocal(3, 5), 5)
  near(patch.placementFrame.elevationAtDir([0, 1, 0]), 5, 1e-9, 'mesh elevation')
  assert.equal(patch.placementFrame.elevationAtDir([0, 0, 0]), 9)
  assert.equal(patch.placementFrame.elevationAtDir([1, 0, 0]), 9)
})

gate('exact patch frame: a mesh with no ground falls back to the CPU sampler and the planet frame', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, renderMeshHeightAtLocal: () => null }
  const patch = createExactPatchFrame(frame)
  assert.equal(patch.placementFrame.groundHeightLocal(3, 5), 8)
  assert.equal(patch.placementFrame.elevationAtDir([0, 1, 0]), 9)
})

gate('exact patch frame: a zero mesh height gives zero elevation along up', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, renderMeshHeightAtLocal: () => 0 }
  assert.equal(createExactPatchFrame(frame).placementFrame.elevationAtDir([0, 1, 0]), 0)
})

gate('exact patch frame: a patch without ground throws a NoGroundHeightError and marks the chunk missing until begin', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, _patchHeightOrNull: () => null }
  const patch = createExactPatchFrame(frame)
  assert.throws(() => patch.placementFrame.groundHeightLocal(1, 2), (e) => e instanceof NoGroundHeightError)
  assert.equal(patch.missing, true)
  patch.beginChunk()
  assert.equal(patch.missing, false)
})

gate('exact patch frame: a patch height is used when there is no mesh, and the mesh wins when both exist', () => {
  const patchOnly = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, _patchHeightOrNull: () => 4 }
  assert.equal(createExactPatchFrame(patchOnly).placementFrame.groundHeightLocal(1, 2), 4)
  const both = { ...patchOnly, renderMeshHeightAtLocal: () => 5 }
  const patch = createExactPatchFrame(both)
  assert.equal(patch.placementFrame.groundHeightLocal(1, 2), 5)
  assert.equal(patch.missing, false)
})

gate('exact patch frame: prefetch reaches the patch when it exists and is a no-op otherwise', () => {
  const calls = []
  const withPatch = createExactPatchFrame({ radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, _patchPrefetch: (x, z) => calls.push([x, z]) })
  withPatch.prefetchChunk(1, 2)
  assert.deepEqual(calls, [[1, 2]])
  const bare = createExactPatchFrame({ radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid })
  bare.prefetchChunk(1, 2)
})

gate('exact patch frame: a frame without its sampler functions is refused', () => {
  mustThrow(() => createExactPatchFrame({}), TypeError)
  mustThrow(() => createExactPatchFrame(null), TypeError)
  mustThrow(() => createExactPatchFrame({ elevationAtDir: () => 1, groundHeightLocal: grid }), TypeError)
})

gate('exact patch frame control: a mesh height of 5 is not the planet frame height of 8', () => {
  const frame = { radius: 100, anchorHeight: 0, offsetY: 0, up: [0, 1, 0], east: [1, 0, 0], north: [0, 0, 1], elevationAtDir: () => 7, cpuElevationAtDir: () => 9, groundHeightLocal: grid, renderMeshHeightAtLocal: () => 5 }
  refutes(() => assert.equal(createExactPatchFrame(frame).placementFrame.groundHeightLocal(3, 5), 8), 'the planet frame height won over the mesh')
})

finish()
