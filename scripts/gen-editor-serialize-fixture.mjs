import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = process.argv[2] || '/workspace/spoint'
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const spoint = await import(pathToFileURL(join(spointRoot, 'src/sdk/EditorHandlersSerialize.js')).href)

const worldConfig = {
  port: 3000,
  tickRate: 20,
  gravity: [0, -9.8, 0],
  scene: { sky: 'day' },
  spawnPoints: [[1, 2, 3]],
  terrain: { seed: 7 },
  unknownKey: 'dropped',
}

const entities = [
  { id: 'a', model: 'crate', position: [1, 2, 3], rotation: [0, 0, 0, 1], scale: [1, 1, 1], _appName: 'crate', bodyType: 'dynamic', _config: { hp: 3 }, custom: { tag: 'x' } },
  { id: 'b', parent: 'a', model: 'bolt', position: [0, 1, 0], rotation: [0, 0.7071067811865476, 0, 0.7071067811865476], scale: [2, 2, 2] },
  { id: 'c', position: [5, 0, 5], rotation: [0, 0, 0, 1] },
  { id: 'd', position: [-4, 0.5, 2], rotation: [0, 0, 0, 1], scale: [1, 1, 1], bodyType: 'static', custom: {} },
  { id: 'e', model: 'ramp', position: [3, 0, -3], rotation: [0, 0.5, 0, 0.8660254037844386], scale: [1, 3, 1], bodyType: 'kinematic' },
]

const transfer = { offset: [-10, 1, 0], mul: [1, 1, 2], negateY: true }

const toBase = {
  point: (p) => [p[0] + transfer.offset[0], p[1] + transfer.offset[1], p[2] * transfer.mul[2]],
  quat: (q) => [q[0], transfer.negateY ? -q[1] : q[1], q[2], q[3]],
}

const appRuntime = { entities: new Map(entities.map((e) => [e.id, structuredClone(e)])) }
const plainDef = spoint.serializeWorld(appRuntime, worldConfig, null)
const rebasedDef = spoint.serializeWorld({ entities: new Map(entities.map((e) => [e.id, structuredClone(e)])) }, worldConfig, toBase)

const fixture = {
  source: 'spoint src/sdk/EditorHandlersSerialize.js (d5e3860 content)',
  worldConfig,
  entities,
  transfer,
  worldConfigKeys: [...spoint.WORLD_CONFIG_KEYS],
  entityPlain: entities.map((e) => spoint.serializeEntity(structuredClone(e), null)),
  entityRebased: entities.map((e) => spoint.serializeEntity(structuredClone(e), toBase)),
  worldPlain: plainDef,
  worldRebased: rebasedDef,
  worldSource: spoint.serializeWorldSource(plainDef),
  worldModule: 'export default ' + spoint.serializeWorldSource(plainDef) + '\n',
  textNames: ['a.js', 'b.JS', 'c.Yaml', 'readme', '.js', 'dir.v2/file', 'x.png', 'y.mjs', 'z.', 'deep/name.svg'],
  textFlags: ['a.js', 'b.JS', 'c.Yaml', 'readme', '.js', 'dir.v2/file', 'x.png', 'y.mjs', 'z.', 'deep/name.svg'].map((n) => spoint.isTextFile(n)),
  errors: [
    { e: { code: 'EACCES' }, path: 'app/a.js' },
    { e: { name: 'TypeError' }, path: 'x' },
    { e: {}, path: 'y' },
    { e: null, path: 'z' },
  ].map(({ e, path }) => ({ e, path, message: spoint.sanitizeFsError(e, path) })),
}

const out = join(root, 'scripts/fixtures/spoint/editor-serialize.json')
writeFileSync(out, JSON.stringify(fixture, null, 2) + '\n', 'utf8')
console.log('wrote ' + out + ' entities=' + plainDef.entities.length + ' rebasedEntities=' + rebasedDef.entities.length)
