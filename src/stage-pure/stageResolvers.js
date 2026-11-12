import { TERRAIN_DEFAULTS } from '../terrain-pure/terrainDefaults.js'
import { resolveClusterConfig, declaredWeaponRangeM, heapWorldCeiling } from '../clusters-pure/clusterConfig.js'
import { CLUSTER_STAY_FACTOR, CLUSTER_JOIN_FACTOR } from '../clusters-pure/clusterAssignment.js'
import { createChartAnchorLattice, chartAnchorCellWorstAngleDeg, CHART_ANCHORS_PER_FACE } from '../chart-pure/chartAnchor.js'
import { CHART_REANCHOR_HYSTERESIS_DEG, WALKABLE_CHART_LIMIT_DEG } from '../chart-pure/chartReanchorPolicy.js'

export const TERRAIN_APP = 'terrain'

const JOLT_FIELDS = ['heapBytes', 'residentBytes', 'mirrorReserve', 'mirrorMarginalBytes', 'worldMarginalBytes', 'reserveFraction']

export class TerrainConfigError extends TypeError {
  constructor(code, world, detail) {
    super(`${code}: [terrain-config] world "${world}" ${detail}`)
    this.name = 'TerrainConfigError'
    this.code = code
    this.world = world
  }
}

const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value)

const kindOf = (value) => {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'array'
  return typeof value
}

function declaredTerrain(worldDef, world) {
  let fromEntity = null
  if (Array.isArray(worldDef.entities)) {
    for (const entity of worldDef.entities) {
      if (!entity || entity.app !== TERRAIN_APP) continue
      if (fromEntity !== null) throw new TerrainConfigError('terrain-declared-twice', world, 'has more than one terrain entity: one world has one ground, so the second terrain entity is refused instead of being ignored')
      if (entity.config != null && !isPlainObject(entity.config)) throw new TerrainConfigError('terrain-config-not-an-object', world, `has a terrain entity whose config is ${kindOf(entity.config)}`)
      fromEntity = entity.config ?? {}
    }
  }
  const direct = worldDef.terrain
  if (direct === undefined || direct === null || direct === false) return fromEntity
  if (!isPlainObject(direct)) throw new TerrainConfigError('terrain-config-not-an-object', world, `declares terrain as ${kindOf(direct)}: a terrain config is an object, false or null`)
  if (fromEntity !== null) throw new TerrainConfigError('terrain-declared-twice', world, 'declares terrain both on the world and on a terrain entity: one world has one ground, so the stage refuses to choose between them')
  return direct
}

function checkedField(world, key, value, fallback) {
  if (typeof fallback === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TerrainConfigError('terrain-field-not-a-finite-number', world, `sets terrain.${key} to ${JSON.stringify(value) ?? kindOf(value)}: the default is the number ${fallback}, so the field takes a finite number`)
    return value
  }
  if (!Array.isArray(value) || value.length !== fallback.length || !value.every(Number.isFinite)) throw new TerrainConfigError('terrain-field-not-a-vector', world, `sets terrain.${key} to ${JSON.stringify(value) ?? kindOf(value)}: the default is a vector of ${fallback.length} numbers, so the field takes the same`)
  return Object.freeze([...value])
}

export function resolveTerrainConfig(worldDef) {
  if (!isPlainObject(worldDef)) throw new TerrainConfigError('world-def-not-an-object', '(unnamed)', `is ${kindOf(worldDef)}: a world definition is an object`)
  const world = typeof worldDef.name === 'string' ? worldDef.name : '(unnamed)'
  const declared = declaredTerrain(worldDef, world)
  if (declared === null) return null
  const out = {}
  for (const key of Object.keys(TERRAIN_DEFAULTS)) {
    out[key] = declared[key] === undefined ? TERRAIN_DEFAULTS[key] : checkedField(world, key, declared[key], TERRAIN_DEFAULTS[key])
  }
  for (const key of Object.keys(declared)) {
    if (!Object.hasOwn(TERRAIN_DEFAULTS, key)) out[key] = declared[key]
  }
  if (declared.radius != null && (typeof declared.radius !== 'number' || !Number.isFinite(declared.radius))) throw new TerrainConfigError('terrain-radius-not-a-number', world, `sets terrain.radius to ${JSON.stringify(declared.radius) ?? kindOf(declared.radius)}: the planet radius is a finite number of metres`)
  out.radius = declared.radius ?? null
  if (declared.clusters != null) {
    if (!isPlainObject(declared.clusters)) throw new TerrainConfigError('terrain-clusters-not-an-object', world, `sets terrain.clusters to ${kindOf(declared.clusters)}: the cluster config is an object with a boolean enabled`)
    if (typeof declared.clusters.enabled !== 'boolean') throw new TerrainConfigError('terrain-clusters-enabled-not-a-boolean', world, `sets terrain.clusters.enabled to ${JSON.stringify(declared.clusters.enabled) ?? kindOf(declared.clusters.enabled)}: a truthy string or number would read as disabled downstream, so only true or false is accepted`)
    out.clusters = Object.freeze({ ...declared.clusters })
  } else {
    out.clusters = Object.freeze({ enabled: false })
  }
  return Object.freeze(out)
}

function checkedJolt(jolt) {
  if (!isPlainObject(jolt)) throw new TypeError('[stage] the cluster policy got no physics heap budget: the number of worlds one process may hold is computed from the measured heap, so the host passes { ' + JOLT_FIELDS.join(', ') + ' }')
  for (const field of JOLT_FIELDS) {
    if (typeof jolt[field] !== 'number' || !Number.isFinite(jolt[field]) || jolt[field] < 0) throw new TypeError(`[stage] the physics heap budget field ${field} is ${JSON.stringify(jolt[field]) ?? kindOf(jolt[field])}: every field is a finite non-negative number`)
  }
  if (!(jolt.worldMarginalBytes > 0)) throw new TypeError('[stage] the physics heap budget field worldMarginalBytes is 0: a world that costs nothing gives no ceiling')
  const frozen = Object.freeze({ ...jolt })
  if (!(heapWorldCeiling(frozen) >= 1)) throw new TypeError(`[stage] the physics heap budget fits ${heapWorldCeiling(frozen)} worlds: a host that cannot hold one world cannot load a cluster world`)
  return frozen
}

export function createClusterPolicy({ jolt, anchorsPerFace = CHART_ANCHORS_PER_FACE } = {}) {
  if (!Number.isInteger(anchorsPerFace) || anchorsPerFace < 1) throw new TypeError(`[stage] the cluster policy got anchorsPerFace ${JSON.stringify(anchorsPerFace)}: the chart anchor lattice cuts each cube face into a whole number of anchors per side`)
  return Object.freeze({
    anchorsPerFace,
    createLattice: createChartAnchorLattice,
    cellWorstAngleDeg: chartAnchorCellWorstAngleDeg,
    hysteresisDeg: CHART_REANCHOR_HYSTERESIS_DEG,
    stayFactor: CLUSTER_STAY_FACTOR,
    joinFactor: CLUSTER_JOIN_FACTOR,
    walkableLimitDeg: WALKABLE_CHART_LIMIT_DEG,
    jolt: checkedJolt(jolt),
  })
}

export function createStageResolvers(options) {
  const policy = createClusterPolicy(options)
  return Object.freeze({
    policy,
    resolveTerrainConfig,
    resolveClusterConfig: (spec, context) => resolveClusterConfig(spec, context, policy),
    declaredWeaponRangeM,
  })
}
