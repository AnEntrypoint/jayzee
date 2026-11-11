import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { configureWorld } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { PATH_WINDOW, createPlanetStreamer } from '../src/engine/planetStream.js'
import { PAGE_SIDE } from '../src/engine/pageLayout.js'
import { F32, TRANSFORM_STRIDE_FLOATS } from '../src/engine/sharedData.js'
import { buildPlanetScene } from '../src/engine/planetScene.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GLUE = pathToFileURL(resolve(root, 'engine/out/engine-core-1024mib-threads.mjs')).href
const MIB = 1024 * 1024
const VERTICES_PER_TRIANGLE = 3
const PAGE_HEIGHT_BYTES = PAGE_SIDE * PAGE_SIDE * F32

const module = await loadEngineModule(GLUE, resolvePlan({ players: 1024, workers: 2, budgetBytes: 512 * MIB }))
configureWorld(module, solverIterationsFor(readLayout(module).players))
createPlanetStreamer(module)
const gapsBefore = Number(module._engine_planet_gap_queries())
const scene = buildPlanetScene({ module, now: () => performance.now() })
const report = scene.report()
const heightQueriesOutsidePages = Number(module._engine_planet_gap_queries()) - gapsBefore
const sharing = scene.vegetation.sharing(PAGE_HEIGHT_BYTES)
const instancesOnly = scene.vegetation.sharing(0)

const frameHeader = readFileSync(resolve(root, 'engine/src/render/render_frame.h'), 'utf8')
const constant = (name) => {
  const found = frameHeader.match(new RegExp('constexpr std::uint32_t ' + name + ' = ([^;]+);'))
  assert.ok(found, 'render_frame.h has no ' + name)
  return found[1].trim()
}

console.log('planet scene report ' + JSON.stringify({ ...report, generateMs: undefined }))
console.log('planet scene area ' + scene.area + ' km2, generate ' + report.generateMs.toFixed(3) + ' ms, height queries outside loaded pages ' + heightQueriesOutsidePages + ' of ' + report.heightCalls)
console.log('sharing(' + PAGE_HEIGHT_BYTES + ') ' + JSON.stringify(sharing))
console.log('sharing(0) ' + JSON.stringify(instancesOnly))

gate('object counts on the Node engine: 1024 entities and 67509 trees over the 1.2708 km2 cap', () => {
  assert.equal(report.entities, 1024)
  assert.equal(report.trees, 67509)
  assert.equal(scene.population.count, 1024)
  assert.equal(scene.area.toFixed(4), '1.2708')
})

gate('collider counts: one very static, 67509 static and 1024 dynamic, and only the dynamic layer costs a step', () => {
  assert.deepEqual(report.colliderCounts, { 'very-static': 1, static: 67509, dynamic: 1024 })
  assert.deepEqual(report.stepCost, { 'very-static': 0, static: 0, dynamic: 1024 })
})

gate('patch counts: 16 resident patches of 8439 instances, none deferred, 135024 instances in 8641536 bytes bound to the engine arena', () => {
  assert.equal(report.patches, 16)
  assert.equal(report.patchesDeferred, 0)
  assert.deepEqual(report.vegetationPlan, { slots: 16, capacityPerPatch: 8439, slotBytes: 540096, bytesPerSpecies: 8641536, bound: 'patches' })
  assert.equal(report.generatedInstances, 135024)
  assert.equal(report.vegetationBytes, 8641536)
  assert.equal(report.vegetationBytes, report.generatedInstances * TRANSFORM_STRIDE_FLOATS * F32)
  assert.equal(report.vegetationBound, true)
  assert.equal(report.heightCalls, 136048)
  assert.equal(report.heightCalls, report.entities + report.generatedInstances)
})

gate('the vegetation instances are twice the tree colliders: the 16 patch caps cover twice the scene cap', () => {
  assert.equal(report.generatedInstances, 2 * report.trees + 6)
  assert.ok(heightQueriesOutsidePages <= report.heightCalls)
})

gate('sharing counts: with a 1024-byte page per patch the shared layout avoids 135040 copies and 1636672 bytes, and 1620288 bytes for the instances alone', () => {
  assert.equal(PAGE_HEIGHT_BYTES, 1024)
  assert.deepEqual(sharing, { renderBytes: 8657920, physicsBytesIfCopied: 1636672, sharedBytes: 8657920, bytesSaved: 1636672, copiesSaved: 135040 })
  assert.deepEqual(instancesOnly, { renderBytes: 8641536, physicsBytesIfCopied: 1620288, sharedBytes: 8641536, bytesSaved: 1620288, copiesSaved: 135040 })
})

gate('triangle counts before culling, from the draw constants: 12 per vegetation instance is 1620288, and 450 per terrain page over 16 pages is 7200', () => {
  assert.equal(constant('kPropVertices'), '36')
  assert.equal(constant('kPageQuads'), 'kPageSide - 1')
  assert.equal(constant('kPageVertices'), '6 * kPageQuads * kPageQuads')
  const perInstance = 36 / VERTICES_PER_TRIANGLE
  const perPage = (6 * (PAGE_SIDE - 1) * (PAGE_SIDE - 1)) / VERTICES_PER_TRIANGLE
  const pages = 4 * PATH_WINDOW * PATH_WINDOW
  assert.equal(perInstance, 12)
  assert.equal(report.generatedInstances * perInstance, 1620288)
  assert.equal(perPage, 450)
  assert.equal(pages, 16)
  assert.equal(pages * perPage, 7200)
})

finish()
