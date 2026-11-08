import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { installCustomVersion } from '../src/apps/CustomVersion.js'
import { createEcsEntityMap } from '../src/apps/EcsEntityMap.js'
import { EventBus } from '../src/apps/EventBus.js'
import { parseSurfaceSelector, selectSurface } from '../src/apps/SurfaceSelector.js'
import { createSurfaceSelectorRuntime } from '../src/apps/SurfaceSelectorRuntime.js'
import { ENGINE_ALIASES, engineAliasUrls, localSpecifiers, rewriteLocalSpecifiers } from '../src/apps/appImports.js'

const makeBus = () => {
  const state = { clock: 0, errors: [], warnings: [], nowCalls: 0 }
  const bus = new EventBus({
    now: () => { state.nowCalls++; return state.clock },
    error: (...args) => state.errors.push(args),
    warn: (...args) => state.warnings.push(args),
  })
  return { bus, state }
}

const tag = (log, name) => () => { log.push(name) }

const throwsCode = (code) => (error) => error.reasonCode === code

gate('CustomVersion: installing on an entity with no custom leaves null and one version', () => {
  const entity = {}
  installCustomVersion(entity)
  assert.equal(entity.custom, null)
  assert.equal(entity._customV, 1)
})

gate('CustomVersion: installing with an initial object keeps it and bumps once', () => {
  const entity = { custom: { hp: 1 } }
  installCustomVersion(entity)
  assert.deepEqual(entity.custom, { hp: 1 })
  assert.equal(entity._customV, 1)
})

gate('CustomVersion: a property write through custom bumps the version by one', () => {
  const entity = { custom: { hp: 1 } }
  installCustomVersion(entity)
  entity.custom.hp = 2
  assert.equal(entity._customV, 2)
  assert.equal(entity.custom.hp, 2)
})

gate('CustomVersion: a nested plain object is wrapped and its write bumps the same entity', () => {
  const entity = { custom: { hp: 1 } }
  installCustomVersion(entity)
  entity.custom.inner = { x: 0 }
  assert.equal(entity._customV, 2)
  entity.custom.inner.x = 5
  assert.equal(entity._customV, 3)
  assert.equal(entity.custom.inner.x, 5)
})

gate('CustomVersion: a delete through custom bumps the version', () => {
  const entity = { custom: { hp: 1, mana: 4 } }
  installCustomVersion(entity)
  delete entity.custom.hp
  assert.equal(entity._customV, 2)
  assert.equal('hp' in entity.custom, false)
})

gate('CustomVersion: assigning null or undefined to custom stores null and bumps', () => {
  const entity = { custom: { hp: 1 } }
  installCustomVersion(entity)
  entity.custom = null
  assert.equal(entity.custom, null)
  assert.equal(entity._customV, 2)
  entity.custom = undefined
  assert.equal(entity.custom, null)
  assert.equal(entity._customV, 3)
})

gate('CustomVersion: a non-object or array assignment is refused and leaves the version alone', () => {
  const entity = { custom: { hp: 1 } }
  installCustomVersion(entity)
  const before = entity._customV
  assert.throws(() => { entity.custom = 5 }, /entity\.custom must be null or a plain object/)
  assert.throws(() => { entity.custom = [1] }, /entity\.custom must be null or a plain object/)
  assert.throws(() => { entity.custom = 'text' }, /entity\.custom must be null or a plain object/)
  assert.equal(entity._customV, before)
})

gate('CustomVersion: installing twice is a no-op and keeps the version', () => {
  const entity = { custom: { a: 1 } }
  installCustomVersion(entity)
  entity.custom = { a: 1 }
  const before = entity._customV
  installCustomVersion(entity)
  assert.equal(entity._customV, before)
  assert.equal(entity.custom.a, 1)
})

gate('CustomVersion: an array in custom is wrapped, and push through it bumps once per set', () => {
  const entity = { custom: { list: [] } }
  installCustomVersion(entity)
  const before = entity._customV
  entity.custom.list.push(3)
  assert.deepEqual([...entity.custom.list], [3])
  assert.equal(entity._customV, before + 2)
})

