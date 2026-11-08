export const WORLD_FILE_STEM = /^[A-Za-z0-9_-]{1,128}$/
export const WORLD_DIR = 'apps/world'
export const WORLD_INDEX = 'index'
export const WORLD_FIXTURES_DIR = 'apps/world/_fixtures'
export const SITE_WORLD_FILES = Object.freeze([])

export function isWorldName(value) {
  return typeof value === 'string' && WORLD_FILE_STEM.test(value)
}

export function worldFileRel(name) {
  if (!isWorldName(name)) throw new TypeError(`world name must be a world file stem, got ${JSON.stringify(name)}`)
  return `${WORLD_DIR}/${name}.js`
}

export function worldFileCandidates(name) {
  return [worldFileRel(name), `${WORLD_FIXTURES_DIR}/${name}.js`]
}

export function defaultWorldNameOf(indexModule) {
  const named = indexModule?.defaultWorld
  if (named === undefined) return WORLD_INDEX
  if (!isWorldName(named)) throw new TypeError(`${WORLD_DIR}/${WORLD_INDEX}.js defaultWorld must be a world file stem, got ${JSON.stringify(named)}`)
  return named
}

export function worldRequestOf(search, hash = '') {
  const params = new URLSearchParams(search)
  const hashAt = hash.indexOf('?')
  if (hashAt >= 0) {
    for (const [key, value] of new URLSearchParams(hash.slice(hashAt + 1))) {
      if (!params.has(key)) params.append(key, value)
    }
  }
  const requested = params.get('world') || null
  if (requested !== null && !isWorldName(requested)) throw new TypeError(`?world must be a world file stem, got ${JSON.stringify(requested)}`)
  return requested
}

export function locateWorld({ name = null, defaultName = null, exists }) {
  if (typeof exists !== 'function') throw new TypeError('locateWorld needs an exists(path) function')
  const requested = name === '' ? null : name
  if (requested !== null && !isWorldName(requested)) throw new TypeError(`world name must be a world file stem, got ${JSON.stringify(requested)}`)
  const worldName = requested ?? defaultName
  if (worldName === null) return { name: null, path: null }
  for (const rel of worldFileCandidates(worldName)) {
    if (exists(rel)) return { name: worldName, path: rel }
  }
  throw new Error(`world "${worldName}" not found: no ${worldFileRel(worldName)} or ${WORLD_FIXTURES_DIR}/${worldName}.js`)
}

export function locateSiteWorld(name = null) {
  return locateWorld({ name, exists: (rel) => SITE_WORLD_FILES.includes(rel) })
}
