import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { createAppLoader } from '../src/apps/appLoader.js'
import { APPS_MANIFEST_VERSION, buildAppsManifest, entrySource, listAppNames, manifestDigest, normalizePath, parseAppsManifest, resolveAppEntry } from '../src/apps/appsManifest.js'
import { createNodeAppHost } from '../src/apps/nodeAppHost.js'

const TREE = {
  'apps/door.js': "export default { name: 'door' }\n",
  'apps/lift/index.js': "import { speed } from './lib/speed.js'\nimport data from './data'\nimport { World } from '@spoint/ecs'\nexport default { speed, data, World }\n",
  'apps/lift/lib/speed.js': "import { unit } from '../unit.js'\nexport const speed = 2 * unit\n",
  'apps/lift/unit.js': 'export const unit = 1\n',
  'apps/lift/data.js': "import '/shared/boot.js'\nexport default 7\n",
  'apps/notes.txt': 'not an app\n',
  'apps/empty/readme.md': 'no index\n',
  'apps/evil.js': "export default { run() { process.exit(1) } }\n",
  'apps/escape/index.js': "import '../door.js'\nexport default {}\n",
  'apps/broken/index.js': "import './gone.js'\nexport default {}\n",
  'more/door.js': "export default { name: 'shadowed door' }\n",
  'more/extra.js': "export default { name: 'extra' }\n",
}

const memoryHost = (tree) => {
  const files = new Map(Object.entries(tree))
  const reads = []
  return {
    reads,
    join: (...parts) => parts.join('/'),
    exists: async (path) => files.has(path),
    readFile: async (path) => {
      reads.push(path)
      if (!files.has(path)) throw new Error('no file ' + path)
      return files.get(path)
    },
    listDir: async (dir) => {
      const names = new Map()
      for (const path of files.keys()) {
        if (!path.startsWith(dir + '/')) continue
        const rest = path.slice(dir.length + 1)
        const head = rest.split('/')[0]
        names.set(head, rest.includes('/') ? 'dir' : 'file')
      }
      return [...names].map(([name, kind]) => ({ name, isFile: kind === 'file', isDirectory: kind === 'dir' }))
    },
  }
}

const DIRS = ['apps', 'more']
const GOOD = ['door', 'extra', 'lift']

gate('an entry resolves to the flat file first, then the folder index, in directory order', async () => {
  const host = memoryHost(TREE)
  assert.deepEqual(await resolveAppEntry('door', DIRS, host), { dir: 'apps', path: 'apps/door.js', layout: 'flat' })
  assert.deepEqual(await resolveAppEntry('lift', DIRS, host), { dir: 'apps', path: 'apps/lift/index.js', layout: 'folder' })
  assert.deepEqual(await resolveAppEntry('extra', DIRS, host), { dir: 'more', path: 'more/extra.js', layout: 'flat' })
  assert.equal(await resolveAppEntry('absent', DIRS, host), null)
  assert.deepEqual(await resolveAppEntry('door', ['more', 'apps'], host), { dir: 'more', path: 'more/door.js', layout: 'flat' })
})

gate('an entry name with a path separator or a dot segment is refused', async () => {
  const host = memoryHost(TREE)
  for (const name of ['../door', 'lift/index', '..', '.', '', 'a\\b', 5]) {
    await assert.rejects(resolveAppEntry(name, DIRS, host), RangeError)
  }
})

gate('the name list holds each app once, first directory wins, and skips files that are not apps', async () => {
  const names = await listAppNames(DIRS, memoryHost(TREE))
  assert.deepEqual(names, ['broken', 'door', 'escape', 'evil', 'lift', 'extra'])
})

gate('the name list agrees with the app loader on the same tree', async () => {
  const host = memoryHost(TREE)
  const registered = []
  const loader = createAppLoader({ runtime: { registerApp: (name) => registered.push(name) }, host: { ...host, importModule: async () => ({ default: {} }) }, dirs: DIRS, log: { error() {}, log() {}, debug() {} } })
  const result = await loader.loadAll()
  assert.deepEqual([...result.loaded, ...result.failed].sort(), (await listAppNames(DIRS, host)).sort())
})

gate('the manifest holds each app with its entry and every module its local imports reach', async () => {
  const manifest = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  assert.equal(manifest.version, APPS_MANIFEST_VERSION)
  assert.deepEqual(Object.keys(manifest.apps), GOOD)
  assert.deepEqual(manifest.apps.door, { entry: 'door.js', layout: 'flat', modules: { 'door.js': TREE['apps/door.js'] }, imports: {}, engine: [], absolute: [] })
  const lift = manifest.apps.lift
  assert.equal(lift.entry, 'lift/index.js')
  assert.deepEqual(Object.keys(lift.modules).sort(), ['lift/data.js', 'lift/index.js', 'lift/lib/speed.js', 'lift/unit.js'])
  assert.deepEqual(lift.imports, {
    'lift/index.js': { './data': 'lift/data.js', './lib/speed.js': 'lift/lib/speed.js' },
    'lift/lib/speed.js': { '../unit.js': 'lift/unit.js' },
  })
  assert.deepEqual(lift.engine, ['@spoint/ecs'])
  assert.deepEqual(lift.absolute, ['/shared/boot.js'])
  assert.equal(entrySource(manifest, 'lift'), TREE['apps/lift/index.js'])
  assert.equal(entrySource(manifest, 'absent'), null)
})