gate('CustomVersion negative control: a write through the raw object does not bump the version', () => {
  const entity = { custom: null }
  installCustomVersion(entity)
  const raw = { q: 1 }
  entity.custom = raw
  const before = entity._customV
  raw.q = 2
  assert.equal(entity._customV, before)
  assert.equal(entity.custom.q, 2)
})

gate('EcsEntityMap: an empty map has size 0, no keys and missing reads', () => {
  const map = createEcsEntityMap()
  assert.equal(map.size, 0)
  assert.equal(map.get('a'), undefined)
  assert.equal(map.has('a'), false)
  assert.deepEqual([...map.keys()], [])
  assert.equal(map.delete('a'), false)
})

gate('EcsEntityMap: set returns the map and stores values in insertion order', () => {
  const map = createEcsEntityMap()
  assert.equal(map.set('a', 1), map)
  map.set('b', 2)
  assert.equal(map.size, 2)
  assert.equal(map.get('a'), 1)
  assert.equal(map.has('b'), true)
  assert.deepEqual([...map.keys()], ['a', 'b'])
  assert.deepEqual([...map.values()], [1, 2])
  assert.deepEqual([...map], [['a', 1], ['b', 2]])
})

gate('EcsEntityMap: setting an existing key replaces its value and keeps the size', () => {
  const map = createEcsEntityMap()
  map.set('a', 1)
  map.set('a', 9)
  assert.equal(map.size, 1)
  assert.equal(map.get('a'), 9)
})

gate('EcsEntityMap: delete reports true once, then false, and removes the component', () => {
  const map = createEcsEntityMap()
  map.set('a', 1).set('b', 2)
  assert.equal(map.delete('a'), true)
  assert.equal(map.delete('a'), false)
  assert.equal(map.size, 1)
  assert.equal(map.has('a'), false)
  assert.equal(map.get('a'), undefined)
})

gate('EcsEntityMap: forEach passes value, key and the map', () => {
  const map = createEcsEntityMap()
  map.set('a', 1).set('b', 2)
  const seen = []
  map.forEach(function visit(value, key, source) {
    seen.push([value, key, source === map, this.tag])
  }, { tag: 't' })
  assert.deepEqual(seen, [[1, 'a', true, 't'], [2, 'b', true, 't']])
})

gate('EcsEntityMap: numeric keys and object values keep their identity', () => {
  const map = createEcsEntityMap()
  const value = {}
  map.set(1, 'x').set(2, value)
  assert.deepEqual([...map.keys()], [1, 2])
  assert.equal(map.get(2), value)
})

gate('EcsEntityMap: clear removes every entry and the world reports the same count', () => {
  const map = createEcsEntityMap()
  map.set('a', 1).set('b', 2)
  assert.equal(map._ecs.entityCount, 2)
  map.clear()
  assert.equal(map.size, 0)
  assert.deepEqual([...map.keys()], [])
  assert.equal(map._ecs.exists('a'), false)
})

gate('EcsEntityMap: two maps do not share entries', () => {
  const first = createEcsEntityMap()
  const second = createEcsEntityMap()
  first.set('k', 1)
  assert.equal(second.has('k'), false)
  assert.equal(second.size, 0)
})

gate('EcsEntityMap negative control: an undefined key is refused and leaves no orphan entity', () => {
  const map = createEcsEntityMap()
  map.set('a', 1)
  assert.throws(() => map.set(undefined, 2), /key must not be undefined/)
  assert.equal(map.size, 1)
  assert.equal(map._ecs.entityCount, 1)
})

gate('EventBus: a constructor missing now, error or warn is refused', () => {
  assert.throws(() => new EventBus(), /now must be a function/)
  assert.throws(() => new EventBus({ now: () => 0, error: () => {} }), /warn must be a function/)
  assert.throws(() => new EventBus({ now: 5, error: () => {}, warn: () => {} }), /now must be a function/)
})

