const DEFAULT_ROTATION = [0, 0, 0, 1]

function requireFunction(value, name) {
  if (typeof value !== 'function') throw new TypeError(`PrefabSpawner requires ${name} as a function`)
  return value
}

function isVec(value, length) {
  return Array.isArray(value) && value.length === length
}

function requireOverrides(overrides, where) {
  if (overrides === null || typeof overrides !== 'object') throw new Error(`${where}: overrides must be an object`)
}

export class PrefabSpawner {
  constructor(appRuntime, prefabLibrary, { now, random } = {}) {
    if (!appRuntime) throw new Error('PrefabSpawner requires appRuntime')
    this.appRuntime = appRuntime
    this.prefabLibrary = prefabLibrary || null
    this.now = requireFunction(now, 'now (a clock returning milliseconds)')
    this.random = requireFunction(random, 'random (a source returning numbers in [0, 1))')
    this._spawnedRoots = new Map()
  }

  async spawnPrefab(prefabName, position, rotation, overrides = {}) {
    const startMs = this.now()

    if (!prefabName || typeof prefabName !== 'string') {
      throw new Error('spawnPrefab: prefabName required (string)')
    }
    if (!isVec(position, 3)) {
      throw new Error('spawnPrefab: position must be [x,y,z]')
    }
    if (!isVec(rotation, 4)) {
      throw new Error('spawnPrefab: rotation must be [x,y,z,w]')
    }
    requireOverrides(overrides, 'spawnPrefab')

    if (!this.prefabLibrary) {
      throw new Error('spawnPrefab: prefabLibrary not configured')
    }
    const prefab = await this.prefabLibrary.load(prefabName)
    if (!prefab || !Array.isArray(prefab.entities) || prefab.entities.length === 0) {
      throw new Error(`spawnPrefab: prefab "${prefabName}" invalid or empty`)
    }

    const prefabRootId = prefab.rootId || prefab.entities[0].id
    if (!prefab.entities.some(entity => entity.id === prefabRootId)) {
      throw new Error(`spawnPrefab: prefab "${prefabName}" root "${prefabRootId}" is not one of its entities`)
    }
    for (const entity of prefab.entities) {
      if (entity.parent && !prefab.entities.some(other => other.id === entity.parent)) {
        throw new Error(`spawnPrefab: prefab "${prefabName}" entity "${entity.id}" names a parent that is not in the prefab`)
      }
    }

    const sortedEntities = this._topologicalSort(prefab.entities, prefabRootId)

    const idMap = new Map()
    for (const entity of sortedEntities) {
      idMap.set(entity.id, this._generateEntityId(entity.app, entity.model))
    }

    const spawnedIds = []
    for (const entity of sortedEntities) {
      const newId = idMap.get(entity.id)
      const newParentId = entity.parent ? idMap.get(entity.parent) : null
      this.appRuntime.spawnEntity(newId, this._buildSpawnConfig(entity, newParentId, overrides))
      spawnedIds.push(newId)
    }

    const newRootId = idMap.get(prefabRootId)
    this._spawnedRoots.set(newRootId, new Set(spawnedIds))

    const rootEntity = this.appRuntime.entities.get(newRootId)
    if (rootEntity) {
      rootEntity.position = [...position]
      rootEntity.rotation = [...rotation]
    }

    this.appRuntime._log('prefab_spawn', {
      prefabName,
      rootId: newRootId,
      count: spawnedIds.length,
      elapsedMs: this.now() - startMs,
    }, { sourceEntity: newRootId })

    return newRootId
  }

  async spawnMultiple(prefabName, positions, rotationOrCallback, overrides = {}) {
    const startMs = this.now()

    if (!Array.isArray(positions) || positions.length === 0) {
      throw new Error('spawnMultiple: positions must be non-empty array of [x,y,z]')
    }

    const isRotationCallback = typeof rotationOrCallback === 'function'
    const defaultRotation = isRotationCallback ? null : rotationOrCallback ?? DEFAULT_ROTATION
    if (!isRotationCallback && !isVec(defaultRotation, 4)) {
      throw new Error('spawnMultiple: rotation must be [x,y,z,w] or a function')
    }
    requireOverrides(overrides, 'spawnMultiple')

    const placements = positions.map((pos, i) => {
      const rot = isRotationCallback ? rotationOrCallback(i, pos) : defaultRotation
      if (!isVec(pos, 3)) {
        throw new Error(`spawnMultiple: position[${i}] must be [x,y,z]`)
      }
      if (!isVec(rot, 4)) {
        throw new Error(`spawnMultiple: rotation[${i}] must be [x,y,z,w]`)
      }
      return { pos, rot }
    })

    const rootIds = []
    for (const { pos, rot } of placements) {
      rootIds.push(await this.spawnPrefab(prefabName, pos, rot, overrides))
    }

    this.appRuntime._log('prefab_spawn_multiple', {
      prefabName,
      count: positions.length,
      elapsedMs: this.now() - startMs,
    })

    return rootIds
  }

