import { ENGINE_ALIASES, localSpecifiers } from './appImports.js'

export const APPS_MANIFEST_VERSION = 1
export const REFUSAL_BLOCKED_PATTERN = 'app-source-blocked-pattern'
export const REFUSAL_IMPORT_MISSING = 'app-import-missing'
export const REFUSAL_IMPORT_ESCAPES = 'app-import-escapes-apps-dir'
export const REFUSAL_ENTRY_MISSING = 'app-entry-missing'

const BLOCKED_PATTERNS = Object.freeze([
  'process.exit', 'child_process', 'require(', '__proto__',
  'Object.prototype', 'globalThis', 'eval(', 'import(',
])

const byName = (a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0)
const byText = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

const checkHost = (host) => {
  for (const method of ['join', 'exists', 'readFile', 'listDir']) {
    if (typeof host?.[method] !== 'function') throw new TypeError('the apps manifest needs host.' + method)
  }
}

const checkDirs = (dirs) => {
  if (!Array.isArray(dirs) || dirs.length === 0 || !dirs.every((dir) => typeof dir === 'string' && dir.length > 0)) {
    throw new TypeError('dirs must be a non-empty list of directory paths')
  }
}

const toSlashes = (path) => path.replace(/\\/g, '/')

export const normalizePath = (path) => {
  const text = toSlashes(path)
  const absolute = text.startsWith('/')
  const out = []
  for (const part of text.split('/')) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      if (out.length > 0 && out[out.length - 1] !== '..') out.pop()
      else if (!absolute) out.push('..')
      continue
    }
    out.push(part)
  }
  return (absolute ? '/' : '') + out.join('/')
}

const parentOf = (path) => {
  const at = path.lastIndexOf('/')
  return at <= 0 ? (at === 0 ? '/' : '') : path.slice(0, at)
}

const within = (dir, path) => path === dir || path.startsWith(dir.endsWith('/') ? dir : dir + '/')

export async function resolveAppEntry(name, dirs, host) {
  checkHost(host)
  checkDirs(dirs)
  if (typeof name !== 'string' || name.length === 0 || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
    throw new RangeError('app name must be a single path segment, got ' + JSON.stringify(name))
  }
  for (const dir of dirs) {
    const flat = host.join(dir, name + '.js')
    if (await host.exists(flat)) return { dir, path: flat, layout: 'flat' }
    const folder = host.join(dir, name, 'index.js')
    if (await host.exists(folder)) return { dir, path: folder, layout: 'folder' }
  }
  return null
}

export async function listAppNames(dirs, host) {
  checkHost(host)
  checkDirs(dirs)
  const seen = new Set()
  const names = []
  for (const dir of dirs) {
    const entries = (await host.listDir(dir)).slice().sort(byName)
    for (const entry of entries) {
      let name = null
      if (entry.isFile && entry.name.endsWith('.js')) name = entry.name.slice(0, -3)
      else if (entry.isDirectory && (await host.exists(host.join(dir, entry.name, 'index.js')))) name = entry.name
      if (!name || seen.has(name)) continue
      seen.add(name)
      names.push(name)
    }
  }
  return names
}

const blockedPatternIn = (source) => {
  for (const pattern of BLOCKED_PATTERNS) if (source.includes(pattern)) return pattern
  return null
}

const candidatesFor = (target) => (target.endsWith('.js') || target.endsWith('.mjs') || target.endsWith('.json') ? [target] : [target, target + '.js', target + '/index.js'])

