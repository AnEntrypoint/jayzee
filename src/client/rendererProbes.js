export const NO_WEBGL2 = 'NO_WEBGL2'
export const NO_WEBGPU = 'NO_WEBGPU'
export const OFFSCREEN_PROBE_TIMEOUT_MS = 2000
export const OFFSCREEN_PROBE_CANVAS_PX = 4

export const OFFSCREEN_PROBE_WORKER_SOURCE = `
      self.onmessage = function (e) {
        try {
          const off = e.data.canvas
          const gl = off.getContext('webgl2')
          self.postMessage({ ok: !!gl })
        } catch (err) {
          self.postMessage({ ok: false, error: String(err && err.message || err) })
        }
      }
    `

const messageOf = (error) => (error && error.message) || error

function coded(message, code, detail) {
  const error = new Error(message)
  error.code = code
  if (detail !== undefined) error.detail = detail
  return error
}

export function probeWebGL2(host) {
  try {
    const canvas = host.document.createElement('canvas')
    const gl = canvas.getContext('webgl2')
    return !!(gl && typeof host.WebGL2RenderingContext !== 'undefined' && gl instanceof host.WebGL2RenderingContext)
  } catch (_) {
    return false
  }
}

export async function probeOffscreenCanvasWorkerRendering(host) {
  const detail = { apiSurface: false, workerConstructible: false, webgl2InWorker: false, error: null }
  try {
    if (typeof host.OffscreenCanvas === 'undefined') { detail.error = 'OffscreenCanvas global undefined'; return { supported: false, detail } }
    if (typeof host.HTMLCanvasElement === 'undefined' || typeof host.HTMLCanvasElement.prototype.transferControlToOffscreen !== 'function') {
      detail.error = 'transferControlToOffscreen not on HTMLCanvasElement.prototype'
      return { supported: false, detail }
    }
    detail.apiSurface = true
    if (typeof host.Worker === 'undefined') { detail.error = 'Worker global undefined'; return { supported: false, detail } }

    let worker = null
    let blobUrl = null
    try {
      blobUrl = host.URL.createObjectURL(new host.Blob([OFFSCREEN_PROBE_WORKER_SOURCE], { type: 'application/javascript' }))
      worker = new host.Worker(blobUrl)
      detail.workerConstructible = true
    } catch (e) {
      detail.error = 'Worker construction failed: ' + messageOf(e)
      if (blobUrl) host.URL.revokeObjectURL(blobUrl)
      return { supported: false, detail }
    }

    const probeCanvas = host.document.createElement('canvas')
    probeCanvas.width = OFFSCREEN_PROBE_CANVAS_PX
    probeCanvas.height = OFFSCREEN_PROBE_CANVAS_PX
    let offscreen
    try {
      offscreen = probeCanvas.transferControlToOffscreen()
    } catch (e) {
      detail.error = 'transferControlToOffscreen threw: ' + messageOf(e)
      worker.terminate()
      host.URL.revokeObjectURL(blobUrl)
      return { supported: false, detail }
    }

    const result = await new Promise((resolve) => {
      let settled = false
      const timer = host.setTimeout(() => {
        if (settled) return
        settled = true
        resolve({ ok: false, error: 'worker webgl2-in-worker probe timed out (2s)' })
      }, OFFSCREEN_PROBE_TIMEOUT_MS)
      const settle = (value) => {
        if (settled) return
        settled = true
        host.clearTimeout(timer)
        resolve(value)
      }
      worker.onmessage = (e) => settle(e.data || { ok: false, error: 'empty worker response' })
      worker.onerror = (e) => settle({ ok: false, error: 'worker onerror: ' + messageOf(e) })
      try {
        worker.postMessage({ canvas: offscreen }, [offscreen])
      } catch (e) {
        settle({ ok: false, error: 'postMessage transfer failed: ' + messageOf(e) })
      }
    })
    worker.terminate()
    host.URL.revokeObjectURL(blobUrl)

    detail.webgl2InWorker = !!result.ok
    if (!result.ok && result.error) detail.error = result.error
    return { supported: detail.apiSurface && detail.workerConstructible && detail.webgl2InWorker, detail }
  } catch (e) {
    detail.error = 'probe threw: ' + messageOf(e)
    return { supported: false, detail }
  }
}