  getSpawnedPrefabInstances(rootId) {
    return this._spawnedRoots.get(rootId) || new Set()
  }

  async updatePrefabInstance(rootId, overrides = {}, cascadeToVariants = false) {
    const spawnedIds = this._spawnedRoots.get(rootId)
    if (!spawnedIds) {
      throw new Error(`updatePrefabInstance: unknown root entity ID "${rootId}"`)
    }
    requireOverrides(overrides, 'updatePrefabInstance')

    let updateCount = 0
    for (const entityId of Object.keys(overrides)) {
      if (!spawnedIds.has(entityId)) continue

      const entity = this.appRuntime.entities.get(entityId)
      if (!entity) continue

      const props = overrides[entityId]
      if (!props || typeof props !== 'object') continue

      if (isVec(props.position, 3)) {
        entity.position = [...props.position]
      }
      if (isVec(props.rotation, 4)) {
        entity.rotation = [...props.rotation]
      }
      if (isVec(props.scale, 3)) {
        entity.scale = [...props.scale]
      }
      if (props.custom && typeof props.custom === 'object') {
        entity.custom = { ...(entity.custom || {}), ...props.custom }
      }

      updateCount++
    }

    this.appRuntime._log('prefab_update', {
      rootId,
      updateCount,
      cascadeToVariants,
    }, { sourceEntity: rootId })

    return updateCount > 0
  }

  _buildSpawnConfig(entity, parentId, overrides) {
    const config = {
      position: entity.position ? [...entity.position] : [0, 0, 0],
      rotation: entity.rotation ? [...entity.rotation] : [0, 0, 0, 1],
      scale: entity.scale ? [...entity.scale] : [1, 1, 1],
      bodyType: entity.bodyType || 'static',
      custom: entity.custom ? { ...entity.custom } : {},
    }

    if (entity.app) config.app = entity.app
    if (entity.model) config.model = entity.model
    if (entity.collider) config.collider = entity.collider
    if (entity.mass !== undefined) config.mass = entity.mass
    if (entity.config) config.config = { ...entity.config }

    if (parentId) config.parent = parentId

    const ov = overrides[entity.id]
    if (ov) {
      if (ov.position) config.position = [...ov.position]
      if (ov.rotation) config.rotation = [...ov.rotation]
      if (ov.scale) config.scale = [...ov.scale]
      if (ov.bodyType) config.bodyType = ov.bodyType
      if (ov.mass !== undefined) config.mass = ov.mass
      if (ov.custom && typeof ov.custom === 'object') {
        config.custom = { ...config.custom, ...ov.custom }
      }
    }

    return config
  }

  _topologicalSort(entities, rootId) {
    const result = []
    const visited = new Set()

    const visit = (id) => {
      if (visited.has(id)) return
      visited.add(id)

      const entity = entities.find(e => e.id === id)
      if (entity) result.push(entity)

      for (const child of entities) {
        if (child.parent === id && !visited.has(child.id)) {
          visit(child.id)
        }
      }
    }

    visit(rootId)
    for (const entity of entities) {
      if (!visited.has(entity.id)) visit(entity.id)
    }

    return result
  }

  _generateEntityId(app, model) {
    if (app && app !== '') {
      return app + '-' + this.random().toString(36).slice(2, 8)
    }
    if (model && model !== '') {
      return 'placed-' + this.random().toString(36).slice(2, 10)
    }
    return 'entity-' + this.random().toString(36).slice(2, 10)
  }
}

export function createPrefabSpawner(appRuntime, prefabLibrary, clock) {
  return new PrefabSpawner(appRuntime, prefabLibrary, clock)
}