gate('an app with a blocked pattern, an import that leaves its folder or a missing import is refused with a reason and left out', async () => {
  const manifest = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  assert.deepEqual(manifest.refusals, [
    { reasonCode: 'app-import-missing', app: 'broken', module: 'broken/index.js', specifier: './gone.js' },
    { reasonCode: 'app-import-escapes-apps-dir', app: 'escape', module: 'escape/index.js', specifier: '../door.js' },
    { reasonCode: 'app-source-blocked-pattern', app: 'evil', module: 'evil.js', pattern: 'process.exit' },
  ])
  for (const name of ['broken', 'escape', 'evil']) assert.equal(Object.hasOwn(manifest.apps, name), false)
})

gate('a blocked pattern inside an imported module refuses the whole app', async () => {
  const tree = { 'apps/a/index.js': "import './b.js'\nexport default {}\n", 'apps/a/b.js': 'export const x = eval("1")\n' }
  const manifest = await buildAppsManifest({ dirs: ['apps'], host: memoryHost(tree) })
  assert.deepEqual(manifest.apps, {})
  assert.deepEqual(manifest.refusals, [{ reasonCode: 'app-source-blocked-pattern', app: 'a', module: 'a/b.js', pattern: 'eval(' }])
})

gate('a named app that has no entry is reported, and a name list limits the manifest', async () => {
  const manifest = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE), names: ['lift', 'ghost', 'lift'] })
  assert.deepEqual(Object.keys(manifest.apps), ['lift'])
  assert.deepEqual(manifest.refusals, [{ reasonCode: 'app-entry-missing', app: 'ghost' }])
})

gate('two modules that import each other are each read once', async () => {
  const tree = { 'apps/ring/index.js': "import './b.js'\nexport default {}\n", 'apps/ring/b.js': "import './index.js'\nexport const b = 1\n" }
  const host = memoryHost(tree)
  const manifest = await buildAppsManifest({ dirs: ['apps'], host })
  assert.deepEqual(Object.keys(manifest.apps.ring.modules).sort(), ['ring/b.js', 'ring/index.js'])
  assert.deepEqual(host.reads.sort(), ['apps/ring/b.js', 'apps/ring/index.js'])
})

gate('the digest is the same for the same tree and changes when one module byte changes', async () => {
  const first = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  const second = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  assert.equal(first.digest, second.digest)
  assert.match(first.digest, /^[0-9a-f]{8}$/)
  const changed = await buildAppsManifest({ dirs: DIRS, host: memoryHost({ ...TREE, 'apps/lift/unit.js': 'export const unit = 2\n' }) })
  assert.notEqual(changed.digest, first.digest)
  assert.equal(manifestDigest(first.apps), first.digest)
})

gate('a manifest written as JSON parses back to the same content', async () => {
  const manifest = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  const parsed = parseAppsManifest(JSON.stringify(manifest))
  assert.deepEqual(parsed, JSON.parse(JSON.stringify(manifest)))
})

gate('a parsed manifest with a changed module, a wrong version, a missing entry module or a dangling import is refused', async () => {
  const manifest = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
  const copy = () => JSON.parse(JSON.stringify(manifest))
  const tampered = copy()
  tampered.apps.door.modules['door.js'] += ' '
  assert.throws(() => parseAppsManifest(tampered), /digest/)
  const versioned = copy()
  versioned.version = 2
  assert.throws(() => parseAppsManifest(versioned), /version/)
  const headless = copy()
  delete headless.apps.lift.modules['lift/index.js']
  assert.throws(() => parseAppsManifest(headless), /entry/)
  const dangling = copy()
  delete dangling.apps.lift.modules['lift/unit.js']
  assert.throws(() => parseAppsManifest(dangling), /not in the manifest/)
  assert.throws(() => parseAppsManifest('[]'), TypeError)
})

gate('path normalising folds dot segments and keeps a leading parent step on a relative path', () => {
  assert.equal(normalizePath('apps/lift/lib/../unit.js'), 'apps/lift/unit.js')
  assert.equal(normalizePath('apps/./lift//index.js'), 'apps/lift/index.js')
  assert.equal(normalizePath('apps\\lift\\index.js'), 'apps/lift/index.js')
  assert.equal(normalizePath('../x.js'), '../x.js')
  assert.equal(normalizePath('/a/../../b'), '/b')
})

gate('the manifest refuses a host without readFile and an empty directory list', async () => {
  const host = memoryHost(TREE)
  const partial = { ...host }
  delete partial.readFile
  await assert.rejects(buildAppsManifest({ dirs: DIRS, host: partial }), TypeError)
  await assert.rejects(buildAppsManifest({ dirs: [], host }), TypeError)
})

gate('the Node filesystem host builds the same manifest from the same tree on disk', async () => {
  const root = mkdtempSync(join(tmpdir(), 'jz-apps-manifest-gate-'))
  try {
    for (const [rel, content] of Object.entries(TREE)) {
      mkdirSync(dirname(join(root, rel)), { recursive: true })
      writeFileSync(join(root, rel), content)
    }
    const onDisk = await buildAppsManifest({ dirs: DIRS.map((dir) => join(root, dir)), host: createNodeAppHost() })
    const inMemory = await buildAppsManifest({ dirs: DIRS, host: memoryHost(TREE) })
    assert.deepEqual(onDisk.apps, inMemory.apps)
    assert.equal(onDisk.digest, inMemory.digest)
    assert.deepEqual(onDisk.refusals, inMemory.refusals)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

finish()
