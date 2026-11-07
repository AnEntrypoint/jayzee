import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { FLAT_RING_HALF_HEIGHT_M, registerStageShape, stageShape, resolveStageShape } from '../src/stage-pure/stageShapes.js'
import { Stage } from '../src/stage-pure/stage.js'
import { StageLoader, StageConfigError } from '../src/stage-pure/stageLoader.js'
import { SpatialIndex } from '../src/spatial-pure/octree.js'
import { flatPlanetRadius, clusterPlanetRadius, planetRadiusMeters } from '../src/stage-pure/planetRadius.js'
import { resolveRelevanceRadius, DEFAULT_RELEVANCE_RADIUS_M } from '../src/spatial-pure/relevanceRadius.js'

const EARTH_RADIUS_M = 6371000

const throwsMatching = (fn, pattern) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown, 'expected a throw matching ' + pattern)
  assert.match(String(thrown.message), pattern)
  return thrown
}

const makeRuntime = (appDefs = new Map()) => {
  const entities = new Map()
  return {
    _appDefs: appDefs,
    _activeDynamicIds: new Set(),
    entities,
    gravity: undefined,
    spawnEntity(id, config) {
      const entityId = id ?? 'anon-' + entities.size
      const entity = { id: entityId, position: config.position ?? [0, 0, 0], bodyType: config.bodyType, spawnConfig: config }
      entities.set(entityId, entity)
      return entity
    },
    destroyEntity(id) {
      entities.delete(id)
    },
    getEntity(id) {
      return entities.get(id) ?? null
    },
  }
}

const resolvers = {
  resolveTerrainConfig: (worldDef) => worldDef.terrain ?? null,
  resolveClusterConfig: (clusters, context) => {
    if (clusters?.refuse) {
      const refusal = new Error('cluster refused the config')
      refusal.code = 'bad-cluster'
      throw refusal
    }
    return clusters?.enabled === true ? { radius: context.radius } : null
  },
  declaredWeaponRangeM: () => 0,
}

const FLAT_WORLD = { name: 'flat-world' }
const CLUSTER_WORLD = { name: 'cluster-world', terrain: { radius: EARTH_RADIUS_M, clusters: { enabled: true } } }

const codeOf = (fn) => {
  let thrown = null
  try {
    fn()
  } catch (error) {
    thrown = error
  }
  assert.ok(thrown instanceof StageConfigError, 'expected a StageConfigError')
  return thrown
}

gate('flat and planet shapes are registered, frozen and reachable by id', () => {
  assert.equal(FLAT_RING_HALF_HEIGHT_M, Infinity)
  assert.equal(stageShape('flat').band.minInclusive, 0)
  assert.equal(stageShape('flat').band.maxExclusive, Number.MIN_VALUE)
  assert.equal(stageShape('planet').band.maxExclusive, Infinity)
  assert.ok(Object.isFrozen(stageShape('flat')))
  assert.ok(Object.isFrozen(stageShape('flat').band))
  throwsMatching(() => stageShape('missing'), /has no registration/)
})

gate('an undeclared radius resolves to flat at 0 and to planet at every positive radius', () => {
  assert.equal(resolveStageShape(0).id, 'flat')
  assert.equal(resolveStageShape(Number.MIN_VALUE).id, 'planet')
  assert.equal(resolveStageShape(EARTH_RADIUS_M).id, 'planet')
  throwsMatching(() => resolveStageShape(-1), /matches no registered stage shape/)
  throwsMatching(() => resolveStageShape(Number.NaN), /matches no registered stage shape/)
})

gate('a declared shape must hold the radius it is declared at', () => {
  assert.equal(resolveStageShape(EARTH_RADIUS_M, 'planet').id, 'planet')
  assert.equal(resolveStageShape(0, 'flat').id, 'flat')
  throwsMatching(() => resolveStageShape(0, 'planet'), /outside its band/)
  throwsMatching(() => resolveStageShape(EARTH_RADIUS_M, 'flat'), /outside its band/)
})

gate('a declared shape id that is not registered is refused', () => {
  assert.equal(resolveStageShape(0, null).id, 'flat')
  throwsMatching(() => resolveStageShape(0, 'nope'), /has no registration/)
})

