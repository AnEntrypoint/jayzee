export const HOST_GLOBALS = ['document', 'OffscreenCanvas', 'HTMLCanvasElement', 'Worker', 'URL', 'Blob', 'WebGL2RenderingContext', 'navigator', 'setTimeout', 'clearTimeout']

class FakeGl {}

export function buildHost(spec) {
  const log = []
  const timers = new Map()
  let nextTimer = 1
  const canvas = () => ({
    width: 0,
    height: 0,
    getContext(kind) {
      log.push('getContext ' + kind)
      if (spec.contextThrows) throw new Error('context lost for good')
      if (spec.context === 'none') return null
      if (spec.context === 'foreign') return {}
      return new FakeGl()
    },
    transferControlToOffscreen() {
      if (spec.transferThrows) throw new Error('already transferred')
      return { offscreen: true }
    },
  })
  class FakeWorker {
    constructor(url) {
      if (spec.workerThrows) throw new Error('worker-src blocked')
      log.push('worker ' + url)
      this.onmessage = null
      this.onerror = null
    }
    postMessage(message, transfer) {
      log.push('post ' + Object.keys(message).join(',') + ' transfer ' + transfer.length)
      if (spec.postThrows) throw new Error('could not be cloned')
      if (spec.reply === 'ok') this.onmessage({ data: { ok: true } })
      else if (spec.reply === 'no-gl') this.onmessage({ data: { ok: false } })
      else if (spec.reply === 'error') this.onmessage({ data: { ok: false, error: 'no webgl2 in worker' } })
      else if (spec.reply === 'empty') this.onmessage({})
      else if (spec.reply === 'onerror') this.onerror({ message: 'script error' })
    }
    terminate() { log.push('terminate') }
  }
  const HTMLCanvasElement = function HTMLCanvasElement() {}
  if (spec.transfer !== false) HTMLCanvasElement.prototype.transferControlToOffscreen = function transferControlToOffscreen() {}
  const adapterInfo = spec.adapterInfo === undefined ? { vendor: 'testvendor', architecture: 'arch', device: 'dev', description: 'Test GPU' } : spec.adapterInfo
  const device = {
    limits: { maxComputeWorkgroupsPerDimension: 65535, maxComputeWorkgroupSizeX: 256, maxStorageBufferBindingSize: 134217728, maxBufferSize: 268435456, other: 1 },
    destroy() { log.push('device destroyed') },
  }
  const adapter = {
    info: adapterInfo,
    isFallbackAdapter: spec.fallbackAdapter === true,
    requestDevice: async () => (spec.device === 'none' ? null : device),
  }
  const gpu = {
    requestAdapter: async (options) => {
      log.push('requestAdapter ' + JSON.stringify(options))
      if (spec.adapterThrows) throw new Error('gpu process crashed')
      return spec.adapter === 'none' ? null : adapter
    },
  }
  const host = {
    document: { createElement: (tag) => { log.push('createElement ' + tag); if (spec.createThrows) throw new Error('no dom'); return canvas() } },
    OffscreenCanvas: spec.offscreen === false ? undefined : function OffscreenCanvas() {},
    HTMLCanvasElement: spec.htmlCanvas === false ? undefined : HTMLCanvasElement,
    Worker: spec.worker === false ? undefined : FakeWorker,
    URL: { createObjectURL: () => 'blob:probe', revokeObjectURL: (url) => log.push('revoke ' + url) },
    Blob: function Blob(parts, options) { this.size = parts[0].length; this.type = options.type },
    WebGL2RenderingContext: spec.glClass === false ? undefined : FakeGl,
    navigator: spec.gpu === false ? {} : { gpu },
    setTimeout: (fn, ms) => { const id = nextTimer++; timers.set(id, fn); log.push('setTimeout ' + ms); if (spec.reply === 'timeout') Promise.resolve().then(() => { if (timers.has(id)) { timers.delete(id); fn() } }); return id },
    clearTimeout: (id) => { if (timers.delete(id)) log.push('clearTimeout') },
  }
  return { host, log }
}

export const WEBGL2_SPECS = [
  ['a webgl2 context of the right class', {}],
  ['no context', { context: 'none' }],
  ['a context of another class', { context: 'foreign' }],
  ['getContext throws', { contextThrows: true }],
  ['createElement throws', { createThrows: true }],
  ['no WebGL2RenderingContext global', { glClass: false }],
]

export const OFFSCREEN_SPECS = [
  ['the worker gets a context', { reply: 'ok' }],
  ['no OffscreenCanvas', { offscreen: false, reply: 'ok' }],
  ['no HTMLCanvasElement', { htmlCanvas: false, reply: 'ok' }],
  ['no transferControlToOffscreen', { transfer: false, reply: 'ok' }],
  ['no Worker', { worker: false, reply: 'ok' }],
  ['the worker constructor throws', { workerThrows: true, reply: 'ok' }],
  ['transferControlToOffscreen throws', { transferThrows: true, reply: 'ok' }],
  ['the worker gets no context', { reply: 'no-gl' }],
  ['the worker reports an error', { reply: 'error' }],
  ['the worker answers with no data', { reply: 'empty' }],
  ['the worker raises onerror', { reply: 'onerror' }],
  ['postMessage throws', { postThrows: true }],
  ['the worker never answers', { reply: 'timeout' }],
]

export const WEBGPU_SPECS = [
  ['a hardware adapter and a device', {}],
  ['no navigator.gpu', { gpu: false }],
  ['no adapter', { adapter: 'none' }],
  ['a swiftshader adapter', { adapterInfo: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader Device' } }],
  ['a fallback adapter', { fallbackAdapter: true }],
  ['an adapter with no info', { adapterInfo: null }],
  ['no device', { device: 'none' }],
  ['requestAdapter throws', { adapterThrows: true }],
]

export async function runRendererProbes(api) {
  const rows = []
  for (const [name, spec] of WEBGL2_SPECS) {
    const { host, log } = buildHost(spec)
    rows.push({ probe: 'webgl2', name, result: await api.probeWebGL2(host), log })
  }
  for (const [name, spec] of OFFSCREEN_SPECS) {
    const { host, log } = buildHost(spec)
    rows.push({ probe: 'offscreen', name, result: await api.probeOffscreenCanvasWorkerRendering(host), log })
  }
  for (const [name, spec] of WEBGPU_SPECS) {
    const { host, log } = buildHost(spec)
    rows.push({ probe: 'webgpu', name, result: await api.probeWebGPU(host), log })
  }
  return JSON.parse(JSON.stringify(rows))
}
