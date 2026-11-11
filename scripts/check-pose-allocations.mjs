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
import { attachPoseRegion, poseRegionBuffers } from '../src/engine/poseRegion.js'
import { createPoseHandoffCore, createPoseStepper } from '../src/engine/poseHandoffCore.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const GLUE = pathToFileURL(resolve(root, 'engine/out/engine-core-512mib.mjs')).href
const FRAME_FILES = ['src/engine/poseHandoffCore.js', 'src/engine/poseRegion.js', 'src/engine/planetStream.js', 'src/engine/sceneSetup.js'].map((f) => pathToFileURL(resolve(root, f)).href)
const WARMUP_FRAMES = 2000
const COUNTED_FRAMES = 600
const SLOTS = 3
const MIB = 1024 * 1024

const started = Date.now()
const plan = resolvePlan({ players: 1024, workers: 1, budgetBytes: 512 * MIB })
const module = await loadEngineModule(GLUE, plan)
const layout = readLayout(module)
configureWorld(module, solverIterationsFor(layout.players))
const streamer = createPlanetStreamer(module)
const poseBytes = module._engine_pose_bytes()
const reserve = module._engine_pose_reserve()
const buffers = poseRegionBuffers({ slots: SLOTS, poseBytes })
const region = attachPoseRegion(buffers, { owner: true })
const stepper = createPoseStepper({ module, streamer, region, reserve })
let core = null
core = createPoseHandoffCore({ module, region, reserve, send: (slot) => core.receive(stepper(slot)) })

const expectedFrames = []
for (let f = 0; f < WARMUP_FRAMES; f++) core.request(f)

const controlHold = []
const session = new Session()
session.connect()
await session.post('HeapProfiler.enable')
await session.post('HeapProfiler.startSampling', { samplingInterval: 1, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
const countedStart = Date.now()
for (let f = WARMUP_FRAMES; f < WARMUP_FRAMES + COUNTED_FRAMES; f++) {
  core.request(f)
  controlHold.push({ frame: f })
  expectedFrames.push(core.handoff.imported)
}
const countedMs = Date.now() - countedStart
const { profile } = await session.post('HeapProfiler.stopSampling')
session.disconnect()

const WITNESS_FILE = pathToFileURL(fileURLToPath(import.meta.url)).href
const frameBytes = { total: 0, own: 0, control: 0 }
const walk = (node, inFrame) => {
  const here = inFrame || FRAME_FILES.includes(node.callFrame.url)
  if (node.selfSize > 0) {
    if (here) frameBytes.total += node.selfSize
    if (FRAME_FILES.includes(node.callFrame.url)) frameBytes.own += node.selfSize
    if (process.env.POSE_DEBUG && here) console.error('ALLOC', node.selfSize, node.callFrame.functionName, node.callFrame.url.split('/').slice(-1)[0], node.callFrame.lineNumber)
    if (node.callFrame.url === WITNESS_FILE) frameBytes.control += node.selfSize
  }
  for (const child of node.children) walk(child, here)
}
walk(profile.head, false)

const imported = expectedFrames.every((frame, i) => frame === WARMUP_FRAMES + i)
const wallMs = Date.now() - started

gate('the shared pose region carries 600 counted frames, each imported in order', () => {
  assert.equal(expectedFrames.length, COUNTED_FRAMES)
  assert.ok(imported, 'an imported frame differs from its request')
  assert.equal(core.handoff.failure, null)
  assert.equal(core.handoff.pending, 0)
})

gate('the frame-path code allocates zero bytes over 600 frames (its own allocations, heap sampled every allocation)', () => {
  assert.equal(frameBytes.own, 0, 'frame-path code allocated ' + frameBytes.own + ' bytes')
})

gate('the sampler attributes the witness control allocations to this file, so the zero above is not a blind sampler', () => {
  assert.equal(controlHold.length, COUNTED_FRAMES)
  assert.ok(frameBytes.control > 0, 'the control allocation was not sampled')
})

console.log(JSON.stringify({ frames: COUNTED_FRAMES, warmupFrames: WARMUP_FRAMES, countedMs, frameBytes: { ...frameBytes, inheritedFromFramePath: frameBytes.total - frameBytes.own }, poseBytes, slots: SLOTS, wallMs }))
finish()
