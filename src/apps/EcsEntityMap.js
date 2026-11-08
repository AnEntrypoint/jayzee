import { createWorld } from '../packages/ecs/world.js'

const ENTITY_COMPONENT = '_entity'

export function createEcsEntityMap() {
  const world = createWorld()

  const map = {
    set(key, value) {
      if (key === undefined) throw new TypeError('EcsEntityMap key must not be undefined')
      if (!world.exists(key)) world.createEntity(key)
      world.addComponent(key, ENTITY_COMPONENT, value)
      return map
    },

    get(key) {
      return world.getComponent(key, ENTITY_COMPONENT)
    },

    has(key) {
      return world.hasComponent(key, ENTITY_COMPONENT)
    },

    delete(key) {
      if (!world.exists(key)) return false
      world.destroyEntity(key)
      return true
    },

    clear() {
      for (const id of world.entities()) world.destroyEntity(id)
    },

    get size() {
      return world.entityCount
    },

    [Symbol.iterator]() {
      return map.entries()
    },

    keys() {
      return world.entities()[Symbol.iterator]()
    },

    values() {
      const ids = world.entities()
      let index = 0
      return {
        next() {
          if (index >= ids.length) return { done: true }
          return { value: world.getComponent(ids[index++], ENTITY_COMPONENT), done: false }
        },
        [Symbol.iterator]() { return this },
      }
    },

    entries() {
      const ids = world.entities()
      let index = 0
      return {
        next() {
          if (index >= ids.length) return { done: true }
          const key = ids[index++]
          return { value: [key, world.getComponent(key, ENTITY_COMPONENT)], done: false }
        },
        [Symbol.iterator]() { return this },
      }
    },

    forEach(callback, thisArg) {
      for (const [key, value] of map) callback.call(thisArg, value, key, map)
    },

    get _ecs() {
      return world
    },
  }

  return map
}
