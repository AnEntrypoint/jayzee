export const PROBE_REFUSAL = Object.freeze({
  NO_CANVAS: 'canvas-factory-missing',
  CANVAS_THREW: 'canvas-factory-threw',
  NO_WEBGL2: 'webgl2-context-unavailable',
  CONTEXT_THREW: 'webgl2-context-threw',
  CONTEXT_LOST: 'webgl2-context-lost',
  NO_OFFSCREEN: 'offscreen-canvas-missing',
  NO_WORKER: 'worker-missing',
  NO_TRANSFER: 'transfer-control-missing',
  NO_GPU: 'webgpu-missing',
  NO_ADAPTER: 'webgpu-adapter-unavailable',
  ADAPTER_THREW: 'webgpu-adapter-threw',
  ADAPTER_TIMEOUT: 'webgpu-adapter-timeout',
  NO_RENDERER_CLASS: 'renderer-class-missing',
  RENDERER_THREW: 'renderer-construct-threw',
  INIT_THREW: 'renderer-init-threw',
  INIT_TIMEOUT: 'renderer-init-timeout',
  FELL_BACK: 'webgpu-renderer-fell-back-to-webgl',
})

export const MAX_PIXEL_RATIO = 2
export const WEBGPU_ADAPTER_TIMEOUT_MS = 3000
export const WEBGPU_INIT_TIMEOUT_MS = 8000
export const MIN_TEXTURE_SIZE = 2048

const refusal = (reason, detail = null) => ({ ok: false, reason, detail })
const messageOf = (error) => (error && error.message ? error.message : String(error))

function glInfo(gl) {
  const ext = typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_debug_renderer_info') : null
  return {
    renderer: gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    vendor: gl.getParameter(ext ? ext.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  }
}

function releaseContext(gl) {
  const lose = typeof gl.getExtension === 'function' ? gl.getExtension('WEBGL_lose_context') : null
  if (lose && typeof lose.loseContext === 'function') lose.loseContext()
}

function probeContext(canvas) {
  let gl
  try {
    gl = canvas.getContext('webgl2', { failIfMajorPerformanceCaveat: false, powerPreference: 'high-performance' })
  } catch (error) {
    return refusal(PROBE_REFUSAL.CONTEXT_THREW, messageOf(error))
  }
  if (!gl) return refusal(PROBE_REFUSAL.NO_WEBGL2)
  if (typeof gl.isContextLost === 'function' && gl.isContextLost()) return refusal(PROBE_REFUSAL.CONTEXT_LOST)
  const info = glInfo(gl)
  releaseContext(gl)
  return { ok: true, reason: null, detail: null, ...info, textureSizeOk: Number.isFinite(info.maxTextureSize) && info.maxTextureSize >= MIN_TEXTURE_SIZE }
}

export function probeWebGL2(host) {
  if (typeof host?.createCanvas !== 'function') return refusal(PROBE_REFUSAL.NO_CANVAS)
  let canvas
  try {
    canvas = host.createCanvas()
  } catch (error) {
    return refusal(PROBE_REFUSAL.CANVAS_THREW, messageOf(error))
  }
  if (!canvas || typeof canvas.getContext !== 'function') return refusal(PROBE_REFUSAL.NO_CANVAS)
  return probeContext(canvas)
}

export function probeOffscreenCanvasWorkerRendering(host) {
  if (typeof host?.OffscreenCanvas !== 'function') return refusal(PROBE_REFUSAL.NO_OFFSCREEN)
  if (typeof host.Worker !== 'function') return refusal(PROBE_REFUSAL.NO_WORKER)
  if (typeof host.createCanvas !== 'function') return refusal(PROBE_REFUSAL.NO_CANVAS)
  let canvas
  try {
    canvas = host.createCanvas()
  } catch (error) {
    return refusal(PROBE_REFUSAL.CANVAS_THREW, messageOf(error))
  }
  if (!canvas || typeof canvas.transferControlToOffscreen !== 'function') return refusal(PROBE_REFUSAL.NO_TRANSFER)
  let offscreen
  try {
    offscreen = new host.OffscreenCanvas(1, 1)
  } catch (error) {
    return refusal(PROBE_REFUSAL.CANVAS_THREW, messageOf(error))
  }
  return probeContext(offscreen)
}

function sizeOf(options) {
  const width = options.width, height = options.height
  if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) throw new RangeError('createRenderer needs a positive finite width and height, got ' + String(width) + ' by ' + String(height))
  const ratio = Number.isFinite(options.pixelRatio) && options.pixelRatio > 0 ? Math.min(options.pixelRatio, MAX_PIXEL_RATIO) : 1
  return { width, height, ratio }
}

function configure(renderer, size, colorSpace) {
  renderer.setPixelRatio(size.ratio)
  renderer.setSize(size.width, size.height, false)
  if (colorSpace !== undefined) renderer.outputColorSpace = colorSpace
  return renderer
}

