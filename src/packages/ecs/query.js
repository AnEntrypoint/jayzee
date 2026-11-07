export function createQuery(world, spec = {}) {
  const requiredNames = spec.has || []
  const anyOfNames = spec.hasAny || []
  const excludedNames = spec.not || []
  let cachedIds = null
  let cachedVersion = -1

  function matches(id) {
    if (!requiredNames.every((name) => world.hasComponent(id, name))) return false
    if (excludedNames.some((name) => world.hasComponent(id, name))) return false
    if (anyOfNames.length > 0 && !anyOfNames.some((name) => world.hasComponent(id, name))) return false
    return true
  }

  function refresh() {
    cachedVersion = world.version
    cachedIds = world.entities().filter(matches)
    return cachedIds
  }

  function changed() {
    return cachedIds === null || world.version !== cachedVersion
  }

  function count() {
    if (cachedIds === null) refresh()
    return cachedIds.length
  }

  function get() {
    return cachedIds
  }

  function componentsOf(id) {
    const components = {}
    for (const name of requiredNames) components[name] = world.getComponent(id, name)
    for (const name of anyOfNames) {
      if (world.hasComponent(id, name)) components[name] = world.getComponent(id, name)
    }
    return components
  }

  const query = {
    refresh,
    changed,
    count,
    get,
    [Symbol.iterator]() {
      const ids = refresh()
      let position = 0
      return {
        next() {
          if (position < ids.length) return { value: ids[position++], done: false }
          return { done: true }
        },
      }
    },
    *entries() {
      for (const id of refresh()) yield { id, components: componentsOf(id) }
    },
    forEach(fn) {
      for (const id of refresh()) fn(id, world)
    },
  }
  return query
}
