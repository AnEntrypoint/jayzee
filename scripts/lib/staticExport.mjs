import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const EXPORT_TARGETS = Object.freeze(['itch', 'pages'])
export const EXPORT_PAGE_FILES = Object.freeze(['site/export/index.html', 'site/export/boot.js', 'site/export/server-worker.js', 'site/coi-sw.js'])
export const EXPORT_ENTRIES = Object.freeze(['site/export/boot.js', 'site/export/server-worker.js'])
export const ITCH_MAX_FILES = 1000
export const ITCH_MAX_BYTES = 500 * 1024 * 1024
export const ITCH_MAX_FILE_BYTES = 200 * 1024 * 1024
export const WORLD_APP = 'world'
const SPECIFIER = /(\bfrom\s*|\bimport\s*)(['"])([^'"\n]+)\2/g
const DYNAMIC_LITERAL = /\bimport\(\s*(['"])([^'"\n]+)\1\s*\)/g
const NODE_ONLY = /^node:/
const APP_NAME = /^[A-Za-z0-9_-]{1,64}$/
const MODULE_FILE = /\.m?js$/

const refuse = (code, message) => {
  const error = new Error(message)
  error.code = code
  return error
}

const toPosix = (path) => path.split(sep).join('/')

const relativeSpecifier = (fromOut, toOut) => {
  const rel = posix.relative(posix.dirname(fromOut), toOut)
  return rel.startsWith('.') ? rel : './' + rel
}

const resolveBare = (specifier, fromAbs) => {
  const name = specifier.startsWith('@') ? specifier.split('/').slice(0, 2).join('/') : specifier.split('/')[0]
  let packageDir = null
  for (let dir = dirname(fromAbs); ; dir = dirname(dir)) {
    const candidate = join(dir, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json'))) {
      packageDir = candidate
      break
    }
    if (dirname(dir) === dir) break
  }
  if (packageDir === null) throw refuse('export-package-missing', 'package ' + name + ' imported by ' + fromAbs + ' is not installed')
  const manifest = JSON.parse(readFileSync(join(packageDir, 'package.json'), 'utf8'))
  const subpath = specifier === name ? '.' : './' + specifier.slice(name.length + 1)
  const pick = (entry) => {
    if (typeof entry === 'string') return entry
    if (entry === null || typeof entry !== 'object') return null
    for (const condition of ['browser', 'import', 'default']) {
      if (condition in entry) {
        const found = pick(entry[condition])
        if (found !== null) return found
      }
    }
    return null
  }
  let target = null
  if (manifest.exports !== undefined) {
    const table = typeof manifest.exports === 'string' || !Object.keys(manifest.exports).some((key) => key.startsWith('.')) ? { '.': manifest.exports } : manifest.exports
    target = pick(table[subpath])
  } else if (subpath === '.') {
    target = typeof manifest.browser === 'string' ? manifest.browser : manifest.module ?? manifest.main ?? 'index.js'
  } else {
    target = subpath
  }
  if (target === null) throw refuse('export-package-entry-missing', 'package ' + name + ' has no browser entry for ' + specifier)
  return { name, packageDir, file: join(packageDir, target) }
}

export function planExport({ appsDir, target = 'itch', base = './', entries = EXPORT_ENTRIES, pageFiles = EXPORT_PAGE_FILES, read = (abs) => readFileSync(abs) } = {}) {
  if (!EXPORT_TARGETS.includes(target)) throw refuse('export-target-unknown', 'target must be one of ' + EXPORT_TARGETS.join(', ') + ', got ' + target)
  if (typeof appsDir !== 'string' || !existsSync(appsDir) || !statSync(appsDir).isDirectory()) throw refuse('export-apps-missing', 'the apps directory ' + appsDir + ' does not exist')
  if (typeof base !== 'string' || !(base === './' || (base.startsWith('/') && base.endsWith('/')))) throw refuse('export-base-invalid', 'base must be ./ or an absolute path that ends in a slash, got ' + base)
  const appsRoot = resolve(appsDir)
  const outputs = new Map()
  const outOf = new Map()
  const vendored = new Set()

  const outNameOf = (abs) => {
    if (outOf.has(abs)) return outOf.get(abs)
    let name
    const fromApps = relative(appsRoot, abs)
    const fromRoot = relative(root, abs)
    const modulesAt = abs.lastIndexOf(sep + 'node_modules' + sep)
    if (!fromApps.startsWith('..')) name = 'apps/' + toPosix(fromApps)
    else if (modulesAt >= 0) name = 'vendor/' + toPosix(abs.slice(modulesAt + 14))
    else if (fromRoot.startsWith('site' + sep + 'export' + sep)) name = toPosix(fromRoot.slice(12))
    else if (fromRoot.startsWith('src' + sep)) name = toPosix(fromRoot)
    else throw refuse('export-outside-closure', toPosix(fromRoot) + ' is outside the export closure')
    outOf.set(abs, name)
    return name
  }

  const addModule = (abs) => {
    const outName = outNameOf(abs)
    if (outputs.has(outName)) return outName
    if (!existsSync(abs)) throw refuse('export-module-missing', toPosix(relative(root, abs)) + ' does not exist')
    outputs.set(outName, null)
    const text = read(abs).toString('utf8')
    const pageDir = relative(root, abs).startsWith('site' + sep + 'export' + sep) ? dirname(abs) : null
    const link = (specifier) => {
      if (NODE_ONLY.test(specifier)) throw refuse('export-node-import', outName + ' imports ' + specifier + ', which a browser cannot provide')
      if (specifier.startsWith('./') || specifier.startsWith('../')) {
        const targetAbs = resolve(pageDir !== null && specifier.startsWith('./src/') ? root : dirname(abs), specifier)
        if (outName.startsWith('apps/') && relative(appsRoot, targetAbs).startsWith('..') && !relative(root, targetAbs).startsWith('src' + sep)) {
          throw refuse('export-outside-closure', outName + ' imports ' + specifier + ', which leaves the apps directory')
        }
        return relativeSpecifier(outName, addModule(targetAbs))
      }
      if (/^[a-z]+:/i.test(specifier) || specifier.startsWith('/')) throw refuse('export-absolute-import', outName + ' imports ' + specifier + ', which is not relative to the export')
      const found = resolveBare(specifier, abs)
      vendored.add(found.name)
      return relativeSpecifier(outName, addModule(found.file))
    }
    const rewritten = text
      .replace(SPECIFIER, (whole, lead, quote, specifier) => lead + quote + link(specifier) + quote)
      .replace(DYNAMIC_LITERAL, (whole, quote, specifier) => 'import(' + quote + link(specifier) + quote + ')')
    outputs.set(outName, Buffer.from(rewritten))
    return outName
  }

  for (const entry of entries) addModule(join(root, entry))

  const apps = {}
  const assets = []
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const abs = join(dir, entry.name)
      if (entry.isDirectory()) walk(abs)
      else if (MODULE_FILE.test(entry.name)) addModule(abs)
      else {
        const outName = outNameOf(abs)
        outputs.set(outName, read(abs))
        assets.push(outName)
      }
    }
  }
  walk(appsRoot)
  for (const entry of readdirSync(appsRoot, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    if (!entry.isDirectory() || entry.name === WORLD_APP) continue
    if (!APP_NAME.test(entry.name)) throw refuse('export-app-name-invalid', 'app directory ' + entry.name + ' is not a valid app name')
    if (existsSync(join(appsRoot, entry.name, 'index.js'))) apps[entry.name] = './apps/' + entry.name + '/index.js'
  }
  const worldModule = join(appsRoot, WORLD_APP, 'index.js')
  if (!existsSync(worldModule)) throw refuse('export-world-missing', 'the apps directory has no ' + WORLD_APP + '/index.js world config')

  for (const page of pageFiles) {
    const abs = join(root, page)
    const outName = page.startsWith('site/export/') ? page.slice(12) : page.slice(5)
    if (!outputs.has(outName)) outputs.set(outName, read(abs))
  }
  outputs.set('kernel.wasm', read(join(root, 'dist', 'kernel.wasm')))
  if (target === 'pages') {
    outputs.set('.nojekyll', Buffer.alloc(0))
    const html = outputs.get('index.html').toString('utf8')
    outputs.set('404.html', Buffer.from(base === './' ? html : html.replace('<head>', '<head>\n<base href="' + base + '">')))
  }

  return { target, base, apps, assets, vendored: [...vendored].sort(), worldModule, outputs }
}

export async function buildExport(options = {}) {
  const plan = planExport(options)
  const loaded = await import(pathToFileURL(plan.worldModule).href)
  const config = loaded.default
  if (config === null || typeof config !== 'object' || Array.isArray(config)) throw refuse('export-world-invalid', 'the world module must default-export a config object')
  let serialised
  try {
    serialised = JSON.parse(JSON.stringify(config))
  } catch (error) {
    throw refuse('export-world-invalid', 'the world config cannot be written as JSON: ' + error.message)
  }
  for (const entity of serialised.entities ?? []) {
    if (entity.app !== undefined && entity.app !== null && !(entity.app in plan.apps)) throw refuse('export-app-missing', 'entity ' + entity.id + ' names app ' + entity.app + ', which has no apps/' + entity.app + '/index.js')
    if (typeof entity.model === 'string' && (entity.bodyType ?? 'static') === 'static' && !plan.outputs.has(entity.model)) throw refuse('export-model-missing', 'entity ' + entity.id + ' names model ' + entity.model + ', which is not in the export')
  }
  const names = [...plan.outputs.keys(), 'manifest.json'].sort()
  const manifest = { target: plan.target, base: plan.base, config: serialised, apps: plan.apps, vendored: plan.vendored, files: names }
  plan.outputs.set('manifest.json', Buffer.from(JSON.stringify(manifest, null, 2) + '\n'))
  const files = names.map((name) => ({ to: name, bytes: plan.outputs.get(name) }))
  const totalBytes = files.reduce((sum, file) => sum + file.bytes.length, 0)
  if (plan.target === 'itch') {
    if (files.length > ITCH_MAX_FILES) throw refuse('export-itch-too-many-files', 'itch.io takes at most ' + ITCH_MAX_FILES + ' files, the export holds ' + files.length)
    if (totalBytes > ITCH_MAX_BYTES) throw refuse('export-itch-too-large', 'itch.io takes at most ' + ITCH_MAX_BYTES + ' bytes, the export holds ' + totalBytes)
    const big = files.find((file) => file.bytes.length > ITCH_MAX_FILE_BYTES)
    if (big) throw refuse('export-itch-file-too-large', big.to + ' is larger than the itch.io single-file limit')
  }
  return { ...plan, manifest, files, totalBytes }
}

const CRC_TABLE = new Uint32Array(256)
for (let n = 0; n < 256; n++) {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  CRC_TABLE[n] = c >>> 0
}

export const crc32 = (bytes) => {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) crc = CRC_TABLE[(crc ^ bytes[i]) & 255] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

export function zipStore(files) {
  const parts = []
  const central = []
  let offset = 0
  for (const { to, bytes } of files) {
    const name = Buffer.from(to, 'utf8')
    const crc = crc32(bytes)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0x21, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(bytes.length, 18)
    local.writeUInt32LE(bytes.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(20, 6)
    header.writeUInt16LE(0x0800, 8)
    header.writeUInt16LE(0, 10)
    header.writeUInt16LE(0, 12)
    header.writeUInt16LE(0x21, 14)
    header.writeUInt32LE(crc, 16)
    header.writeUInt32LE(bytes.length, 20)
    header.writeUInt32LE(bytes.length, 24)
    header.writeUInt16LE(name.length, 28)
    header.writeUInt32LE(offset, 42)
    parts.push(local, name, bytes)
    central.push(header, name)
    offset += 30 + name.length + bytes.length
  }
  const centralBytes = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(files.length, 8)
  end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(centralBytes.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, centralBytes, end])
}

export function readZipStore(zip) {
  const endAt = zip.length - 22
  if (endAt < 0 || zip.readUInt32LE(endAt) !== 0x06054b50) throw refuse('zip-end-missing', 'the archive has no end record')
  const count = zip.readUInt16LE(endAt + 10)
  let at = zip.readUInt32LE(endAt + 16)
  const files = []
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(at) !== 0x02014b50) throw refuse('zip-central-invalid', 'central record ' + i + ' is malformed')
    const crc = zip.readUInt32LE(at + 16)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const localAt = zip.readUInt32LE(at + 42)
    const to = zip.subarray(at + 46, at + 46 + nameLength).toString('utf8')
    const dataAt = localAt + 30 + zip.readUInt16LE(localAt + 26) + zip.readUInt16LE(localAt + 28)
    const bytes = zip.subarray(dataAt, dataAt + size)
    if (crc32(bytes) !== crc) throw refuse('zip-crc-mismatch', to + ' fails its checksum')
    files.push({ to, bytes })
    at += 46 + nameLength
  }
  return files
}
