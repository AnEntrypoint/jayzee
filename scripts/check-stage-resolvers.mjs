import { gate, finish } from './lib/gate.mjs'
import { StageLoader, StageConfigError } from '../src/stage-pure/stageLoader.js'
import { createStageResolvers, createClusterPolicy, resolveTerrainConfig, TerrainConfigError } from '../src/stage-pure/stageResolvers.js'
import { TERRAIN_DEFAULTS } from '../src/terrain-pure/terrainDefaults.js'
import { parseClusterFlag } from '../src/world-def/clusterFlag.js'
import { heapWorldCeiling, CLUSTER_DEFAULT_LINK_M } from '../src/clusters-pure/clusterConfig.js'
import { CLUSTER_STAY_FACTOR, CLUSTER_JOIN_FACTOR, createClusterAssigner } from '../src/clusters-pure/clusterAssignment.js'
import { chartAnchorKeyOfDir, chartAnchorForDir, CHART_ANCHORS_PER_FACE } from '../src/chart-pure/chartAnchor.js'
import { DEFAULT_COMBAT } from '../src/behaviours/combat.js'

const fail = (what) => { throw new Error(what) }
const expect = (actual, expected, what) => {
  const a = JSON.stringify(actual), e = JSON.stringify(expected)
  if (a !== e) fail(`${what}: expected ${e} got ${a}`)
}
const thrownBy = (fn, what) => {
  try { fn() } catch (error) { return error }
  return fail(`${what}: did not throw`)
}

const JOLT = { heapBytes: 134217728, residentBytes: 1157976, mirrorReserve: 2, mirrorMarginalBytes: 11278387, worldMarginalBytes: 20238432, reserveFraction: 0.1 }
const RADIUS = 63600

const makeRuntime = (appDefs = new Map()) => {
  const entities = new Map()
  return {
    _appDefs: appDefs,
    gravity: undefined,
    entities,
    spawnEntity(id, config) {
      const entityId = id ?? 'anon-' + entities.size
      const entity = { id: entityId, position: config.position ?? [0, 0, 0], bodyType: config.bodyType, spawnConfig: config }
      entities.set(entityId, entity)
      return entity
    },
    destroyEntity(id) { entities.delete(id) },
    getEntity(id) { return entities.get(id) ?? null },
  }
}

const planetWorld = (extra = {}, clusters = {}) => ({
  name: 'planet',
  planetRadius: RADIUS,
  entities: [{ id: 'ground', app: 'terrain', config: { radius: RADIUS, clusters: { enabled: true, ...clusters } } }],
  ...extra,
})

const loaderWith = (runtime = makeRuntime()) => new StageLoader(runtime, createStageResolvers({ jolt: JOLT }))

gate('resolveTerrainConfig returns null for a world with no ground and for terrain false or null', () => {
  expect(resolveTerrainConfig({ name: 'a' }), null, 'no terrain')
  expect(resolveTerrainConfig({ name: 'a', terrain: false }), null, 'false')
  expect(resolveTerrainConfig({ name: 'a', terrain: null, entities: [{ app: 'door' }] }), null, 'null and other apps')
})

gate('resolveTerrainConfig reads the terrain entity or the world field, fills every default, and keeps declared fields', () => {
  const fromEntity = resolveTerrainConfig({ name: 'a', entities: [{ app: 'terrain', config: { radius: 5000, canyonDepth: 12, seed: 9 } }] })
  const fromWorld = resolveTerrainConfig({ name: 'a', terrain: { radius: 5000, canyonDepth: 12, seed: 9 } })
  expect(fromEntity, fromWorld, 'both sources resolve the same config')
  expect([fromEntity.radius, fromEntity.canyonDepth, fromEntity.seed], [5000, 12, 9], 'declared fields')
  expect(fromEntity.clusters, { enabled: false }, 'clusters default to disabled')
  for (const key of Object.keys(TERRAIN_DEFAULTS)) {
    if (key !== 'canyonDepth') expect(fromEntity[key], TERRAIN_DEFAULTS[key], `default ${key}`)
  }
  if (!Object.isFrozen(fromEntity) || !Object.isFrozen(fromEntity.clusters)) fail('the resolved config can be edited')
  expect(resolveTerrainConfig({ terrain: {} }).radius, null, 'an undeclared radius is null')
})

