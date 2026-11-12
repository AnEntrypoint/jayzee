import assert from 'node:assert/strict'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker } from 'node:worker_threads'
import { gate, finish } from './lib/gate.mjs'
import { buildBoxGlb } from './lib/glbFixture.mjs'
import { ITCH_MAX_FILES, buildExport, planExport, readZipStore, zipStore } from './lib/staticExport.mjs'
import { writeExport } from './static-export.mjs'
import { createBrowserServerClient } from '../src/transport/browserServer.js'
import { MSG } from '../src/protocol/messages.js'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { SnapshotEncoder } from '../src/snapshot-lod-pure/snapshotEncoder.js'

const work = mkdtempSync(join(tmpdir(), 'jayzee-export-'))
const appsDir = join(work, 'apps')
const put = (rel, content) => {
  const path = join(appsDir, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}
put('world/index.js', "export default {\n  tickRate: 64,\n  gravity: [0, -18, 0],\n  spawnPoint: [0, 4, 0],\n  entities: [\n    { id: 'environment', model: 'apps/arena/map.glb', position: [0, 0, 0] },\n    { id: 'game', app: 'arena', config: { rounds: 2 } },\n    { id: 'crate', bodyType: 'dynamic', position: [3, 6, 0] },\n  ],\n}\n")
put('arena/index.js', "import { bump } from './rules.js'\n\nexport default {\n  server: {\n    update: (ctx) => {\n      ctx.state.ticks = bump(ctx.state.ticks)\n      ctx.entity.custom = { ticks: ctx.state.ticks, rounds: ctx.config.rounds }\n    },\n  },\n}\n")
put('arena/rules.js', 'export const bump = (n) => (n ?? 0) + 1\n')
put('arena/map.glb', buildBoxGlb([{ translation: [0, 1, 0], scale: [20, 1, 20] }]))
put('arena/readme.txt', 'an asset that is not a module\n')

const listAll = (dir, prefix = '') => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory() ? listAll(join(dir, entry.name), prefix + entry.name + '/') : [prefix + entry.name]))

gate('the export plan holds the page, the server worker, the kernel, the service worker, the apps and a manifest, under relative names only', async () => {
  const built = await buildExport({ appsDir })
  const names = built.files.map((file) => file.to)
  for (const name of ['index.html', 'boot.js', 'server-worker.js', 'coi-sw.js', 'kernel.wasm', 'manifest.json', 'apps/world/index.js', 'apps/arena/index.js', 'apps/arena/rules.js', 'apps/arena/map.glb', 'apps/arena/readme.txt', 'src/transport/browserServer.js', 'src/sdk/server.js', 'src/world/World.js']) {
    assert.ok(names.includes(name), name + ' is not in the export')
  }
  assert.ok(names.every((name) => !name.startsWith('/') && !name.includes('..') && !name.includes('node_modules')), 'a file name leaves the export root')
  assert.deepEqual(built.manifest.apps, { arena: './apps/arena/index.js' })
  assert.deepEqual(built.manifest.config.entities.map((entity) => entity.id), ['environment', 'game', 'crate'])
  assert.deepEqual(built.manifest.files, [...names].sort())
})