gate('EventBus: on refuses a non-string channel and a non-function handler', () => {
  const { bus } = makeBus()
  assert.throws(() => bus.on(5, () => {}), /channel must be a string/)
  assert.throws(() => bus.on('x', 5), /handler must be a function/)
})

gate('EventBus: an exact channel delivers the event with the injected timestamp merged into meta', () => {
  const { bus, state } = makeBus()
  state.clock = 42
  const seen = []
  bus.on('a.b', (event) => seen.push(event))
  const event = bus.emit('a.b', 7, { x: 1 })
  assert.deepEqual(seen, [event])
  assert.deepEqual(event, { channel: 'a.b', data: 7, meta: { x: 1, timestamp: 42 } })
})

gate('EventBus: the returned unsubscribe stops delivery', () => {
  const { bus } = makeBus()
  const log = []
  const stop = bus.on('x', tag(log, 'h'))
  bus.emit('x')
  stop()
  bus.emit('x')
  assert.deepEqual(log, ['h'])
})

gate('EventBus negative control: an exact channel is not a prefix match', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('a', tag(log, 'a'))
  bus.emit('ab')
  bus.emit('a.b')
  assert.deepEqual(log, [])
})

gate('EventBus: a suffix wildcard matches the prefix itself and anything under it', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('room.*', tag(log, 'r'))
  bus.emit('room.join')
  bus.emit('room.')
  bus.emit('room')
  bus.emit('roomx')
  bus.emit('other.room.x')
  assert.deepEqual(log, ['r', 'r'])
})

gate('EventBus: a lone star wildcard receives every channel, including the empty one', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('*', tag(log, 's'))
  bus.emit('x')
  bus.emit('')
  bus.emit('deep.one')
  assert.deepEqual(log, ['s', 's', 's'])
})

gate('EventBus: a channel that matches two wildcards and an exact handler fires each once in depth order', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('a.b', tag(log, 'exact'))
  bus.on('a*', tag(log, 'a*'))
  bus.on('a.*', tag(log, 'a.*'))
  bus.emit('a.b')
  assert.deepEqual(log, ['exact', 'a*', 'a.*'])
})

gate('EventBus: a wildcard reached by two prefixes of one channel is not delivered twice', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('a*', tag(log, 'a*'))
  bus.emit('abc')
  bus.emit('a.b.c')
  assert.deepEqual(log, ['a*', 'a*'])
})

gate('EventBus: a suffix wildcard with a prefix that matches no channel is not delivered', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('a.*', tag(log, 'a.*'))
  bus.emit('a.x')
  bus.emit('a')
  assert.deepEqual(log, ['a.*'])
})

gate('EventBus: a handler that throws is logged with its label and the other handlers still run', () => {
  const { bus, state } = makeBus()
  const log = []
  bus.on('a.b', () => { throw new Error('boom') })
  bus.on('a.b', tag(log, 'after'))
  const event = bus.emit('a.b')
  assert.deepEqual(log, ['after'])
  assert.equal(event.channel, 'a.b')
  assert.deepEqual(state.errors, [['[EventBus] a.b:', 'boom']])
})

gate('EventBus: wildcard failures are labelled by the matched prefix, and a full-length match by the bare label', () => {
  const { bus, state } = makeBus()
  bus.on('a.*', () => { throw new Error('wild') })
  bus.emit('a.b')
  bus.emit('a.')
  assert.deepEqual(state.errors, [['[EventBus] *a.*:', 'wild'], ['[EventBus]:', 'wild']])
})

gate('EventBus negative control: a failing handler does not stop emit from returning the event', () => {
  const { bus } = makeBus()
  bus.on('x', () => { throw 'plain string' })
  assert.equal(bus.emit('x', 1).data, 1)
})