gate('resolveTerrainConfig refuses two grounds, a non-object config, a wrong field type, a non-numeric radius and a non-boolean cluster flag', () => {
  const code = (def) => {
    const error = thrownBy(() => resolveTerrainConfig(def), JSON.stringify(def))
    if (!(error instanceof TerrainConfigError)) fail(`wrong error ${error.message}`)
    return error.code
  }
  expect(code({ terrain: {}, entities: [{ app: 'terrain', config: {} }] }), 'terrain-declared-twice', 'world and entity')
  expect(code({ entities: [{ app: 'terrain' }, { app: 'terrain' }] }), 'terrain-declared-twice', 'two entities')
  expect(code({ terrain: true }), 'terrain-config-not-an-object', 'true')
  expect(code({ entities: [{ app: 'terrain', config: [1] }] }), 'terrain-config-not-an-object', 'array config')
  expect(code({ terrain: { canyonDepth: '40' } }), 'terrain-field-not-a-finite-number', 'string scalar')
  expect(code({ terrain: { maxLevel: NaN } }), 'terrain-field-not-a-finite-number', 'NaN scalar')
  expect(code({ terrain: { bcSea: [1, 2] } }), 'terrain-field-not-a-vector', 'short vector')
  expect(code({ terrain: { radius: '6000' } }), 'terrain-radius-not-a-number', 'string radius')
  expect(code({ terrain: { clusters: [] } }), 'terrain-clusters-not-an-object', 'array clusters')
  expect(code({ terrain: { clusters: { enabled: 'true' } } }), 'terrain-clusters-enabled-not-a-boolean', 'string flag')
  expect(code(null), 'world-def-not-an-object', 'null world')
})

gate('the cluster policy is built from the chart anchor lattice, the walkable limit and the assigner factors, and needs a heap budget', () => {
  const policy = createClusterPolicy({ jolt: JOLT })
  expect([policy.anchorsPerFace, policy.stayFactor, policy.joinFactor], [CHART_ANCHORS_PER_FACE, CLUSTER_STAY_FACTOR, CLUSTER_JOIN_FACTOR], 'constants')
  expect(Math.round(policy.walkableLimitDeg * 1000), 45000, 'walkable limit is the 45 degree slope limit')
  const lattice = policy.createLattice(RADIUS, 4)
  expect(lattice.chunksPerFace, 4, 'the lattice is the cube-sphere anchor lattice')
  const worst = policy.cellWorstAngleDeg(lattice)
  if (!(worst > 12 && worst < 22)) fail(`worst anchor angle ${worst}`)
  for (const bad of [undefined, {}, { ...JOLT, heapBytes: NaN }, { ...JOLT, worldMarginalBytes: 0 }, { ...JOLT, heapBytes: 1000 }]) {
    const error = thrownBy(() => createClusterPolicy({ jolt: bad }), JSON.stringify(bad))
    if (!(error instanceof TypeError) || !/heap budget/.test(error.message)) fail(`wrong error ${error.message}`)
  }
  thrownBy(() => createClusterPolicy({ jolt: JOLT, anchorsPerFace: 0 }), 'zero anchors')
  thrownBy(() => createStageResolvers(), 'resolvers with no budget')
})

