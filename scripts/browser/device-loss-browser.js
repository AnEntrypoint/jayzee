import { loadRenderer } from '../../src/engine/renderer.js'

const FRAMES_BEFORE = 5
const FRAMES_AFTER = 5
const result = { phase: 'device-loss', done: false, ok: false, errors: [] }
window.deviceLossResult = result

const drawFrames = (renderer, count) => {
  const statuses = []
  for (let i = 0; i < count; i++) statuses.push(renderer.frame())
  return statuses
}

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const started = performance.now()
  let renderer = await loadRenderer({ canvas, navigatorLike: navigator, requested: 'webgpu', players: 64, budgetBytes: 67108864 })
  const limits = renderer.device.limits
  result.limits = { maxTextureDimension2D: limits.maxTextureDimension2D, maxTextureArrayLayers: limits.maxTextureArrayLayers, maxBufferSize: limits.maxBufferSize, textureCompressionBc: renderer.device.features.has('texture-compression-bc'), deviceMemory: navigator.deviceMemory ?? null }
  result.before = { modelTier: renderer.modelTier, backend: renderer.backendName, statuses: drawFrames(renderer, FRAMES_BEFORE), frames: renderer.stats().frames }

  const lostAt = performance.now()
  renderer.device.destroy()
  result.lost = await renderer.deviceLost
  result.lostMs = Math.round(performance.now() - lostAt)

  renderer = null
  const reloadAt = performance.now()
  const recovered = await loadRenderer({ canvas, navigatorLike: navigator, requested: 'webgpu', players: 64, budgetBytes: 67108864 })
  result.reloadMs = Math.round(performance.now() - reloadAt)
  recovered.markWarmup()
  const statuses = drawFrames(recovered, FRAMES_AFTER)
  const stats = recovered.stats()
  result.after = { modelTier: recovered.modelTier, statuses, frames: Number(stats.frames), createsAfterSeal: Number(stats.createsAfterSeal), allocationsSinceWarmup: String(stats.allocationsSinceWarmup) }
  result.wallMs = Math.round(performance.now() - started)
  result.ok = result.lost.reason === 'destroyed' && result.before.statuses.every((s) => s === 0) && statuses.every((s) => s === 0) && Number(stats.createsAfterSeal) === 0
  result.done = true
}

run().catch((error) => {
  result.errors.push(String(error && error.stack ? error.stack : error))
  result.done = true
})