gate('registerStageShape refuses an empty or non-string id', () => {
  const band = { minInclusive: 1, maxExclusive: 2 }
  throwsMatching(() => registerStageShape('', { band }), /non-empty string/)
  throwsMatching(() => registerStageShape(42, { band }), /non-empty string/)
  throwsMatching(() => registerStageShape(undefined, { band }), /non-empty string/)
})

gate('registerStageShape refuses a second registration of an id already held', () => {
  throwsMatching(() => registerStageShape('flat', { band: { minInclusive: 1000, maxExclusive: 2000 } }), /already registered/)
  throwsMatching(() => registerStageShape('planet', { band: { minInclusive: 1000, maxExclusive: 2000 } }), /already registered/)
})

gate('registerStageShape refuses a band that overlaps a registered band', () => {
  throwsMatching(() => registerStageShape('probe-ring', { band: { minInclusive: EARTH_RADIUS_M, maxExclusive: EARTH_RADIUS_M + 1000 } }), /overlapping the registered shape "planet"/)
  throwsMatching(() => registerStageShape('probe-ring', { band: { minInclusive: 0, maxExclusive: 1 } }), /overlapping the registered shape "flat"/)
})

gate('registerStageShape refuses a missing or malformed band', () => {
  throwsMatching(() => registerStageShape('probe-a', {}), /declares no band/)
  throwsMatching(() => registerStageShape('probe-b', { band: null }), /declares no band/)
  throwsMatching(() => registerStageShape('probe-c', { band: { minInclusive: Number.NaN, maxExclusive: 5 } }), /non-NaN numbers/)
  throwsMatching(() => registerStageShape('probe-d', { band: { minInclusive: '1', maxExclusive: 5 } }), /non-NaN numbers/)
  throwsMatching(() => registerStageShape('probe-e', { band: { minInclusive: -1, maxExclusive: 5 } }), /below 0/)
})

gate('registerStageShape refuses an empty or inverted band', () => {
  throwsMatching(() => registerStageShape('probe-f', { band: { minInclusive: 5, maxExclusive: 5 } }), /empty band/)
  throwsMatching(() => registerStageShape('probe-g', { band: { minInclusive: 9, maxExclusive: 3 } }), /empty band/)
})

gate('no band at or above zero can be registered, because flat and planet cover [0, Infinity)', () => {
  const starts = [0, Number.MIN_VALUE, 1, 1e-300, EARTH_RADIUS_M, 1e308]
  for (const start of starts) {
    throwsMatching(() => registerStageShape('sweep-' + start, { band: { minInclusive: start, maxExclusive: start * 2 + 1 } }), /overlapping/)
    throwsMatching(() => registerStageShape('sweep-open-' + start, { band: { minInclusive: start, maxExclusive: Infinity } }), /overlapping/)
  }
  assert.equal(resolveStageShape(0).id, 'flat')
})

gate('the flat ring is unbounded vertically and the planet ring is a sphere of its radius', () => {
  const flat = new Stage('flat-ring-probe')
  const planet = new Stage('planet-ring-probe', { planetRadius: clusterPlanetRadius(EARTH_RADIUS_M) })
  assert.deepEqual(flat.relevanceRing(10), { spherical: false, radius: 10, halfHeight: Infinity })
  assert.deepEqual(planet.relevanceRing(10), { spherical: true, radius: 10, halfHeight: 10 })
  assert.equal(planet.relevanceRing(undefined).radius, 200)
})

gate('the flat horizontal query ignores height and the cell query of a flat stage keeps it', () => {
  const runtime = makeRuntime()
  const flat = new Stage('flat-query')
  flat.bind(runtime)
  flat.addEntity('high', { position: [0, 1000000, 0] })
  flat.addEntity('far', { position: [50, 0, 0] })
  assert.deepEqual(flat.getRelevantEntitiesHorizontal([0, 0, 0], 10), ['high'])
  assert.deepEqual(flat.getRelevantEntitiesForCell([0, 0, 0], 10), ['high'])
  assert.ok(!flat.getRelevantEntitiesHorizontal([0, 0, 0], 10).includes('far'))
})

