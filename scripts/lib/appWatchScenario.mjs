import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const app = (label) => 'export default { label: \'' + label + '\' }\n'

const SETTLE_MS = 300
const STEP_MS = 600

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)

const silentLog = { log() {}, debug() {}, error() {}, warn() {} }

function muteConsole() {
  const saved = { log: console.log, debug: console.debug, error: console.error, warn: console.warn }
  console.log = () => {}
  console.debug = () => {}
  console.error = () => {}
  console.warn = () => {}
  return () => Object.assign(console, saved)
}

export const spointAdapter = (AppLoader) => ({
  create({ dir, runtime, onTreeChange, onReload }) {
    const loader = new AppLoader(runtime, { dirs: [dir] })
    loader._onTreeChangeCallback = onTreeChange
    loader._onReloadCallback = onReload
    return loader
  },
})

export const jayzeeAdapter = (createAppLoader, createNodeAppHost) => ({
  create({ dir, runtime, onTreeChange, onReload }) {
    return createAppLoader({ runtime, host: createNodeAppHost(), dirs: [dir], log: silentLog, onTreeChange, onReload })
  },
})

export async function runAppWatchScenario(adapter) {
  const root = mkdtempSync(join(tmpdir(), 'app-watch-'))
  const flat = join(root, 'flat.js')
  const folder = join(root, 'folder')
  const index = join(folder, 'index.js')
  const helper = join(folder, 'helper.js')
  const notes = join(root, 'notes.txt')
  mkdirSync(folder)
  writeFileSync(flat, app('v1'))
  writeFileSync(index, app('f1'))
  writeFileSync(notes, 'hello\n')

  const registered = []
  const reloads = []
  const clientReloads = []
  const trees = []
  const runtime = {
    registerApp(name, def) { registered.push({ name, label: def.label }) },
    queueReload(name, def, cb) {
      reloads.push({ name, label: def.label })
      if (cb) cb(name, def)
    },
  }
  const restore = muteConsole()
  const steps = []
  try {
    const loader = adapter.create({
      dir: root,
      runtime,
      onTreeChange: (filename) => trees.push(filename),
      onReload: (name, code) => clientReloads.push({ name, code }),
    })
    await loader.loadAll()
    const initial = registered.splice(0).sort(byName)
    await loader.watchAll()
    await sleep(SETTLE_MS)

    const run = async (step, action) => {
      action()
      await sleep(STEP_MS)
      steps.push({
        step,
        reloads: reloads.splice(0),
        clientReloads: clientReloads.splice(0),
        trees: [...new Set(trees.splice(0))].sort(),
      })
    }
    await run('two writes inside the debounce window reload once', () => {
      writeFileSync(flat, app('v2a'))
      writeFileSync(flat, app('v2'))
    })
    await run('an edit to a folder app reloads the folder by name', () => writeFileSync(index, app('f2')))
    await run('a nested non-index file reloads its folder app', () => writeFileSync(helper, 'export const helper = 1\n'))
    await run('a non-js file is reported and reloads nothing', () => writeFileSync(notes, 'changed\n'))
    await run('a refused source is not reloaded', () => writeFileSync(flat, app('v3x') + 'const leaked = process.exit\n'))
    await run('the next valid edit loads the new source, not a cached module', () => writeFileSync(flat, app('v3')))
    loader.stopWatching()
    await run('an edit after stopWatching reloads nothing', () => writeFileSync(flat, app('v4')))
    return { initial, steps }
  } finally {
    restore()
    rmSync(root, { recursive: true, force: true })
  }
}
