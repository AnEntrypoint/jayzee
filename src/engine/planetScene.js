import { PLANET_RADIUS_M } from './sphere.js'
import { createLeafPatchCentre, leafPatchId, vegetationLevelFor } from './vegetationPatches.js'
import { capAreaKm2, placePopulation } from './population.js'
import { densityFor } from './populationDensity.js'
import { createColliderSet } from './colliderLayers.js'
import { registerPopulation, registerTerrain } from './populationColliders.js'
import { canEngineHeightInto, createEngineHeightAt, createEngineHeightInto } from './terrainHeight.js'
import { arenaAllocator, canArenaAllocate } from './arenaAllocate.js'
import { VEG_GEN_INSTANCES_PER_FRAME, VEG_SPECIES, createVegetationPool, planVegetationPool } from './vegetation.js'
import { createVegetationDetail } from './vegetationDetail.js'

export const PLANET_ENTITY_COUNT = 1024
export const PATCH_HEIGHT_MARGIN_M = 100

export const DEFAULT_SCENE = Object.freeze({
  seed: 1,
  capRad: 1e-4,
  centreLatRad: 0.3,
  centreLonRad: 0.7,
  entities: PLANET_ENTITY_COUNT,
  patchSide: 4,
  deviceBufferBytes: 256 * 1024 * 1024,
  radiusM: PLANET_RADIUS_M,
  patchIds: null,
  instanceBudget: null,
  fullDetailM: 150,
})

export const WITNESS_PATCH_CAPACITY = 256
export const WITNESS_PATCH_BLOCK = 4
export const WITNESS_ENTITY_CAP_M = 120
const POLE_FACE = 2

export const witnessSceneSpec = (radiusM, capacityPerPatch = WITNESS_PATCH_CAPACITY, block = WITNESS_PATCH_BLOCK) => {
  const level = vegetationLevelFor({ capacityPerPatch, densityPerKm2: densityFor('trees'), radiusM })
  const first = 2 ** (level - 1) - block / 2
  const patchIds = []
  for (let j = 0; j < block; j++) for (let i = 0; i < block; i++) patchIds.push(leafPatchId(POLE_FACE, level, first + i, first + j))
  return { centreLatRad: Math.PI / 2, centreLonRad: 0, capRad: WITNESS_ENTITY_CAP_M / radiusM, radiusM, patchIds, patchLevel: level }
}

const need = (ok, message) => {
  if (!ok) throw new RangeError(message)
}

export const sceneSpec = (overrides = {}) => {
  const spec = { ...DEFAULT_SCENE, ...overrides }
  need(Number.isInteger(spec.entities) && spec.entities >= 1, 'entities must be a whole number at least 1')
  need(Number.isInteger(spec.patchSide) && spec.patchSide >= 1, 'patchSide must be a whole number at least 1')
  need(spec.capRad > 0 && spec.capRad < Math.PI / 4, 'capRad must be in (0, pi/4)')
  need(spec.radiusM > 0 && Number.isFinite(spec.radiusM), 'radiusM must be a positive finite number')
  need(spec.patchIds === null || (Array.isArray(spec.patchIds) && spec.patchIds.length >= 1 && spec.patchIds.every((id) => Number.isSafeInteger(id) && id >= 0) && new Set(spec.patchIds).size === spec.patchIds.length), 'patchIds must be null or a list of distinct quadtree leaf patch ids')
  need(spec.deviceBufferBytes > 0 && Number.isFinite(spec.deviceBufferBytes), 'deviceBufferBytes must be a positive finite number, read from the device once')
  need(spec.instanceBudget === null || (Number.isInteger(spec.instanceBudget) && spec.instanceBudget >= 0), 'instanceBudget must be null or a whole number of shown instances, chosen from the device budget once')
  need(spec.fullDetailM > 0 && Number.isFinite(spec.fullDetailM), 'fullDetailM must be a positive finite distance in metres')
  return spec
}

const bindVegetation = (module, vegetation, plan, cullRadiusM) => {
  const memory = vegetation.memory()
  const status = module._engine_vegetation_bind(
    memory.block.byteOffset,
    memory.counts.byteOffset,
    memory.dirty.byteOffset,
    memory.origins.byteOffset,
    cullRadiusM,
    VEG_SPECIES.length,
    plan.slots,
    plan.capacityPerPatch,
  )
  return status === 1
}

