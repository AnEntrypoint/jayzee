export class SourceClosureError extends Error {
  constructor(code, message, detail) {
    super(`${code}: ${message}`)
    this.name = 'SourceClosureError'
    this.code = code
    this.detail = detail
  }
}

const IDENT = '[A-Za-z_$][\\w$]*'
const FROM_CLAUSE = new RegExp('(?:^|[\\n;}])[ \\t]*(import|export)\\s+([^\'"`;]*?)\\s*from\\s*([\'"])([^\'"\\n]+)\\3', 'g')
const BARE_IMPORT = /(?:^|[\n;}])[ \t]*import\s*(['"])([^'"\n]+)\1/g
const DYNAMIC_IMPORT = /\bimport\s*\(\s*(['"])([^'"\n]+)\1\s*\)/g
const DECLARED_EXPORT = new RegExp('(?:^|[\\n;}])[ \\t]*export\\s+(?:async\\s+)?(?:function\\s*\\*?|class|const|let|var)\\s+(' + IDENT + ')', 'g')
const DESTRUCTURED_EXPORT = /(?:^|[\n;}])[ \t]*export\s+(?:const|let|var)\s*\{([^}]*)\}/g
const LISTED_EXPORT = /(?:^|[\n;}])[ \t]*export\s*\{([^}]*)\}/g
const DEFAULT_EXPORT = /(?:^|[\n;}])[ \t]*export\s+default\b/
const STAR_AS = new RegExp('^\\*\\s*as\\s+(' + IDENT + ')$')

const listNames = (body, side) => body.split(',').map((part) => part.trim()).filter((part) => part !== '').map((part) => {
  const pieces = part.split(/\s+as\s+|\s*:\s*/)
  return (side === 'source' ? pieces[0] : pieces[pieces.length - 1]).trim()
})

function clauseNames(kind, clause) {
  const text = clause.trim()
  if (text === '*') return { star: kind === 'export', namespace: kind === 'import', names: [], exported: [] }
  const starAs = STAR_AS.exec(text)
  if (starAs) return { star: false, namespace: true, names: [], exported: kind === 'export' ? [starAs[1]] : [] }
  const open = text.indexOf('{')
  const names = []
  const exported = []
  let namespace = false
  const head = (open < 0 ? text : text.slice(0, open)).replace(/,\s*$/, '').trim()
  if (kind === 'import' && head !== '') {
    for (const part of head.split(',').map((p) => p.trim()).filter((p) => p !== '')) {
      if (part.startsWith('*')) namespace = true
      else names.push('default')
    }
  }
  if (open >= 0) {
    const body = text.slice(open + 1, text.lastIndexOf('}'))
    names.push(...listNames(body, 'source'))
    if (kind === 'export') exported.push(...listNames(body, 'local'))
  }
  return { star: false, namespace, names, exported }
}

export function listImports(text) {
  if (typeof text !== 'string') throw new TypeError('listImports needs source text')
  const found = []
  for (const m of text.matchAll(FROM_CLAUSE)) found.push({ kind: m[1], specifier: m[4], ...clauseNames(m[1], m[2]) })
  for (const m of text.matchAll(BARE_IMPORT)) found.push({ kind: 'import', specifier: m[2], star: false, namespace: false, names: [], exported: [] })
  for (const m of text.matchAll(DYNAMIC_IMPORT)) found.push({ kind: 'dynamic', specifier: m[2], star: false, namespace: true, names: [], exported: [] })
  return found
}

export function listExports(text) {
  if (typeof text !== 'string') throw new TypeError('listExports needs source text')
  const names = new Set()
  const stars = []
  for (const m of text.matchAll(DECLARED_EXPORT)) names.add(m[1])
  for (const m of text.matchAll(DESTRUCTURED_EXPORT)) for (const name of listNames(m[1], 'local')) names.add(name)
  for (const m of text.matchAll(LISTED_EXPORT)) for (const name of listNames(m[1], 'local')) names.add(name)
  if (DEFAULT_EXPORT.test(text)) names.add('default')
  for (const entry of listImports(text)) {
    if (entry.kind !== 'export') continue
    if (entry.star) stars.push(entry.specifier)
    for (const name of entry.exported) names.add(name)
  }
  return { names, stars }
}