gate('the planet cell query uses 3D distance and the planet horizontal query is refused', () => {
  const runtime = makeRuntime()
  const planet = new Stage('planet-query', { planetRadius: clusterPlanetRadius(EARTH_RADIUS_M) })
  planet.bind(runtime)
  planet.addEntity('centre', { position: [0, 0, 0] })
  planet.addEntity('above', { position: [0, 50, 0] })
  assert.deepEqual(planet.getRelevantEntitiesForCell([0, 0, 0], 10), ['centre'])
  assert.deepEqual(planet.getRelevantEntities([0, 0, 0], 60).sort(), ['above', 'centre'])
  throwsMatching(() => planet.getRelevantEntitiesHorizontal([0, 0, 0], 10), /horizontal relevance query/)
})

gate('a Stage with no relevance radius, or a non-positive one, uses 200 metres', () => {
  assert.equal(new Stage('default-radius').spatial.relevanceRadius, DEFAULT_RELEVANCE_RADIUS_M)
  assert.equal(new Stage('negative-radius', { relevanceRadius: -3 }).spatial.relevanceRadius, 200)
  assert.equal(new Stage('given-radius', { relevanceRadius: 75 }).spatial.relevanceRadius, 75)
  assert.equal(resolveRelevanceRadius('75'), 200)
})

gate('a Stage takes its radius only from a minted planet radius, and a bare number is refused', () => {
  assert.equal(new Stage('flat-radius', { planetRadius: flatPlanetRadius() }).spatial.planetRadius, 0)
  const planet = new Stage('cluster-radius', { planetRadius: clusterPlanetRadius(EARTH_RADIUS_M) })
  assert.equal(planet.spatial.planetRadius, EARTH_RADIUS_M)
  assert.equal(planet.shape.id, 'planet')
  throwsMatching(() => new Stage('bare-radius', { planetRadius: EARTH_RADIUS_M }), /not one the stage can accept/)
})

gate('a Stage refuses a declared shape that disagrees with its planet radius', () => {
  throwsMatching(() => new Stage('mismatch-flat', { planetRadius: clusterPlanetRadius(EARTH_RADIUS_M), shape: 'flat' }), /outside its band/)
  throwsMatching(() => new Stage('mismatch-planet', { shape: 'planet' }), /outside its band/)
  assert.equal(new Stage('matched-flat', { shape: 'flat' }).shape.id, 'flat')
})

gate('planet radii are minted only by flatPlanetRadius and clusterPlanetRadius', () => {
  assert.equal(planetRadiusMeters('none', undefined), 0)
  assert.equal(planetRadiusMeters('flat', flatPlanetRadius()), 0)
  assert.equal(Object.isFrozen(flatPlanetRadius()), true)
  for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, '6371000']) {
    throwsMatching(() => clusterPlanetRadius(bad), /positive finite number of meters/)
  }
  throwsMatching(() => planetRadiusMeters('forged', { resolvedBy: 'cluster', meters: EARTH_RADIUS_M }), /not one the stage can accept/)
})

gate('Stage refuses to add entities before it is bound and adds them after', () => {
  const stage = new Stage('unbound')
  assert.equal(stage.addEntity('x', { position: [0, 0, 0] }), null)
  assert.equal(stage.entityCount, 0)
  stage.bind(makeRuntime())
  assert.equal(stage.addEntity('x', { position: [0, 0, 0] }).id, 'x')
  assert.equal(stage.entityCount, 1)
})

gate('removeEntity drops an entity from the stage, the index and the runtime', () => {
  const runtime = makeRuntime()
  const stage = new Stage('remove')
  stage.bind(runtime)
  stage.addEntity('a', { position: [1, 0, 1] })
  assert.equal(stage.hasEntity('a'), true)
  stage.removeEntity('a')
  assert.equal(stage.hasEntity('a'), false)
  assert.equal(stage.spatial.has('a'), false)
  assert.equal(runtime.getEntity('a'), null)
  assert.deepEqual(stage.getRelevantEntities([1, 0, 1], 5), [])
})

