export class EditorSerializeError extends Error {
  constructor(reasonCode, detail) {
    super(`[editor-serialize] ${reasonCode}: ${detail}`)
    this.name = 'EditorSerializeError'
    this.reasonCode = reasonCode
  }
}

export const TEXT_EXTS = new Set(['.js', '.mjs', '.json', '.md', '.txt', '.css', '.html', '.yml', '.yaml', '.svg'])

export const WORLD_CONFIG_KEYS = Object.freeze(['port', 'tickRate', 'entityTickRate', 'gravity', 'relevanceRadius', 'physicsRadius', 'physicsBodyBudget', 'movement', 'player', 'scene', 'camera', 'animation', 'input', 'spawnPoint', 'spawnPoints', 'playerModel', 'trustedApps', 'placeableApps', 'terrain', 'netcode'])

const WORLD_MODULE_PREFIX = 'export default '
const WORLD_MODULE_SUFFIX = '\n'

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) && !ArrayBuffer.isView(value)
const isTuple = (value) => Array.isArray(value) || ArrayBuffer.isView(value)

const vec3 = (value, label) => {
  if (!isTuple(value) || value.length !== 3 || !Array.from(value).every(isFiniteNumber)) {
    throw new EditorSerializeError('bad-vector', `${label} must be three finite numbers`)
  }
  return [value[0], value[1], value[2]]
}

const quatFrom = (value, label) => {
  if (isTuple(value)) {
    if (value.length !== 4 || !Array.from(value).every(isFiniteNumber)) {
      throw new EditorSerializeError('bad-quat', `${label} must be four finite numbers`)
    }
    return [value[0], value[1], value[2], value[3]]
  }
  if (isPlainObject(value)) {
    return quatFrom([value.x ?? 0, value.y ?? 0, value.z ?? 0, value.w ?? 1], label)
  }
  throw new EditorSerializeError('bad-quat', `${label} must be an array or an {x, y, z, w} object`)
}

const isIdentityQuat = (q) => q[0] === 0 && q[1] === 0 && q[2] === 0 && q[3] === 1
const isUnitScale = (s) => s[0] === 1 && s[1] === 1 && s[2] === 1

export function isTextFile(name) {
  if (typeof name !== 'string') throw new EditorSerializeError('bad-name', 'file name must be a string')
  const i = name.lastIndexOf('.')
  return i >= 0 && TEXT_EXTS.has(name.slice(i).toLowerCase())
}

export function sanitizeFsError(e, clientRelativePath) {
  const code = e && e.code ? e.code : (e && e.name) || 'ERROR'
  return `${code}: operation failed on '${clientRelativePath}'`
}

export function serializeEntity(e, toBase = null) {
  if (!isPlainObject(e)) throw new EditorSerializeError('bad-entity', 'entity must be an object')
  if (typeof e.id !== 'string' || e.id === '') throw new EditorSerializeError('bad-id', 'entity id must be a non-empty string')
  const rebase = Boolean(toBase) && !e.parent
  const out = { id: e.id }
  if (e.model) out.model = e.model
  const position = vec3(e.position, `entity ${e.id} position`)
  out.position = rebase ? vec3(toBase.point(position), `entity ${e.id} rebased position`) : position
  if (e.rotation !== undefined && e.rotation !== null) {
    let rotation = quatFrom(e.rotation, `entity ${e.id} rotation`)
    if (rebase) rotation = quatFrom(toBase.quat(rotation), `entity ${e.id} rebased rotation`)
    if (!isIdentityQuat(rotation)) out.rotation = rotation
  }
  if (e.scale) {
    const scale = vec3(e.scale, `entity ${e.id} scale`)
    if (!isUnitScale(scale)) out.scale = scale
  }
  if (e._appName) out.app = e._appName
  if (e.bodyType && e.bodyType !== 'static') out.bodyType = e.bodyType
  if (e._config) out.config = e._config
  if (e.custom) out.custom = e.custom
  if (e.parent) out.parent = e.parent
  return out
}

export function serializeWorld(appRuntime, sourceWorldDef, toBase = null) {
  if (!isPlainObject(appRuntime) || !(appRuntime.entities instanceof Map)) {
    throw new EditorSerializeError('bad-runtime', 'appRuntime.entities must be a Map')
  }
  if (sourceWorldDef !== undefined && sourceWorldDef !== null && !isPlainObject(sourceWorldDef)) {
    throw new EditorSerializeError('bad-source-def', 'sourceWorldDef must be an object when given')
  }
  const def = {}
  const src = sourceWorldDef || {}
  for (const k of WORLD_CONFIG_KEYS) if (src[k] !== undefined) def[k] = src[k]
  const entities = []
  for (const e of appRuntime.entities.values()) {
    if (!isPlainObject(e)) throw new EditorSerializeError('bad-entity', 'entity must be an object')
    const hasNoAuthoredState = !e._appName && !e.model && !e.custom && !e._config && !e.parent
    if (hasNoAuthoredState) continue
    entities.push(serializeEntity(e, toBase))
  }
  def.entities = entities
  return def
}

export function serializeWorldSource(def) {
  if (!isPlainObject(def)) throw new EditorSerializeError('not-object', 'world definition must be an object')
  return JSON.stringify(def, null, 2)
}

export function serializeWorldModule(def) {
  return WORLD_MODULE_PREFIX + serializeWorldSource(def) + WORLD_MODULE_SUFFIX
}

export function parseWorldModule(source) {
  if (typeof source !== 'string') throw new EditorSerializeError('not-string', 'world module source must be a string')
  if (!source.startsWith(WORLD_MODULE_PREFIX) || !source.endsWith(WORLD_MODULE_SUFFIX)) {
    throw new EditorSerializeError('bad-wrapper', `world module must start with "${WORLD_MODULE_PREFIX}" and end with a newline`)
  }
  let def
  try {
    def = JSON.parse(source.slice(WORLD_MODULE_PREFIX.length, -WORLD_MODULE_SUFFIX.length))
  } catch (error) {
    throw new EditorSerializeError('bad-json', error.message)
  }
  if (!isPlainObject(def)) throw new EditorSerializeError('not-object', 'world definition must be an object')
  if (!Array.isArray(def.entities)) throw new EditorSerializeError('bad-entities', 'entities must be an array')
  const seen = new Set()
  def.entities.forEach((record, index) => {
    if (!isPlainObject(record)) throw new EditorSerializeError('bad-entity', `entity ${index} must be an object`)
    if (typeof record.id !== 'string' || record.id === '') throw new EditorSerializeError('bad-id', `entity ${index} needs a non-empty string id`)
    if (seen.has(record.id)) throw new EditorSerializeError('duplicate-id', `entity id "${record.id}" appears twice`)
    seen.add(record.id)
    if (record.position !== undefined) vec3(record.position, `entity ${record.id} position`)
  })
  return def
}