export const isRelative = (specifier) => specifier.startsWith('./') || specifier.startsWith('../')

export function resolveRelative(fromPath, specifier) {
  const parts = fromPath.split('/')
  parts.pop()
  for (const piece of specifier.split('/')) {
    if (piece === '.' || piece === '') continue
    if (piece === '..') {
      if (parts.length === 0) throw new SourceClosureError('import-escapes-root', `${specifier} from ${fromPath} leaves the source root`, { from: fromPath, specifier })
      parts.pop()
    } else {
      parts.push(piece)
    }
  }
  return parts.join('/')
}

function readOrNull(readText, path) {
  let text
  try {
    text = readText(path)
  } catch {
    return null
  }
  return typeof text === 'string' ? text : null
}

export function importClosure(entries, readText) {
  if (!Array.isArray(entries) || entries.length === 0) throw new TypeError('importClosure needs a non-empty list of entry paths')
  if (typeof readText !== 'function') throw new TypeError('importClosure needs a readText function')
  const texts = new Map()
  const edges = []
  const missing = []
  const bare = new Set()
  const queue = []
  for (const entry of entries) {
    if (typeof entry !== 'string' || entry === '') throw new TypeError('entry paths must be non-empty strings')
    if (!texts.has(entry)) {
      const text = readOrNull(readText, entry)
      if (text === null) throw new SourceClosureError('entry-unreadable', `entry ${entry} cannot be read`, { path: entry })
      texts.set(entry, text)
      queue.push(entry)
    }
  }
  for (let head = 0; head < queue.length; head++) {
    const from = queue[head]
    for (const entry of listImports(texts.get(from))) {
      if (!isRelative(entry.specifier)) {
        bare.add(entry.specifier)
        continue
      }
      const to = resolveRelative(from, entry.specifier)
      edges.push({ from, to, specifier: entry.specifier, names: entry.names, kind: entry.kind })
      if (texts.has(to)) continue
      const text = readOrNull(readText, to)
      if (text === null) {
        missing.push({ from, specifier: entry.specifier, path: to })
        texts.set(to, '')
        continue
      }
      texts.set(to, text)
      queue.push(to)
    }
  }
  const absent = new Set(missing.map((m) => m.path))
  const files = [...texts.keys()].filter((path) => !absent.has(path)).sort()
  return { files, edges, missing, bare: [...bare].sort(), texts }
}

export function exportedNames(path, texts, seen = new Set()) {
  if (seen.has(path)) return new Set()
  seen.add(path)
  const text = texts.get(path)
  if (text === undefined) return new Set()
  const { names, stars } = listExports(text)
  const all = new Set(names)
  for (const specifier of stars) {
    if (!isRelative(specifier)) continue
    for (const name of exportedNames(resolveRelative(path, specifier), texts, seen)) if (name !== 'default') all.add(name)
  }
  return all
}

export function unresolvedBindings(closure) {
  const absent = new Set(closure.missing.map((m) => m.path))
  const unresolved = []
  const cache = new Map()
  for (const edge of closure.edges) {
    if (absent.has(edge.to) || !edge.to.endsWith('js')) continue
    let names = cache.get(edge.to)
    if (names === undefined) {
      names = exportedNames(edge.to, closure.texts)
      cache.set(edge.to, names)
    }
    for (const name of edge.names) if (!names.has(name)) unresolved.push({ from: edge.from, to: edge.to, name })
  }
  return unresolved
}

export function assertClosed(closure) {
  if (closure.missing.length > 0) {
    const first = closure.missing[0]
    throw new SourceClosureError('import-unresolved', `${first.specifier} from ${first.from} names no file (${closure.missing.length} unresolved in all)`, closure.missing)
  }
  const bindings = unresolvedBindings(closure)
  if (bindings.length > 0) {
    const first = bindings[0]
    throw new SourceClosureError('binding-unresolved', `${first.from} imports ${first.name} from ${first.to}, which does not export it (${bindings.length} unresolved in all)`, bindings)
  }
  return closure
}