gate('updateEntityPosition moves a member and ignores an id the stage does not hold', () => {
  const stage = new Stage('update')
  stage.bind(makeRuntime())
  stage.addEntity('a', { position: [1, 0, 1] })
  stage.updateEntityPosition('ghost', [1, 0, 1])
  assert.equal(stage.spatial.has('ghost'), false)
  stage.updateEntityPosition('a', [500, 0, 0])
  assert.deepEqual(stage.getRelevantEntities([500, 0, 0], 5), ['a'])
  assert.deepEqual(stage.getRelevantEntities([1, 0, 1], 5), [])
})

gate('clear destroys every entity the stage holds', () => {
  const runtime = makeRuntime()
  const stage = new Stage('clear')
  stage.bind(runtime)
  stage.addEntity('a', { position: [0, 0, 0] })
  stage.addEntity('b', { position: [1, 0, 0] })
  assert.equal(stage.entityCount, 2)
  stage.clear()
  assert.equal(stage.entityCount, 0)
  assert.equal(runtime.entities.size, 0)
  assert.equal(stage.spatial.size, 0)
  assert.deepEqual(stage.getAllEntityIds(), [])
})

gate('syncPositions follows active dynamic bodies and ignores ones the stage does not own', () => {
  const runtime = makeRuntime()
  const stage = new Stage('sync')
  stage.bind(runtime)
  stage.addEntity('p', { position: [0, 0, 0], bodyType: 'dynamic' })
  stage.addEntity('static', { position: [0, 0, 0] })
  runtime._activeDynamicIds.add('p')
  runtime._activeDynamicIds.add('foreign')
  runtime.getEntity('p').position = [300, 0, 0]
  runtime.entities.set('foreign', { id: 'foreign', position: [301, 0, 0] })
  assert.deepEqual(stage.getRelevantEntities([300, 0, 0], 5), [])
  stage.syncPositions()
  assert.deepEqual(stage.getRelevantEntities([300, 0, 0], 5), ['p'])
  assert.equal(stage.spatial.has('foreign'), false)
})

gate('syncPositions also follows unmanaged dynamic ids the runtime reports', () => {
  const runtime = makeRuntime()
  const stage = new Stage('unmanaged')
  stage.bind(runtime)
  stage.addEntity('u', { position: [0, 0, 0] })
  runtime.getEntity('u').position = [40, 0, 0]
  runtime.getUnmanagedDynamicIds = () => ['u', 'nobody']
  stage.syncPositions()
  assert.deepEqual(stage.getRelevantEntities([40, 0, 0], 5), ['u'])
  assert.equal(stage.spatial.has('nobody'), false)
})

gate('an unbound Stage answers sync and clear as no-ops', () => {
  const stage = new Stage('unbound-noop')
  stage.syncPositions()
  stage.clear()
  stage.removeEntity('nothing')
  assert.deepEqual(stage.getAllEntityIds(), [])
  assert.equal(stage.hasEntity('nothing'), false)
})

gate('StageLoader refuses to be built without its three resolvers and names the missing one', () => {
  throwsMatching(() => new StageLoader(makeRuntime()), /got no resolveTerrainConfig function/)
  const { resolveTerrainConfig, ...withoutTerrain } = resolvers
  throwsMatching(() => new StageLoader(makeRuntime(), withoutTerrain), /got no resolveTerrainConfig function/)
  throwsMatching(() => new StageLoader(makeRuntime(), { ...resolvers, declaredWeaponRangeM: 'nope' }), /got no declaredWeaponRangeM function/)
  assert.ok(new StageLoader(makeRuntime(), resolvers))
})

gate('a flat world loads as a flat stage with the default radius and becomes the active stage', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const stage = loader.loadFromDefinition('flat-world', FLAT_WORLD)
  assert.equal(stage.shape.id, 'flat')
  assert.equal(stage.spatial.planetRadius, 0)
  assert.equal(stage.spatial.relevanceRadius, 200)
  assert.equal(stage.playerModel, '/assets/default-avatar.vrm')
  assert.equal(loader.getActiveStage(), stage)
  assert.equal(loader.stageCount, 1)
})

