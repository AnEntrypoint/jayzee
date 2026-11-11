import { loadEngineModule, resolvePlan } from './EngineWorld.js'
import { configureWorld } from './sceneSetup.js'
import { createPlanetStreamer } from './planetStream.js'
import { attachPoseRegion } from './poseRegion.js'
import { createPoseStepper } from './poseHandoffCore.js'

let tickSlot = null
let tickMs = null
let tickCount = 0

const timedTick = (slot) => {
  const at = performance.now()
  const out = tickSlot(slot)
  if (tickCount < tickMs.length) tickMs[tickCount] = performance.now() - at
  tickCount += 1
  return out
}

const boot = async ({ glue, players, budgetBytes, workers, solverIterations, path, pose, timeTicks }) => {
  const module = await loadEngineModule(glue, resolvePlan({ players, budgetBytes, workers }))
  configureWorld(module, solverIterations)
  const streamer = createPlanetStreamer(module, path)
  const poseBytes = module._engine_pose_bytes()
  const reserve = module._engine_pose_reserve()
  const region = attachPoseRegion(pose)
  tickSlot = createPoseStepper({ module, streamer, region, reserve })
  if (timeTicks > 0) tickMs = new Float64Array(timeTicks)
  self.postMessage({ type: 'ready', poseBytes })
}

self.onmessage = (event) => {
  const message = event.data
  try {
    if (typeof message === 'number') return self.postMessage(tickMs ? timedTick(message) : tickSlot(message))
    if (message.type === 'stats') return self.postMessage({ type: 'stats', tickMs: tickMs ? tickMs.slice(0, Math.min(tickCount, tickMs.length)) : null })
    if (message.type === 'boot') return boot(message)
    throw new Error('unknown message ' + message.type)
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.stack ? error.stack : error) })
  }
}
