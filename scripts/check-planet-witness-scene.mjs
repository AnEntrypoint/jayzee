import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { PLANET, configureWorld } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../src/engine/planetStream.js'
import { WITNESS_ENTITY_CAP_M, WITNESS_PATCH_BLOCK, buildPlanetScene, witnessSceneSpec } from '../src/engine/planetScene.js'
import { patchLeaf } from '../src/engine/vegetationPatches.js'
import { createLeafBlock, createVegetationFollower } from '../src/engine/vegetationStream.js'
import { PATH_PERIOD_FRAMES } from '../src/engine/planetStream.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GLUE = pathToFileURL(resolve(root, 'engine/out/engine-core-1024mib-threads.mjs')).href
const MIB = 1024 * 1024
const BROWSER_PAGE_WINDOW = 8
const POLE_FACE = 2
const OUTSIDE_SHARE_LIMIT = 0.01

const sceneOn = async (spec, generateAfterPages) => {
  const module = await loadEngineModule(GLUE, resolvePlan({ players: 1024, workers: 2, budgetBytes: 512 * MIB }))
  configureWorld(module, solverIterationsFor(readLayout(module).players))
  if (!generateAfterPages) createPlanetStreamer(module, { window: BROWSER_PAGE_WINDOW })
  const scene = buildPlanetScene({ module, now: () => performance.now(), generate: !generateAfterPages, spec })
  if (generateAfterPages) {
    createPlanetStreamer(module, { window: BROWSER_PAGE_WINDOW })
    scene.generate()
  }
  return scene.report()
}

const orbit = async (spec) => {
  const module = await loadEngineModule(GLUE, resolvePlan({ players: 1024, workers: 2, budgetBytes: 512 * MIB }))
  configureWorld(module, solverIterationsFor(readLayout(module).players))
  const scene = buildPlanetScene({ module, now: () => performance.now(), generate: false, spec })
  const streamer = createPlanetStreamer(module, { window: BROWSER_PAGE_WINDOW })
  module._engine_page_apply()
  scene.generate()
  const block = createLeafBlock({ level: spec.patchLevel, block: WITNESS_PATCH_BLOCK })
  block.update(0, PLANET.radius, 0)
  const firstIds = block.ids.slice()
  const follow = createVegetationFollower({ scene, block, radiusM: PLANET.radius })
  const atStart = scene.report()
  for (let frame = 0; frame < PATH_PERIOD_FRAMES; frame++) {
    module._engine_page_apply()
    const spot = streamer.step(frame)
    follow(spot[0], spot[1], spot[2], streamer.pending)
  }
  return { atStart, atEnd: scene.report(), moves: block.moves, firstIds, lastIds: block.ids.slice() }
}

const spec = witnessSceneSpec(PLANET.radius)
const lap = await orbit(spec)
console.log('orbit ' + JSON.stringify({ moves: lap.moves, generatedAtStart: lap.atStart.generatedInstances, generatedAtEnd: lap.atEnd.generatedInstances, outsideAtEnd: lap.atEnd.generateHeightCallsOutsidePages, patches: lap.atEnd.patches, deferred: lap.atEnd.patchesDeferred }))
const witness = await sceneOn(spec, true)
const grid = await sceneOn({}, false)
console.log('witness scene ' + JSON.stringify({ ...witness, generateMs: undefined, vegetationPlan: undefined }))
console.log('default grid scene ' + JSON.stringify({ heightCalls: grid.heightCalls, placementHeightCallsOutsidePages: grid.placementHeightCallsOutsidePages, generateHeightCallsOutsidePages: grid.generateHeightCallsOutsidePages, generatedInstances: grid.generatedInstances }))

gate('the witness scene uses the engine radius and a block of quadtree leaves around the pole face centre, where the streamer loads its pages', () => {
  assert.equal(spec.radiusM, PLANET.radius)
  assert.equal(spec.patchIds.length, WITNESS_PATCH_BLOCK * WITNESS_PATCH_BLOCK)
  const side = 2 ** spec.patchLevel
  for (const id of spec.patchIds) {
    const leaf = patchLeaf(id)
    assert.equal(leaf.face, POLE_FACE)
    assert.equal(leaf.level, spec.patchLevel)
    assert.ok(Math.abs(leaf.tx + 0.5 - side / 2) <= WITNESS_PATCH_BLOCK / 2 && Math.abs(leaf.ty + 0.5 - side / 2) <= WITNESS_PATCH_BLOCK / 2)
  }
  assert.equal(spec.capRad, WITNESS_ENTITY_CAP_M / PLANET.radius)
})

gate('every patch of the witness scene is resident and generated, with none deferred', () => {
  assert.equal(witness.patches, spec.patchIds.length)
  assert.equal(witness.patchesDeferred, 0)
  assert.equal(witness.generatedInstances, witness.patches * witness.vegetationPlan.capacityPerPatch)
  assert.equal(witness.vegetationBound, true)
})

gate('vegetation generated after the pages are staged reads its heights from loaded pages: under 1 percent of the instance height calls fall outside', () => {
  assert.ok(witness.generateHeightCallsOutsidePages <= witness.generatedInstances * OUTSIDE_SHARE_LIMIT, witness.generateHeightCallsOutsidePages + ' of ' + witness.generatedInstances + ' instance heights fell outside the loaded pages')
})

gate('control: the default grid scene at latitude 0.3 reads no loaded page at all, so the gate above is not vacuous', () => {
  assert.equal(grid.placementHeightCallsOutsidePages + grid.generateHeightCallsOutsidePages, grid.heightCalls)
})

gate('one lap of the camera orbit moves the leaf block, streams patches in and out with none deferred, and keeps the heights on loaded pages', () => {
  assert.deepEqual(lap.firstIds, spec.patchIds)
  assert.ok(lap.moves >= 4, 'the block moved only ' + lap.moves + ' times')
  assert.ok(lap.atEnd.generatedInstances > lap.atStart.generatedInstances, 'no patch was generated during the lap')
  assert.equal(lap.atEnd.patches, spec.patchIds.length)
  assert.equal(lap.atEnd.patchesDeferred, 0)
  assert.ok(lap.atEnd.generateHeightCallsOutsidePages <= lap.atEnd.generatedInstances * OUTSIDE_SHARE_LIMIT, lap.atEnd.generateHeightCallsOutsidePages + ' of ' + lap.atEnd.generatedInstances + ' instance heights fell outside the loaded pages')
})

finish()
