import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { configureWorld } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../src/engine/planetStream.js'
import { createEngineHeightAt } from '../src/engine/terrainHeight.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { capAreaKm2 } from '../src/engine/population.js'
import { densityFor } from '../src/engine/populationDensity.js'
import { VEG_GEN_INSTANCES_PER_FRAME, createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'
import { buildPlanetScene } from '../src/engine/planetScene.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GLUE = pathToFileURL(resolve(root, 'engine/out/engine-core-1024mib-threads.mjs')).href
const MIB = 1024 * 1024
const CAPACITY = 1024
const SLOTS = 64
const WARMUP_PATCHES = 64
const TIMED_PATCHES = 512
const PAGE_WINDOW = 5
const POLE_LAT = Math.PI / 2
const FAR_LAT = 0.3
const FAR_LON = 0.7

const capRadFor = (instances) => {
  let lo = 0
  let hi = 1e-3
  for (let k = 0; k < 200; k++) {
    const mid = (lo + hi) / 2
    if (densityFor('trees') * capAreaKm2(mid) < instances) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

const module = await loadEngineModule(GLUE, resolvePlan({ players: 1024, workers: 2, budgetBytes: 512 * MIB }))
configureWorld(module, solverIterationsFor(readLayout(module).players))
createPlanetStreamer(module, { window: PAGE_WINDOW })
const heightAt = createEngineHeightAt(module)
const gaps = () => Number(module._engine_planet_gap_queries())

const quantile = (sorted, q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]

const measure = (latRad, lonRad, capacity = CAPACITY, warmupPatches = WARMUP_PATCHES, timedPatches = TIMED_PATCHES) => {
  const capRad = capRadFor(capacity)
  const centre = { latRad, lonRad, capRad }
  const pool = createVegetationPool({
    plan: planVegetationPool({ maxBufferBytes: 256 * MIB, residentPatches: SLOTS, capacityPerPatch: capacity }),
    worldSeed: 1,
    heightAt,
    patchCentre: () => centre,
    now: () => performance.now(),
    generatePerFrame: Math.max(VEG_GEN_INSTANCES_PER_FRAME, capacity),
    cullRadiusM: PLANET_RADIUS_M * capRad + 100,
  })
  const ids = new Array(SLOTS)
  const times = []
  const gapsBefore = gaps()
  let next = 0
  while (next < warmupPatches + timedPatches) {
    for (let k = 0; k < SLOTS; k++) ids[k] = next + k
    pool.sync(ids)
    for (let k = 0; k < SLOTS; k++) {
      const before = pool.stats().generateMs
      const done = pool.step(capacity)
      assert.equal(done.patches, 1)
      if (next + k >= warmupPatches) times.push(pool.stats().generateMs - before)
    }
    next += SLOTS
  }
  const stats = pool.stats()
  const instances = stats.generatedInstances
  const sorted = times.slice().sort((a, b) => a - b)
  const sum = times.reduce((acc, t) => acc + t, 0)
  return {
    patches: stats.generated,
    timedPatches: times.length,
    instancesPerPatch: instances / stats.generated,
    gapQueries: gaps() - gapsBefore,
    heightQueries: instances,
    medianMs: quantile(sorted, 0.5),
    p95Ms: quantile(sorted, 0.95),
    maxMs: sorted[sorted.length - 1],
    meanMs: sum / times.length,
    minMs: sorted[0],
  }
}

const loaded = measure(POLE_LAT, 0)
const unloaded = measure(FAR_LAT, FAR_LON)
const scene = buildPlanetScene({ module, now: () => performance.now() })
const sceneReport = scene.report()
const sceneSized = measure(FAR_LAT, FAR_LON, sceneReport.vegetationPlan.capacityPerPatch, SLOTS, 2 * SLOTS)

const line = (name, m) => name + ': ' + m.timedPatches + ' patches of ' + m.instancesPerPatch + ' instances, median ' + m.medianMs.toFixed(4) + ' ms, mean ' + m.meanMs.toFixed(4) + ' ms, p95 ' + m.p95Ms.toFixed(4) + ' ms, max ' + m.maxMs.toFixed(4) + ' ms, min ' + m.minMs.toFixed(4) + ' ms, ' + (m.medianMs * 1e6 / m.instancesPerPatch).toFixed(1) + ' ns per instance at the median, height queries ' + m.heightQueries + ', outside a loaded page ' + m.gapQueries
console.log(line('loaded pages (pole, window ' + PAGE_WINDOW + ')', loaded))
console.log(line('no loaded page (lat ' + FAR_LAT + ', lon ' + FAR_LON + ')', unloaded))
console.log('budget ' + VEG_GEN_INSTANCES_PER_FRAME + ' instances per frame = ' + (VEG_GEN_INSTANCES_PER_FRAME / CAPACITY) + ' patches of ' + CAPACITY + ': median ' + (loaded.medianMs * VEG_GEN_INSTANCES_PER_FRAME / CAPACITY).toFixed(4) + ' ms, at the max ' + (loaded.maxMs * VEG_GEN_INSTANCES_PER_FRAME / CAPACITY).toFixed(4) + ' ms per frame on loaded pages')
console.log(line('scene-sized patches, warm (lat ' + FAR_LAT + ', lon ' + FAR_LON + ')', sceneSized))
console.log('planet scene, first build: ' + sceneReport.patches + ' patches of ' + sceneReport.vegetationPlan.capacityPerPatch + ' instances generated in ' + sceneReport.generateMs.toFixed(4) + ' ms, ' + (sceneReport.generateMs / sceneReport.patches).toFixed(4) + ' ms per patch, ' + (sceneReport.generateMs * 1e6 / sceneReport.generatedInstances).toFixed(1) + ' ns per instance')

gate('each timed patch on loaded pages holds 1024 instances, and every height query lands in a loaded page', () => {
  assert.equal(loaded.instancesPerPatch, CAPACITY)
  assert.equal(loaded.timedPatches, TIMED_PATCHES)
  assert.equal(loaded.gapQueries, 0)
})

gate('the control far from the loaded pages holds 1024 instances per patch, and every height query misses the pages', () => {
  assert.equal(unloaded.instancesPerPatch, CAPACITY)
  assert.equal(unloaded.timedPatches, TIMED_PATCHES)
  assert.equal(unloaded.gapQueries, unloaded.heightQueries)
})

gate('the scene-sized control times 128 patches of the planet scene capacity, 8439 instances each', () => {
  assert.equal(sceneSized.instancesPerPatch, 8439)
  assert.equal(sceneSized.timedPatches, 2 * SLOTS)
})

gate('every per-patch time is a finite positive number', () => {
  for (const m of [loaded, unloaded, sceneSized]) {
    assert.ok(Number.isFinite(m.maxMs) && m.minMs > 0)
  }
  assert.ok(sceneReport.generateMs > 0)
})

finish()
