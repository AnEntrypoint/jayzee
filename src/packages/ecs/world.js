let nextEntityId = 1

export function createWorld() {
  const entityIds = new Set()
  const componentStores = new Map()
  const systems = []
  let destroyed = false
  let changeVersion = 0

  function assertAlive() {
    if (destroyed) throw new Error('World is destroyed')
  }

  function bumpVersion() {
    changeVersion++
  }

  function createEntity(id) {
    assertAlive()
    let entityId = id
    if (entityId === undefined) {
      entityId = nextEntityId++
    } else if (typeof entityId === 'number' && entityId >= nextEntityId) {
      nextEntityId = entityId + 1
    }
    entityIds.add(entityId)
    bumpVersion()
    return entityId
  }

  function destroyEntity(id) {
    entityIds.delete(id)
    for (const store of componentStores.values()) store.delete(id)
    bumpVersion()
  }

  function exists(id) {
    return entityIds.has(id)
  }

  function entities() {
    return [...entityIds]
  }

  function addComponent(id, name, data) {
    if (!entityIds.has(id)) throw new Error(`Entity ${id} does not exist`)
    if (!componentStores.has(name)) componentStores.set(name, new Map())
    componentStores.get(name).set(id, data)
    bumpVersion()
    return data
  }

  function removeComponent(id, name) {
    const store = componentStores.get(name)
    if (store) {
      store.delete(id)
      bumpVersion()
    }
  }

  function hasComponent(id, name) {
    const store = componentStores.get(name)
    return store ? store.has(id) : false
  }

  function getComponent(id, name) {
    const store = componentStores.get(name)
    return store ? store.get(id) : undefined
  }

  function componentNames() {
    return [...componentStores.keys()]
  }

  function entitiesWith(name) {
    const store = componentStores.get(name)
    return store ? [...store.keys()] : []
  }

  function addTag(id, name) {
    return addComponent(id, name, true)
  }

  function removeTag(id, name) {
    removeComponent(id, name)
  }

  function hasTag(id, name) {
    return hasComponent(id, name)
  }

  function entitiesWithTag(name) {
    return entitiesWith(name)
  }

  function createPrefab(spec, overrides) {
    assertAlive()
    const id = createEntity()
    if (spec.components) {
      for (const [name, data] of Object.entries(spec.components)) {
        const overridden = overrides && overrides[name] !== undefined
        addComponent(id, name, overridden ? { ...data, ...overrides[name] } : data)
      }
    }
    if (spec.tags) {
      for (const name of spec.tags) addTag(id, name)
    }
    const children = []
    if (spec.children) {
      for (const childSpec of spec.children) children.push(createPrefab(childSpec))
    }
    return { id, children }
  }

  function registerSystem(name, update, priority = 0) {
    const system = { name, update, priority }
    systems.push(system)
    systems.sort((a, b) => a.priority - b.priority)
    return function unregister() {
      const index = systems.indexOf(system)
      if (index >= 0) systems.splice(index, 1)
    }
  }

  function runSystems(dt) {
    if (destroyed) return
    for (const system of systems) system.update(world, dt)
  }

  function destroy() {
    destroyed = true
    entityIds.clear()
    componentStores.clear()
    systems.length = 0
    bumpVersion()
  }

  function snapshot() {
    const components = {}
    for (const [name, store] of componentStores) {
      components[name] = Object.fromEntries(store)
    }
    return { entities: [...entityIds], components }
  }

  function restore(snap) {
    entityIds.clear()
    componentStores.clear()
    systems.length = 0
    destroyed = false
    for (const id of snap.entities) {
      entityIds.add(id)
      if (typeof id === 'number' && id >= nextEntityId) nextEntityId = id + 1
    }
    for (const [name, store] of Object.entries(snap.components || {})) {
      componentStores.set(name, new Map(Object.entries(store).map(([key, value]) => [Number(key), value])))
    }
    bumpVersion()
  }

  const world = {
    createEntity,
    destroyEntity,
    exists,
    entities,
    addComponent,
    removeComponent,
    hasComponent,
    getComponent,
    componentNames,
    entitiesWith,
    addTag,
    removeTag,
    hasTag,
    entitiesWithTag,
    createPrefab,
    registerSystem,
    update: runSystems,
    destroy,
    snapshot,
    restore,
    get destroyed() { return destroyed },
    get entityCount() { return entityIds.size },
    get version() { return changeVersion },
  }
  return world
}
