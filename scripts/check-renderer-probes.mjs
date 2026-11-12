import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { MAX_PIXEL_RATIO, PROBE_REFUSAL, chooseRenderer, createRenderer, probeAndCreateWebGPURenderer, probeOffscreenCanvasWorkerRendering, probeWebGL2 } from '../src/client/rendererProbes.js'

const makeGl = ({ debugInfo = true, maxTextureSize = 8192, lost = false } = {}) => {
  const state = { lostByProbe: 0 }
  const gl = {
    RENDERER: 1, VENDOR: 2, MAX_TEXTURE_SIZE: 3,
    state,
    isContextLost: () => lost,
    getExtension(name) {
      if (name === 'WEBGL_debug_renderer_info') return debugInfo ? { UNMASKED_RENDERER_WEBGL: 11, UNMASKED_VENDOR_WEBGL: 12 } : null
      if (name === 'WEBGL_lose_context') return { loseContext: () => { state.lostByProbe++ } }
      return null
    },
    getParameter(code) {
      return { 1: 'masked renderer', 2: 'masked vendor', 3: maxTextureSize, 11: 'ANGLE (Test GPU)', 12: 'Test Vendor' }[code]
    },
  }
  return gl
}

const makeCanvas = (gl, { transfer = true } = {}) => {
  const asked = []
  const canvas = { asked, getContext(kind, attributes) { asked.push([kind, attributes]); return kind === 'webgl2' ? gl : null } }
  if (transfer) canvas.transferControlToOffscreen = () => ({})
  return canvas
}

const makeTimers = () => {
  const pending = new Map()
  let next = 1
  return {
    pending,
    setTimeout(fn, ms) { const id = next++; pending.set(id, { fn, ms }); return id },
    clearTimeout(id) { pending.delete(id) },
    fireAll() { for (const [id, entry] of [...pending]) { pending.delete(id); entry.fn() } },
  }
}

class FakeRenderer {
  constructor(parameters) {
    this.parameters = parameters
    this.calls = []
    this.disposed = false
  }
  setPixelRatio(ratio) { this.calls.push(['setPixelRatio', ratio]) }
  setSize(width, height, updateStyle) { this.calls.push(['setSize', width, height, updateStyle]) }
  dispose() { this.disposed = true }
}

const webgpuClass = ({ backend = { isWebGPUBackend: true }, init = () => Promise.resolve() } = {}) => {
  const made = []
  class FakeWebGPURenderer extends FakeRenderer {
    constructor(parameters) {
      super(parameters)
      this.backend = backend
      made.push(this)
    }
    init() { this.calls.push(['init']); return init() }
  }
  FakeWebGPURenderer.made = made
  return FakeWebGPURenderer
}

const gpuOf = (adapter) => ({ asked: [], requestAdapter(options) { this.asked.push(options); return typeof adapter === 'function' ? adapter() : Promise.resolve(adapter) } })

gate('probeWebGL2 asks a fresh canvas for a webgl2 context, reports the unmasked renderer and vendor, and releases the context', () => {
  const gl = makeGl()
  const canvas = makeCanvas(gl)
  const result = probeWebGL2({ createCanvas: () => canvas })
  assert.deepEqual(result, { ok: true, reason: null, detail: null, renderer: 'ANGLE (Test GPU)', vendor: 'Test Vendor', maxTextureSize: 8192, textureSizeOk: true })
  assert.equal(canvas.asked[0][0], 'webgl2')
  assert.equal(gl.state.lostByProbe, 1)
})

gate('probeWebGL2 falls back to the masked strings without the debug extension and flags a texture limit under 2048', () => {
  const result = probeWebGL2({ createCanvas: () => makeCanvas(makeGl({ debugInfo: false, maxTextureSize: 1024 })) })
  assert.deepEqual([result.ok, result.renderer, result.vendor, result.textureSizeOk], [true, 'masked renderer', 'masked vendor', false])
})

gate('probeWebGL2 names each failure: no canvas factory, a factory that throws, no context, a context that throws and a lost context', () => {
  assert.equal(probeWebGL2({}).reason, PROBE_REFUSAL.NO_CANVAS)
  assert.equal(probeWebGL2(null).reason, PROBE_REFUSAL.NO_CANVAS)
  assert.deepEqual(probeWebGL2({ createCanvas: () => { throw new Error('no dom') } }), { ok: false, reason: PROBE_REFUSAL.CANVAS_THREW, detail: 'no dom' })
  assert.equal(probeWebGL2({ createCanvas: () => makeCanvas(null) }).reason, PROBE_REFUSAL.NO_WEBGL2)
  assert.deepEqual(probeWebGL2({ createCanvas: () => ({ getContext() { throw new Error('gpu process gone') } }) }), { ok: false, reason: PROBE_REFUSAL.CONTEXT_THREW, detail: 'gpu process gone' })
  assert.equal(probeWebGL2({ createCanvas: () => makeCanvas(makeGl({ lost: true })) }).reason, PROBE_REFUSAL.CONTEXT_LOST)
})