gate('a StageLoader on the real resolvers loads a flat world as flat and a clustered planet at its resolved radius', () => {
  const loader = loaderWith()
  const flat = loader.loadFromDefinition('flat', { name: 'flat', planetRadius: 0, entities: [{ id: 'box', model: 'box.glb', position: [1, 2, 3] }] })
  expect([flat.spatial.planetRadius, flat.shape.id], [0, 'flat'], 'flat stage')
  const planet = loader.loadFromDefinition('planet', planetWorld())
  expect([planet.spatial.planetRadius, planet.shape.id], [RADIUS, 'planet'], 'planet stage')
  expect(loader.stageCount, 2, 'both loaded')
  const flatTerrain = loader.loadFromDefinition('hills', { name: 'hills', terrain: { clusters: { enabled: false } } })
  expect(flatTerrain.spatial.planetRadius, 0, 'terrain without clusters stays flat')
})

gate('the cluster config the loader resolves carries a real cube-sphere lattice that the cluster assigner accepts', () => {
  const resolvers = createStageResolvers({ jolt: JOLT })
  const terrain = resolvers.resolveTerrainConfig(planetWorld())
  const config = resolvers.resolveClusterConfig(terrain.clusters, { radius: terrain.radius, relevanceRadius: 200, maxWeaponRangeM: 0 })
  expect([config.radius, config.anchorsPerFace, config.linkM, config.maxWorlds], [RADIUS, 32, CLUSTER_DEFAULT_LINK_M, heapWorldCeiling(JOLT)], 'resolved values')
  const faces = new Set()
  for (const dir of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
    const key = chartAnchorKeyOfDir(config.lattice, dir)
    faces.add(config.lattice.decodeChunk(key, [0, 0, 0])[0])
    const anchor = chartAnchorForDir(config.lattice, dir)
    const angle = Math.acos(Math.min(1, anchor[0] * dir[0] + anchor[1] * dir[1] + anchor[2] * dir[2])) * 180 / Math.PI
    if (!(angle <= config.cellWorstDeg + 1e-9)) fail(`axis ${dir} is ${angle} degrees from its anchor, beyond the worst ${config.cellWorstDeg}`)
  }
  expect(faces.size, 6, 'the six axes land on six cube faces')
  near(config.memberRadiusM, RADIUS * Math.sin(config.cellWorstDeg * Math.PI / 180), 1e-6, 'member radius from the worst anchor angle')
  const assigner = createClusterAssigner({ radius: config.radius, linkM: config.linkM, memberRadiusM: config.memberRadiusM, lattice: config.lattice, hysteresisDeg: config.hysteresisDeg, stayFactor: config.stayFactor, joinFactor: config.joinFactor })
  if (!assigner || typeof assigner !== 'object') fail('the assigner refused the resolved config')
})

function near(a, b, tol, what) { if (!(Math.abs(a - b) <= tol)) fail(`${what}: expected ${b} got ${a}`) }

const refusal = (world, runtime) => {
  const error = thrownBy(() => loaderWith(runtime).loadFromDefinition(world.name, world), world.name)
  if (!(error instanceof StageConfigError)) fail(`wrong error ${error.message}`)
  return [error.code, error.reasonCode]
}

gate('the loader re-raises each real cluster refusal under its own code: link below the ring, link below a weapon, stay beyond the walkable chart, worlds beyond the heap', () => {
  expect(refusal(planetWorld({}, { linkM: 100 })), ['stage-cluster-config-refused', 'cluster-link-below-relevance-ring'], 'short link')
  expect(refusal(planetWorld({ maxWeaponRangeM: 4000 })), ['stage-cluster-config-refused', 'cluster-link-below-weapon-range'], 'declared weapon range')
  expect(refusal(planetWorld({}, { memberRadiusM: RADIUS * 0.7 })), ['stage-cluster-config-refused', 'cluster-radius-exceeds-walkable-chart'], 'wide member radius')
  expect(refusal(planetWorld({}, { maxWorldsPerProcess: heapWorldCeiling(JOLT) + 1 })), ['stage-cluster-config-refused', 'cluster-worlds-exceed-wasm-heap-budget'], 'too many worlds')
  expect(refusal(planetWorld({}, { hz: 50 })), ['stage-cluster-config-refused', 'cluster-cadence-out-of-range'], 'cadence')
  expect(refusal(planetWorld({ relevanceRadius: 400 })), ['stage-cluster-config-refused', 'cluster-link-below-relevance-ring'], 'a wider relevance radius needs a longer link')
})

