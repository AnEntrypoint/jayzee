import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { Session } from 'node:inspector/promises'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { configureWorld } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../src/engine/planetStream.js'
import { buildPlanetScene } from '../src/engine/planetScene.js'
import { createEngineHeightAt, createEngineHeightInto } from '../src/engine/terrainHeight.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { densityFor } from '../src/engine/populationDensity.js'
import { createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'
import { createLeafPatchCentre, leafPatchId, vegetationLevelFor } from '../src/engine/vegetationPatches.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GLUE = pathToFileURL(resolve(root, 'engine/out/engine-core-1024mib-threads.mjs')).href
const FRAME_FILES = ['src/engine/vegetation.js', 'src/engine/vegetationPatches.js', 'src/engine/planetScene.js', 'src/engine/terrainHeight.js', 'src/engine/population.js', 'src/engine/populationDensity.js', 'src/engine/sharedData.js', 'src/engine/arenaAllocate.js', 'src/terrain-pure/cubeSphereCells.js'].map((f) => pathToFileURL(resolve(root, f)).href)
const WITNESS_FILE = pathToFileURL(fileURLToPath(import.meta.url)).href
const WARMUP_FRAMES = 6000
const COUNTED_FRAMES = 600
const SHIFT_EVERY = 2
const GENERATING_FRAMES = COUNTED_FRAMES / SHIFT_EVERY
const PATCH_SIDE = 4
const PATCHES = PATCH_SIDE * PATCH_SIDE
const SCENE_CAP_RAD = 3.4e-5
const POLE_LAT = Math.PI / 2
const PAGE_WINDOW = 5
const LEAF_CAPACITY = 1024
const BOXED_DOUBLE_BYTES = 16
const LEAF_BYTES_PER_ENTERING_PATCH = 1024
const CLOCK_READS_PER_STEP = 2
const MIB = 1024 * 1024

const started = Date.now()
const module = await loadEngineModule(GLUE, resolvePlan({ players: 1024, workers: 2, budgetBytes: 512 * MIB }))
configureWorld(module, solverIterationsFor(readLayout(module).players))
createPlanetStreamer(module, { window: PAGE_WINDOW })
const gapQueries = () => Number(module._engine_planet_gap_queries())
const tickClock = () => {
  let tick = 0
  return () => (tick += 1)
}

const sweep = (f) => {
  const t = Math.floor(f / SHIFT_EVERY) % (2 * PATCHES)
  return t < PATCHES ? t : 2 * PATCHES - t
}

const sceneArm = (now) => {
  const scene = buildPlanetScene({ module, now, spec: { capRad: SCENE_CAP_RAD, patchSide: PATCH_SIDE, centreLatRad: POLE_LAT, centreLonRad: 0 } })
  const ids = Array.from({ length: PATCHES }, (_, k) => k)
  return {
    pool: scene.vegetation,
    capacity: scene.report().vegetationPlan.capacityPerPatch,
    frame: (f) => {
      const base = sweep(f)
      for (let k = 0; k < PATCHES; k++) ids[k] = base + k
      scene.vegetation.sync(ids)
      return scene.vegetation.step().patches
    },
  }
}

const leafArm = (byArray = true) => {
  const level = vegetationLevelFor({ capacityPerPatch: LEAF_CAPACITY, densityPerKm2: densityFor('trees') })
  const side = 2 ** level
  const first = leafPatchId(2, level, side / 2 - 4, side / 2)
  const pool = createVegetationPool({
    plan: planVegetationPool({ maxBufferBytes: 256 * MIB, residentPatches: PATCHES, capacityPerPatch: LEAF_CAPACITY }),
    worldSeed: 1,
    heightAt: createEngineHeightAt(module),
    heightInto: byArray ? createEngineHeightInto(module) : undefined,
    patchCentre: createLeafPatchCentre(),
    now: tickClock(),
    cullRadiusM: (2 * PLANET_RADIUS_M) / side,
  })
  const ids = Array.from({ length: PATCHES }, (_, k) => first + k)
  return {
    pool,
    capacity: LEAF_CAPACITY,
    first,
    frame: (f) => {
      const base = first + sweep(f)
      for (let k = 0; k < PATCHES; k++) ids[k] = base + k
      pool.sync(ids)
      return pool.step().patches
    },
  }
}

const measure = async (arm, moving = true) => {
  for (let f = 0; f < WARMUP_FRAMES; f++) arm.frame(f)
  if (!moving) arm.frame(WARMUP_FRAMES)
  const warm = arm.pool.stats()
  const gapsBefore = gapQueries()
  const controlHold = []
  let generatedInWindow = 0
  const session = new Session()
  session.connect()
  await session.post('HeapProfiler.enable')
  await session.post('HeapProfiler.startSampling', { samplingInterval: 1, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const countedStart = Date.now()
  for (let f = WARMUP_FRAMES; f < WARMUP_FRAMES + COUNTED_FRAMES; f++) {
    generatedInWindow += arm.frame(moving ? f : WARMUP_FRAMES)
    controlHold.push({ frame: f })
  }
  const countedMs = Date.now() - countedStart
  const { profile } = await session.post('HeapProfiler.stopSampling')
  session.disconnect()
  const after = arm.pool.stats()
  const bytes = { underPath: 0, own: 0, control: 0 }
  const sites = new Map()
  const walk = (node, inPath) => {
    const own = FRAME_FILES.includes(node.callFrame.url)
    const here = inPath || own
    if (node.selfSize > 0) {
      const site = node.callFrame.url.split('/').slice(-1)[0] + ':' + (node.callFrame.lineNumber + 1) + ' ' + (node.callFrame.functionName || '(anonymous)')
      if (here) {
        bytes.underPath += node.selfSize
        sites.set(site, (sites.get(site) ?? 0) + node.selfSize)
      }
      if (own) bytes.own += node.selfSize
      if (node.callFrame.url === WITNESS_FILE && !inPath) bytes.control += node.selfSize
    }
    for (const child of node.children) walk(child, here)
  }
  walk(profile.head, false)
  return {
    bytes,
    sites: [...sites].map(([site, size]) => size + ' bytes at ' + site),
    controlPushes: controlHold.length,
    generatedInWindow,
    generated: after.generated - warm.generated,
    instances: after.generatedInstances - warm.generatedInstances,
    heightQueriesOutsidePages: gapQueries() - gapsBefore,
    resident: after.resident,
    pending: after.pending,
    deferred: after.deferred,
    poolBytes: arm.pool.bytes(),
    capacity: arm.capacity,
    countedMs,
  }
}

const blockOf = (arm) => {
  const gapsBefore = gapQueries()
  arm.frame(0)
  while (arm.pool.stats().pending > 0) arm.pool.step()
  const block = arm.pool.memory().block
  return { bytes: Buffer.from(block.buffer, block.byteOffset, block.byteLength).toString('base64'), instances: arm.pool.stats().generatedInstances, outsidePages: gapQueries() - gapsBefore }
}
const byArray = blockOf(leafArm(true))
const byReturn = blockOf(leafArm(false))

const integerClock = await measure(sceneArm(tickClock()))
const wallClock = await measure(sceneArm(() => performance.now()))
const leaves = leafArm()
const leafIds = await measure(leaves)
const leafIdle = await measure(leaves, false)

const steady = (m, generating = GENERATING_FRAMES) => {
  assert.equal(m.generatedInWindow, generating)
  assert.equal(m.generated, generating)
  assert.ok(m.instances <= generating * m.capacity)
  assert.equal(m.resident, PATCHES)
  assert.equal(m.pending, 0)
  assert.equal(m.deferred, 0)
  assert.equal(m.poolBytes, PATCHES * m.capacity * 64)
}

const listed = (m) => m.bytes.underPath + ' bytes under the path, ' + m.bytes.own + ' in its own files: ' + m.sites.join(', ')

gate('each counted window is the steady state: a patch leaves and a patch enters every second frame, each is generated, half the frames generate nothing, and the pool neither grows nor defers', () => {
  steady(integerClock)
  steady(wallClock)
  steady(leafIds)
  steady(leafIdle, 0)
  assert.equal(integerClock.instances, GENERATING_FRAMES * integerClock.capacity)
  assert.ok(integerClock.heightQueriesOutsidePages < integerClock.instances, 'control: some heights come from loaded pages')
  assert.ok(integerClock.heightQueriesOutsidePages > 0, 'control: some heights come from outside the loaded pages')
})

gate('the typed height channel writes the same instance bytes as heightAt, with heights from loaded pages among them', () => {
  assert.equal(byArray.instances, byReturn.instances)
  assert.ok(byArray.instances > 0)
  assert.ok(byArray.outsidePages < byArray.instances, 'control: some heights come from loaded pages')
  assert.equal(byArray.bytes, byReturn.bytes)
})

gate('vegetation sync and step allocate zero bytes over 600 frames on the planet scene with an integer clock, in their own files and in everything they call (heap sampled at every allocation)', () => {
  assert.equal(integerClock.bytes.own, 0, listed(integerClock))
  assert.equal(integerClock.bytes.underPath, 0, listed(integerClock))
})

gate('with performance.now as the clock, the only bytes are the clock readings: at most two boxed doubles per generating step', () => {
  const ceiling = GENERATING_FRAMES * CLOCK_READS_PER_STEP * BOXED_DOUBLE_BYTES
  assert.ok(wallClock.bytes.underPath <= ceiling, 'above ' + ceiling + ': ' + listed(wallClock))
})

gate('quadtree leaf patch ids past 32 bits: a frame where no patch enters allocates zero bytes', () => {
  assert.ok(leaves.first > 2 ** 32, 'control: the ids are past 32 bits')
  assert.equal(leafIdle.bytes.own, 0, listed(leafIdle))
  assert.equal(leafIdle.bytes.underPath, 0, listed(leafIdle))
})

gate('quadtree leaf patch ids past 32 bits: a patch that enters costs at most 1024 bytes, none of them per instance', () => {
  const ceiling = GENERATING_FRAMES * LEAF_BYTES_PER_ENTERING_PATCH
  assert.ok(leafIds.bytes.underPath <= ceiling, 'above ' + ceiling + ': ' + listed(leafIds))
  assert.ok(leafIds.bytes.underPath < leafIds.instances, 'control: fewer bytes than instances, so no instance allocates')
})

gate('the sampler attributes the witness control allocations to this file in every window, so the zeros above are not a blind sampler', () => {
  for (const m of [integerClock, wallClock, leafIds, leafIdle]) {
    assert.equal(m.controlPushes, COUNTED_FRAMES)
    assert.ok(m.bytes.control > 0, 'the control allocation was not sampled')
  }
})

const summary = (m) => ({ bytes: m.bytes, sites: m.sites, generated: m.generated, instances: m.instances, capacityPerPatch: m.capacity, heightQueriesOutsidePages: m.heightQueriesOutsidePages, countedMs: m.countedMs })
console.log(JSON.stringify({ frames: COUNTED_FRAMES, warmupFrames: WARMUP_FRAMES, patches: PATCHES, integerClock: summary(integerClock), wallClock: summary(wallClock), leafIds: summary(leafIds), leafIdle: summary(leafIdle), wallMs: Date.now() - started }))
finish()
