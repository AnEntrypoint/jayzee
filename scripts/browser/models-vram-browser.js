const TIERS = [
  { tier: 0, side: 512, layers: 64, slots: 128, vertices: 4096, indices: 12288 },
  { tier: 1, side: 1024, layers: 128, slots: 256, vertices: 16384, indices: 49152 },
  { tier: 2, side: 2048, layers: 96, slots: 256, vertices: 32768, indices: 98304 },
]
const FORMATS = [
  { name: 'bc7-rgba-unorm', texel: 1, block: true, feature: 'texture-compression-bc' },
  { name: 'rgba8unorm', texel: 4, block: false, feature: null },
]
const VERTEX_STRIDE = 32
const INDEX_BYTES = 4
const IDLE_MS = 1000
const HOLD_MS = 1500
const log = []
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const mark = (tier, format, stage) => log.push({ tier, format, stage, epochMs: performance.timeOrigin + performance.now() })

const textureBytesOf = (side, layers, block) => {
  let total = 0
  let w = side
  for (;;) {
    total += block ? Math.ceil(w / 4) * Math.ceil(w / 4) * 16 * layers : w * w * 4 * layers
    if (w === 1) break
    w = Math.max(1, w >> 1)
  }
  return total
}

const result = { done: false, error: null, adapter: null, rows: [], log }
window.vramResult = result
const report = (line) => {
  const el = document.getElementById('result')
  if (el) el.textContent += line + '\n'
}

const run = async () => {
  const factory = (await import('../../engine/out/engine-core-64mib.mjs')).default
  const engine = await factory({})
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  if (!adapter) throw new Error('no WebGPU adapter')
  const bcSupported = adapter.features.has('texture-compression-bc')
  result.adapter = { bcSupported, description: adapter.info ? adapter.info.description : null }
  const device = await adapter.requestDevice({ requiredFeatures: bcSupported ? ['texture-compression-bc'] : [] })
  for (const t of TIERS) {
    for (const f of FORMATS) {
      const plannedBytes = engine._engine_device_tier_vram(t.tier, f.texel)
      const budgetBytes = engine._engine_device_tier_budget(t.tier)
      if (f.feature && !bcSupported) {
        result.rows.push({ tier: t.tier, format: f.name, skipped: 'texture-compression-bc is not on this adapter', plannedBytes, budgetBytes })
        continue
      }
      mark(t.tier, f.name, 'idle')
      await sleep(IDLE_MS)
      mark(t.tier, f.name, 'allocating')
      device.pushErrorScope('out-of-memory')
      const vertex = device.createBuffer({ size: t.slots * t.vertices * VERTEX_STRIDE, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST })
      const index = device.createBuffer({ size: t.slots * t.indices * INDEX_BYTES, usage: GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST })
      const texture = device.createTexture({
        size: [t.side, t.side, t.layers],
        mipLevelCount: Math.log2(t.side) + 1,
        format: f.block ? 'bc7-rgba-unorm' : 'rgba8unorm',
        usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
      })
      const oom = await device.popErrorScope()
      await device.queue.onSubmittedWorkDone()
      mark(t.tier, f.name, 'held')
      await sleep(HOLD_MS)
      const createdBytes = vertex.size + index.size + textureBytesOf(t.side, t.layers, f.block)
      vertex.destroy()
      index.destroy()
      texture.destroy()
      await device.queue.onSubmittedWorkDone()
      mark(t.tier, f.name, 'freed')
      await sleep(IDLE_MS)
      result.rows.push({ tier: t.tier, format: f.name, plannedBytes, budgetBytes, createdBytes, outOfMemory: oom ? oom.message : null })
    }
  }
}

run()
  .catch((error) => { result.error = error && error.message ? error.message : String(error) })
  .finally(() => {
    result.done = true
    report(JSON.stringify(result))
  })