export const buildPlanetScene = ({ spec: overrides = {}, module, now, generate = true, allocate }) => {
  const spec = sceneSpec(overrides)
  if (typeof now !== 'function') throw new TypeError('buildPlanetScene needs now(), the injected clock')
  const gapQueries = () => (typeof module._engine_planet_gap_queries === 'function' ? Number(module._engine_planet_gap_queries()) : null)
  const gapsAtStart = gapQueries()
  const baseHeight = createEngineHeightAt(module, spec.radiusM)
  let heightCalls = 0
  const heightAt = (n) => {
    heightCalls += 1
    return baseHeight(n)
  }
  const baseHeightInto = canEngineHeightInto(module) ? createEngineHeightInto(module, spec.radiusM) : null
  const heightInto = baseHeightInto === null ? undefined : (n, out) => {
    heightCalls += 1
    baseHeightInto(n, out)
  }

  const area = capAreaKm2(spec.capRad, spec.radiusM)
  const population = placePopulation({
    seed: spec.seed,
    densityPerKm2: spec.entities / area,
    centreLatRad: spec.centreLatRad,
    centreLonRad: spec.centreLonRad,
    capRad: spec.capRad,
    radiusM: spec.radiusM,
    heightAt,
  })
  need(population.count === spec.entities, 'population count ' + population.count + ' is not the entity count ' + spec.entities)
  const trees = Math.round(densityFor('trees') * area)

  const colliders = createColliderSet()
  registerTerrain(colliders)
  for (let i = 0; i < population.count; i++) colliders.add('body-' + i, 'body')
  registerPopulation(colliders, 'trees', trees, 'tree')

  const side = spec.patchSide
  const leafCentre = spec.patchIds === null ? null : createLeafPatchCentre()
  const patchIds = spec.patchIds === null ? Array.from({ length: side * side }, (_, k) => k) : spec.patchIds
  const patchCapRad = leafCentre === null ? (spec.capRad * Math.SQRT2) / side : Math.max(...patchIds.map((id) => leafCentre(id).capRad))
  const patchTrees = Math.max(1, Math.round(densityFor('trees') * capAreaKm2(patchCapRad, spec.radiusM)))
  const gridCentre = (id, out = { latRad: 0, lonRad: 0, capRad: 0 }) => {
    const i = id % side
    const j = Math.floor(id / side)
    out.latRad = spec.centreLatRad + (((j + 0.5) / side) * 2 - 1) * spec.capRad
    out.lonRad = spec.centreLonRad + (((i + 0.5) / side) * 2 - 1) * spec.capRad
    out.capRad = patchCapRad
    return out
  }
  const patchCentre = leafCentre === null ? gridCentre : leafCentre
  const cullRadiusM = spec.radiusM * patchCapRad + PATCH_HEIGHT_MARGIN_M
  const plan = planVegetationPool({ maxBufferBytes: spec.deviceBufferBytes, residentPatches: patchIds.length, capacityPerPatch: patchTrees })
  const inArena = allocate === undefined && canArenaAllocate(module)
  const vegetation = createVegetationPool({
    plan,
    species: VEG_SPECIES,
    worldSeed: spec.seed,
    heightAt,
    heightInto,
    patchCentre,
    densityOf: () => densityFor('trees'),
    generatePerFrame: Math.max(VEG_GEN_INSTANCES_PER_FRAME, plan.capacityPerPatch),
    now,
    radiusM: spec.radiusM,
    cullRadiusM,
    allocate: inArena ? arenaAllocator(module) : allocate,
  })
  vegetation.sync(patchIds)
  const vegetationBound = inArena ? bindVegetation(module, vegetation, plan, cullRadiusM) : null
  let generateMs = 0
  let generateHeightCallsOutsidePages = gapsAtStart === null ? null : 0
  const generatePending = () => {
    const gapsBefore = gapQueries()
    const t0 = now()
    while (vegetation.stats().pending > 0) vegetation.step()
    generateMs += now() - t0
    if (gapsBefore !== null) generateHeightCallsOutsidePages += gapQueries() - gapsBefore
  }
  const detail = spec.instanceBudget === null ? null : createVegetationDetail({ pool: vegetation, instanceBudget: spec.instanceBudget, fullDetailM: spec.fullDetailM })
  const streamStep = (patchIdsNow, eyeX, eyeY, eyeZ) => {
    const gapsBefore = gapQueries()
    if (patchIdsNow !== null) vegetation.sync(patchIdsNow)
    vegetation.step()
    if (detail !== null && eyeX !== undefined) detail.update(eyeX, eyeY, eyeZ)
    if (gapsBefore !== null) generateHeightCallsOutsidePages += gapQueries() - gapsBefore
  }
  const placementHeightCallsOutsidePages = gapsAtStart === null ? null : gapQueries() - gapsAtStart
  if (generate) generatePending()

  const report = () => {
    const stats = vegetation.stats()
    return {
      entities: population.count,
      trees,
      colliderCounts: colliders.counts(),
      stepCost: colliders.stepCost(),
      patches: stats.resident,
      patchesDeferred: stats.deferred,
      generatedInstances: stats.generatedInstances,
      generateMs,
      heightCalls,
      placementHeightCallsOutsidePages,
      generateHeightCallsOutsidePages,
      patchLevel: spec.patchLevel ?? null,
      vegetationPlan: plan,
      vegetationBytes: vegetation.bytes(),
      vegetationBound,
      shownInstances: vegetation.shownTotal(),
      instanceBudget: spec.instanceBudget,
      detailBias: detail === null ? null : detail.governor.stats.bias,
    }
  }

  return { spec, area, population, colliders, vegetation, detail, report, generate: generatePending, streamStep }
}