gate('a cluster world loads as a planet stage at its cluster-resolved radius', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const stage = loader.loadFromDefinition('cluster-world', CLUSTER_WORLD)
  assert.equal(stage.shape.id, 'planet')
  assert.equal(stage.spatial.planetRadius, EARTH_RADIUS_M)
  assert.notEqual(new StageLoader(makeRuntime(), resolvers).loadFromDefinition('flat-world', FLAT_WORLD).spatial.planetRadius, EARTH_RADIUS_M)
})

gate('a cluster world with a non-positive radius is refused as needing one', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  for (const radius of [0, -5, undefined, Number.NaN]) {
    const error = codeOf(() => loader.loadFromDefinition('bad-radius', { name: 'bad-radius', terrain: { radius, clusters: { enabled: true } } }))
    assert.equal(error.code, 'stage-cluster-needs-planet-radius')
  }
  const disabled = new StageLoader(makeRuntime(), resolvers).loadFromDefinition('disabled-clusters', { name: 'disabled-clusters', terrain: { radius: 0, clusters: { enabled: false } } })
  assert.equal(disabled.shape.id, 'flat')
})

gate('a cluster config the resolver refuses is re-raised as a StageConfigError carrying the reason code', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const error = codeOf(() => loader.loadFromDefinition('refused', { name: 'refused', terrain: { radius: EARTH_RADIUS_M, clusters: { enabled: true, refuse: true } } }))
  assert.equal(error.code, 'stage-cluster-config-refused')
  assert.equal(error.reasonCode, 'bad-cluster')
  assert.equal(error.name, 'StageConfigError')
  assert.ok(error instanceof TypeError)
  assert.equal(loader.stageCount, 0)
})

gate('a declared planetRadius that conflicts with the cluster radius is refused, and a matching or zero one is accepted', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const conflict = codeOf(() => loader.loadFromDefinition('conflict', { name: 'conflict', planetRadius: 100, terrain: { radius: EARTH_RADIUS_M, clusters: { enabled: true } } }))
  assert.equal(conflict.code, 'stage-radius-conflicts-with-cluster-radius')
  const matching = loader.loadFromDefinition('matching', { name: 'matching', planetRadius: EARTH_RADIUS_M, terrain: { radius: EARTH_RADIUS_M, clusters: { enabled: true } } })
  assert.equal(matching.spatial.planetRadius, EARTH_RADIUS_M)
  const zero = loader.loadFromDefinition('zero', { name: 'zero', planetRadius: 0, terrain: { radius: EARTH_RADIUS_M, clusters: { enabled: true } } })
  assert.equal(zero.spatial.planetRadius, EARTH_RADIUS_M)
})

gate('a declared planetRadius without enabled clusters is refused, and zero or absent is flat', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const error = codeOf(() => loader.loadFromDefinition('ungrounded', { name: 'ungrounded', planetRadius: EARTH_RADIUS_M }))
  assert.equal(error.code, 'stage-radius-not-cluster-resolved')
  assert.equal(loader.loadFromDefinition('zero-declared', { name: 'zero-declared', planetRadius: 0 }).shape.id, 'flat')
  assert.equal(loader.loadFromDefinition('absent-declared', { name: 'absent-declared' }).shape.id, 'flat')
})

gate('entities load at their position, with a malformed position falling back to the origin', () => {
  const runtime = makeRuntime()
  const loader = new StageLoader(runtime, resolvers)
  loader.loadFromDefinition('placed', {
    name: 'placed',
    entities: [
      { id: 'a', position: [1, 2, 3], model: 'm.glb' },
      { id: 'b', position: [1, 2] },
      { id: 'c', position: [1, Number.NaN, 3] },
    ],
  })
  assert.deepEqual(runtime.getEntity('a').position, [1, 2, 3])
  assert.equal(runtime.getEntity('a').spawnConfig.autoTrimesh, true)
  assert.deepEqual(runtime.getEntity('b').position, [0, 0, 0])
  assert.deepEqual(runtime.getEntity('c').position, [0, 0, 0])
  assert.equal(runtime.getEntity('b').spawnConfig.autoTrimesh, undefined)
})

