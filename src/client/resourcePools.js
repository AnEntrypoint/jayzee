import { MATERIAL_ALBEDO_WORD, MATERIAL_FIELD_WORDS, MATERIAL_WORDS, TABLE_STATUS, TEXTURE_FORMAT } from '../engine/materials.js'

const MAX_SLOTS = 65535
const SLOT_SPAN = 65536
const LAST_GENERATION = 65534
const RETIRED_GENERATION = 65535
const LIGHT_KEYS = ['x', 'y', 'z', 'radius', 'r', 'g', 'b', 'intensity']
const LIGHT_FIELDS = LIGHT_KEYS.length

const whole = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(name + ' must be a whole number between ' + min + ' and ' + max + ', got ' + String(value))
  }
  return value
}

const finite = (value, name) => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(name + ' must be a finite number, got ' + String(value))
  return value
}

export const createSlotPool = (capacity, name = 'pool') => {
  whole(capacity, name + ' capacity', 1, MAX_SLOTS)
  const generations = new Uint16Array(capacity).fill(1)
  const freeStack = new Uint16Array(capacity)
  const live = new Uint8Array(capacity)
  for (let i = 0; i < capacity; i++) freeStack[i] = capacity - 1 - i
  let freeCount = capacity
  let retired = 0

  const resolve = (handle) => {
    if (!Number.isInteger(handle) || handle < 0) return -1
    const slot = handle % SLOT_SPAN
    const generation = (handle - slot) / SLOT_SPAN
    if (slot >= capacity || live[slot] !== 1 || generations[slot] !== generation) return -1
    return slot
  }

  return {
    capacity,
    name,
    count: () => capacity - freeCount - retired,
    retired: () => retired,
    acquire() {
      if (freeCount === 0) return -1
      freeCount -= 1
      const slot = freeStack[freeCount]
      live[slot] = 1
      return generations[slot] * SLOT_SPAN + slot
    },
    resolve,
    release(handle) {
      const slot = resolve(handle)
      if (slot < 0) return false
      live[slot] = 0
      if (generations[slot] === LAST_GENERATION) {
        generations[slot] = RETIRED_GENERATION
        retired += 1
        return true
      }
      generations[slot] += 1
      freeStack[freeCount] = slot
      freeCount += 1
      return true
    }
  }
}

export const createLightPool = (capacity) => {
  const slots = createSlotPool(capacity, 'lights')
  const data = new Float32Array(capacity * LIGHT_FIELDS)

  const check = (light) => {
    if (light === null || typeof light !== 'object') throw new TypeError('light must be an object')
    for (const key of LIGHT_KEYS) finite(light[key], 'light.' + key)
    if (!(light.radius > 0)) throw new RangeError('light.radius must be above zero, got ' + light.radius)
  }
  const store = (slot, light) => {
    for (let k = 0; k < LIGHT_FIELDS; k++) data[slot * LIGHT_FIELDS + k] = light[LIGHT_KEYS[k]]
  }
  const requireSlot = (handle) => {
    const slot = slots.resolve(handle)
    if (slot < 0) throw new RangeError('stale or unknown light handle ' + String(handle))
    return slot
  }

  return {
    capacity,
    data,
    count: slots.count,
    add(light) {
      check(light)
      const handle = slots.acquire()
      if (handle < 0) return -1
      store(handle % SLOT_SPAN, light)
      return handle
    },
    set(handle, light) {
      check(light)
      store(requireSlot(handle), light)
    },
    read(handle, out) {
      const slot = requireSlot(handle)
      if (out.length < LIGHT_FIELDS) throw new RangeError('read needs an output of ' + LIGHT_FIELDS + ' values')
      for (let k = 0; k < LIGHT_FIELDS; k++) out[k] = data[slot * LIGHT_FIELDS + k]
      return out
    },
    isLive: (handle) => slots.resolve(handle) >= 0,
    remove(handle) {
      const slot = slots.resolve(handle)
      if (slot < 0) return false
      data.fill(0, slot * LIGHT_FIELDS, (slot + 1) * LIGHT_FIELDS)
      return slots.release(handle)
    }
  }
}

