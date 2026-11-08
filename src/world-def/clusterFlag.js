export class WorldDefParseError extends Error {
  constructor(code, world, detail) {
    super('[world-parse] ' + world + ': ' + code + ': ' + detail)
    this.name = 'WorldDefParseError'
    this.code = code
    this.world = world
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const positiveFinite = (value) => typeof value === 'number' && Number.isFinite(value) && value > 0

const valueKind = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

const CLUSTER_KINDS = {
  clusters: { kind: 'object', holds: isPlainObject },
  radius: { kind: 'number', holds: (value) => Number.isFinite(value) },
}

const terrainConfigOf = (def) => {
  if (Array.isArray(def.entities)) {
    for (const entity of def.entities) {
      if (entity && entity.app === 'terrain' && isPlainObject(entity.config)) return entity.config
    }
  }
  return isPlainObject(def.terrain) ? def.terrain : null
}

export function parseClusterFlag(world, def) {
  if (!isPlainObject(def)) {
    throw new WorldDefParseError('world-def-not-an-object', world, 'got ' + typeof def)
  }
  if (!('planetRadius' in def)) {
    throw new WorldDefParseError('world-planet-radius-not-declared', world, 'declare planetRadius 0 for a flat chart or the cluster-resolved sphere radius')
  }
  const planetRadius = def.planetRadius
  if (typeof planetRadius !== 'number' || !Number.isFinite(planetRadius) || planetRadius < 0) {
    throw new WorldDefParseError('world-planet-radius-not-a-number', world, 'got ' + JSON.stringify(planetRadius))
  }

  const terrainConfig = terrainConfigOf(def)
  if (terrainConfig) {
    for (const key of Object.keys(terrainConfig)) {
      const declared = Object.hasOwn(CLUSTER_KINDS, key) ? CLUSTER_KINDS[key] : null
      const value = terrainConfig[key]
      if (declared && value != null && !declared.holds(value)) {
        throw new WorldDefParseError('world-terrain-field-type-invalid', world, 'terrain field ' + JSON.stringify(key) + ' declared ' + declared.kind + ', got ' + valueKind(value))
      }
    }
    if (!isPlainObject(terrainConfig.clusters) || typeof terrainConfig.clusters.enabled !== 'boolean') {
      throw new WorldDefParseError('world-clusters-not-declared', world, 'declare terrain.clusters { enabled } so resolveClusterConfig is never reached unstated')
    }
    if (terrainConfig.clusters.enabled === true && !positiveFinite(terrainConfig.radius)) {
      throw new WorldDefParseError('world-clusters-enabled-without-terrain-radius', world, 'terrain.radius ' + JSON.stringify(terrainConfig.radius))
    }
  }

  if (planetRadius > 0) {
    if (!terrainConfig) {
      throw new WorldDefParseError('world-planet-radius-unreachable', world, 'planetRadius ' + planetRadius + ' with no terrain config')
    }
    if (terrainConfig.clusters.enabled !== true) {
      throw new WorldDefParseError('world-planet-radius-unreachable', world, 'planetRadius ' + planetRadius + ' needs terrain.clusters.enabled true')
    }
    if (terrainConfig.radius !== planetRadius) {
      throw new WorldDefParseError('world-planet-radius-unreachable', world, 'terrain.radius ' + terrainConfig.radius + ' != planetRadius ' + planetRadius)
    }
  } else if (terrainConfig && terrainConfig.clusters.enabled === true) {
    throw new WorldDefParseError('world-clusters-enabled-without-planet-radius', world, 'terrain.radius ' + terrainConfig.radius + ' needs planetRadius ' + terrainConfig.radius)
  }

  return def
}
