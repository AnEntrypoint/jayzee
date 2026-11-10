import { loadEngineModule, resolvePlan } from './EngineWorld.js'
import { configureWorld } from './sceneSetup.js'
import { createPlanetStreamer } from './planetStream.js'

let engine = null

const boot = async ({ glue, players, budgetBytes, workers, solverIterations, path }) => {
  const module = await loadEngineModule(glue, resolvePlan({ players, budgetBytes, workers }))
  configureWorld(module, solverIterations)
  const streamer = createPlanetStreamer(module, path)
  const poseBytes = module._engine_pose_bytes()
  const reserve = module._engine_pose_reserve()
  engine = { module, streamer, poseBytes, reserve }
  self.postMessage({ type: 'ready', poseBytes })
}

const tick = ({ frame, buffer }) => {
  const { module, streamer, poseBytes, reserve } = engine
  const started = performance.now()
  const spot = streamer.step(frame)
  if (module._engine_follow(spot.x, spot.y, spot.z) !== 0) throw new Error('engine_follow refused at frame ' + frame)
  module._engine_tick(1)
  if (module._engine_pose_export(reserve, poseBytes) !== poseBytes) throw new Error('engine_pose_export refused at frame ' + frame)
  new Uint8Array(buffer).set(module.HEAPU8.subarray(reserve, reserve + poseBytes))
  self.postMessage({ type: 'pose', frame, tickMs: performance.now() - started, buffer }, [buffer])
}

self.onmessage = (event) => {
  const message = event.data
  try {
    if (message.type === 'boot') return boot(message)
    if (message.type === 'tick') return tick(message)
    throw new Error('unknown message ' + message.type)
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.stack ? error.stack : error) })
  }
}
