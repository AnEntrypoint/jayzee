import { loadEngineModule, resolvePlan } from './EngineWorld.js'
import { configureWorld } from './sceneSetup.js'
import { createPlanetStreamer } from './planetStream.js'
import { attachPoseRegion } from './poseRegion.js'
import { createArenaPrefault, createPoseStepper } from './poseHandoffCore.js'
import { warmEngine } from './warmEngine.js'

let tickSlot = null
let prefaultArena = null
let tickMs = null
let tickCount = 0

const timedTick = (slot) => {
  const at = performance.now()
  const out = tickSlot(slot)
  if (tickCount < tickMs.length) tickMs[tickCount] = performance.now() - at
  tickCount += 1
  return out
}

const warmApart = (glue, spec) => new Promise((resolve, reject) => {
  const started = performance.now()
  const worker = new Worker(new URL('./warmWorker.js', import.meta.url), { type: 'module' })
  const settle = (act, value) => {
    worker.terminate()
    act(value)
  }
  worker.onerror = (event) => settle(reject, new Error('warm worker: ' + event.message))
  worker.onmessage = (event) => {
    const message = event.data
    if (message.type !== 'warmed') return settle(reject, new Error(message.message))
    settle(resolve, { warmed: message.warmed, reason: message.reason, bodies: message.bodies, ticks: message.ticks, ms: message.ms, apartMs: performance.now() - started, release: () => Promise.resolve(null) })
  }
  worker.postMessage({ glue, spec })
})

const boot = async ({ glue, players, budgetBytes, workers, solverIterations, path, pose, timeTicks, warm }) => {
  const spec = warm === true ? {} : warm
  const apart = warm !== false && spec.inline !== true
  const warmed = warm === false ? null : apart ? await warmApart(glue, spec) : await warmEngine(glue, spec)
  const module = await loadEngineModule(glue, resolvePlan({ players, budgetBytes, workers }))
  const reclaim = warmed ? await warmed.release() : null
  configureWorld(module, solverIterations, path && path.baseY ? path.baseY : 0)
  const streamer = createPlanetStreamer(module, path)
  const poseBytes = module._engine_pose_bytes()
  const reserve = module._engine_pose_reserve()
  const region = attachPoseRegion(pose)
  tickSlot = createPoseStepper({ module, streamer, region, reserve })
  prefaultArena = createArenaPrefault(module)
  prefaultArena()
  if (timeTicks > 0) tickMs = new Float64Array(timeTicks)
  self.postMessage({ type: 'ready', poseBytes, warm: warmed ? { warmed: warmed.warmed, reason: warmed.reason, bodies: warmed.bodies, ticks: warmed.ticks, ms: warmed.ms, apart, apartMs: warmed.apartMs ?? null, reclaim } : null })
}

self.onmessage = (event) => {
  const message = event.data
  try {
    if (typeof message === 'number') {
      self.postMessage(tickMs ? timedTick(message) : tickSlot(message))
      return prefaultArena()
    }
    if (message.type === 'stats') return self.postMessage({ type: 'stats', tickMs: tickMs ? tickMs.slice(0, Math.min(tickCount, tickMs.length)) : null })
    if (message.type === 'boot') return boot(message)
    throw new Error('unknown message ' + message.type)
  } catch (error) {
    self.postMessage({ type: 'error', message: String(error && error.stack ? error.stack : error) })
  }
}