export async function probeWebGPU(host) {
  const detail = { apiSurface: false, adapter: false, device: false, limits: null, error: null }
  try {
    const nav = host.navigator
    if (typeof nav === 'undefined' || !nav || !nav.gpu) {
      detail.error = 'navigator.gpu undefined (no WebGPU implementation in this browser)'
      return { supported: false, detail }
    }
    detail.apiSurface = true
    const adapter = await nav.gpu.requestAdapter({ powerPreference: 'high-performance' })
    if (!adapter) {
      detail.error = 'requestAdapter() resolved null (WebGPU present but no usable adapter)'
      return { supported: false, detail }
    }
    detail.adapter = true
    detail.adapterInfo = adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, device: adapter.info.device, description: adapter.info.description } : null
    const adapterInfo = adapter.info || {}
    const software = adapter.isFallbackAdapter === true || adapterInfo.isFallbackAdapter === true || /swiftshader|software/i.test([adapterInfo.vendor, adapterInfo.architecture, adapterInfo.device, adapterInfo.description].join(' '))
    if (software) {
      detail.error = 'the adapter is software (' + ([adapterInfo.vendor, adapterInfo.description].filter(Boolean).join(' ') || 'fallback adapter') + '): WebGPU on the CPU is refused, so WebGL2 is used'
      return { supported: false, detail }
    }
    const device = await adapter.requestDevice()
    if (!device) {
      detail.error = 'requestDevice() resolved null'
      return { supported: false, detail }
    }
    detail.device = true
    detail.limits = {
      maxComputeWorkgroupsPerDimension: device.limits.maxComputeWorkgroupsPerDimension,
      maxComputeWorkgroupSizeX: device.limits.maxComputeWorkgroupSizeX,
      maxStorageBufferBindingSize: device.limits.maxStorageBufferBindingSize,
      maxBufferSize: device.limits.maxBufferSize,
    }
    device.destroy()
    return { supported: true, detail }
  } catch (e) {
    detail.error = 'probe threw: ' + messageOf(e)
    return { supported: false, detail }
  }
}

export function applyCommonRendererSetup(renderer, isMobile, env) {
  const win = env.host.window
  renderer.setSize(win.innerWidth, win.innerHeight)
  renderer.setPixelRatio(isMobile ? Math.min(win.devicePixelRatio * 0.5, 1) : Math.min(win.devicePixelRatio, 2))
  renderer.shadowMap.enabled = false
  renderer.shadowMap.type = env.three.PCFShadowMap
  renderer.shadowMap.autoUpdate = false
  renderer.shadowMap.needsUpdate = true
  env.renderControls.bindTonemapping(renderer, env.three)
  env.renderControls.applyToneMapping()
  renderer.outputColorSpace = env.three.SRGBColorSpace
  env.host.document.body.appendChild(renderer.domElement)
}

function checkEnv(env, who) {
  if (!env || !env.host || !env.host.window || !env.host.document) throw new TypeError(who + ' needs env.host with window and document')
  if (!env.three) throw new TypeError(who + ' needs env.three')
  if (typeof env.renderControls?.bindTonemapping !== 'function' || typeof env.renderControls?.applyToneMapping !== 'function') throw new TypeError(who + ' needs env.renderControls with bindTonemapping and applyToneMapping')
}

export function createRenderer(isMobile, env) {
  checkEnv(env, 'createRenderer')
  const host = env.host
  if (!probeWebGL2(host)) throw coded('WebGL2 is not available', NO_WEBGL2)
  const renderer = new env.three.WebGLRenderer({ antialias: !isMobile, powerPreference: 'high-performance' })
  renderer.debug.checkShaderErrors = host.window.__checkShaderErrors || false
  applyCommonRendererSetup(renderer, isMobile, env)
  renderer.xr.enabled = true
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault()
    host.console.warn('[renderer] WebGL context lost')
  }, false)
  renderer.domElement.addEventListener('webglcontextrestored', () => host.location.reload(), false)
  return renderer
}

export async function probeAndCreateWebGPURenderer(isMobile, forceWebGL = false, env) {
  checkEnv(env, 'probeAndCreateWebGPURenderer')
  if (typeof env.loadWebGPURenderer !== 'function') throw new TypeError('probeAndCreateWebGPURenderer needs env.loadWebGPURenderer, an async function returning the WebGPURenderer class')
  const host = env.host
  if (forceWebGL) {
    if (!probeWebGL2(host)) throw coded('WebGL2 is not available', NO_WEBGL2)
  } else {
    const probe = await probeWebGPU(host)
    if (!probe.supported) throw coded('WebGPU is not available: ' + ((probe.detail && probe.detail.error) || 'unknown'), NO_WEBGPU, probe.detail)
  }
  const WebGPURenderer = await env.loadWebGPURenderer()
  const trackTimestamp = typeof host.location !== 'undefined' && /[?&]gputime=1\b/.test(host.location.search)
  const renderer = new WebGPURenderer({ antialias: !isMobile, powerPreference: 'high-performance', forceWebGL, trackTimestamp })
  await renderer.init()
  applyCommonRendererSetup(renderer, isMobile, env)
  return renderer
}
