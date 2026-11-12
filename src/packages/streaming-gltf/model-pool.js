export const PROGRESSIVE_LOD_KEY = 'EP_progressive_lod'

export const MODEL_POOL_REFUSAL = Object.freeze({
  SCHEMA: 'progressive-lod-schema',
  MESH_INDEX: 'progressive-lod-mesh-index',
  LOD_ADDRESS: 'progressive-lod-address',
  PATH: 'progressive-lod-path',
  CONTAINER: 'model-container',
  FULL: 'model-pool-full',
  OPTION: 'model-pool-option',
  NOT_HELD: 'model-pool-not-held',
})

export class ModelPoolError extends Error {
  constructor(code, message) {
    super(code + ': ' + message)
    this.name = 'ModelPoolError'
    this.code = code
  }
}

const refuse = (code, message) => {
  throw new ModelPoolError(code, message)
}

const GLB_MAGIC = 0x46546c67
const GLB_HEADER_BYTES = 12
const CHUNK_HEADER_BYTES = 8
const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function readModelContainer(bytes) {
  if (!(bytes instanceof Uint8Array)) refuse(MODEL_POOL_REFUSAL.CONTAINER, 'a model must arrive as a Uint8Array')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length >= GLB_HEADER_BYTES + CHUNK_HEADER_BYTES && view.getUint32(0, true) === GLB_MAGIC) {
    const jsonLength = view.getUint32(GLB_HEADER_BYTES, true)
    const jsonStart = GLB_HEADER_BYTES + CHUNK_HEADER_BYTES
    if (jsonStart + jsonLength > bytes.length) refuse(MODEL_POOL_REFUSAL.CONTAINER, 'the GLB JSON chunk runs past the end of the file')
    const json = JSON.parse(new TextDecoder().decode(bytes.subarray(jsonStart, jsonStart + jsonLength)))
    return { json, binOffset: jsonStart + jsonLength + CHUNK_HEADER_BYTES, glb: true }
  }
  let json
  try {
    json = JSON.parse(new TextDecoder().decode(bytes))
  } catch (error) {
    refuse(MODEL_POOL_REFUSAL.CONTAINER, 'the model is neither a GLB nor glTF JSON: ' + error.message)
  }
  return { json, binOffset: 0, glb: false }
}