gate('every import in every exported module is relative and lands on a file of the export, so no package and no absolute path is needed at run time', async () => {
  const built = await buildExport({ appsDir })
  const names = new Set(built.files.map((file) => file.to))
  let checked = 0
  for (const { to, bytes } of built.files) {
    if (!/\.m?js$/.test(to) || to === 'coi-sw.js') continue
    for (const [, , , specifier] of bytes.toString('utf8').matchAll(/(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g)) {
      assert.ok(specifier.startsWith('./') || specifier.startsWith('../'), to + ' imports ' + specifier)
      const target = join('/', dirname(to), specifier).slice(1)
      assert.ok(names.has(target), to + ' imports ' + specifier + ', which is not in the export')
      checked += 1
    }
  }
  assert.ok(checked > 60, 'only ' + checked + ' imports were checked')
  assert.deepEqual(built.vendored, ['msgpackr'])
  assert.ok(names.has('vendor/msgpackr/index.js'))
  assert.ok(built.files.find((file) => file.to === 'src/protocol/msgpack.js').bytes.toString('utf8').includes('../../vendor/msgpackr/index.js'))
})

gate('the page and its html reach nothing by an absolute url: every src, href and fetch in them is relative', async () => {
  const built = await buildExport({ appsDir })
  const text = (name) => built.files.find((file) => file.to === name).bytes.toString('utf8')
  for (const [, url] of text('index.html').matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(url.startsWith('./'), 'index.html reaches ' + url)
  for (const name of ['boot.js', 'server-worker.js']) {
    for (const [, url] of text(name).matchAll(/(?:fetch|new URL)\(\s*'([^']+)'/g)) assert.ok(url.startsWith('./'), name + ' reaches ' + url)
  }
  assert.ok(text('index.html').includes("register('./coi-sw.js')"))
})

gate('the pages target adds .nojekyll and a 404 page that carries the base path, and the itch target adds neither', async () => {
  const pages = await buildExport({ appsDir, target: 'pages', base: '/my-game/' })
  const names = pages.files.map((file) => file.to)
  assert.ok(names.includes('.nojekyll') && names.includes('404.html'))
  assert.ok(pages.files.find((file) => file.to === '404.html').bytes.toString('utf8').includes('<base href="/my-game/">'))
  assert.ok(!pages.files.find((file) => file.to === 'index.html').bytes.toString('utf8').includes('<base'))
  const itch = await buildExport({ appsDir })
  assert.ok(!itch.files.some((file) => file.to === '.nojekyll' || file.to === '404.html'))
  assert.ok(itch.files.length <= ITCH_MAX_FILES)
})

gate('the export is refused by name for an unknown target, a bad base, a missing world, an app that is not there, a missing model and a Node import in an app', async () => {
  await assert.rejects(buildExport({ appsDir, target: 'steam' }), { code: 'export-target-unknown' })
  await assert.rejects(buildExport({ appsDir, target: 'pages', base: 'my-game' }), { code: 'export-base-invalid' })
  await assert.rejects(buildExport({ appsDir: join(work, 'nowhere') }), { code: 'export-apps-missing' })
  const variant = (name, change) => {
    const dir = join(work, name)
    cpSync(appsDir, dir, { recursive: true })
    change(dir)
    return dir
  }
  await assert.rejects(buildExport({ appsDir: variant('no-world', (dir) => rmSync(join(dir, 'world'), { recursive: true })) }), { code: 'export-world-missing' })
  await assert.rejects(buildExport({ appsDir: variant('no-app', (dir) => rmSync(join(dir, 'arena', 'index.js'))) }), { code: 'export-app-missing' })
  await assert.rejects(buildExport({ appsDir: variant('no-model', (dir) => rmSync(join(dir, 'arena', 'map.glb'))) }), { code: 'export-model-missing' })
  await assert.rejects(buildExport({ appsDir: variant('node-import', (dir) => writeFileSync(join(dir, 'arena', 'rules.js'), "import { readFileSync } from 'node:fs'\nexport const bump = (n) => readFileSync.length + n\n")) }), { code: 'export-node-import' })
  await assert.rejects(buildExport({ appsDir: variant('escape', (dir) => writeFileSync(join(dir, 'arena', 'rules.js'), "export { bump } from '../../outside.js'\n")) }), { code: 'export-outside-closure' })
})

gate('writeExport writes exactly the planned files and a store-only zip whose entries read back byte for byte with good checksums', async () => {
  const outDir = join(work, 'out-itch')
  const result = await writeExport({ appsDir, outDir, target: 'itch' })
  assert.deepEqual(listAll(outDir).sort(), result.files.map((file) => file.to).sort())
  for (const { to, bytes } of result.files) assert.ok(readFileSync(join(outDir, to)).equals(bytes), to + ' differs on disk')
  const entries = readZipStore(readFileSync(result.zipPath))
  assert.deepEqual(entries.map((entry) => entry.to), result.files.map((file) => file.to))
  assert.ok(entries.every((entry, index) => entry.bytes.equals(result.files[index].bytes)))
  const broken = Buffer.from(zipStore([{ to: 'a.txt', bytes: Buffer.from('hello') }]))
  broken[35] ^= 1
  assert.throws(() => readZipStore(broken), { code: 'zip-crc-mismatch' })
})

gate('the written export runs with nothing but its own files: its server worker boots in a Worker thread from the output directory, loads the kernel and the map model by fetch, and serves live snapshots', async () => {
  const outDir = join(work, 'out-run')
  const result = await writeExport({ appsDir, outDir, target: 'pages', base: '/game/', zip: false })
  assert.ok(!existsSync(join(outDir, 'node_modules')))
  const bootstrap = join(work, 'worker-bootstrap.mjs')
  writeFileSync(bootstrap, [
    "import { parentPort, workerData } from 'node:worker_threads'",
    "import { readFile } from 'node:fs/promises'",
    "import { fileURLToPath } from 'node:url'",
    'globalThis.self = { postMessage: (message, transfer) => parentPort.postMessage(message, transfer), set onmessage(handler) { parentPort.on(\'message\', (data) => handler({ data })) } }',
    'globalThis.fetch = async (url) => { try { const bytes = await readFile(fileURLToPath(url)); return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) } } catch (error) { return { ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) } } }',
    'await import(workerData.entry)',
    '',
  ].join('\n'))
  const thread = new Worker(bootstrap, { workerData: { entry: pathToFileURL(join(outDir, 'server-worker.js')).href } })
  const worker = { postMessage: (message, transfer) => thread.postMessage(message, transfer), set onmessage(handler) { thread.on('message', (data) => handler({ data })) } }
  try {
    const apps = {}
    for (const name of Object.keys(result.manifest.apps)) apps[name] = pathToFileURL(join(outDir, result.manifest.apps[name])).href
    const client = createBrowserServerClient({ worker, config: result.manifest.config, apps, setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: (handle) => clearTimeout(handle) })
    const inbox = []
    client.transport.onMessage = (bytes) => inbox.push(unpack(bytes))
    const info = await client.ready
    assert.deepEqual([info.tickRate, info.entities, info.apps], [64, 3, ['arena']])
    client.transport.send(pack({ type: MSG.HANDSHAKE, payload: { name: 'solo' } }))
    const snaps = () => inbox.filter((m) => m.type === MSG.SNAPSHOT).map((m) => SnapshotEncoder.decode(m.payload))
    for (let i = 0; i < 600 && snaps().length < 100; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    const last = snaps().at(-1)
    assert.ok(last, 'no snapshot arrived from the exported server')
    const byId = Object.fromEntries(last.entities.map((entity) => [entity.id, entity]))
    assert.equal(byId.game.custom.rounds, 2)
    assert.ok(byId.game.custom.ticks > 50, 'the exported app ticked ' + byId.game.custom.ticks + ' times')
    assert.ok(Math.abs(byId.crate.position[1] - 2.35) < 0.1, 'the crate rests at ' + byId.crate.position[1] + ', not on the exported map model')
    client.transport.close()
  } finally {
    await thread.terminate()
  }
})

gate('the command line writes the export and reports it, and refuses an unknown argument with a non-zero exit', async () => {
  const { spawnSync } = await import('node:child_process')
  const script = new URL('./static-export.mjs', import.meta.url).pathname
  const outDir = join(work, 'out-cli')
  const ok = spawnSync(process.execPath, [script, '--apps', appsDir, '--out', outDir, '--target', 'pages', '--base', '/repo/'], { encoding: 'utf8' })
  assert.equal(ok.status, 0, ok.stderr)
  assert.ok(ok.stdout.includes('target pages'), ok.stdout)
  assert.ok(existsSync(join(outDir, '.nojekyll')) && existsSync(join(outDir, 'manifest.json')))
  const bad = spawnSync(process.execPath, [script, '--frobnicate'], { encoding: 'utf8' })
  assert.equal(bad.status, 1)
  assert.ok(bad.stderr.includes('static export refused'))
})

process.on('exit', () => rmSync(work, { recursive: true, force: true }))

finish()
