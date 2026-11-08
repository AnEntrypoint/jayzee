import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import {
  EditorSerializeError,
  TEXT_EXTS,
  WORLD_CONFIG_KEYS,
  isTextFile,
  parseWorldModule,
  sanitizeFsError,
  serializeEntity,
  serializeWorld,
  serializeWorldModule,
  serializeWorldSource,
} from '../src/sdk/editorHandlersSerialize.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const fixture = JSON.parse(readFileSync(join(root, 'scripts/fixtures/spoint/editor-serialize.json'), 'utf8'))

const toBase = {
  point: (p) => [p[0] + fixture.transfer.offset[0], p[1] + fixture.transfer.offset[1], p[2] * fixture.transfer.mul[2]],
  quat: (q) => [q[0], fixture.transfer.negateY ? -q[1] : q[1], q[2], q[3]],
}

const cloneEntities = () => fixture.entities.map((e) => structuredClone(e))
const runtimeOf = (list) => ({ entities: new Map(list.map((e) => [e.id, e])) })

const refusedWith = (fn, reasonCode) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, `expected a refusal with ${reasonCode}`)
  assert.ok(thrown instanceof EditorSerializeError, `expected EditorSerializeError, got ${thrown && thrown.name}`)
  assert.equal(thrown.reasonCode, reasonCode)
}

const moduleSource = readFileSync(join(root, 'src/sdk/editorHandlersSerialize.js'), 'utf8')

gate('WORLD_CONFIG_KEYS and TEXT_EXTS match spoint at d5e3860 in order and content', () => {
  assert.deepEqual([...WORLD_CONFIG_KEYS], fixture.worldConfigKeys)
  assert.deepEqual([...TEXT_EXTS], ['.js', '.mjs', '.json', '.md', '.txt', '.css', '.html', '.yml', '.yaml', '.svg'])
})

gate('isTextFile matches spoint for every fixture name, including case, dotfiles and trailing dots', () => {
  fixture.textNames.forEach((name, index) => {
    assert.equal(isTextFile(name), fixture.textFlags[index], `isTextFile(${JSON.stringify(name)})`)
  })
})

gate('isTextFile refuses a non-string name instead of throwing a TypeError', () => {
  refusedWith(() => isTextFile(undefined), 'bad-name')
  refusedWith(() => isTextFile(42), 'bad-name')
})

gate('sanitizeFsError matches spoint for a code, a name only, an empty object and null', () => {
  for (const { e, path, message } of fixture.errors) {
    assert.equal(sanitizeFsError(e, path), message)
  }
})

gate('serializeEntity without a transfer matches spoint for every fixture entity', () => {
  fixture.entityPlain.forEach((expected, index) => {
    assert.deepEqual(serializeEntity(cloneEntities()[index], null), expected, `entity ${expected.id}`)
  })
})

gate('serializeEntity with a transfer rebases only entities without a parent, as spoint does', () => {
  fixture.entityRebased.forEach((expected, index) => {
    assert.deepEqual(serializeEntity(cloneEntities()[index], toBase), expected, `entity ${expected.id}`)
  })
  const childPlain = serializeEntity(cloneEntities()[1], null)
  const childRebased = serializeEntity(cloneEntities()[1], toBase)
  assert.deepEqual(childRebased.position, childPlain.position, 'child position is not rebased')
  assert.deepEqual(childRebased.rotation, childPlain.rotation, 'child rotation is not rebased')
})

gate('serializeWorld without a transfer matches the spoint world definition', () => {
  const def = serializeWorld(runtimeOf(cloneEntities()), fixture.worldConfig, null)
  assert.deepEqual(def, fixture.worldPlain)
  assert.deepEqual(Object.keys(def), [...fixture.worldConfigKeys.filter((k) => k in fixture.worldConfig), 'entities'])
  assert.ok(!('unknownKey' in def), 'an unknown world key must be dropped')
})

gate('serializeWorld with a transfer matches the spoint rebased world definition', () => {
  const def = serializeWorld(runtimeOf(cloneEntities()), fixture.worldConfig, toBase)
  assert.deepEqual(def, fixture.worldRebased)
})

gate('serializeWorld drops entities with no authored state, and keeps an empty custom object', () => {
  const def = serializeWorld(runtimeOf(cloneEntities()), null, null)
  const ids = def.entities.map((e) => e.id)
  assert.deepEqual(ids, ['a', 'b', 'd', 'e'])
})

gate('serializeWorldSource is the spoint two-space JSON, byte for byte', () => {
  assert.equal(serializeWorldSource(fixture.worldPlain), fixture.worldSource)
})

gate('serializeWorldModule wraps the source as the spoint world module, byte for byte', () => {
  assert.equal(serializeWorldModule(fixture.worldPlain), fixture.worldModule)
  assert.ok(serializeWorldModule(fixture.worldPlain).endsWith('\n'))
})

gate('parseWorldModule reads a spoint world module back to the same definition', () => {
  assert.deepEqual(parseWorldModule(fixture.worldModule), fixture.worldPlain)
  const again = parseWorldModule(serializeWorldModule(fixture.worldRebased))
  assert.deepEqual(again, fixture.worldRebased)
})

gate('parseWorldModule refuses a missing prefix, a missing trailing newline and a non-string source', () => {
  refusedWith(() => parseWorldModule(fixture.worldModule.slice('export default '.length)), 'bad-wrapper')
  refusedWith(() => parseWorldModule(fixture.worldModule.slice(0, -1)), 'bad-wrapper')
  refusedWith(() => parseWorldModule(42), 'not-string')
  refusedWith(() => parseWorldModule(Buffer.from(fixture.worldModule)), 'not-string')
})

