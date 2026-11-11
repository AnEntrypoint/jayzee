import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { PLANET_RADIUS_M, BODY_SPACING_M } from '../src/engine/sceneSetup.js'
import { createPlanetStreamer } from '../src/engine/planetStream.js'
import { attachPoseRegion, poseRegionBuffers } from '../src/engine/poseRegion.js'
import { createPoseStepper } from '../src/engine/poseHandoffCore.js'
import { WARM_DEFAULTS, warmEngine } from '../src/engine/warmEngine.js'
import { RECLAIM_DEFAULTS, watchCollected } from '../src/engine/memoryReclaim.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const GLUE = pathToFileURL(join(root, 'engine/out/engine-core-64mib-threads.mjs')).href
const MIB = 1024 * 1024
const BODIES = 512
const TICKS = 90
const SMALL_WARM = Object.freeze({ bodies: 256, ticks: 40 })

const fakeGlue = (message) => 'data:text/javascript,' + encodeURIComponent('export default () => { throw new Error(' + JSON.stringify(message) + ') }')

const poseDigest = async () => {
  const module = await loadEngineModule(GLUE, resolvePlan({ players: 64, workers: 2, budgetBytes: 64 * MIB }))
  assert.equal(module._engine_world_configure(BODIES, 60, -9.8, 0, 0.5, 0, 4), 0)
  for (let i = 0; i < BODIES; i++) module._engine_spawn((i % 32) * BODY_SPACING_M, PLANET_RADIUS_M + 1 + (i % 5), Math.floor(i / 32) * BODY_SPACING_M, 0, 0, 0)
  module._engine_world_optimize()
  const streamer = createPlanetStreamer(module, { baseY: PLANET_RADIUS_M })
  const poseBytes = module._engine_pose_bytes()
  const region = attachPoseRegion(poseRegionBuffers({ slots: 1, poseBytes }), { owner: true })
  const step = createPoseStepper({ module, streamer, region, reserve: module._engine_pose_reserve() })
  const hash = createHash('sha256')
  for (let frame = 0; frame < TICKS; frame++) {
    region.setFrame(0, frame)
    step(0)
    hash.update(region.view(0))
  }
  module.PThread.terminateAllThreads()
  return hash.digest('hex')
}

const cold = await poseDigest()
const warmed = await warmEngine(GLUE, SMALL_WARM)
const afterWarm = await poseDigest()
const reclaimed = await warmed.release()

gate('a warm run on the threaded glue reports its bodies, its ticks and a positive time', () => {
  assert.equal(warmed.warmed, true)
  assert.equal(warmed.reason, null)
  assert.equal(warmed.bodies, SMALL_WARM.bodies)
  assert.equal(warmed.ticks, SMALL_WARM.ticks)
  assert.ok(warmed.ms > 0, 'warm time ' + warmed.ms)
})

gate('a world stepped after a warm run has the same pose bytes on every one of ' + TICKS + ' ticks as a world stepped without it', () => {
  assert.equal(afterWarm, cold)
})

gate('release ends the warm instance threads, waits until its memory has been collected, and may be called again', async () => {
  assert.equal(reclaimed.collected, true, 'the warm instance was not collected after ' + reclaimed.nudges + ' nudges')
  assert.equal(reclaimed.watched, 2)
  assert.ok(reclaimed.nudges >= 1 && reclaimed.nudges <= RECLAIM_DEFAULTS.mostNudges)
  assert.deepEqual(await warmed.release(), { collected: false, watched: 0, nudges: 0, ms: 0 })
})

gate('control: with no nudge allowed the release does not wait and reports the memory as not collected', async () => {
  const quick = await warmEngine(GLUE, { ...SMALL_WARM, reclaim: { mostNudges: 0 } })
  const result = await quick.release()
  assert.equal(result.collected, false)
  assert.equal(result.nudges, 0)
  assert.equal(result.watched, 2)
})

gate('the watch nudges with dropped buffers, one loop turn apart, until every target is collected, then lets the loop turn to finish the sweep', async () => {
  const made = []
  let turns = 0
  const wait = watchCollected([{}, null, 7, {}], { nudgeBytes: 4096, mostNudges: 400, settleTurns: 3, makeBuffer: (bytes) => made.push(bytes) && new ArrayBuffer(32 * MIB), yieldToLoop: () => new Promise((done) => { turns += 1; setTimeout(done, 1) }) })
  const result = await wait()
  assert.equal(result.watched, 2)
  assert.equal(result.collected, true, 'not collected after ' + result.nudges + ' nudges')
  assert.equal(made.length, result.nudges)
  assert.ok(made.every((bytes) => bytes === 4096))
  assert.equal(turns, result.nudges + 3)
  assert.throws(() => watchCollected([], { mostNudges: -1 }), RangeError)
  assert.throws(() => watchCollected([], { nudgeBytes: 0 }), RangeError)
})

gate('the defaults are the 64-player plan with its whole body pool for 300 ticks', () => {
  assert.deepEqual({ ...WARM_DEFAULTS }, { players: 64, budgetBytes: 64 * MIB, bodies: 2048, ticks: 300 })
})

gate('a body count, tick count or player count that is not a whole number of at least 1 is refused', async () => {
  for (const spec of [{ bodies: 0 }, { bodies: 1.5 }, { ticks: 0 }, { ticks: NaN }, { players: 0 }, { bodies: '8' }]) {
    await assert.rejects(() => warmEngine(GLUE, spec), RangeError, JSON.stringify(spec))
  }
})

gate('a warm instance that cannot reserve its memory is reported, not thrown, and its release is a no-op', async () => {
  const result = await warmEngine(fakeGlue('WebAssembly.Memory(): could not allocate memory'))
  assert.equal(result.warmed, false)
  assert.match(result.reason, /could not reserve its memory/)
  assert.equal(result.bodies, 0)
  assert.equal(result.ticks, 0)
  result.release()
})

gate('any other failure of the warm instance is thrown', async () => {
  await assert.rejects(() => warmEngine(fakeGlue('unrelated failure')), /unrelated failure/)
})

gate('the physics worker warms before it loads its world and reports the warm run in its ready message', async () => {
  const { readFile } = await import('node:fs/promises')
  const worker = await readFile(join(root, 'src/engine/physicsWorker.js'), 'utf8')
  const warmAt = worker.indexOf('await warmEngine(glue')
  const loadAt = worker.indexOf('await loadEngineModule(glue')
  const releaseAt = worker.indexOf('warmed.release()')
  assert.ok(warmAt > 0 && loadAt > warmAt && releaseAt > loadAt, 'order: warm ' + warmAt + ', load ' + loadAt + ', release ' + releaseAt)
  assert.match(worker, /const reclaim = warmed \? await warmed\.release\(\) : null/, 'the worker reports ready before the warm memory is collected')
  assert.ok(worker.includes("new Worker(new URL('./warmWorker.js', import.meta.url), { type: 'module' })"), 'the warm instance is not in a worker of its own')
  assert.ok(worker.includes('const apart = warm !== false && spec.inline !== true'), 'the warm run is not apart by default')
  const settleAt = worker.indexOf('const settle = (act, value) => {')
  assert.ok(settleAt > 0 && worker.indexOf('worker.terminate()', settleAt) < worker.indexOf('act(value)', settleAt), 'the warm worker is not ended before its result is used')
  const warmWorker = await readFile(join(root, 'src/engine/warmWorker.js'), 'utf8')
  assert.ok(warmWorker.includes('await warmEngine(glue, spec)') && warmWorker.includes("type: 'warmed'"))
  assert.match(worker, /type: 'ready', poseBytes, warm:/)
})

finish()