export function resolveSiblingUrl(rootUrl, path) {
  if (typeof path !== 'string' || path.length === 0) refuse(MODEL_POOL_REFUSAL.PATH, 'a sibling LOD path must be a non-empty string')
  if (SCHEME.test(path) || path.startsWith('/') || path.includes('\\')) refuse(MODEL_POOL_REFUSAL.PATH, 'sibling LOD path ' + JSON.stringify(path) + ' must be relative to the root asset')
  const segments = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') refuse(MODEL_POOL_REFUSAL.PATH, 'sibling LOD path ' + JSON.stringify(path) + ' climbs out of the root asset directory')
    segments.push(segment)
  }
  if (segments.length === 0) refuse(MODEL_POOL_REFUSAL.PATH, 'sibling LOD path ' + JSON.stringify(path) + ' names no file')
  const query = rootUrl.search(/[?#]/)
  const plain = query === -1 ? rootUrl : rootUrl.slice(0, query)
  return plain.slice(0, plain.lastIndexOf('/') + 1) + segments.join('/')
}

export function readProgressiveLod(json, validator) {
  if (json === null || typeof json !== 'object') refuse(MODEL_POOL_REFUSAL.SCHEMA, 'the glTF JSON is not an object')
  if (typeof validator?.validate !== 'function') refuse(MODEL_POOL_REFUSAL.OPTION, 'readProgressiveLod needs the EP_progressive_lod schema validator')
  const fromExtension = json.extensions?.[PROGRESSIVE_LOD_KEY]
  const raw = fromExtension ?? json.extras?.[PROGRESSIVE_LOD_KEY]
  if (raw === undefined || raw === null) return null
  const checked = validator.validate(raw)
  if (!checked.ok) refuse(MODEL_POOL_REFUSAL.SCHEMA, checked.errors.join('; '))
  const ranged = raw.storage === 'single-glb-range'
  const viewCount = Array.isArray(json.bufferViews) ? json.bufferViews.length : 0
  const addressed = (lod, where) => {
    if (ranged) {
      if (!Number.isInteger(lod.bufferView) || lod.bufferView >= viewCount) refuse(MODEL_POOL_REFUSAL.LOD_ADDRESS, where + ' names bufferView ' + String(lod.bufferView) + ' of ' + viewCount)
      return
    }
    if (lod.inline === true) return
    if (typeof lod.path !== 'string' || lod.path.length === 0) refuse(MODEL_POOL_REFUSAL.LOD_ADDRESS, where + ' is neither inline nor a sibling path')
    resolveSiblingUrl('root', lod.path)
  }
  const seen = new Set()
  const meshes = raw.meshes.map((mesh, m) => {
    const primitives = json.meshes?.[mesh.meshIndex]?.primitives
    if (!Array.isArray(primitives) || mesh.primIndex >= primitives.length) refuse(MODEL_POOL_REFUSAL.MESH_INDEX, 'meshes[' + m + '] names mesh ' + mesh.meshIndex + ' primitive ' + mesh.primIndex + ', which the file does not hold')
    const key = mesh.meshIndex + ':' + mesh.primIndex
    if (seen.has(key)) refuse(MODEL_POOL_REFUSAL.MESH_INDEX, 'meshes[' + m + '] repeats mesh ' + mesh.meshIndex + ' primitive ' + mesh.primIndex)
    seen.add(key)
    mesh.lods.forEach((lod, l) => addressed(lod, 'meshes[' + m + '].lods[' + l + ']'))
    const lods = mesh.lods.map((lod, order) => ({ ...lod, order })).sort((a, b) => a.ratio - b.ratio || a.order - b.order)
    return { meshIndex: mesh.meshIndex, primIndex: mesh.primIndex, lods }
  })
  const textureCount = Array.isArray(json.textures) ? json.textures.length : 0
  const textures = (raw.textures || []).map((texture, t) => {
    if (texture.textureIndex >= textureCount) refuse(MODEL_POOL_REFUSAL.MESH_INDEX, 'textures[' + t + '] names texture ' + texture.textureIndex + ' of ' + textureCount)
    texture.lods.forEach((lod, l) => addressed(lod, 'textures[' + t + '].lods[' + l + ']'))
    const lods = texture.lods.map((lod, order) => ({ ...lod, order })).sort((a, b) => a.width - b.width || a.order - b.order)
    return { textureIndex: texture.textureIndex, name: texture.name ?? null, lods }
  })
  return { version: raw.version, storage: raw.storage, source: fromExtension != null ? 'extension' : 'extras', meshes, textures }
}

export function planLodLoads(record, { rootUrl, json, binOffset = 0 }) {
  if (typeof rootUrl !== 'string' || rootUrl.length === 0) refuse(MODEL_POOL_REFUSAL.OPTION, 'planLodLoads needs the root asset url')
  const ranged = record.storage === 'single-glb-range'
  const steps = []
  const address = (lod) => {
    if (ranged) {
      const view = json.bufferViews[lod.bufferView]
      const start = binOffset + (view.byteOffset || 0)
      return { inline: false, url: rootUrl, range: [start, start + view.byteLength], bytes: view.byteLength }
    }
    if (lod.inline === true) return { inline: true, url: null, range: null, bytes: lod.bytes ?? 0 }
    return { inline: false, url: resolveSiblingUrl(rootUrl, lod.path), range: null, bytes: lod.bytes ?? 0 }
  }
  for (const mesh of record.meshes) {
    mesh.lods.forEach((lod, level) => steps.push({ kind: 'mesh', meshIndex: mesh.meshIndex, primIndex: mesh.primIndex, level, ratio: lod.ratio, ...address(lod) }))
  }
  for (const texture of record.textures) {
    texture.lods.forEach((lod, level) => steps.push({ kind: 'texture', textureIndex: texture.textureIndex, level, width: lod.width, ...address(lod) }))
  }
  steps.forEach((step, order) => { step.order = order })
  steps.sort((a, b) => a.level - b.level || a.bytes - b.bytes || a.order - b.order)
  const levels = steps.length ? steps[steps.length - 1].level + 1 : 0
  return { steps, levels, fetches: steps.filter((step) => !step.inline).length }
}

export function createModelPool({ fetchBytes, validator, capacity = 16, onEvict = null }) {
  if (typeof fetchBytes !== 'function') refuse(MODEL_POOL_REFUSAL.OPTION, 'the pool needs an injected fetchBytes(url, range) returning a promise of a Uint8Array')
  if (typeof validator?.validate !== 'function') refuse(MODEL_POOL_REFUSAL.OPTION, 'the pool needs the EP_progressive_lod schema validator')
  if (!Number.isInteger(capacity) || capacity < 1) refuse(MODEL_POOL_REFUSAL.OPTION, 'capacity must be an integer of at least 1, got ' + String(capacity))
  if (onEvict !== null && typeof onEvict !== 'function') refuse(MODEL_POOL_REFUSAL.OPTION, 'onEvict must be a function or null')

  const entries = new Map()
  const stats = { hits: 0, misses: 0, evictions: 0, fetches: 0, bytesFetched: 0, failures: 0, refusedFull: 0 }
  let useSeq = 0

  function evictOne() {
    let victim = null
    for (const entry of entries.values()) {
      if (entry.refs > 0 || entry.model === null) continue
      if (victim === null || entry.lastUse < victim.lastUse) victim = entry
    }
    if (victim === null) return false
    entries.delete(victim.url)
    victim.evicted = true
    stats.evictions++
    if (onEvict) onEvict(victim.model)
    return true
  }

  async function fetchCounted(url, range) {
    stats.fetches++
    const bytes = await fetchBytes(url, range)
    if (!(bytes instanceof Uint8Array)) refuse(MODEL_POOL_REFUSAL.CONTAINER, 'fetchBytes for ' + url + ' did not return a Uint8Array')
    stats.bytesFetched += bytes.length
    return bytes
  }

  async function loadRoot(entry) {
    const bytes = await fetchCounted(entry.url, null)
    const container = readModelContainer(bytes)
    const record = readProgressiveLod(container.json, validator)
    const plan = record ? planLodLoads(record, { rootUrl: entry.url, json: container.json, binOffset: container.binOffset }) : { steps: [], levels: 0, fetches: 0 }
    const loaded = []
    let level = -1
    while (level + 1 < plan.levels) {
      const steps = plan.steps.filter((step) => step.level === level + 1)
      if (!steps.every((step) => step.inline)) break
      for (const step of steps) loaded.push({ ...step, data: null })
      level++
    }
    entry.model = { url: entry.url, bytes, json: container.json, binOffset: container.binOffset, record, plan, level, levels: plan.levels, loaded }
    return entry.model
  }

  function acquire(url) {
    if (typeof url !== 'string' || url.length === 0) return Promise.reject(new ModelPoolError(MODEL_POOL_REFUSAL.OPTION, 'acquire needs a url'))
    let entry = entries.get(url)
    if (entry) {
      stats.hits++
      entry.refs++
      entry.lastUse = ++useSeq
      return entry.ready
    }
    if (entries.size >= capacity && !evictOne()) {
      stats.refusedFull++
      return Promise.reject(new ModelPoolError(MODEL_POOL_REFUSAL.FULL, 'all ' + capacity + ' slots hold a model that is still in use'))
    }
    stats.misses++
    entry = { url, refs: 1, lastUse: ++useSeq, model: null, evicted: false, ready: null, refining: Promise.resolve() }
    entries.set(url, entry)
    entry.ready = loadRoot(entry).catch((error) => {
      stats.failures++
      if (entries.get(url) === entry) entries.delete(url)
      throw error
    })
    return entry.ready
  }

  function release(url) {
    const entry = entries.get(url)
    if (!entry || entry.refs === 0) refuse(MODEL_POOL_REFUSAL.NOT_HELD, 'release of ' + String(url) + ', which no caller holds')
    entry.refs--
    entry.lastUse = ++useSeq
    return entry.refs
  }

  function refine(url) {
    const entry = entries.get(url)
    if (!entry || entry.refs === 0) return Promise.reject(new ModelPoolError(MODEL_POOL_REFUSAL.NOT_HELD, 'refine of ' + String(url) + ', which no caller holds'))
    const run = async () => {
      const model = await entry.ready
      if (entry.evicted || model.level + 1 >= model.levels) return null
      const level = model.level + 1
      const steps = model.plan.steps.filter((step) => step.level === level)
      const loaded = []
      for (const step of steps) {
        const data = step.inline ? null : await fetchCounted(step.url, step.range)
        loaded.push({ ...step, data })
      }
      if (entry.evicted) return null
      model.level = level
      for (const each of loaded) model.loaded.push(each)
      return { level, steps: loaded, complete: level + 1 >= model.levels }
    }
    const next = entry.refining.then(run, run)
    entry.refining = next.catch(() => {})
    return next
  }

  return {
    capacity,
    acquire,
    release,
    refine,
    has(url) { return entries.has(url) },
    refsOf(url) { return entries.get(url)?.refs ?? 0 },
    get size() { return entries.size },
    getStats() { return { ...stats } },
  }
}
