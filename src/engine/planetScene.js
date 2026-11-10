import { PLANET_RADIUS_M } from './sphere.js'
import { capAreaKm2, placePopulation } from './population.js'
import { densityFor } from './populationDensity.js'
import { createColliderSet } from './colliderLayers.js'
import { registerPopulation, registerTerrain } from './populationColliders.js'
import { createEngineHeightAt } from './terrainHeight.js'
import { arenaAllocator, canArenaAllocate } from './arenaAllocate.js'
import { VEG_GEN_INSTANCES_PER_FRAME, VEG_SPECIES, createVegetationPool, planVegetationPool } from './vegetation.js'

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
})

const need = (ok, message) => {
  if (!ok) throw new RangeError(message)
}

export const sceneSpec = (overrides = {}) => {
  const spec = { ...DEFAULT_SCENE, ...overrides }
  need(Number.isInteger(spec.entities) && spec.entities >= 1, 'entities must be a whole number at least 1')
  need(Number.isInteger(spec.patchSide) && spec.patchSide >= 1, 'patchSide must be a whole number at least 1')
  need(spec.capRad > 0 && spec.capRad < Math.PI / 4, 'capRad must be in (0, pi/4)')
  need(spec.radiusM > 0 && Number.isFinite(spec.radiusM), 'radiusM must be a positive finite number')
  need(spec.deviceBufferBytes > 0 && Number.isFinite(spec.deviceBufferBytes), 'deviceBufferBytes must be a positive finite number, read from the device once')
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
  const baseHeight = createEngineHeightAt(module, spec.radiusM)
  let heightCalls = 0
  const heightAt = (n) => {
    heightCalls += 1
    return baseHeight(n)
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
  const patchCapRad = (spec.capRad * Math.SQRT2) / side
  const patchTrees = Math.max(1, Math.round(densityFor('trees') * capAreaKm2(patchCapRad, spec.radiusM)))
  const patchCentre = (id) => {
    const i = id % side
    const j = Math.floor(id / side)
    return {
      latRad: spec.centreLatRad + (((j + 0.5) / side) * 2 - 1) * spec.capRad,
      lonRad: spec.centreLonRad + (((i + 0.5) / side) * 2 - 1) * spec.capRad,
      capRad: patchCapRad,
    }
  }
  const cullRadiusM = spec.radiusM * patchCapRad + PATCH_HEIGHT_MARGIN_M
  const plan = planVegetationPool({ maxBufferBytes: spec.deviceBufferBytes, residentPatches: side * side, capacityPerPatch: patchTrees })
  const inArena = allocate === undefined && canArenaAllocate(module)
  const vegetation = createVegetationPool({
    plan,
    species: VEG_SPECIES,
    worldSeed: spec.seed,
    heightAt,
    patchCentre,
    densityOf: () => densityFor('trees'),
    generatePerFrame: Math.max(VEG_GEN_INSTANCES_PER_FRAME, plan.capacityPerPatch),
    now,
    radiusM: spec.radiusM,
    cullRadiusM,
    allocate: inArena ? arenaAllocator(module) : allocate,
  })
  vegetation.sync(Array.from({ length: side * side }, (_, k) => k))
  const vegetationBound = inArena ? bindVegetation(module, vegetation, plan, cullRadiusM) : null
  let generateMs = 0
  if (generate) {
    const t0 = now()
    while (vegetation.stats().pending > 0) vegetation.step()
    generateMs = now() - t0
  }

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
      vegetationPlan: plan,
      vegetationBytes: vegetation.bytes(),
      vegetationBound,
    }
  }

  return { spec, area, population, colliders, vegetation, report }
}