gate('EventBus: once delivers one event and its returned unsubscribe cancels it before emit', () => {
  const { bus } = makeBus()
  const log = []
  bus.once('x', tag(log, 'once'))
  bus.emit('x')
  bus.emit('x')
  assert.deepEqual(log, ['once'])
  const stop = bus.once('y', tag(log, 'never'))
  stop()
  bus.emit('y')
  assert.deepEqual(log, ['once'])
})

gate('EventBus: off with the original handler removes a pending once wrapper', () => {
  const { bus } = makeBus()
  const log = []
  const handler = tag(log, 'h')
  bus.once('x', handler)
  bus.off('x', handler)
  bus.emit('x')
  assert.deepEqual(log, [])
})

gate('EventBus: off on a wildcard rebuilds the trie so the handler stops', () => {
  const { bus } = makeBus()
  const log = []
  const handler = tag(log, 'w')
  bus.on('a.*', handler)
  bus.emit('a.x')
  bus.off('a.*', handler)
  bus.emit('a.x')
  assert.deepEqual(log, ['w'])
})

gate('EventBus: a scope delivers its emits with sourceEntity and stops after destroy', () => {
  const { bus } = makeBus()
  const scope = bus.scope('e1')
  const seen = []
  scope.on('x', (event) => seen.push(event.meta.sourceEntity))
  scope.emit('x', 5)
  assert.deepEqual(seen, ['e1'])
  scope.destroy()
  bus.emit('x')
  assert.deepEqual(seen, ['e1'])
})

gate('EventBus: a released scope warns and returns a no-op unsubscribe', () => {
  const { bus, state } = makeBus()
  const scope = bus.scope('e1')
  scope.destroy()
  const log = []
  const stop = scope.on('x', tag(log, 'late'))
  assert.equal(typeof stop, 'function')
  stop()
  bus.emit('x')
  assert.deepEqual(log, [])
  assert.deepEqual(state.warnings, [["[EventBus] e1: ignored 'x' subscription on a released scope"]])
})

gate('EventBus: a scope once fires once, and handover emits system.handover with the source entity', () => {
  const { bus } = makeBus()
  const scope = bus.scope('e2')
  const log = []
  scope.once('x', tag(log, 'once'))
  scope.emit('x')
  scope.emit('x')
  assert.deepEqual(log, ['once'])
  const handed = []
  bus.on('system.handover', (event) => handed.push(event))
  scope.handover('e9', { hp: 1 })
  assert.equal(handed.length, 1)
  assert.deepEqual(handed[0].data, { targetEntityId: 'e9', stateData: { hp: 1 } })
  assert.equal(handed[0].meta.sourceEntity, 'e2')
})

gate('EventBus: destroyScope releases the scope and tolerates an unknown id', () => {
  const { bus } = makeBus()
  const scope = bus.scope('e3')
  const log = []
  scope.on('x', tag(log, 'x'))
  bus.destroyScope('e3')
  bus.destroyScope('e3')
  bus.destroyScope('never')
  bus.emit('x')
  assert.deepEqual(log, [])
})

gate('EventBus: clear removes exact and wildcard handlers and scopes, and new subscriptions work afterwards', () => {
  const { bus } = makeBus()
  const log = []
  bus.on('a.b', tag(log, 'exact'))
  bus.on('a.*', tag(log, 'wild'))
  const scope = bus.scope('e4')
  scope.on('a.b', tag(log, 'scoped'))
  bus.clear()
  bus.emit('a.b')
  assert.deepEqual(log, [])
  bus.on('a.*', tag(log, 'fresh'))
  bus.emit('a.b')
  assert.deepEqual(log, ['fresh'])
})

gate('EventBus negative control: a scope destroyed by clear warns on a new subscription', () => {
  const { bus, state } = makeBus()
  const scope = bus.scope('e5')
  bus.clear()
  scope.on('x', () => {})
  assert.equal(state.warnings.length, 1)
})

gate('EventBus: the injected clock is read once per emit', () => {
  const { bus, state } = makeBus()
  bus.emit('a')
  bus.emit('b')
  assert.equal(state.nowCalls, 2)
})

