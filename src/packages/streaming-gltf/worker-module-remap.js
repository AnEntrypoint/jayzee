export const STATIC_IMPORT_SPECIFIER = /(?<=^|;)(\s*(?:import\s*|import\b[^'"`;()]*?\bfrom\s*|export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}'"`]*\})\s*from\s*))(['"])([^'"\r\n]+)\2/gm

const HOST_FUNCTIONS = ['fetch', 'resolve', 'createModuleUrl', 'revokeModuleUrl', 'importModule']

export const isRelativeSpecifier = (specifier) => specifier.startsWith('./') || specifier.startsWith('../') || specifier.startsWith('/')

function requireHost(host) {
  if (!host || typeof host !== 'object') throw new TypeError('worker-module-remap: host must be an object with ' + HOST_FUNCTIONS.join(', '))
  for (const name of HOST_FUNCTIONS) {
    if (typeof host[name] !== 'function') throw new TypeError('worker-module-remap: host.' + name + ' must be a function')
  }
  return host
}

export function rewriteSpecifiers(source, matches, targets) {
  let out = ''
  let cursor = 0
  matches.forEach((match, i) => {
    const specifierStart = match.index + match[1].length + 1
    out += source.slice(cursor, specifierStart) + targets[i]
    cursor = specifierStart + match[3].length
  })
  return out + source.slice(cursor)
}

async function remapModule(url, bareMap, cache, chain, moduleUrls, host) {
  if (chain.includes(url)) throw new Error(`worker-module-remap: import cycle ${[...chain, url].join(' -> ')}`)
  if (cache.has(url)) return cache.get(url)
  const pending = (async () => {
    const response = await host.fetch(url)
    if (!response.ok) throw new Error(`worker-module-remap: fetch ${url}: ${response.status}`)
    const source = await response.text()
    const matches = [...source.matchAll(STATIC_IMPORT_SPECIFIER)]
    const targets = await Promise.all(matches.map(([, , , specifier]) => {
      if (Object.hasOwn(bareMap, specifier)) return bareMap[specifier]
      if (isRelativeSpecifier(specifier)) return remapModule(host.resolve(specifier, url), bareMap, cache, [...chain, url], moduleUrls, host)
      return specifier
    }))
    const unchanged = matches.every(([, , , specifier], i) => targets[i] === specifier || (isRelativeSpecifier(specifier) && targets[i] === host.resolve(specifier, url)))
    if (unchanged) return url
    const moduleUrl = host.createModuleUrl(rewriteSpecifiers(source, matches, targets))
    moduleUrls.push(moduleUrl)
    return moduleUrl
  })()
  cache.set(url, pending)
  return pending
}

export async function importWithBareRemap(url, bareMap, host) {
  requireHost(host)
  const moduleUrls = []
  try {
    return await host.importModule(await remapModule(url, bareMap, new Map(), [], moduleUrls, host))
  } finally {
    for (const moduleUrl of moduleUrls) host.revokeModuleUrl(moduleUrl)
  }
}
