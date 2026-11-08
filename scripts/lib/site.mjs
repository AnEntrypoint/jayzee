import { readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const jzRoot = join(root, 'node_modules', 'jz')

export const SITE_DIR = join(root, 'docs', 'play')
export const ENTRY_MODULES = ['src/world/World.js', 'src/physics-pure/settler.js']
export const PAGE_FILES = ['site/index.html', 'site/play.js']
export const IMPORT_MAP = { 'jz/interop': join(jzRoot, 'instantiate.js') }
const SPECIFIER = /from '([^']+)'/g

const siteNameOf = (abs) => {
  const rel = relative(root, abs)
  if (rel.startsWith('src/')) return rel
  const vendor = relative(jzRoot, abs)
  if (!vendor.startsWith('..')) return join('vendor', 'jz', vendor)
  throw new Error(rel + ' is outside the site closure')
}

export const planSite = ({ read = (abs) => readFileSync(abs, 'utf8'), entries = ENTRY_MODULES } = {}) => {
  const modules = new Map()
  const queue = [...entries.map((path) => join(root, path)), IMPORT_MAP['jz/interop']]
  while (queue.length > 0) {
    const abs = queue.pop()
    if (modules.has(abs)) continue
    const text = read(abs)
    modules.set(abs, text)
    if (/\bimport\(/.test(text)) throw new Error(relative(root, abs) + ' uses a dynamic import, which the site plan does not follow')
    for (const [, specifier] of text.matchAll(SPECIFIER)) {
      if (specifier.startsWith('./') || specifier.startsWith('../')) queue.push(resolve(dirname(abs), specifier))
      else if (Object.hasOwn(IMPORT_MAP, specifier)) queue.push(IMPORT_MAP[specifier])
      else throw new Error(relative(root, abs) + ' imports ' + specifier + ', which the browser site does not provide')
    }
  }
  const files = [...modules.keys()].map((abs) => ({ to: siteNameOf(abs), bytes: Buffer.from(modules.get(abs)) }))
  for (const page of PAGE_FILES) {
    files.push({ to: page.replace(/^site\//, ''), bytes: readFileSync(join(root, page)) })
  }
  files.push({ to: 'kernel.wasm', bytes: readFileSync(join(root, 'dist', 'kernel.wasm')) })
  return { files }
}