gate('an entity takes its body type from its own declaration first, then its app, and static is never honoured', () => {
  const appDefs = new Map([
    ['door', { server: { bodyType: 'kinematic' } }],
    ['crate', { bodyType: 'dynamic' }],
    ['ghost', { server: { bodyType: 'static' } }],
  ])
  const runtime = makeRuntime(appDefs)
  new StageLoader(runtime, resolvers).loadFromDefinition('bodies', {
    name: 'bodies',
    entities: [
      { id: 'd', app: 'door' },
      { id: 'c', app: 'crate' },
      { id: 'g', app: 'ghost' },
      { id: 'o', app: 'door', bodyType: 'dynamic' },
      { id: 'x', app: 'door', bodyType: 'static' },
    ],
  })
  assert.equal(runtime.getEntity('d').bodyType, 'kinematic')
  assert.equal(runtime.getEntity('c').bodyType, 'dynamic')
  assert.equal(runtime.getEntity('g').bodyType, undefined)
  assert.equal(runtime.getEntity('o').bodyType, 'dynamic')
  assert.equal(runtime.getEntity('x').bodyType, undefined)
})

gate('gravity is copied onto the runtime, and a world without gravity leaves it alone', () => {
  const runtime = makeRuntime()
  const loader = new StageLoader(runtime, resolvers)
  const gravity = [0, -5, 0]
  loader.loadFromDefinition('gravity', { name: 'gravity', gravity })
  assert.deepEqual(runtime.gravity, [0, -5, 0])
  gravity[1] = -99
  assert.deepEqual(runtime.gravity, [0, -5, 0])
  loader.loadFromDefinition('no-gravity', { name: 'no-gravity' })
  assert.deepEqual(runtime.gravity, [0, -5, 0])
})

gate('the first loaded stage stays active until setActiveStage names another, and a missing name is ignored', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  const first = loader.loadFromDefinition('first', FLAT_WORLD)
  const second = loader.loadFromDefinition('second', CLUSTER_WORLD)
  assert.equal(loader.getActiveStage(), first)
  assert.equal(loader.setActiveStage('missing'), undefined)
  assert.equal(loader.getActiveStage(), first)
  assert.equal(loader.setActiveStage('second'), second)
  assert.equal(loader.getActiveStage(), second)
  assert.equal(loader.getStage('missing'), null)
  assert.deepEqual(loader.allStages().map((s) => s.name), ['first', 'second'])
})

gate('queries with no active stage return empty lists, and a planet active stage refuses the horizontal query', () => {
  const runtime = makeRuntime()
  const loader = new StageLoader(runtime, resolvers)
  assert.deepEqual(loader.getNearbyEntities([0, 0, 0], 5), [])
  assert.deepEqual(loader.getRelevantEntities([0, 0, 0], 5), [])
  assert.deepEqual(loader.getRelevantEntitiesHorizontal([0, 0, 0], 5), [])
  assert.deepEqual(loader.getRelevantEntitiesForCell([0, 0, 0], 5), [])
  loader.loadFromDefinition('flat-world', {
    name: 'flat-world',
    entities: [{ id: 'e', position: [0, 0, 0] }],
  })
  assert.deepEqual(loader.getRelevantEntities([0, 0, 0], 5), ['e'])
  loader.loadFromDefinition('cluster-world', CLUSTER_WORLD)
  loader.setActiveStage('cluster-world')
  throwsMatching(() => loader.getRelevantEntitiesHorizontal([0, 0, 0], 5), /horizontal relevance query/)
})

gate('syncAllPositions moves dynamic entities in every loaded stage', () => {
  const runtime = makeRuntime()
  const loader = new StageLoader(runtime, resolvers)
  loader.loadFromDefinition('flat-world', { name: 'flat-world', entities: [{ id: 'mover', position: [0, 0, 0], bodyType: 'dynamic' }] })
  runtime._activeDynamicIds.add('mover')
  runtime.getEntity('mover').position = [77, 0, 0]
  assert.deepEqual(loader.getRelevantEntities([77, 0, 0], 3), [])
  loader.syncAllPositions()
  assert.deepEqual(loader.getRelevantEntities([77, 0, 0], 3), ['mover'])
})