gate('parseWorldModule refuses bad JSON, a non-object body, a missing entities array and a non-object entity', () => {
  refusedWith(() => parseWorldModule('export default \n'), 'bad-json')
  refusedWith(() => parseWorldModule('export default {"entities":[\n'), 'bad-json')
  refusedWith(() => parseWorldModule('export default [1,2]\n'), 'not-object')
  refusedWith(() => parseWorldModule('export default null\n'), 'not-object')
  refusedWith(() => parseWorldModule('export default {"port":3000}\n'), 'bad-entities')
  refusedWith(() => parseWorldModule('export default {"entities":[3]}\n'), 'bad-entity')
})

gate('parseWorldModule refuses an entity with no id and two entities with one id', () => {
  refusedWith(() => parseWorldModule('export default {"entities":[{"position":[0,0,0]}]}\n'), 'bad-id')
  refusedWith(() => parseWorldModule('export default {"entities":[{"id":""}]}\n'), 'bad-id')
  refusedWith(() => parseWorldModule('export default {"entities":[{"id":"a"},{"id":"a"}]}\n'), 'duplicate-id')
})

gate('parseWorldModule refuses a stored position that is not three finite numbers', () => {
  refusedWith(() => parseWorldModule('export default {"entities":[{"id":"a","position":[0,0]}]}\n'), 'bad-vector')
  refusedWith(() => parseWorldModule('export default {"entities":[{"id":"a","position":[0,null,0]}]}\n'), 'bad-vector')
})

gate('serializeEntity refuses an entity with no id, a non-finite position and a malformed rotation or scale', () => {
  refusedWith(() => serializeEntity({ position: [0, 0, 0] }, null), 'bad-id')
  refusedWith(() => serializeEntity({ id: 'x', position: [0, NaN, 0] }, null), 'bad-vector')
  refusedWith(() => serializeEntity({ id: 'x', position: [0, 0, 0], rotation: [0, 0, 1] }, null), 'bad-quat')
  refusedWith(() => serializeEntity({ id: 'x', position: [0, 0, 0], rotation: 'up' }, null), 'bad-quat')
  refusedWith(() => serializeEntity({ id: 'x', position: [0, 0, 0], scale: [1, 1] }, null), 'bad-vector')
})

gate('serializeEntity refuses a transfer that returns a non-finite point or quaternion', () => {
  const broken = { point: () => [0, NaN, 0], quat: (q) => q }
  refusedWith(() => serializeEntity({ id: 'x', position: [0, 0, 0] }, broken), 'bad-vector')
  const brokenQuat = { point: (p) => p, quat: () => [0, 0, 0] }
  refusedWith(() => serializeEntity({ id: 'x', position: [0, 0, 0], rotation: [0, 0, 0, 1] }, brokenQuat), 'bad-quat')
})

gate('an object rotation {x, y, z, w} is written as the quaternion array, with w defaulting to 1', () => {
  const out = serializeEntity({ id: 'x', position: [0, 0, 0], rotation: { x: 0, y: 0.5, z: 0 } }, null)
  assert.deepEqual(out.rotation, [0, 0.5, 0, 1])
  const identity = serializeEntity({ id: 'y', position: [0, 0, 0], rotation: { x: 0, y: 0, z: 0, w: 1 } }, null)
  assert.ok(!('rotation' in identity), 'an identity object rotation is omitted')
})

gate('serializeWorld refuses a missing runtime or a non-object source definition', () => {
  refusedWith(() => serializeWorld(null, null, null), 'bad-runtime')
  refusedWith(() => serializeWorld({ entities: [] }, null, null), 'bad-runtime')
  refusedWith(() => serializeWorld(runtimeOf([]), 'port', null), 'bad-source-def')
})

gate('serializeWorldSource refuses a non-object definition', () => {
  refusedWith(() => serializeWorldSource(null), 'not-object')
  refusedWith(() => serializeWorldSource([]), 'not-object')
})

gate('control: a transfer changes the rebased output, so the rebase path is not a no-op', () => {
  const plain = serializeEntity(cloneEntities()[4], null)
  const rebased = serializeEntity(cloneEntities()[4], toBase)
  assert.notDeepEqual(rebased.position, plain.position)
  assert.notDeepEqual(rebased.rotation, plain.rotation)
})

gate('control: the comparer detects a single changed value in a spoint expectation', () => {
  const tampered = structuredClone(fixture.worldPlain)
  tampered.entities[0].position[0] += 1
  assert.throws(() => assert.deepEqual(serializeWorld(runtimeOf(cloneEntities()), fixture.worldConfig, null), tampered))
  const tamperedSource = fixture.worldModule.replace('"crate"', '"crates"')
  assert.notEqual(serializeWorldModule(fixture.worldPlain), tamperedSource)
})

gate('control: a fixture world module with its prefix removed is refused, not read as JSON', () => {
  refusedWith(() => parseWorldModule(fixture.worldSource + '\n'), 'bad-wrapper')
})

gate('the module source carries no comment markers and reads no host global', () => {
  assert.ok(!moduleSource.includes('//'), 'comment marker "//" found')
  assert.ok(!moduleSource.includes('/*'), 'comment marker "/*" found')
  for (const host of ['Date.now', 'performance', 'console', 'process', 'setTimeout', 'globalThis', 'Math.random', 'fetch', 'window', 'structuredClone']) {
    assert.ok(!new RegExp('\\b' + host.replace('.', '\\.') + '\\b').test(moduleSource), `host global ${host} found`)
  }
})

finish()