export function createRenderer(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('createRenderer needs its options: { WebGLRenderer, canvas, width, height }')
  if (typeof options.WebGLRenderer !== 'function') return refusal(PROBE_REFUSAL.NO_RENDERER_CLASS)
  if (!options.canvas || typeof options.canvas.getContext !== 'function') return refusal(PROBE_REFUSAL.NO_CANVAS)
  const size = sizeOf(options)
  let renderer
  try {
    renderer = new options.WebGLRenderer({ canvas: options.canvas, antialias: options.antialias !== false, powerPreference: 'high-performance', alpha: false, stencil: false })
  } catch (error) {
    return refusal(PROBE_REFUSAL.RENDERER_THREW, messageOf(error))
  }
  configure(renderer, size, options.outputColorSpace)
  return { ok: true, reason: null, detail: null, renderer, backend: 'webgl2-legacy', pixelRatio: size.ratio }
}

function withDeadline(promise, ms, timers, reason) {
  return new Promise((resolve, reject) => {
    let settled = false
    const handle = timers.setTimeout(() => {
      if (settled) return
      settled = true
      resolve({ timedOut: true, reason })
    }, ms)
    promise.then((value) => {
      if (settled) return
      settled = true
      timers.clearTimeout(handle)
      resolve({ timedOut: false, value })
    }, (error) => {
      if (settled) return
      settled = true
      timers.clearTimeout(handle)
      reject(error)
    })
  })
}

function disposeQuietly(renderer) {
  try {
    if (renderer && typeof renderer.dispose === 'function') renderer.dispose()
  } catch {
    return false
  }
  return true
}

export async function probeAndCreateWebGPURenderer(options) {
  if (options === null || typeof options !== 'object') throw new TypeError('probeAndCreateWebGPURenderer needs its options: { gpu, WebGPURenderer, canvas, width, height, timers }')
  const timers = options.timers
  if (typeof timers?.setTimeout !== 'function' || typeof timers?.clearTimeout !== 'function') throw new TypeError('probeAndCreateWebGPURenderer needs timers with setTimeout and clearTimeout')
  const size = sizeOf(options)
  const gpu = options.gpu
  if (!gpu || typeof gpu.requestAdapter !== 'function') return refusal(PROBE_REFUSAL.NO_GPU)
  if (typeof options.WebGPURenderer !== 'function') return refusal(PROBE_REFUSAL.NO_RENDERER_CLASS)
  if (!options.canvas || typeof options.canvas.getContext !== 'function') return refusal(PROBE_REFUSAL.NO_CANVAS)
  let adapter
  try {
    const waited = await withDeadline(Promise.resolve(gpu.requestAdapter({ powerPreference: 'high-performance' })), options.adapterTimeoutMs ?? WEBGPU_ADAPTER_TIMEOUT_MS, timers, PROBE_REFUSAL.ADAPTER_TIMEOUT)
    if (waited.timedOut) return refusal(waited.reason)
    adapter = waited.value
  } catch (error) {
    return refusal(PROBE_REFUSAL.ADAPTER_THREW, messageOf(error))
  }
  if (!adapter) return refusal(PROBE_REFUSAL.NO_ADAPTER)
  let renderer
  try {
    renderer = new options.WebGPURenderer({ canvas: options.canvas, antialias: options.antialias !== false, powerPreference: 'high-performance' })
  } catch (error) {
    return refusal(PROBE_REFUSAL.RENDERER_THREW, messageOf(error))
  }
  try {
    const waited = await withDeadline(Promise.resolve(renderer.init()), options.initTimeoutMs ?? WEBGPU_INIT_TIMEOUT_MS, timers, PROBE_REFUSAL.INIT_TIMEOUT)
    if (waited.timedOut) {
      disposeQuietly(renderer)
      return refusal(waited.reason)
    }
  } catch (error) {
    disposeQuietly(renderer)
    return refusal(PROBE_REFUSAL.INIT_THREW, messageOf(error))
  }
  if (!renderer.backend || renderer.backend.isWebGPUBackend !== true) {
    disposeQuietly(renderer)
    return refusal(PROBE_REFUSAL.FELL_BACK)
  }
  configure(renderer, size, options.outputColorSpace)
  return { ok: true, reason: null, detail: null, renderer, backend: 'webgpu', pixelRatio: size.ratio }
}

export async function chooseRenderer(options) {
  const attempts = []
  if (options.preferWebGPU !== false) {
    const gpu = await probeAndCreateWebGPURenderer(options)
    attempts.push({ backend: 'webgpu', ok: gpu.ok, reason: gpu.reason })
    if (gpu.ok) return { ...gpu, attempts }
  }
  const probe = probeWebGL2(options.host)
  attempts.push({ backend: 'webgl2-probe', ok: probe.ok, reason: probe.reason })
  if (!probe.ok) return { ok: false, reason: probe.reason, detail: probe.detail, attempts }
  const gl = createRenderer(options)
  attempts.push({ backend: 'webgl2-legacy', ok: gl.ok, reason: gl.reason })
  return { ...gl, attempts }
}