gate('a declared playerModel is kept, and an absent one takes the default avatar', () => {
  const loader = new StageLoader(makeRuntime(), resolvers)
  assert.equal(loader.loadFromDefinition('custom', { name: 'custom', playerModel: 'hero.vrm' }).playerModel, 'hero.vrm')
  assert.equal(loader.loadFromDefinition('default', { name: 'default' }).playerModel, '/assets/default-avatar.vrm')
})

gate('the index refuses a query whose centre or extent is absent, NaN, infinite or negative', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  throwsMatching(() => index.nearby(undefined, 5), /got centre/)
  throwsMatching(() => index.nearby([Number.NaN, 0, 0], 5), /got centre/)
  throwsMatching(() => index.nearby([0, 0, 0], -1), /got radius -1/)
  throwsMatching(() => index.nearby([0, 0, 0], Number.POSITIVE_INFINITY), /got radius/)
  throwsMatching(() => index.nearby([0, 0, 0], '5'), /got radius/)
  throwsMatching(() => index.nearbyCylinder([0, 0, 0], 5, -1), /got halfHeight -1/)
  throwsMatching(() => index.nearbyCylinder([0, 0, 0], 5, Number.NaN), /got halfHeight NaN/)
  throwsMatching(() => index.nearest([0, 0, 0], '5'), /got radius/)
  assert.deepEqual(index.nearby([0, 0, 0], 1), ['a'])
})

gate('nearby is a three-dimensional sphere query and excludes what lies outside its radius', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [10, 0, 0])
  index.insert('c', [100, 0, 0])
  index.insert('up', [0, 50, 0])
  assert.deepEqual(index.nearby([0, 0, 0], 20).sort(), ['a', 'b'])
  assert.ok(!index.nearby([0, 0, 0], 20).includes('up'))
  assert.ok(index.nearby([0, 0, 0], 60).includes('up'))
})

gate('nearbyCylinder bounds height separately from its horizontal radius', () => {
  const index = new SpatialIndex()
  index.insert('up', [0, 50, 0])
  index.insert('far', [30, 0, 0])
  index.insert('sky', [0, 1000000, 0])
  assert.deepEqual(index.nearbyCylinder([0, 0, 0], 20, 60).sort(), ['up'])
  assert.deepEqual(index.nearbyCylinder([0, 0, 0], 20, 40), [])
  assert.ok(!index.nearbyCylinder([0, 0, 0], 20, 60).includes('far'))
  assert.deepEqual(index.nearbyCylinder([0, 0, 0], 20, Number.POSITIVE_INFINITY).sort(), ['sky', 'up'])
})

gate('a non-finite insert is ignored and a non-finite update removes the entity', () => {
  const index = new SpatialIndex()
  index.insert('nan', [Number.NaN, 0, 0])
  assert.equal(index.has('nan'), false)
  index.insert('ok', [1, 0, 1])
  assert.equal(index.has('ok'), true)
  index.update('ok', [Number.NaN, 0, 0])
  assert.equal(index.has('ok'), false)
  assert.equal(index.size, 0)
})

gate('remove drops an entity from every query and bumps mutations only when it held the id', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  const before = index.mutations
  index.remove('ghost')
  assert.equal(index.mutations, before)
  index.remove('a')
  assert.equal(index.mutations, before + 1)
  assert.deepEqual(index.nearby([0, 0, 0], 5), [])
  assert.equal(index.getPosition('a'), null)
})

gate('a move across a cell boundary re-buckets the entity, so queries find it at the new place only', () => {
  const index = new SpatialIndex()
  index.insert('w', [1, 0, 1])
  index.update('w', [40, 0, 40])
  assert.deepEqual(index.nearby([40, 0, 40], 2), ['w'])
  assert.deepEqual(index.nearby([1, 0, 1], 2), [])
})