gate('probeOffscreenCanvasWorkerRendering needs OffscreenCanvas, Worker, a transferable canvas and a webgl2 context on an offscreen canvas', () => {
  const gl = makeGl()
  const sizes = []
  class Offscreen { constructor(width, height) { sizes.push([width, height]) } getContext(kind) { return kind === 'webgl2' ? gl : null } }
  class NoGl { getContext() { return null } }
  const host = { OffscreenCanvas: Offscreen, Worker: class {}, createCanvas: () => makeCanvas(gl) }
  assert.equal(probeOffscreenCanvasWorkerRendering(host).ok, true)
  assert.deepEqual(sizes, [[1, 1]])
  assert.equal(probeOffscreenCanvasWorkerRendering({ ...host, OffscreenCanvas: undefined }).reason, PROBE_REFUSAL.NO_OFFSCREEN)
  assert.equal(probeOffscreenCanvasWorkerRendering({ ...host, Worker: undefined }).reason, PROBE_REFUSAL.NO_WORKER)
  assert.equal(probeOffscreenCanvasWorkerRendering({ ...host, createCanvas: () => makeCanvas(gl, { transfer: false }) }).reason, PROBE_REFUSAL.NO_TRANSFER)
  assert.equal(probeOffscreenCanvasWorkerRendering({ ...host, OffscreenCanvas: NoGl }).reason, PROBE_REFUSAL.NO_WEBGL2)
})

gate('createRenderer builds the WebGL renderer on the given canvas, caps the pixel ratio at 2 and sizes it without touching the style', () => {
  const canvas = makeCanvas(makeGl())
  const result = createRenderer({ WebGLRenderer: FakeRenderer, canvas, width: 1280, height: 720, pixelRatio: 3, outputColorSpace: 'srgb' })
  assert.deepEqual([result.ok, result.backend, result.pixelRatio], [true, 'webgl2-legacy', MAX_PIXEL_RATIO])
  assert.equal(result.renderer.parameters.canvas, canvas)
  assert.deepEqual(result.renderer.calls, [['setPixelRatio', 2], ['setSize', 1280, 720, false]])
  assert.equal(result.renderer.outputColorSpace, 'srgb')
  assert.equal(createRenderer({ WebGLRenderer: FakeRenderer, canvas, width: 10, height: 10 }).pixelRatio, 1)
})

gate('createRenderer names a missing class, a missing canvas and a constructor that throws, and refuses a bad size', () => {
  const canvas = makeCanvas(makeGl())
  assert.equal(createRenderer({ canvas, width: 1, height: 1 }).reason, PROBE_REFUSAL.NO_RENDERER_CLASS)
  assert.equal(createRenderer({ WebGLRenderer: FakeRenderer, width: 1, height: 1 }).reason, PROBE_REFUSAL.NO_CANVAS)
  class Throws { constructor() { throw new Error('Error creating WebGL context') } }
  assert.deepEqual(createRenderer({ WebGLRenderer: Throws, canvas, width: 1, height: 1 }), { ok: false, reason: PROBE_REFUSAL.RENDERER_THREW, detail: 'Error creating WebGL context' })
  assert.throws(() => createRenderer({ WebGLRenderer: FakeRenderer, canvas, width: 0, height: 10 }), /positive finite width and height/)
  assert.throws(() => createRenderer(null), /needs its options/)
})

gate('probeAndCreateWebGPURenderer asks for a high-performance adapter, initialises the renderer and returns it on a WebGPU backend', async () => {
  const timers = makeTimers()
  const gpu = gpuOf({ name: 'adapter' })
  const Class = webgpuClass()
  const result = await probeAndCreateWebGPURenderer({ gpu, WebGPURenderer: Class, canvas: makeCanvas(null), width: 800, height: 600, pixelRatio: 1.5, timers })
  assert.deepEqual([result.ok, result.backend, result.pixelRatio], [true, 'webgpu', 1.5])
  assert.deepEqual(gpu.asked, [{ powerPreference: 'high-performance' }])
  assert.deepEqual(result.renderer.calls, [['init'], ['setPixelRatio', 1.5], ['setSize', 800, 600, false]])
  assert.equal(timers.pending.size, 0)
})

gate('a WebGPU renderer that initialised onto its WebGL fallback is disposed and refused, so the caller picks the WebGL path on purpose', async () => {
  const Class = webgpuClass({ backend: { isWebGLBackend: true } })
  const result = await probeAndCreateWebGPURenderer({ gpu: gpuOf({}), WebGPURenderer: Class, canvas: makeCanvas(null), width: 8, height: 8, timers: makeTimers() })
  assert.equal(result.reason, PROBE_REFUSAL.FELL_BACK)
  assert.equal(Class.made[0].disposed, true)
})

