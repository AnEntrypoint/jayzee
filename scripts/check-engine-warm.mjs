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
warmed.release()

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

gate('release ends the warm instance threads and may be called again', () => {
  warmed.release()
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
  assert.match(worker, /type: 'ready', poseBytes, warm:/)
})

finish()