gate('SurfaceSelector parse: a valid spec is frozen and keeps its rule order', () => {
  const selector = parseSurfaceSelector({
    fallback: 'desk',
    rules: [{ surface: 'touch', key: 'coarse', equals: true }, { surface: 'hud', key: 'hud', present: true }],
  })
  assert.equal(Object.isFrozen(selector), true)
  assert.equal(Object.isFrozen(selector.rules), true)
  assert.equal(selector.rules.length, 2)
  assert.throws(() => { selector.rules.push({}) }, TypeError)
})

gate('SurfaceSelector select: the first matching rule wins and the fallback is used otherwise', () => {
  const selector = parseSurfaceSelector({
    fallback: 'desk',
    rules: [{ surface: 'touch', key: 'coarse', equals: true }, { surface: 'hud', key: 'hud', present: true }],
  })
  assert.equal(selectSurface(selector, { coarse: true, hud: 1 }), 'touch')
  assert.equal(selectSurface(selector, { hud: 'x' }), 'hud')
  assert.equal(selectSurface(selector, {}), 'desk')
  assert.equal(selectSurface(selector, null), 'desk')
})

gate('SurfaceSelector select negative control: equals is strict and present treats null as absent', () => {
  const selector = parseSurfaceSelector({
    fallback: 'desk',
    rules: [{ surface: 'touch', key: 'coarse', equals: true }, { surface: 'hud', key: 'hud', present: true }],
  })
  assert.equal(selectSurface(selector, { coarse: 'true' }), 'desk')
  assert.equal(selectSurface(selector, { hud: null }), 'desk')
})

gate('SurfaceSelector select: an equals rule against undefined matches a missing key', () => {
  const selector = parseSurfaceSelector({ fallback: 'f', rules: [{ surface: 'u', key: 'k', equals: undefined }] })
  assert.equal(selectSurface(selector, {}), 'u')
})

gate('SurfaceSelector select: a present false rule matches null and undefined but not 0', () => {
  const selector = parseSurfaceSelector({ fallback: 'f', rules: [{ surface: 'p', key: 't', present: false }] })
  assert.equal(selectSurface(selector, { t: null }), 'p')
  assert.equal(selectSurface(selector, {}), 'p')
  assert.equal(selectSurface(selector, { t: 0 }), 'f')
})

gate('SurfaceSelector parse refusals: bad top level, bad rule shapes, and bad present', () => {
  assert.throws(() => parseSurfaceSelector(null), /needs a string fallback and a rules array/)
  assert.throws(() => parseSurfaceSelector({ fallback: 1, rules: [] }), /needs a string fallback/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: {} }), /needs a string fallback/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [5] }), /rule 0 is not an object/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [{ surface: 'a', key: 'k', equals: 1, extra: true }] }), /unknown key "extra"/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [{ key: 'k', equals: 1 }] }), /needs string surface and key/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [{ surface: 'a', key: 'k' }] }), /exactly one of equals or present/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [{ surface: 'a', key: 'k', equals: 1, present: true }] }), /exactly one of equals or present/)
  assert.throws(() => parseSurfaceSelector({ fallback: 'a', rules: [{ surface: 'a', key: 'k', present: 'yes' }] }), /present must be boolean/)
})

gate('SurfaceSelectorRuntime: invalid labels, rate, and clock are refused with their reason codes', () => {
  const now = () => 0
  assert.throws(() => createSurfaceSelectorRuntime({ labels: [], now }), throwsCode('selector-labels-invalid'))
  assert.throws(() => createSurfaceSelectorRuntime({ maxSwapsPerSecond: 0, now }), throwsCode('selector-rate-invalid'))
  assert.throws(() => createSurfaceSelectorRuntime({ maxSwapsPerSecond: Number.NaN, now }), throwsCode('selector-rate-invalid'))
  assert.throws(() => createSurfaceSelectorRuntime({ maxSwapsPerSecond: Infinity, now }), throwsCode('selector-rate-invalid'))
  assert.throws(() => createSurfaceSelectorRuntime({}), throwsCode('selector-clock-invalid'))
})