gate('probeAndCreateWebGPURenderer names a missing navigator.gpu, a null adapter, an adapter that throws, an init that throws and a missing class', async () => {
  const base = { WebGPURenderer: webgpuClass(), canvas: makeCanvas(null), width: 8, height: 8, timers: makeTimers() }
  assert.equal((await probeAndCreateWebGPURenderer({ ...base, gpu: undefined })).reason, PROBE_REFUSAL.NO_GPU)
  assert.equal((await probeAndCreateWebGPURenderer({ ...base, gpu: gpuOf(null) })).reason, PROBE_REFUSAL.NO_ADAPTER)
  assert.deepEqual(await probeAndCreateWebGPURenderer({ ...base, gpu: gpuOf(() => Promise.reject(new Error('blocklisted'))) }), { ok: false, reason: PROBE_REFUSAL.ADAPTER_THREW, detail: 'blocklisted' })
  const Failing = webgpuClass({ init: () => Promise.reject(new Error('device lost')) })
  assert.deepEqual(await probeAndCreateWebGPURenderer({ ...base, gpu: gpuOf({}), WebGPURenderer: Failing }), { ok: false, reason: PROBE_REFUSAL.INIT_THREW, detail: 'device lost' })
  assert.equal(Failing.made[0].disposed, true)
  assert.equal((await probeAndCreateWebGPURenderer({ ...base, gpu: gpuOf({}), WebGPURenderer: undefined })).reason, PROBE_REFUSAL.NO_RENDERER_CLASS)
  await assert.rejects(() => probeAndCreateWebGPURenderer({ ...base, gpu: gpuOf({}), timers: null }), /needs timers/)
})

gate('an adapter request that never answers ends at the 3000 ms deadline, and an init that never answers ends at 8000 ms with the renderer disposed', async () => {
  const timers = makeTimers()
  const hung = probeAndCreateWebGPURenderer({ gpu: gpuOf(() => new Promise(() => {})), WebGPURenderer: webgpuClass(), canvas: makeCanvas(null), width: 8, height: 8, timers })
  await Promise.resolve()
  assert.deepEqual([...timers.pending.values()].map((entry) => entry.ms), [3000])
  timers.fireAll()
  assert.equal((await hung).reason, PROBE_REFUSAL.ADAPTER_TIMEOUT)
  const Class = webgpuClass({ init: () => new Promise(() => {}) })
  const second = makeTimers()
  const stuck = probeAndCreateWebGPURenderer({ gpu: gpuOf({}), WebGPURenderer: Class, canvas: makeCanvas(null), width: 8, height: 8, timers: second })
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.deepEqual([...second.pending.values()].map((entry) => entry.ms), [8000])
  second.fireAll()
  assert.equal((await stuck).reason, PROBE_REFUSAL.INIT_TIMEOUT)
  assert.equal(Class.made[0].disposed, true)
})

gate('chooseRenderer takes WebGPU when it works, WebGL2 when WebGPU is refused, and reports every attempt in order', async () => {
  const gl = makeGl()
  const base = { canvas: makeCanvas(gl), width: 640, height: 480, timers: makeTimers(), host: { createCanvas: () => makeCanvas(gl) }, WebGLRenderer: FakeRenderer }
  const gpu = await chooseRenderer({ ...base, gpu: gpuOf({}), WebGPURenderer: webgpuClass() })
  assert.deepEqual([gpu.ok, gpu.backend, gpu.attempts], [true, 'webgpu', [{ backend: 'webgpu', ok: true, reason: null }]])
  const fallback = await chooseRenderer({ ...base, gpu: undefined, WebGPURenderer: webgpuClass() })
  assert.deepEqual([fallback.ok, fallback.backend], [true, 'webgl2-legacy'])
  assert.deepEqual(fallback.attempts, [{ backend: 'webgpu', ok: false, reason: PROBE_REFUSAL.NO_GPU }, { backend: 'webgl2-probe', ok: true, reason: null }, { backend: 'webgl2-legacy', ok: true, reason: null }])
  const skipped = await chooseRenderer({ ...base, preferWebGPU: false, gpu: gpuOf({}), WebGPURenderer: webgpuClass() })
  assert.deepEqual(skipped.attempts.map((attempt) => attempt.backend), ['webgl2-probe', 'webgl2-legacy'])
})

gate('negative control: a host with neither WebGPU nor WebGL2 gets no renderer and the reason of the last probe', async () => {
  const none = await chooseRenderer({ canvas: makeCanvas(null), width: 640, height: 480, timers: makeTimers(), host: { createCanvas: () => makeCanvas(null) }, WebGLRenderer: FakeRenderer, WebGPURenderer: webgpuClass() })
  assert.deepEqual([none.ok, none.reason, none.renderer], [false, PROBE_REFUSAL.NO_WEBGL2, undefined])
  assert.deepEqual(none.attempts.map((attempt) => attempt.ok), [false, false])
})

gate('the module reads no browser global: no window, document, navigator, performance or console', () => {
  const source = readFileSync(new URL('../src/client/rendererProbes.js', import.meta.url), 'utf8')
  assert.equal(/\b(window|document|navigator|performance|console|globalThis)\b/.test(source.replace(/'[^']*'/g, '')), false)
  assert.equal(/\/\/|\/\*/.test(source), false)
})

finish()
