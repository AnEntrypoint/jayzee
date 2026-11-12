import { EntityDestroyedError } from './entityHost.js'

export const ENTITY_SLOT_LIMIT = 65536
export const ENTITY_GENERATION_LIMIT = 65536
export const ENTITY_TABLE_FULL = 'entity-table-full'

const isVec = (value, length) => (Array.isArray(value) || ArrayBuffer.isView(value)) && value.length === length && Number.isFinite(value[0]) && Number.isFinite(value[1]) && Number.isFinite(value[2]) && (length === 3 || Number.isFinite(value[3]))

const needVec = (value, length, name) => {
  if (!isVec(value, length)) throw new TypeError(name + ' must hold ' + length + ' finite numbers')
  return value
}

export const entitySlot = (id) => id % ENTITY_SLOT_LIMIT
export const entityGeneration = (id) => Math.floor(id / ENTITY_SLOT_LIMIT)

export function createEntityTable({ capacity, world = null } = {}) {
  if (!Number.isInteger(capacity) || capacity < 1 || capacity > ENTITY_SLOT_LIMIT) throw new RangeError('capacity must be a whole number from 1 to ' + ENTITY_SLOT_LIMIT)
  if (world !== null && (typeof world.position !== 'function' || typeof world.setPosition !== 'function' || typeof world.velocity !== 'function' || typeof world.setVelocity !== 'function')) {
    throw new TypeError('world must provide position, setPosition, velocity and setVelocity')
  }
  const position = new Float64Array(capacity * 3)
  const velocity = new Float64Array(capacity * 3)
  const rotation = new Float64Array(capacity * 4)
  const radius = new Float64Array(capacity)
  const generation = new Uint16Array(capacity)
  const alive = new Uint8Array(capacity)
  const tag = new Int32Array(capacity).fill(-1)
  const app = new Int32Array(capacity).fill(-1)
  const body = new Int32Array(capacity).fill(-1)
  const free = new Int32Array(capacity)
  const ids = new Float64Array(capacity).fill(-1)
  const custom = new Array(capacity).fill(null)
  const model = new Array(capacity).fill(null)
  const names = new Array(capacity).fill(null)
  const handles = new Array(capacity).fill(null)
  const byName = new Map()
  const tagIds = new Map()
  const tagNames = []
  const scratch = [0, 0, 0]
  let freeCount = capacity
  let liveCount = 0
  let colliderEpoch = 0
  for (let i = 0; i < capacity; i++) free[i] = capacity - 1 - i

  const internTag = (name) => {
    if (typeof name !== 'string' || name.length === 0) throw new TypeError('a tag must be a non-empty string')
    let id = tagIds.get(name)
    if (id === undefined) {
      id = tagNames.length
      tagNames.push(name)
      tagIds.set(name, id)
    }
    return id
  }

  const slotOf = (id) => {
    if (!Number.isInteger(id) || id < 0) return -1
    const slot = id % ENTITY_SLOT_LIMIT
    if (slot >= capacity || alive[slot] === 0 || ids[slot] !== id) return -1
    return slot
  }

  const liveSlot = (id) => {
    const slot = slotOf(id)
    if (slot < 0) throw new EntityDestroyedError(id)
    return slot
  }

  const syncBody = (slot) => {
    if (body[slot] < 0 || world === null) return
    world.position(body[slot], scratch)
    position[slot * 3] = scratch[0]
    position[slot * 3 + 1] = scratch[1]
    position[slot * 3 + 2] = scratch[2]
    world.velocity(body[slot], scratch)
    velocity[slot * 3] = scratch[0]
    velocity[slot * 3 + 1] = scratch[1]
    velocity[slot * 3 + 2] = scratch[2]
  }

  const read3 = (view, slot, out) => {
    out[0] = view[slot * 3]
    out[1] = view[slot * 3 + 1]
    out[2] = view[slot * 3 + 2]
    return out
  }

  const writePosition = (slot, value) => {
    needVec(value, 3, 'position')
    position[slot * 3] = value[0]
    position[slot * 3 + 1] = value[1]
    position[slot * 3 + 2] = value[2]
    if (body[slot] >= 0 && world !== null) world.setPosition(body[slot], read3(position, slot, scratch))
  }

  const writeVelocity = (slot, value) => {
    needVec(value, 3, 'velocity')
    velocity[slot * 3] = value[0]
    velocity[slot * 3 + 1] = value[1]
    velocity[slot * 3 + 2] = value[2]
    if (body[slot] >= 0 && world !== null) world.setVelocity(body[slot], read3(velocity, slot, scratch))
  }

  const bind = (id, slot) => ({
    get id() { return id },
    get alive() { return slotOf(id) === slot },
    get name() { liveSlot(id); return names[slot] },
    get model() { liveSlot(id); return model[slot] },
    get tag() { liveSlot(id); return tag[slot] < 0 ? null : tagNames[tag[slot]] },
    get body() { liveSlot(id); return body[slot] < 0 ? null : body[slot] },
    get radius() { liveSlot(id); return radius[slot] },
    set radius(value) {
      liveSlot(id)
      if (!(Number.isFinite(value) && value >= 0)) throw new RangeError('radius must be a finite number at or above zero')
      if ((radius[slot] > 0) !== (value > 0)) colliderEpoch += 1
      radius[slot] = value
    },
    get position() { liveSlot(id); syncBody(slot); return read3(position, slot, []) },
    set position(value) { liveSlot(id); writePosition(slot, value) },
    get velocity() { liveSlot(id); syncBody(slot); return read3(velocity, slot, []) },
    set velocity(value) { liveSlot(id); writeVelocity(slot, value) },
    get rotation() { liveSlot(id); return [rotation[slot * 4], rotation[slot * 4 + 1], rotation[slot * 4 + 2], rotation[slot * 4 + 3]] },
    set rotation(value) {
      liveSlot(id)
      needVec(value, 4, 'rotation')
      for (let a = 0; a < 4; a++) rotation[slot * 4 + a] = value[a]
    },
    get custom() { liveSlot(id); return custom[slot] },
    set custom(value) {
      liveSlot(id)
      if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new TypeError('entity.custom must be null or a plain object')
      custom[slot] = value
    },
    readPosition(out) { liveSlot(id); syncBody(slot); return read3(position, slot, out) },
    readVelocity(out) { liveSlot(id); syncBody(slot); return read3(velocity, slot, out) },
  })

  const spawn = (config = {}) => {
    if (config === null || typeof config !== 'object') throw new TypeError('spawn takes a config object')
    const { name = null, tag: tagName = null, app: appId = -1, body: bodyId = -1, model: modelRef = null, custom: startCustom = null } = config
    const startPosition = needVec(config.position ?? [0, 0, 0], 3, 'position')
    const startVelocity = needVec(config.velocity ?? [0, 0, 0], 3, 'velocity')
    const startRotation = needVec(config.rotation ?? [0, 0, 0, 1], 4, 'rotation')
    const startRadius = config.radius ?? 0
    if (!(Number.isFinite(startRadius) && startRadius >= 0)) throw new RangeError('radius must be a finite number at or above zero')
    if (!Number.isInteger(appId) || appId < -1) throw new RangeError('app must be an app index or -1')
    if (!Number.isInteger(bodyId) || bodyId < -1) throw new RangeError('body must be a body index or -1')
    if (bodyId >= 0 && world === null) throw new TypeError('a body index needs a world on the table')
    if (startCustom !== null && (typeof startCustom !== 'object' || Array.isArray(startCustom))) throw new TypeError('entity.custom must be null or a plain object')
    if (modelRef !== null && typeof modelRef !== 'string') throw new TypeError('model must be a string or null')
    if (name !== null) {
      if (typeof name !== 'string' || name.length === 0) throw new TypeError('name must be a non-empty string or null')
      if (byName.has(name)) throw new RangeError('an entity named ' + name + ' is already live')
    }
    const tagId = tagName === null ? -1 : internTag(tagName)
    if (freeCount === 0) {
      const error = new RangeError('the entity table is full: capacity ' + capacity)
      error.code = ENTITY_TABLE_FULL
      throw error
    }
    freeCount -= 1
    const slot = free[freeCount]
    const id = slot + generation[slot] * ENTITY_SLOT_LIMIT
    alive[slot] = 1
    ids[slot] = id
    tag[slot] = tagId
    app[slot] = appId
    body[slot] = bodyId
    radius[slot] = startRadius
    custom[slot] = startCustom
    model[slot] = modelRef
    names[slot] = name
    for (let a = 0; a < 3; a++) {
      position[slot * 3 + a] = startPosition[a]
      velocity[slot * 3 + a] = startVelocity[a]
    }
    for (let a = 0; a < 4; a++) rotation[slot * 4 + a] = startRotation[a]
    if (name !== null) byName.set(name, id)
    handles[slot] = bind(id, slot)
    liveCount += 1
    if (startRadius > 0) colliderEpoch += 1
    return id
  }

  const destroy = (id) => {
    const slot = slotOf(id)
    if (slot < 0) return false
    alive[slot] = 0
    ids[slot] = -1
    if (names[slot] !== null) byName.delete(names[slot])
    if (radius[slot] > 0) colliderEpoch += 1
    names[slot] = null
    custom[slot] = null
    model[slot] = null
    handles[slot] = null
    tag[slot] = -1
    app[slot] = -1
    body[slot] = -1
    radius[slot] = 0
    generation[slot] = (generation[slot] + 1) % ENTITY_GENERATION_LIMIT
    free[freeCount] = slot
    freeCount += 1
    liveCount -= 1
    return true
  }

  const resolve = (ref) => (typeof ref === 'string' ? (byName.has(ref) ? byName.get(ref) : -1) : ref)

  const getEntity = (ref) => {
    const slot = slotOf(resolve(ref))
    return slot < 0 ? null : handles[slot]
  }

  const query = (filter, out) => {
    if (!ArrayBuffer.isView(out) && !Array.isArray(out)) throw new TypeError('query writes ids into an out array')
    const wantTag = filter && filter.tag !== undefined ? (tagIds.has(filter.tag) ? tagIds.get(filter.tag) : -2) : -1
    const wantApp = filter && filter.app !== undefined ? filter.app : -1
    const center = filter && filter.center !== undefined ? needVec(filter.center, 3, 'center') : null
    const reach = center === null ? 0 : filter.reach
    if (center !== null && !(Number.isFinite(reach) && reach >= 0)) throw new RangeError('reach must be a finite number at or above zero')
    const limit = out.length
    let matched = 0
    if (wantTag === -2) return 0
    for (let slot = 0; slot < capacity; slot++) {
      if (alive[slot] === 0) continue
      if (wantTag >= 0 && tag[slot] !== wantTag) continue
      if (wantApp >= 0 && app[slot] !== wantApp) continue
      if (center !== null) {
        syncBody(slot)
        const dx = position[slot * 3] - center[0]
        const dy = position[slot * 3 + 1] - center[1]
        const dz = position[slot * 3 + 2] - center[2]
        const span = reach + radius[slot]
        if (dx * dx + dy * dy + dz * dz > span * span) continue
      }
      if (matched < limit) out[matched] = ids[slot]
      matched += 1
    }
    return matched
  }

  return {
    capacity,
    spawn,
    destroy,
    getEntity,
    query,
    slotOf,
    has: (ref) => slotOf(resolve(ref)) >= 0,
    idOf: (slot) => (alive[slot] === 1 ? ids[slot] : -1),
    idByName: (name) => (byName.has(name) ? byName.get(name) : -1),
    syncBody,
    get count() { return liveCount },
    get colliderEpoch() { return colliderEpoch },
    views: { position, velocity, rotation, radius, alive, tag, app, body, generation, ids },
  }
}
