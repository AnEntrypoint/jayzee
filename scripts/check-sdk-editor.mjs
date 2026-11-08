import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { MAX_OPS, PRUNE_HEADROOM, createEditOpLog } from '../src/sdk/EditOpLog.js'
import { INSTANCE_SCOPES, INSTANCE_LIFETIMES, PlaceInstances, instanceRoomId } from '../src/sdk/PlaceInstances.js'
import { PrefabSpawner, createPrefabSpawner } from '../src/sdk/PrefabSpawner.js'
import { KNOWN_EDITOR_PROP_TYPES, VALID_SPDX, validateManifest } from '../src/sdk/AppManifest.js'
import { ALL_KINDS, LAYOUTS, PRIMITIVES, KIND_PLACE, KIND_UPDATE, computeLayout, validateMessage } from '../src/sdk/FreddieBridge.js'

const sequence = (values) => {
  let index = 0
  return () => values[index++]
}

const ticking = () => {
  let time = 0
  return () => (time += 10)
}

const near = (actual, expected, label) => {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`)
}

const refusedWith = (fn, reasonCode) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'expected a refusal')
  assert.equal(thrown.reasonCode, reasonCode)
}

const fnvRef = (text) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 0x01000193)
  return hash >>> 0
}

const roomHandle = (roomId, worldName, players) => ({
  roomId,
  port: 3000,
  worldName,
  server: { playerManager: { getPlayerCount: () => players } },
})

const fakeDirectory = ({ deferCreate = false, rooms = [] } = {}) => {
  const byId = new Map(rooms.map(room => [room.roomId, room]))
  const calls = { create: [], stop: [] }
  const resolvers = []
  return {
    byId,
    calls,
    resolvers,
    getRoom: (id) => byId.get(id) ?? null,
    createRoom(id, place) {
      calls.create.push(id)
      const make = () => {
        const handle = roomHandle(id, place, 0)
        byId.set(id, handle)
        return handle
      }
      if (!deferCreate) return Promise.resolve(make())
      return new Promise(resolve => resolvers.push(() => resolve(make())))
    },
    stopRoom: async (id) => {
      calls.stop.push(id)
      return byId.delete(id)
    },
    listRooms: () => [...byId.values()],
  }
}

const crate = () => ({
  rootId: 'root',
  entities: [
    { id: 'child', parent: 'root', model: 'bolt', position: [1, 0, 0] },
    { id: 'root', app: 'crate', position: [0, 0, 0] },
    { id: 'grand', parent: 'child', position: [0, 2, 0], custom: { tag: 'x' } },
  ],
})

const library = (prefabs) => ({ load: async (name) => prefabs[name] ?? null })

const runtime = () => {
  const entities = new Map()
  const logs = []
  return {
    entities,
    logs,
    spawnEntity(id, config) {
      entities.set(id, { id, ...structuredClone(config) })
    },
    _log(name, payload, extra) {
      logs.push({ name, payload, extra })
    },
  }
}

const spawnerWith = (appRuntime, prefabs, randoms, clock = ticking()) =>
  new PrefabSpawner(appRuntime, library(prefabs), { now: clock, random: sequence(randoms) })

const cases = {}

const probe = async (label, fn) => {
  try {
    await fn()
    cases[label] = null
  } catch (error) {
    cases[label] = error
  }
}

await probe('acquire dedupes an in-flight create', async () => {
  const directory = fakeDirectory({ deferCreate: true })
  const instances = new PlaceInstances(directory, { place: 'arena-map', lifetime: 'ephemeral' })
  const first = instances.acquire('party', 'a')
  const second = instances.acquire('party', 'a')
  assert.equal(directory.calls.create.length, 1)
  assert.equal(instances.pending.size, 1)
  directory.resolvers.forEach(resolve => resolve())
  const [one, two] = await Promise.all([first, second])
  assert.equal(one, two)
  assert.equal(instances.pending.size, 0)
})

await probe('acquire returns an existing room without creating', async () => {
  const directory = fakeDirectory({ rooms: [roomHandle('solo:k', 'arena-map', 1)] })
  const instances = new PlaceInstances(directory, { place: 'arena-map' })
  const handle = await instances.acquire('solo', 'k')
  assert.equal(handle.roomId, 'solo:k')
  assert.equal(directory.calls.create.length, 0)
})

await probe('acquire refuses a bad scope before any directory call', async () => {
  const directory = fakeDirectory()
  const instances = new PlaceInstances(directory, { place: 'arena-map' })
  assert.throws(() => instances.acquire('arena', 'a'), (error) => error.reasonCode === 'instance-scope')
  assert.equal(directory.calls.create.length, 0)
})

await probe('release stops an empty ephemeral room', async () => {
  const directory = fakeDirectory({ rooms: [roomHandle('party:a', 'm', 0)] })
  const instances = new PlaceInstances(directory, { place: 'm', lifetime: 'ephemeral' })
  assert.equal(await instances.release('party', 'a'), true)
  assert.deepEqual(directory.calls.stop, ['party:a'])
})

await probe('release keeps a populated ephemeral room', async () => {
  const directory = fakeDirectory({ rooms: [roomHandle('party:a', 'm', 2)] })
  const instances = new PlaceInstances(directory, { place: 'm', lifetime: 'ephemeral' })
  assert.equal(await instances.release('party', 'a'), false)
  assert.equal(directory.byId.has('party:a'), true)
})

await probe('release is refused outside the ephemeral lifetime', async () => {
  const directory = fakeDirectory({ rooms: [roomHandle('party:a', 'm', 0)] })
  const instances = new PlaceInstances(directory, { place: 'm', lifetime: 'session' })
  assert.equal(await instances.release('party', 'a'), false)
  assert.equal(directory.calls.stop.length, 0)
})

await probe('sweep stops empty party and solo rooms only', async () => {
  const directory = fakeDirectory({
    rooms: [
      roomHandle('party:a', 'm', 0),
      roomHandle('solo:b', 'm', 0),
      roomHandle('party:c', 'm', 2),
      roomHandle('arena:x', 'm', 0),
    ],
  })
  const instances = new PlaceInstances(directory, { place: 'm', lifetime: 'ephemeral' })
  assert.equal(await instances.sweep(), 2)
  assert.deepEqual([...directory.byId.keys()].sort(), ['arena:x', 'party:c'])
})

await probe('sweep does nothing outside the ephemeral lifetime', async () => {
  const directory = fakeDirectory({ rooms: [roomHandle('party:a', 'm', 0)] })
  const instances = new PlaceInstances(directory, { place: 'm', lifetime: 'persistent' })
  assert.equal(await instances.sweep(), 0)
  assert.equal(directory.byId.has('party:a'), true)
})

await probe('spawnPrefab spawns parents before children and places the root', async () => {
  const appRuntime = runtime()
  const spawner = spawnerWith(appRuntime, { crate: crate() }, [0.5, 0.75, 0.25])
  const rootId = await spawner.spawnPrefab('crate', [10, 0, 5], [0, 0, 0, 1])
  assert.equal(rootId, 'crate-i')
  assert.deepEqual([...appRuntime.entities.keys()], ['crate-i', 'placed-r', 'entity-9'])
  assert.deepEqual(appRuntime.entities.get('crate-i').position, [10, 0, 5])
  assert.equal(appRuntime.entities.get('crate-i').app, 'crate')
  assert.equal(appRuntime.entities.get('placed-r').parent, 'crate-i')
  assert.equal(appRuntime.entities.get('placed-r').model, 'bolt')
  assert.deepEqual(appRuntime.entities.get('placed-r').position, [1, 0, 0])
  assert.equal(appRuntime.entities.get('entity-9').parent, 'placed-r')
  assert.deepEqual(appRuntime.entities.get('entity-9').custom, { tag: 'x' })
  assert.deepEqual([...spawner.getSpawnedPrefabInstances('crate-i')], ['crate-i', 'placed-r', 'entity-9'])
  assert.deepEqual(appRuntime.logs, [{
    name: 'prefab_spawn',
    payload: { prefabName: 'crate', rootId: 'crate-i', count: 3, elapsedMs: 10 },
    extra: { sourceEntity: 'crate-i' },
  }])
})

await probe('spawnPrefab applies a child override', async () => {
  const appRuntime = runtime()
  const spawner = spawnerWith(appRuntime, { crate: crate() }, [0.5, 0.75, 0.25])
  await spawner.spawnPrefab('crate', [0, 0, 0], [0, 0, 0, 1], {
    child: { position: [5, 5, 5], custom: { hp: 3 }, scale: [2, 2, 2], bodyType: 'dynamic', mass: 4 },
  })
  const child = appRuntime.entities.get('placed-r')
  assert.deepEqual(child.position, [5, 5, 5])
  assert.deepEqual(child.custom, { hp: 3 })
  assert.deepEqual(child.scale, [2, 2, 2])
  assert.equal(child.bodyType, 'dynamic')
  assert.equal(child.mass, 4)
})

await probe('spawnMultiple places each root with its rotation', async () => {
  const appRuntime = runtime()
  const spawner = spawnerWith(appRuntime, { crate: crate() }, [0.5, 0.75, 0.25, 0.25, 0.75, 0.5])
  const roots = await spawner.spawnMultiple('crate', [[0, 0, 0], [4, 0, 0]], (i) => (i === 0 ? [0, 0, 0, 1] : [0, 0, 1, 0]))
  assert.deepEqual(roots, ['crate-i', 'crate-9'])
  assert.deepEqual(appRuntime.entities.get('crate-9').position, [4, 0, 0])
  assert.deepEqual(appRuntime.entities.get('crate-9').rotation, [0, 0, 1, 0])
})

await probe('spawnMultiple refuses a bad position before spawning anything', async () => {
  const appRuntime = runtime()
  const spawner = spawnerWith(appRuntime, { crate: crate() }, [0.5, 0.75, 0.25])
  await assert.rejects(() => spawner.spawnMultiple('crate', [[0, 0, 0], [1]]), /position\[1\] must be/)
  assert.equal(appRuntime.entities.size, 0)
})

await probe('spawnPrefab refuses a missing prefab library', async () => {
  const spawner = new PrefabSpawner(runtime(), null, { now: ticking(), random: sequence([0.5]) })
  await assert.rejects(() => spawner.spawnPrefab('crate', [0, 0, 0], [0, 0, 0, 1]), /prefabLibrary not configured/)
})

await probe('spawnPrefab refuses an unknown prefab', async () => {
  const spawner = spawnerWith(runtime(), {}, [])
  await assert.rejects(() => spawner.spawnPrefab('ghost', [0, 0, 0], [0, 0, 0, 1]), /prefab "ghost" invalid or empty/)
})

await probe('spawnPrefab refuses a root that is not one of its entities', async () => {
  const spawner = spawnerWith(runtime(), { bad: { rootId: 'nope', entities: [{ id: 'a' }] } }, [0.5])
  await assert.rejects(() => spawner.spawnPrefab('bad', [0, 0, 0], [0, 0, 0, 1]), /root "nope" is not one of its entities/)
})

await probe('spawnPrefab refuses an entity whose parent is missing', async () => {
  const spawner = spawnerWith(runtime(), { orphan: { entities: [{ id: 'a', parent: 'missing' }] } }, [0.5])
  await assert.rejects(() => spawner.spawnPrefab('orphan', [0, 0, 0], [0, 0, 0, 1]), /names a parent that is not in the prefab/)
})

await probe('spawnPrefab refuses null overrides and a short position', async () => {
  const spawner = spawnerWith(runtime(), { crate: crate() }, [0.5])
  await assert.rejects(() => spawner.spawnPrefab('crate', [0, 0, 0], [0, 0, 0, 1], null), /overrides must be an object/)
  await assert.rejects(() => spawner.spawnPrefab('crate', [0, 0], [0, 0, 0, 1]), /position must be \[x,y,z\]/)
})

await probe('constructor refuses a missing clock or random source', async () => {
  assert.throws(() => new PrefabSpawner(runtime(), null, { random: () => 0.5 }), /requires now/)
  assert.throws(() => new PrefabSpawner(runtime(), null, { now: () => 0 }), /requires random/)
  assert.throws(() => createPrefabSpawner(null, null, { now: () => 0, random: () => 0.5 }), /requires appRuntime/)
})

await probe('updatePrefabInstance changes known children only', async () => {
  const appRuntime = runtime()
  const spawner = spawnerWith(appRuntime, { crate: crate() }, [0.5, 0.75, 0.25])
  await spawner.spawnPrefab('crate', [0, 0, 0], [0, 0, 0, 1])
  const changed = await spawner.updatePrefabInstance('crate-i', {
    'placed-r': { position: [2, 2, 2], custom: { hp: 9 } },
    stranger: { position: [0, 0, 0] },
  })
  assert.equal(changed, true)
  assert.deepEqual(appRuntime.entities.get('placed-r').position, [2, 2, 2])
  assert.deepEqual(appRuntime.entities.get('placed-r').custom, { hp: 9 })
  assert.equal(appRuntime.entities.has('stranger'), false)
  assert.equal(await spawner.updatePrefabInstance('crate-i', {}), false)
})

await probe('updatePrefabInstance refuses an unknown root', async () => {
  const spawner = spawnerWith(runtime(), {}, [])
  await assert.rejects(() => spawner.updatePrefabInstance('nope', {}), /unknown root entity ID "nope"/)
})

gate('EditOpLog keeps the spoint cap of 10000 and the 1000-entry prune headroom', () => {
  assert.equal(MAX_OPS, 10000)
  assert.equal(PRUNE_HEADROOM, 1000)
})

gate('EditOpLog refuses a missing clock', () => {
  assert.throws(() => createEditOpLog({}), TypeError)
  assert.throws(() => createEditOpLog({ now: () => 0, onBroadcastError: 3 }), TypeError)
})

gate('EditOpLog stamps ts from the injected clock and numbers ops from 1', () => {
  const log = createEditOpLog({ now: sequence([1000, 1001]) })
  assert.equal(log.record('move', { x: 1 }, 'ed1'), 1)
  assert.equal(log.record('move', { x: 2 }, 'ed1'), 2)
  const { ops, latestSeq } = log.getOpsSince(0)
  assert.equal(latestSeq, 2)
  assert.deepEqual(ops.map(op => op.ts), [1000, 1001])
  assert.deepEqual(ops[0], { seq: 1, type: 'move', payload: { x: 1 }, editorId: 'ed1', ts: 1000 })
})

gate('EditOpLog passes seq and op to the broadcast and survives a throwing broadcast', () => {
  const seen = []
  const errors = []
  const log = createEditOpLog({ now: () => 5, onBroadcastError: (error) => errors.push(error.message) })
  assert.equal(log.record('a', null, 'e', (seq, op) => seen.push([seq, op.type])), 1)
  assert.equal(log.record('b', null, 'e', () => { throw new Error('socket closed') }), 2)
  assert.deepEqual(seen, [[1, 'a']])
  assert.deepEqual(errors, ['socket closed'])
  assert.equal(log.record('c', null, 'e', 'not a function'), 3)
})

gate('EditOpLog getOpsSince returns only ops after the sequence', () => {
  const log = createEditOpLog({ now: () => 0 })
  for (let i = 0; i < 5; i++) log.record('t', i, 'e')
  const after2 = log.getOpsSince(2)
  assert.deepEqual(after2.ops.map(op => op.seq), [3, 4, 5])
  assert.equal(after2.latestSeq, 5)
  assert.equal(log.getOpsSince(5).ops.length, 0)
})

gate('EditOpLog treats a negative, NaN or non-number since as 0', () => {
  const log = createEditOpLog({ now: () => 0 })
  for (let i = 0; i < 3; i++) log.record('t', i, 'e')
  assert.equal(log.getOpsSince(-1).ops.length, 3)
  assert.equal(log.getOpsSince(Number.NaN).ops.length, 3)
  assert.equal(log.getOpsSince('2').ops.length, 3)
  assert.equal(log.getOpsSince().ops.length, 3)
})

gate('EditOpLog keeps 10000 ops and prunes to the last 1000 on the 10001st', () => {
  const log = createEditOpLog({ now: () => 0 })
  for (let i = 0; i < MAX_OPS; i++) log.record('t', i, 'e')
  assert.equal(log.opCount(), 10000)
  assert.equal(log.getOpsSince(0).ops[0].seq, 1)
  log.record('t', 'overflow', 'e')
  assert.equal(log.opCount(), 1000)
  const { ops, latestSeq } = log.getOpsSince(0)
  assert.equal(ops[0].seq, 9002)
  assert.equal(ops[ops.length - 1].seq, 10001)
  assert.equal(latestSeq, 10001)
  assert.equal(log.record('t', 'next', 'e'), 10002)
  assert.equal(log.opCount(), 1001)
})

gate('EditOpLog clear resets the count and the sequence', () => {
  const log = createEditOpLog({ now: () => 0 })
  log.record('t', 1, 'e')
  log.clear()
  assert.equal(log.opCount(), 0)
  assert.equal(log.latestSeq(), 0)
  assert.equal(log.record('t', 2, 'e'), 1)
})

gate('PlaceInstances has the spoint scopes and lifetimes', () => {
  assert.deepEqual([...INSTANCE_SCOPES], ['party', 'solo'])
  assert.deepEqual([...INSTANCE_LIFETIMES], ['ephemeral', 'session', 'persistent'])
  assert.ok(Object.isFrozen(INSTANCE_SCOPES))
})

gate('PlaceInstances instanceRoomId joins scope and group with a colon', () => {
  assert.equal(instanceRoomId('party', 'abc'), 'party:abc')
  assert.equal(instanceRoomId('solo', 'x:y'), 'solo:x:y')
})

gate('PlaceInstances refuses an unknown scope and an empty group', () => {
  refusedWith(() => instanceRoomId('arena', 'a'), 'instance-scope')
  refusedWith(() => instanceRoomId('party', ''), 'instance-group')
  refusedWith(() => instanceRoomId('solo', 7), 'instance-group')
})

gate('PlaceInstances constructor refuses a missing directory, a bad place and a bad lifetime', () => {
  assert.throws(() => new PlaceInstances(null, { place: 'm' }), /requires a RoomDirectory/)
  assert.throws(() => new PlaceInstances({}, { place: 'm' }), (error) => error.reasonCode === 'instance-directory')
  refusedWith(() => new PlaceInstances(fakeDirectory(), { place: '' }), 'instance-place')
  refusedWith(() => new PlaceInstances(fakeDirectory(), { place: 'm', lifetime: 'forever' }), 'instance-lifetime')
  assert.equal(new PlaceInstances(fakeDirectory(), { place: 'm' }).lifetime, 'session')
})

gate('PlaceInstances list returns party and solo rooms with player counts', () => {
  const directory = fakeDirectory({
    rooms: [roomHandle('party:a', 'm', 0), roomHandle('solo:b', 'm', 3), roomHandle('arena:x', 'm', 1)],
  })
  const instances = new PlaceInstances(directory, { place: 'm' })
  assert.deepEqual(instances.list(), [
    { roomId: 'party:a', port: 3000, worldName: 'm', players: 0 },
    { roomId: 'solo:b', port: 3000, worldName: 'm', players: 3 },
  ])
  assert.deepEqual(instances.list('solo').map(room => room.roomId), ['solo:b'])
  refusedWith(() => instances.list('arena'), 'instance-scope')
})

gate('PlaceInstances get reads the room for a scope and group', () => {
  const directory = fakeDirectory({ rooms: [roomHandle('party:a', 'm', 0)] })
  const instances = new PlaceInstances(directory, { place: 'm' })
  assert.equal(instances.get('party', 'a').roomId, 'party:a')
  assert.equal(instances.get('party', 'missing'), null)
})

gate('AppManifest accepts a complete manifest and a prerelease semver', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'My App', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.deepEqual(validateManifest(base), { valid: true })
  assert.deepEqual(validateManifest({ ...base, version: '1.2.3-beta.1+build.5' }), { valid: true })
})

gate('AppManifest reports every missing required string', () => {
  const result = validateManifest({})
  assert.deepEqual(result.errors, [
    'missing or empty required field: name',
    'missing or empty required field: version',
    'missing or empty required field: title',
    'missing or empty required field: description',
    'missing or empty required field: license',
    'missing or empty required field: entry',
  ])
})

gate('AppManifest refuses a non-object manifest', () => {
  assert.deepEqual(validateManifest(null), { valid: false, errors: ['manifest must be an object'] })
  assert.deepEqual(validateManifest('x'), { valid: false, errors: ['manifest must be an object'] })
})

gate('AppManifest checks the name pattern, the semver and the SPDX list', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'T', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.deepEqual(validateManifest({ ...base, name: 'My App' }).errors, ['name must be lowercase alphanumeric + hyphens: "My App"'])
  assert.deepEqual(validateManifest({ ...base, version: '1.2' }).errors, ['version must be semver: "1.2"'])
  assert.deepEqual(validateManifest({ ...base, license: 'WTFPL' }).errors, [
    'license must be a known SPDX id: "WTFPL" (known: MIT, CC0-1.0, Apache-2.0, GPL-3.0, LGPL-3.0, MPL-2.0, BSD-2-Clause, BSD-3-Clause, Unlicense, ISC)',
  ])
  assert.equal(VALID_SPDX.length, 10)
})

gate('AppManifest checks author shape, nostr and a required author name', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'T', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.deepEqual(validateManifest({ ...base, author: {} }).errors, ['author.name is required when author is present'])
  assert.deepEqual(validateManifest({ ...base, author: 'bob' }).errors, ['author must be an object { name } or omitted'])
  assert.deepEqual(validateManifest({ ...base, author: { name: 'b', nostr: 5 } }).errors, ['author.nostr must be a hex pubkey string if present'])
  assert.deepEqual(validateManifest({ ...base, author: { name: 'b', nostr: 'ab12' } }), { valid: true })
})

gate('AppManifest checks editor props by type, label, options and range bounds', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'T', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.equal(KNOWN_EDITOR_PROP_TYPES.length, 10)
  assert.deepEqual(validateManifest({ ...base, editorProps: { size: { type: 'select', label: 'Size' } } }).errors, [
    'editorProps.size (select) requires a non-empty options array',
  ])
  assert.deepEqual(validateManifest({ ...base, editorProps: { r: { type: 'range', label: 'R', min: 0 } } }).errors, [
    'editorProps.r (range) requires min and max numbers',
  ])
  assert.deepEqual(validateManifest({ ...base, editorProps: { x: { type: 'vec2', label: 'X' } } }).errors, [
    `editorProps.x.type must be one of: ${KNOWN_EDITOR_PROP_TYPES.join(', ')}`,
  ])
  assert.deepEqual(validateManifest({ ...base, editorProps: { y: { type: 'number' } } }).errors, ['editorProps.y.label is required'])
  assert.deepEqual(validateManifest({ ...base, editorProps: [] }).errors, ['editorProps must be an object'])
  assert.deepEqual(validateManifest({ ...base, editorProps: { z: { type: 'number', label: 'Z' } } }), { valid: true })
})

gate('AppManifest refuses null requires and dependencies, which spoint accepted', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'T', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.deepEqual(validateManifest({ ...base, requires: null }).errors, ['requires must be an object'])
  assert.deepEqual(validateManifest({ ...base, dependencies: [] }).errors, ['dependencies must be an object'])
  assert.deepEqual(validateManifest({ ...base, requires: {}, dependencies: {} }), { valid: true })
})

gate('AppManifest checks tags are non-empty strings and compatibility names a range', () => {
  const base = { name: 'my-app', version: '1.2.3', title: 'T', description: 'd', license: 'MIT', entry: 'main.js' }
  assert.deepEqual(validateManifest({ ...base, tags: 'physics' }).errors, ['tags must be an array of strings'])
  assert.deepEqual(validateManifest({ ...base, tags: ['ok', ''] }).errors, ['tags must be an array of strings'])
  assert.deepEqual(validateManifest({ ...base, tags: ['physics'] }), { valid: true })
  assert.deepEqual(validateManifest({ ...base, compatibility: {} }).errors, ['compatibility.spoint semver range is required'])
  assert.deepEqual(validateManifest({ ...base, compatibility: { spoint: '>=1.0.0' } }), { valid: true })
})

gate('FreddieBridge kinds, primitives and layouts match the spoint lists', () => {
  assert.deepEqual([...ALL_KINDS], ['viz.place', 'viz.update', 'viz.remove', 'viz.clear', 'viz.dataset', 'viz.camera'])
  assert.deepEqual([...PRIMITIVES], ['box', 'sphere', 'capsule', 'cylinder', 'plane', 'model'])
  assert.deepEqual([...LAYOUTS], ['grid', 'scatter', 'tree', 'graph', 'spiral'])
  assert.equal(KIND_PLACE, 'viz.place')
  assert.equal(KIND_UPDATE, 'viz.update')
})

gate('FreddieBridge validates a place message and refuses bad primitives and positions', () => {
  const place = (payload) => ({ id: 'm1', ts: 1, source: 'freddie', kind: 'viz.place', payload })
  assert.deepEqual(validateMessage(place({ entityId: 'e1', primitive: 'box' })), { valid: true })
  assert.deepEqual(validateMessage(place({ entityId: 'e1', primitive: 'cone' })).errors, [`payload.primitive must be one of: ${PRIMITIVES.join(', ')}`])
  assert.deepEqual(validateMessage(place({ entityId: 'e1', primitive: 'box', position: [1, 2] })).errors, ['payload.position must be [x,y,z]'])
  assert.deepEqual(validateMessage(place({ entityId: 'e1', primitive: 'box', scale: [1] })).errors, ['payload.scale must be [sx,sy,sz]'])
})

gate('FreddieBridge accepts a relative model path and refuses escaping or absolute ones', () => {
  const model = (path) => validateMessage({ id: 'm', ts: 1, source: 's', kind: 'viz.place', payload: { entityId: 'e', primitive: 'model', model: path } })
  assert.deepEqual(model('models/a.glb'), { valid: true })
  for (const bad of ['', '../x.glb', 'a/../../b.glb', '/abs.glb', '\\abs.glb', 'C:/x.glb', 'C:\\x.glb']) {
    assert.equal(model(bad).valid, false, `expected ${JSON.stringify(bad)} to be refused`)
  }
  assert.deepEqual(model(undefined).errors, ['payload.model is required when primitive is "model"'])
})

gate('FreddieBridge refuses a message with no payload without throwing', () => {
  const result = validateMessage({ id: 'm', ts: 1, source: 's', kind: 'viz.place' })
  assert.deepEqual(result, { valid: false, errors: ['payload is required (object)'] })
  assert.deepEqual(validateMessage(null), { valid: false, errors: ['message must be an object'] })
})

gate('FreddieBridge refuses a non-finite ts, which spoint accepted as a number', () => {
  const base = { id: 'm', source: 's', kind: 'viz.clear', payload: {} }
  assert.deepEqual(validateMessage({ ...base, ts: Number.NaN }).errors, ['ts is required (number, unix ms)'])
  assert.deepEqual(validateMessage({ ...base, ts: Number.POSITIVE_INFINITY }).errors, ['ts is required (number, unix ms)'])
  assert.deepEqual(validateMessage({ ...base, ts: '5' }).errors, ['ts is required (number, unix ms)'])
  assert.deepEqual(validateMessage({ ...base, ts: 5 }), { valid: true })
})

gate('FreddieBridge validates update, dataset and camera payloads', () => {
  const env = (kind, payload) => validateMessage({ id: 'm', ts: 1, source: 's', kind, payload })
  assert.deepEqual(env(KIND_UPDATE, {}).errors, ['payload.entityId is required'])
  assert.deepEqual(env('viz.dataset', { entityId: 'd', layout: 'graph', items: [] }), { valid: true })
  assert.deepEqual(env('viz.dataset', { entityId: 'd', layout: 'ring', items: [] }).errors, [`payload.layout must be one of: ${LAYOUTS.join(', ')}`])
  assert.deepEqual(env('viz.dataset', { entityId: 'd', layout: 'grid', items: 'x' }).errors, ['payload.items must be an array'])
  assert.deepEqual(env('viz.camera', { position: [0, 0, 0] }).errors, ['payload.target must be [x,y,z]'])
  assert.deepEqual(env('viz.bogus', {}).errors, [`kind must be one of: ${ALL_KINDS.join(', ')}`])
})

gate('FreddieBridge grid layout centres a 5-item grid on the origin', () => {
  const items = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id }))
  const positions = computeLayout(items, 'grid', { spacing: 2 })
  const expected = { a: [-2, 0, -1], b: [0, 0, -1], c: [2, 0, -1], d: [-2, 0, 1], e: [0, 0, 1] }
  for (const [id, want] of Object.entries(expected)) {
    const got = positions.get(id)
    want.forEach((value, axis) => near(got[axis], value, `grid ${id} axis ${axis}`))
  }
  assert.deepEqual([...positions.keys()], ['a', 'b', 'c', 'd', 'e'])
})

gate('FreddieBridge defaults spacing to 1 for a single grid item', () => {
  const positions = computeLayout([{ id: 'solo' }], 'grid')
  assert.deepEqual(positions.get('solo'), [0, 0, 0])
})

gate('FreddieBridge tree places the first item as root and its children one depth down', () => {
  const tree = [{ id: 'root', children: [{ id: 'a' }, { id: 'b' }] }, { id: 'z' }]
  const positions = computeLayout(tree, 'tree', { spacing: 2 })
  const expected = { root: [0, 0, 0], a: [-1, -3, 0], b: [1, -3, 0] }
  for (const [id, want] of Object.entries(expected)) {
    want.forEach((value, axis) => near(positions.get(id)[axis], value, `tree ${id} axis ${axis}`))
  }
  assert.equal(positions.has('z'), false)
})

gate('FreddieBridge spiral layout follows angle i times 0.5 and radius spacing times 1 plus 0.3 i', () => {
  const positions = computeLayout([{ id: 'p0' }, { id: 'p1' }], 'spiral')
  const want = [Math.cos(0.5) * 1.3, 0, Math.sin(0.5) * 1.3]
  assert.deepEqual(positions.get('p0'), [1, 0, 0])
  want.forEach((value, axis) => near(positions.get('p1')[axis], value, `spiral axis ${axis}`))
})

gate('FreddieBridge scatter layout uses FNV-1a over id plus x and id plus z', () => {
  assert.equal(fnvRef(''), 0x811c9dc5)
  assert.equal(fnvRef('a'), 0xe40c292c)
  assert.equal(fnvRef('foobar'), 0xbf9cf968)
  const items = [{ id: 'a' }, { id: 'b' }]
  const positions = computeLayout(items, 'scatter', { spacing: 1 })
  for (const item of items) {
    const h = fnvRef(item.id + 'x') / 0xffffffff
    const h2 = fnvRef(item.id + 'z') / 0xffffffff
    const want = [(h - 0.5) * 1 * 2 * 0.5, (h2 - 0.5) * 1 * 2 * 0.5 * 0.3, (h2 - 0.5) * 1 * 2 * 0.5]
    want.forEach((value, axis) => near(positions.get(item.id)[axis], value, `scatter ${item.id} axis ${axis}`))
  }
})

gate('FreddieBridge refuses the graph layout and unknown layouts instead of returning an empty map', () => {
  refusedWith(() => computeLayout([{ id: 'a' }], 'graph'), 'layout-refused')
  refusedWith(() => computeLayout([{ id: 'a' }], 'ring'), 'layout-refused')
})

gate('FreddieBridge refuses a zero or negative spacing, which spoint replaced with 1 or kept', () => {
  refusedWith(() => computeLayout([{ id: 'a' }], 'grid', { spacing: 0 }), 'layout-refused')
  refusedWith(() => computeLayout([{ id: 'a' }], 'grid', { spacing: -1 }), 'layout-refused')
  refusedWith(() => computeLayout([{ id: 'a' }], 'grid', { spacing: Number.NaN }), 'layout-refused')
})

gate('FreddieBridge refuses items that are not an array or have no string id', () => {
  refusedWith(() => computeLayout('abc', 'grid'), 'layout-refused')
  refusedWith(() => computeLayout([{ name: 'no id' }], 'grid'), 'layout-refused')
  refusedWith(() => computeLayout([{ id: 4 }], 'spiral'), 'layout-refused')
})

for (const label of Object.keys(cases)) {
  gate(label, () => {
    if (cases[label]) throw cases[label]
  })
}

finish()