gate('the weapon range the loader passes is the longest of the declared range, the combat behaviour and a ranged app entity', () => {
  const combatRange = DEFAULT_COMBAT.range
  const long = combatRange + CLUSTER_DEFAULT_LINK_M
  expect(refusal(planetWorld({ players: { behaviours: { combat: { config: { range: long } } } } })), ['stage-cluster-config-refused', 'cluster-link-below-weapon-range'], 'combat range')
  const appDefs = new Map([['turret', { server: { editorProps: [{ key: 'range', default: 50 }] } }]])
  const turretWorld = planetWorld()
  turretWorld.entities.push({ id: 't', app: 'turret', config: { range: long } })
  expect(refusal(turretWorld, makeRuntime(appDefs)), ['stage-cluster-config-refused', 'cluster-link-below-weapon-range'], 'turret range')
  const shortTurret = planetWorld()
  shortTurret.entities.push({ id: 't', app: 'turret', config: {} })
  expect(loaderWith(makeRuntime(appDefs)).loadFromDefinition('p', shortTurret).spatial.planetRadius, RADIUS, 'a turret at its default range loads')
})

gate('radius disagreements are refused: clusters on no radius, a declared radius without clusters, and a declared radius that differs from the resolved one', () => {
  expect(refusal({ name: 'w', terrain: { clusters: { enabled: true } } })[0], 'stage-cluster-needs-planet-radius', 'no radius')
  expect(refusal({ name: 'w', planetRadius: 5000, terrain: { radius: 5000, clusters: { enabled: false } } })[0], 'stage-radius-not-cluster-resolved', 'radius without clusters')
  expect(refusal(planetWorld({ planetRadius: RADIUS + 1 }))[0], 'stage-radius-conflicts-with-cluster-radius', 'two radii')
})

gate('every world the world-definition parser accepts loads through the real resolvers at the radius it declares, and the parser refuses what the loader refuses', () => {
  const worlds = [
    { name: 'flat', planetRadius: 0 },
    { name: 'flat-terrain', planetRadius: 0, terrain: { clusters: { enabled: false } } },
    planetWorld(),
    { name: 'direct', planetRadius: 20000, terrain: { radius: 20000, clusters: { enabled: true } } },
  ]
  for (const world of worlds) {
    parseClusterFlag(world.name, world)
    expect(loaderWith().loadFromDefinition(world.name, world).spatial.planetRadius, world.planetRadius, world.name)
  }
  const bad = { name: 'bad', planetRadius: 5000, terrain: { radius: 5000, clusters: { enabled: false } } }
  thrownBy(() => parseClusterFlag(bad.name, bad), 'parser')
  thrownBy(() => loaderWith().loadFromDefinition(bad.name, bad), 'loader')
})

gate('negative control: a stand-in resolver that only copies the radius loads the short-link world the real resolvers refuse', () => {
  const standIn = {
    resolveTerrainConfig: (worldDef) => worldDef.entities?.find((e) => e.app === 'terrain')?.config ?? null,
    resolveClusterConfig: (clusters, context) => (clusters?.enabled === true ? { radius: context.radius } : null),
    declaredWeaponRangeM: () => 0,
  }
  const world = planetWorld({}, { linkM: 100 })
  expect(new StageLoader(makeRuntime(), standIn).loadFromDefinition('p', world).spatial.planetRadius, RADIUS, 'stand-in loads it')
  expect(refusal(world)[1], 'cluster-link-below-relevance-ring', 'real resolvers refuse it')
})

finish()