gate('SurfaceSelectorRuntime select: desktop and touch names, with orientation and labels', () => {
  const runtime = createSurfaceSelectorRuntime({ labels: { hud: 'HUD' }, now: () => 0 })
  assert.deepEqual(runtime.select(), { name: 'desktop', hidden: false, label: 'desktop' })
  assert.deepEqual(runtime.select({ device: { coarse: true } }), { name: 'touch-landscape', hidden: false, label: 'touch-landscape' })
  assert.deepEqual(runtime.select({ device: { coarse: true, orientation: 'portrait' } }), { name: 'touch-portrait', hidden: false, label: 'touch-portrait' })
  assert.deepEqual(runtime.select({ device: { coarse: true, orientation: 'sideways' } }).name, 'touch-landscape')
  assert.deepEqual(runtime.select({ player: { surface: 'hud' } }), { name: 'hud', hidden: false, label: 'HUD' })
  assert.deepEqual(runtime.select({ player: { uiSurface: 'menu' } }).name, 'menu')
  assert.deepEqual(runtime.select({ player: { surface: 'a', uiSurface: 'b' } }).name, 'a')
  assert.deepEqual(runtime.select({ player: { surface: '' }, device: { coarse: true } }).name, 'touch-landscape')
  assert.deepEqual(runtime.select({ player: { surface: 5 } }).name, 'desktop')
})

gate('SurfaceSelectorRuntime select: a hidden value hides the player, and a null surface hides when hideValue is null', () => {
  const hidden = createSurfaceSelectorRuntime({ hideValue: 'none', now: () => 0 })
  assert.deepEqual(hidden.select({ player: { surface: 'none' } }), { name: null, hidden: true, label: null })
  const nullable = createSurfaceSelectorRuntime({ now: () => 0 })
  assert.equal(nullable.select({ player: { surface: null } }).hidden, true)
  assert.equal(nullable.select({ player: {} }).hidden, false)
})

gate('SurfaceSelectorRuntime select refusals: non-object player or device', () => {
  const runtime = createSurfaceSelectorRuntime({ now: () => 0 })
  assert.throws(() => runtime.select({ player: null }), throwsCode('selector-context-invalid'))
  assert.throws(() => runtime.select({ device: 5 }), throwsCode('selector-context-invalid'))
})

gate('SurfaceSelectorRuntime swap: a second swap inside the window is suppressed and reports the active name', () => {
  let clock = 0
  const runtime = createSurfaceSelectorRuntime({ maxSwapsPerSecond: 2, now: () => clock })
  assert.deepEqual(runtime.swap('a'), { ok: true, reasonCode: null, active: 'a', released: [] })
  clock = 100
  assert.equal(runtime.swap('b').active, 'b')
  clock = 200
  assert.deepEqual(runtime.swap('c'), { ok: false, reasonCode: 'selector-swap-suppressed', active: 'b' })
  assert.deepEqual(runtime.diagnostics(), ['swap-suppressed:c'])
})

gate('SurfaceSelectorRuntime swap window: a swap exactly one second after the first still counts, and one after that does not', () => {
  let clock = 0
  const runtime = createSurfaceSelectorRuntime({ maxSwapsPerSecond: 2, now: () => clock })
  runtime.swap('a')
  clock = 100
  runtime.swap('b')
  clock = 1000
  assert.equal(runtime.swap('d').ok, false)
  clock = 1001
  assert.equal(runtime.swap('e').ok, true)
  assert.equal(runtime.active(), 'e')
})

gate('SurfaceSelectorRuntime holds: held pointers are stringified, released on swap, and release reports presence', () => {
  const runtime = createSurfaceSelectorRuntime({ now: () => 0 })
  runtime.hold(1)
  runtime.hold('2')
  runtime.hold(1)
  assert.deepEqual(runtime.held(), ['1', '2'])
  assert.deepEqual(runtime.swap('x').released, ['1', '2'])
  assert.deepEqual(runtime.held(), [])
  assert.equal(runtime.release(1), false)
  runtime.hold(7)
  assert.equal(runtime.release('7'), true)
  assert.equal(runtime.release(7), false)
})