export const createTexturePool = ({ layers, width, height, host = null, pixels = null }) => {
  whole(width, 'texture width', 1, 16384)
  whole(height, 'texture height', 1, 16384)
  whole(layers, 'texture layers', 1, MAX_SLOTS)
  if (host === null || typeof host !== 'object') throw new TypeError('createTexturePool needs a host, the wasm texture table from createTextures')
  if (!(pixels instanceof Uint8Array)) throw new TypeError('createTexturePool needs pixels, a Uint8Array over the texture layers')
  if (host.capacity !== layers) throw new RangeError('texture layers ' + layers + ' must match the wasm table capacity ' + host.capacity)
  const layerBytes = width * height * 4
  if (pixels.length !== layers * layerBytes) throw new RangeError('texture pixels hold ' + pixels.length + ' bytes, ' + layers + ' layers hold ' + layers * layerBytes)

  const check = (bytes) => {
    if (!(bytes instanceof Uint8Array)) throw new TypeError('pixels must be a Uint8Array')
    if (bytes.length !== layerBytes) throw new RangeError('pixels hold ' + bytes.length + ' bytes, a layer holds ' + layerBytes)
  }
  const layerStart = (handle) => {
    const layer = host.layer(handle)
    if (layer < 0) throw new RangeError('stale or unknown texture handle ' + String(handle))
    return layer * layerBytes
  }

  return {
    layers,
    data: pixels,
    count: () => host.liveCount(),
    layerOffset: layerStart,
    isLive: (handle) => host.isLive(handle),
    add(bytes) {
      check(bytes)
      const handle = host.add(width, height, TEXTURE_FORMAT.RGBA8_UNORM)
      if (handle === TABLE_STATUS.FULL) return -1
      if (handle < 0) throw new RangeError('texture add was refused by the wasm table with status ' + String(handle))
      pixels.set(bytes, layerStart(handle))
      return handle
    },
    replace(handle, bytes) {
      check(bytes)
      pixels.set(bytes, layerStart(handle))
    },
    remove(handle) {
      const layer = host.layer(handle)
      if (layer < 0) return false
      pixels.fill(0, layer * layerBytes, (layer + 1) * layerBytes)
      return host.remove(handle) === TABLE_STATUS.OK
    }
  }
}

export const createMeshPool = ({ slots: capacity, vertexCapacity, indexCapacity, stride }) => {
  whole(stride, 'vertex stride', 1, 64)
  whole(vertexCapacity, 'vertex capacity per mesh', 1, 65536)
  whole(indexCapacity, 'index capacity per mesh', 1, 65536)
  const slots = createSlotPool(capacity, 'meshes')
  const vertices = new Float32Array(capacity * vertexCapacity * stride)
  const indices = new Uint32Array(capacity * indexCapacity)
  const vertexCounts = new Uint32Array(capacity)
  const indexCounts = new Uint32Array(capacity)

  const check = (mesh) => {
    if (mesh === null || typeof mesh !== 'object') throw new TypeError('mesh must be an object')
    if (!(mesh.vertices instanceof Float32Array)) throw new TypeError('mesh.vertices must be a Float32Array')
    if (!(mesh.indices instanceof Uint32Array)) throw new TypeError('mesh.indices must be a Uint32Array')
    if (mesh.vertices.length === 0 || mesh.vertices.length % stride !== 0) throw new RangeError('mesh.vertices must hold a whole number of vertices of stride ' + stride)
    const count = mesh.vertices.length / stride
    if (count > vertexCapacity) throw new RangeError('mesh has ' + count + ' vertices, a slot holds ' + vertexCapacity)
    if (mesh.indices.length > indexCapacity) throw new RangeError('mesh has ' + mesh.indices.length + ' indices, a slot holds ' + indexCapacity)
    for (const index of mesh.indices) {
      if (index >= count) throw new RangeError('mesh index ' + index + ' is outside its ' + count + ' vertices')
    }
  }
  const requireSlot = (handle) => {
    const slot = slots.resolve(handle)
    if (slot < 0) throw new RangeError('stale or unknown mesh handle ' + String(handle))
    return slot
  }

  return {
    slots: capacity,
    vertices,
    indices,
    count: slots.count,
    add(mesh) {
      check(mesh)
      const handle = slots.acquire()
      if (handle < 0) return -1
      const slot = handle % SLOT_SPAN
      vertices.set(mesh.vertices, slot * vertexCapacity * stride)
      indices.set(mesh.indices, slot * indexCapacity)
      vertexCounts[slot] = mesh.vertices.length / stride
      indexCounts[slot] = mesh.indices.length
      return handle
    },
    rangeInto(handle, out) {
      const slot = requireSlot(handle)
      out[0] = slot * vertexCapacity
      out[1] = vertexCounts[slot]
      out[2] = slot * indexCapacity
      out[3] = indexCounts[slot]
      return out
    },
    remove(handle) {
      const slot = slots.resolve(handle)
      if (slot < 0) return false
      vertices.fill(0, slot * vertexCapacity * stride, (slot + 1) * vertexCapacity * stride)
      indices.fill(0, slot * indexCapacity, (slot + 1) * indexCapacity)
      vertexCounts[slot] = 0
      indexCounts[slot] = 0
      return slots.release(handle)
    }
  }
}

