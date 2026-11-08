import { vec3 } from '../netcode/vecGuard.js'

export const ENTITY_PARK_OFFSET = Object.freeze([0, -5000, 0])

export class EntityDestroyedError extends Error {
  constructor(id) {
    super('entity ' + id + ' was destroyed; its handle no longer reads or writes the body')
    this.name = 'EntityDestroyedError'
    this.code = 'ENTITY_DESTROYED'
    this.entityId = id
  }
}

const checkCustom = (value) => {
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) throw new TypeError('entity.custom must be null or a plain object')
  return value
}

export function createEntityHost(world, { park = ENTITY_PARK_OFFSET } = {}) {
  if (!world || typeof world.spawn !== 'function' || typeof world.position !== 'function' || typeof world.velocity !== 'function' || typeof world.setPosition !== 'function' || typeof world.setVelocity !== 'function') {
    throw new TypeError('createEntityHost needs a World with spawn, position, velocity, setPosition and setVelocity')
  }
  const records = []
  const handles = []

  const live = (id) => {
    const record = records[id]
    if (!record.alive) throw new EntityDestroyedError(id)
    return record
  }

  const bind = (id) => ({
    get id() { return id },
    get position() { live(id); return world.position(id) },
    set position(value) { live(id); world.setPosition(id, vec3(value, 'position')) },
    get velocity() { live(id); return world.velocity(id) },
    set velocity(value) { live(id); world.setVelocity(id, vec3(value, 'velocity')) },
    get custom() { return live(id).custom },
    set custom(value) { live(id).custom = checkCustom(value) },
    destroy() {
      const record = records[id]
      if (!record.alive) return
      record.alive = false
      world.setPosition(id, [...park])
      world.setVelocity(id, [0, 0, 0])
    },
  })

  function spawn({ position = [0, 0, 0], velocity = [0, 0, 0], custom = null } = {}) {
    const startPosition = vec3(position, 'position')
    const startVelocity = vec3(velocity, 'velocity')
    const startCustom = checkCustom(custom)
    const id = world.spawn(startPosition, startVelocity)
    records[id] = { alive: true, custom: startCustom }
    handles[id] = bind(id)
    return handles[id]
  }

  function entityById(id) {
    if (!Number.isInteger(id) || id < 0 || id >= records.length) throw new RangeError('no entity with id ' + id)
    live(id)
    return handles[id]
  }

  return { spawn, entityById }
}