gate('SurfaceSelectorRuntime: swap refuses a bad name and a non-finite clock, and diagnostics is a copy', () => {
  const runtime = createSurfaceSelectorRuntime({ now: () => 0 })
  assert.throws(() => runtime.swap(''), throwsCode('selector-name-invalid'))
  assert.throws(() => runtime.swap(5), throwsCode('selector-name-invalid'))
  assert.equal(runtime.active(), null)
  const broken = createSurfaceSelectorRuntime({ now: () => Number.NaN })
  assert.throws(() => broken.swap('x'), throwsCode('selector-clock-invalid'))
  const limited = createSurfaceSelectorRuntime({ maxSwapsPerSecond: 1, now: () => 0 })
  limited.swap('a')
  limited.swap('b')
  limited.diagnostics().length = 0
  assert.equal(limited.diagnostics().length, 1)
})

gate('appImports: ENGINE_ALIASES is frozen and holds the two spoint engine paths', () => {
  assert.equal(Object.isFrozen(ENGINE_ALIASES), true)
  assert.deepEqual({ ...ENGINE_ALIASES }, {
    '@spoint/ecs': '/node_modules/@spoint/ecs/src/index.js',
    'three': '/node_modules/three/build/three.module.js',
  })
})

const SAMPLE = [
  "import { x } from './a.js'",
  'import y from "/abs/b.js"',
  "import * as T from 'three'",
  "import { createWorld } from '@spoint/ecs'",
  "import fs from 'node:fs'",
  "export { z } from './a.js'",
  "const m = await import('./dyn.js')",
].join('\n')

gate('appImports localSpecifiers: relative and absolute specifiers only, deduplicated, aliases and bare names excluded', () => {
  assert.deepEqual(localSpecifiers(SAMPLE), ['./a.js', '/abs/b.js'])
})

gate('appImports localSpecifiers negative control: bare names, dynamic import() and an unknown alias are not local', () => {
  assert.deepEqual(localSpecifiers("import fs from 'node:fs'"), [])
  assert.deepEqual(localSpecifiers("const m = import('./dyn.js')"), [])
  assert.deepEqual(localSpecifiers("from 'foo'", { foo: 'x' }), [])
  assert.deepEqual(localSpecifiers("from 'three'", {}), [])
  assert.deepEqual(localSpecifiers("from 'three'"), [])
})

gate('appImports engineAliasUrls: each alias is prefixed by the origin', () => {
  assert.deepEqual(engineAliasUrls('https://x.test'), {
    '@spoint/ecs': 'https://x.test/node_modules/@spoint/ecs/src/index.js',
    'three': 'https://x.test/node_modules/three/build/three.module.js',
  })
})

gate('appImports rewriteLocalSpecifiers: mapped specifiers are rewritten with their quotes, unmapped ones are left alone', () => {
  const source = "import { x } from './a.js'\nimport './b.js'\nimport 'three'"
  assert.equal(
    rewriteLocalSpecifiers(source, { './a.js': 'https://o/a.js' }),
    "import { x } from 'https://o/a.js'\nimport './b.js'\nimport 'three'",
  )
  assert.equal(rewriteLocalSpecifiers('import y from "/abs/b.js"', { '/abs/b.js': 'u' }), 'import y from "u"')
})

gate('appImports rewriteLocalSpecifiers negative control: an empty map changes nothing, and a mapped alias is rewritten only when mapped', () => {
  assert.equal(rewriteLocalSpecifiers(SAMPLE, {}), SAMPLE)
  assert.equal(rewriteLocalSpecifiers("import * as T from 'three'", { three: 'u' }), "import * as T from 'u'")
})

finish()