async function collectApp(name, entry, host, aliases) {
  const dir = normalizePath(entry.dir)
  const entryPath = normalizePath(entry.path)
  const scope = entry.layout === 'folder' ? parentOf(entryPath) : dir
  const modules = {}
  const imports = {}
  const absolute = new Set()
  const queue = [entryPath]
  const keyOf = (path) => path.slice(dir.length).replace(/^\//, '')
  while (queue.length > 0) {
    const path = queue.shift()
    const key = keyOf(path)
    if (Object.hasOwn(modules, key)) continue
    const source = await host.readFile(path)
    const pattern = blockedPatternIn(source)
    if (pattern !== null) return { refusal: { reasonCode: REFUSAL_BLOCKED_PATTERN, app: name, module: key, pattern } }
    modules[key] = source
    const links = {}
    for (const specifier of localSpecifiers(source, aliases).sort(byText)) {
      if (specifier.startsWith('/')) {
        absolute.add(specifier)
        continue
      }
      const target = normalizePath(parentOf(path) + '/' + specifier)
      if (!within(scope, target)) return { refusal: { reasonCode: REFUSAL_IMPORT_ESCAPES, app: name, module: key, specifier } }
      let found = null
      for (const candidate of candidatesFor(target)) {
        if (await host.exists(candidate)) {
          found = candidate
          break
        }
      }
      if (found === null) return { refusal: { reasonCode: REFUSAL_IMPORT_MISSING, app: name, module: key, specifier } }
      links[specifier] = keyOf(found)
      queue.push(found)
    }
    if (Object.keys(links).length > 0) imports[key] = links
  }
  const used = Object.keys(aliases).filter((alias) => Object.values(modules).some((source) => source.includes("'" + alias + "'") || source.includes('"' + alias + '"'))).sort(byText)
  return { app: { entry: keyOf(entryPath), layout: entry.layout, modules, imports, engine: used, absolute: [...absolute].sort(byText) } }
}

const fnv1a = (text, hash) => {
  let h = hash
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h
}

export const manifestDigest = (apps) => {
  let hash = 2166136261 | 0
  for (const name of Object.keys(apps).sort(byText)) {
    hash = fnv1a(name + '\n', hash)
    const app = apps[name]
    hash = fnv1a(app.entry + '\n', hash)
    for (const key of Object.keys(app.modules).sort(byText)) hash = fnv1a(key + '\n' + app.modules[key] + '\n', hash)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export async function buildAppsManifest({ dirs, host, names = null, aliases = ENGINE_ALIASES }) {
  checkHost(host)
  checkDirs(dirs)
  const wanted = names === null ? await listAppNames(dirs, host) : [...names]
  const apps = {}
  const refusals = []
  for (const name of [...new Set(wanted)].sort(byText)) {
    const entry = await resolveAppEntry(name, dirs, host)
    if (entry === null) {
      refusals.push({ reasonCode: REFUSAL_ENTRY_MISSING, app: name })
      continue
    }
    const collected = await collectApp(name, entry, host, aliases)
    if (collected.refusal) refusals.push(collected.refusal)
    else apps[name] = collected.app
  }
  return { version: APPS_MANIFEST_VERSION, digest: manifestDigest(apps), apps, refusals }
}

export function parseAppsManifest(text) {
  const manifest = typeof text === 'string' ? JSON.parse(text) : text
  if (manifest === null || typeof manifest !== 'object' || Array.isArray(manifest)) throw new TypeError('apps manifest must be an object')
  if (manifest.version !== APPS_MANIFEST_VERSION) throw new RangeError('apps manifest version is ' + JSON.stringify(manifest.version) + ', expected ' + APPS_MANIFEST_VERSION)
  if (manifest.apps === null || typeof manifest.apps !== 'object' || Array.isArray(manifest.apps)) throw new TypeError('apps manifest needs an apps object')
  for (const [name, app] of Object.entries(manifest.apps)) {
    if (typeof app?.entry !== 'string' || app.modules === null || typeof app.modules !== 'object') throw new TypeError('app ' + name + ' needs an entry and a modules object')
    if (typeof app.modules[app.entry] !== 'string') throw new RangeError('app ' + name + ' has no module for its entry ' + app.entry)
    for (const [key, links] of Object.entries(app.imports ?? {})) {
      for (const [specifier, target] of Object.entries(links)) {
        if (typeof app.modules[target] !== 'string') throw new RangeError('app ' + name + ' module ' + key + ' imports ' + specifier + ', which is not in the manifest')
      }
    }
  }
  const digest = manifestDigest(manifest.apps)
  if (manifest.digest !== digest) throw new RangeError('apps manifest digest is ' + JSON.stringify(manifest.digest) + ', its content gives ' + digest)
  return manifest
}

export function entrySource(manifest, name) {
  const app = manifest.apps[name]
  return app ? app.modules[app.entry] : null
}
