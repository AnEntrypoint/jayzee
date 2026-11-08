import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { createAppLoader } from '../src/apps/appLoader.js'
import { createNodeAppHost } from '../src/apps/nodeAppHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/app-loader.json', import.meta.url), 'utf8'))
const quiet = { error() {}, log() {}, debug() {} }
const byApp = (a, b) => (a.app < b.app ? -1 : a.app > b.app ? 1 : 0)
const sorted = (xs) => [...xs].sort()
const same = (got, want, what) => {
  const g = JSON.stringify(got)
  const w = JSON.stringify(want)
  if (g !== w) throw new Error(what + ': got ' + g + ', spoint ' + w)
}
const refusesMissing = (host, method) => {
  const partial = { ...host }
  delete partial[method]
  try {
    createAppLoader({ runtime: { registerApp() {} }, host: partial, dirs: ['x'], log: quiet })
  } catch (error) {
    if (error instanceof TypeError && error.message.includes(method)) return
    throw error
  }
  throw new Error('no TypeError for a host without ' + method)
}

const root = mkdtempSync(join(tmpdir(), 'jz-app-loader-gate-'))
try {
  for (const [rel, content] of Object.entries(fixture.tree)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true })
    writeFileSync(join(root, rel), content)
  }
  const registered = []
  const runtime = { registerApp: (name) => registered.push(name), queueReload() {} }
  const dirs = fixture.dirs.map((d) => join(root, d))
  const loader = createAppLoader({ runtime, host: createNodeAppHost(), dirs, log: quiet })
  const nodeResult = await loader.loadAll()
  const resolved = {}
  for (const name of Object.keys(fixture.resolve)) {
    const found = await loader.resolvePath(name)
    resolved[name] = found === null ? null : relative(root, found).split(sep).join('/')
  }
  const clientModules = loader.getClientModules()

  const files = new Map(Object.entries(fixture.tree))
  const imported = []
  const memoryHost = {
    join: (...parts) => parts.join('/'),
    exists: async (path) => files.has(path) || [...files.keys()].some((key) => key.startsWith(path + '/')),
    readFile: async (path) => {
      if (!files.has(path)) throw new Error('no file ' + path)
      return files.get(path)
    },
    listDir: async (dir) => {
      const children = new Map()
      for (const key of files.keys()) {
        if (!key.startsWith(dir + '/')) continue
        const rest = key.slice(dir.length + 1).split('/')
        children.set(rest[0], { name: rest[0], isFile: rest.length === 1, isDirectory: rest.length > 1 })
      }
      return [...children.values()]
    },
    importModule: async (path) => {
      imported.push(path)
      const text = files.get(path)
      if (text.includes('@@')) throw new SyntaxError('unexpected token in ' + path)
      return { default: { source: text.length } }
    },
  }
  const memRegistered = []
  const memLoader = createAppLoader({ runtime: { registerApp: (name) => memRegistered.push(name) }, host: memoryHost, dirs: fixture.dirs, log: quiet })
  const memResult = await memLoader.loadAll()

  const missingDir = await createAppLoader({ runtime: { registerApp() {} }, host: createNodeAppHost(), dirs: [join(root, 'nowhere')], log: quiet }).loadAll()

  const defaults = []
  const defaultLoader = createAppLoader({ runtime: { registerApp: (name, def) => defaults.push([name, def]) }, host: memoryHost, log: quiet })
  const fromModule = defaultLoader.loadFromModule('direct', { default: { kind: 'direct' } })
  const rejected = defaultLoader.loadFromModule('scalar', { default: 5 })

  gate('node host loadAll loads the apps spoint loads, in the same set', () => same(sorted(nodeResult.loaded), fixture.loadAll.loaded, 'loaded'))
  gate('node host loadAll fails the apps spoint fails (syntax error and refused sources)', () => same(sorted(nodeResult.failed), fixture.loadAll.failed, 'failed'))
  gate('node host loadAll refuses the same sources with the same reason and pattern', () => same([...nodeResult.refusals].sort(byApp), fixture.loadAll.refusals, 'refusals'))
  gate('registerApp runs once per loaded app and never twice for a name', () => {
    same(sorted(registered), fixture.registered, 'registered')
    if (new Set(registered).size !== registered.length) throw new Error('duplicate registration')
  })
  gate('resolvePath matches spoint: flat file first, folder index, shadowed name, missing and bare folder', () => same(resolved, fixture.resolve, 'resolve'))
  gate('getClientModules holds the source text of each loaded file', () => {
    same(sorted(Object.keys(clientModules)), fixture.loadAll.loaded, 'client module names')
    if (clientModules.alpha !== fixture.tree['apps/alpha.js']) throw new Error('alpha source differs from the file')
  })
  gate('an in-memory host gives the same loadAll with no node:fs', () => {
    same(sorted(memResult.loaded), fixture.loadAll.loaded, 'memory loaded')
    same(sorted(memResult.failed), fixture.loadAll.failed, 'memory failed')
    same([...memResult.refusals].sort(byApp), fixture.loadAll.refusals, 'memory refusals')
    same(sorted(memRegistered), fixture.registered, 'memory registered')
  })
  gate('a refused source is never imported', () => {
    for (const refused of ['apps/gamma.js', 'apps/iota.js', 'apps/theta.js']) {
      if (imported.includes(refused)) throw new Error(refused + ' was imported')
    }
  })
  gate('loadAll over a missing directory loads nothing and does not throw', () => same(missingDir, { loaded: [], failed: [], refusals: [] }, 'missing directory'))
  gate('loadFromModule registers a default export object and refuses a scalar', () => {
    same(fromModule, { kind: 'direct' }, 'default export')
    if (rejected !== null) throw new Error('scalar default export was accepted')
    same(defaults.map(([name]) => name), ['direct'], 'registered names')
  })
  gate('createAppLoader refuses a host missing importModule or listDir', () => {
    refusesMissing(memoryHost, 'importModule')
    refusesMissing(memoryHost, 'listDir')
  })
  gate('createAppLoader refuses a runtime without registerApp', () => {
    try {
      createAppLoader({ runtime: {}, host: memoryHost, dirs: [], log: quiet })
    } catch (error) {
      if (error instanceof TypeError) return
    }
    throw new Error('no TypeError for a runtime without registerApp')
  })
} finally {
  rmSync(root, { recursive: true, force: true })
}
finish();