export const createMaterialPool = ({ capacity, host = null, textures = null }) => {
  if (host === null || typeof host !== 'object') throw new TypeError('createMaterialPool needs a host, the wasm material table from createMaterials')
  if (host.capacity !== capacity) throw new RangeError('material capacity ' + capacity + ' must match the wasm table capacity ' + host.capacity)
  const { data, words } = host

  const refuse = (status, what) => {
    if (status === TABLE_STATUS.FULL) return -1
    throw new RangeError(what + ' was refused by the wasm material table with status ' + String(status))
  }
  const requireObject = (material) => {
    if (material === null || typeof material !== 'object') throw new TypeError('material must be an object')
  }
  const slotOf = (handle) => {
    const slot = host.slot(handle)
    if (slot < 0) throw new RangeError('stale or unknown material handle ' + String(handle))
    return slot
  }

  return {
    capacity,
    data,
    words,
    count: () => host.liveCount(),
    add(material) {
      requireObject(material)
      const handle = host.add(material.r, material.g, material.b, material.a, material.roughness, material.metallic, material.emissiveR, material.emissiveG, material.emissiveB, material.albedo ?? 0)
      return handle >= 0 ? handle : refuse(handle, 'material add')
    },
    set(handle, material) {
      requireObject(material)
      const status = host.set(handle, material.r, material.g, material.b, material.a, material.roughness, material.metallic, material.emissiveR, material.emissiveG, material.emissiveB, material.albedo ?? 0)
      if (status !== TABLE_STATUS.OK) refuse(status, 'material set')
    },
    read(handle, out) {
      const base = slotOf(handle) * MATERIAL_WORDS
      if (out.length < MATERIAL_FIELD_WORDS) throw new RangeError('read needs an output of ' + MATERIAL_FIELD_WORDS + ' values')
      for (let k = 0; k < MATERIAL_FIELD_WORDS; k++) out[k] = data[base + k]
      return words[base + MATERIAL_ALBEDO_WORD]
    },
    albedoOffset(handle) {
      const texture = words[slotOf(handle) * MATERIAL_WORDS + MATERIAL_ALBEDO_WORD]
      if (texture === 0 || textures === null || !textures.isLive(texture)) return -1
      return textures.layerOffset(texture)
    },
    isLive: (handle) => host.isLive(handle),
    remove(handle) {
      return host.remove(handle) === TABLE_STATUS.OK
    }
  }
}

export const createPipelineRegistry = () => {
  const pending = new Map()
  const compiled = new Map()
  let compiles = 0
  let sealed = false

  return {
    register(key, compile) {
      if (sealed) throw new RangeError('pipeline ' + String(key) + ' was registered after seal; register every pipeline during loading')
      if (typeof key !== 'string' || key.length === 0) throw new TypeError('pipeline key must be a non-empty string')
      if (typeof compile !== 'function') throw new TypeError('pipeline ' + key + ' needs a compile function')
      if (pending.has(key)) throw new RangeError('pipeline ' + key + ' is registered twice')
      pending.set(key, compile)
    },
    seal() {
      if (sealed) return compiles
      for (const [key, compile] of pending) {
        compiled.set(key, compile())
        compiles += 1
      }
      sealed = true
      return compiles
    },
    get(key) {
      if (!sealed) throw new RangeError('seal the registry before asking for pipeline ' + String(key))
      if (!compiled.has(key)) throw new RangeError('pipeline ' + String(key) + ' was not registered before seal')
      return compiled.get(key)
    },
    compileCount: () => compiles,
    isSealed: () => sealed
  }
}