gate('a move inside one cell under one metre squared does not bump mutations, a larger one does', () => {
  const index = new SpatialIndex()
  index.insert('s', [5, 0, 5])
  const settled = index.mutations
  index.update('s', [5.5, 0, 5.5])
  assert.equal(index.mutations, settled)
  assert.deepEqual(index.nearby([5.5, 0, 5.5], 0.1), ['s'])
  index.update('s', [7, 0, 5])
  assert.equal(index.mutations, settled + 1)
})

gate('an entity at a very large coordinate is found by a query at its own place and not at the origin', () => {
  const index = new SpatialIndex()
  const far = 2 ** 30 * 32
  index.insert('far', [far, 0, 0])
  assert.deepEqual(index.nearby([far, 0, 0], 1), ['far'])
  assert.deepEqual(index.nearby([0, 0, 0], 1), [])
})

gate('nearest returns the closest entity, breaking an exact tie by the smaller id, and null when none is in range', () => {
  const index = new SpatialIndex()
  index.insert('b', [10, 0, 0])
  index.insert('a', [-10, 0, 0])
  assert.equal(index.nearest([0, 0, 0], 20), 'a')
  index.insert('c', [3, 0, 0])
  assert.equal(index.nearest([0, 0, 0], 20), 'c')
  assert.equal(index.nearest([50, 0, 0], 1), null)
})

gate('the relevance radius falls back to 200 for an invalid value and bumps the geometry epoch only on a change', () => {
  const index = new SpatialIndex()
  assert.equal(index.relevanceRadius, 200)
  index.relevanceRadius = -1
  assert.equal(index.relevanceRadius, 200)
  assert.equal(index.geometryEpoch, 0)
  index.relevanceRadius = 50
  assert.equal(index.relevanceRadius, 50)
  assert.equal(index.geometryEpoch, 1)
  index.relevanceRadius = 50
  assert.equal(index.geometryEpoch, 1)
})

gate('an entity no viewer marks seen is reported starved on the fifth tick and an entity marked each tick never is', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [1, 0, 0])
  const reports = []
  for (let tick = 0; tick < 6; tick++) {
    index.markSeen('a', 'v')
    reports.push(index.collectStarved('v', 3))
  }
  assert.deepEqual(reports.slice(0, 4), [[], [], [], []])
  assert.deepEqual(reports[4], ['b'])
  assert.deepEqual(reports[5], [])
  assert.ok(reports.every((r) => !r.includes('a')))
})

gate('starvation is kept per viewer, and clearing a viewer restarts its count', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [1, 0, 0])
  const reports = []
  for (let tick = 0; tick < 5; tick++) reports.push(index.collectStarved('w', 3))
  assert.deepEqual(reports.slice(0, 4), [[], [], [], []])
  assert.deepEqual(reports[4], ['a', 'b'])
  index.clearStarvationKey('w')
  assert.deepEqual(index.collectStarved('w', 3), [])
})

gate('reseat keeps only the entities that return a finite position, at that position', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [1, 0, 0])
  index.reseat((id) => (id === 'a' ? [5, 0, 5] : null))
  assert.equal(index.has('b'), false)
  assert.deepEqual(index.getPosition('a'), [5, 0, 5])
  assert.deepEqual(index.nearby([5, 0, 5], 1), ['a'])
  assert.deepEqual(index.nearby([0, 0, 0], 0.5), [])
})

gate('rebuild keeps every query answer, and clear empties the index', () => {
  const index = new SpatialIndex()
  index.insert('a', [0, 0, 0])
  index.insert('b', [40, 0, 40])
  const before = index.nearby([0, 0, 0], 60).sort()
  assert.deepEqual(before, ['a', 'b'])
  index.rebuild()
  assert.deepEqual(index.nearby([0, 0, 0], 60).sort(), before)
  assert.equal(index.size, 2)
  index.clear()
  assert.equal(index.size, 0)
  assert.deepEqual(index.nearby([0, 0, 0], 60), [])
})

gate('getPosition returns a copy, so an edit to it does not move the entity', () => {
  const index = new SpatialIndex()
  index.insert('a', [2, 0, 2])
  const copy = index.getPosition('a')
  copy[0] = 900
  assert.deepEqual(index.getPosition('a'), [2, 0, 2])
  assert.equal(index.getPosition('nobody'), null)
})

finish()
