import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { buildHost, runRendererProbes } from './lib/rendererProbeScenario.mjs'
import { NO_WEBGL2, NO_WEBGPU, OFFSCREEN_PROBE_TIMEOUT_MS, OFFSCREEN_PROBE_WORKER_SOURCE, createRenderer, probeAndCreateWebGPURenderer, probeOffscreenCanvasWorkerRendering, probeWebGL2, probeWebGPU } from '../src/client/rendererProbes.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/renderer-probes.json', import.meta.url), 'utf8'))
const ran = await runRendererProbes({ probeWebGL2, probeOffscreenCanvasWorkerRendering, probeWebGPU })
const rowsOf = (rows, probe) => rows.filter((row) => row.probe === probe)

class FakeRenderer {
  constructor(parameters) {
    this.parameters = parameters
    this.calls = []
    this.shadowMap = {}
    this.debug = {}
    this.xr = { enabled: false }
    this.listeners = {}
    this.domElement = { addEventListener: (name, fn) => { this.listeners[name] = fn } }
  }
  setSize(width, height) { this.calls.push(['setSize', width, height]) }
  setPixelRatio(ratio) { this.calls.push(['setPixelRatio', ratio]) }
  async init() { this.calls.push(['init']) }
}

const makeEnv = (spec = {}, { devicePixelRatio = 3, search = '', checkShaderErrors } = {}) => {
  const { host, log } = buildHost(spec)
  const appended = []
  const warnings = []
  const reloads = []
  host.window = { innerWidth: 1280, innerHeight: 720, devicePixelRatio, __checkShaderErrors: checkShaderErrors }
  host.document.body = { appendChild: (element) => appended.push(element) }
  host.console = { warn: (text) => warnings.push(text) }
  host.location = { search, reload: () => reloads.push(1) }
  const tonemap = []
  const env = {
    host,
    three: { WebGLRenderer: FakeRenderer, PCFShadowMap: 'PCFShadowMap', SRGBColorSpace: 'srgb' },
    renderControls: { bindTonemapping: (renderer, three) => tonemap.push(['bind', renderer instanceof FakeRenderer, three === env.three]), applyToneMapping: () => tonemap.push(['apply']) },
    loadWebGPURenderer: async () => FakeRenderer,
  }
  return { env, log, appended, warnings, reloads, tonemap }
}

gate('the renderer probe fixture is the one the generator wrote from spoint SceneSetup.js and WebGPUCullingProbe.js, 27 cases', () => {
  assert.equal(createHash('sha256').update(JSON.stringify(fixture.rows)).digest('hex'), fixture.sha256)
  assert.equal(fixture.rows.length, 27)
  assert.deepEqual(fixture.source.files, ['client/core/SceneSetup.js', 'client/core/WebGPUCullingProbe.js'])
})

gate('probeWebGL2 gives the spoint answer on 6 hosts: true only for a webgl2 context that is a WebGL2RenderingContext', () => {
  assert.deepEqual(rowsOf(ran, 'webgl2'), rowsOf(fixture.rows, 'webgl2'))
  assert.deepEqual(rowsOf(ran, 'webgl2').map((row) => row.result), [true, false, false, false, false, false])
})

gate('probeOffscreenCanvasWorkerRendering gives the spoint result, detail and side effects on 13 hosts, the 2 s timeout among them', () => {
  assert.deepEqual(rowsOf(ran, 'offscreen'), rowsOf(fixture.rows, 'offscreen'))
  assert.equal(OFFSCREEN_PROBE_TIMEOUT_MS, 2000)
  const timedOut = rowsOf(ran, 'offscreen').find((row) => row.name === 'the worker never answers')
  assert.equal(timedOut.result.detail.error, 'worker webgl2-in-worker probe timed out (2s)')
  assert.ok(timedOut.log.includes('terminate') && timedOut.log.includes('revoke blob:probe'), 'the timed-out worker was not cleaned up')
})

gate('the worker source the probe runs is the text spoint ships', () => {
  const spoint = fixture.source.files[0]
  assert.equal(spoint, 'client/core/SceneSetup.js')
  assert.equal(createHash('sha256').update(OFFSCREEN_PROBE_WORKER_SOURCE).digest('hex'), createHash('sha256').update("\n      self.onmessage = function (e) {\n        try {\n          const off = e.data.canvas\n          const gl = off.getContext('webgl2')\n          self.postMessage({ ok: !!gl })\n        } catch (err) {\n          self.postMessage({ ok: false, error: String(err && err.message || err) })\n        }\n      }\n    ").digest('hex'))
})

gate('probeWebGPU gives the spoint result on 8 hosts: a software or fallback adapter is refused and the probe device is destroyed', () => {
  assert.deepEqual(rowsOf(ran, 'webgpu'), rowsOf(fixture.rows, 'webgpu'))
  assert.ok(rowsOf(ran, 'webgpu')[0].log.includes('device destroyed'), 'the probe device was left alive')
  assert.equal(rowsOf(ran, 'webgpu').filter((row) => row.result.supported).length, 2)
})

gate('createRenderer follows spoint: antialias off and half pixel ratio capped at 1 on mobile, ratio capped at 2 on desktop, shadows off, XR on, sRGB out, canvas appended', () => {
  const desktop = makeEnv()
  const renderer = createRenderer(false, desktop.env)
  assert.deepEqual(renderer.parameters, { antialias: true, powerPreference: 'high-performance' })
  assert.deepEqual(renderer.calls, [['setSize', 1280, 720], ['setPixelRatio', 2]])
  assert.deepEqual(renderer.shadowMap, { enabled: false, type: 'PCFShadowMap', autoUpdate: false, needsUpdate: true })
  assert.deepEqual([renderer.xr.enabled, renderer.outputColorSpace, renderer.debug.checkShaderErrors], [true, 'srgb', false])
  assert.deepEqual(desktop.tonemap, [['bind', true, true], ['apply']])
  assert.deepEqual(desktop.appended, [renderer.domElement])
  const mobile = createRenderer(true, makeEnv({}, { devicePixelRatio: 3 }).env)
  assert.deepEqual([mobile.parameters.antialias, mobile.calls[1]], [false, ['setPixelRatio', 1]])
  assert.deepEqual(createRenderer(true, makeEnv({}, { devicePixelRatio: 1.5 }).env).calls[1], ['setPixelRatio', 0.75])
  assert.deepEqual(createRenderer(false, makeEnv({}, { devicePixelRatio: 1.25 }).env).calls[1], ['setPixelRatio', 1.25])
  assert.equal(createRenderer(false, makeEnv({}, { checkShaderErrors: true }).env).debug.checkShaderErrors, true)
})

gate('createRenderer warns on a lost context without the default action and reloads the page when the context is restored', () => {
  const made = makeEnv()
  const renderer = createRenderer(false, made.env)
  let prevented = 0
  renderer.listeners.webglcontextlost({ preventDefault: () => { prevented++ } })
  renderer.listeners.webglcontextrestored()
  assert.deepEqual([prevented, made.warnings, made.reloads.length], [1, ['[renderer] WebGL context lost'], 1])
})

gate('createRenderer throws an error coded NO_WEBGL2 when the probe fails, and builds no renderer', () => {
  const made = makeEnv({ context: 'none' })
  assert.throws(() => createRenderer(false, made.env), (error) => error.code === NO_WEBGL2 && error.message === 'WebGL2 is not available')
  assert.deepEqual(made.appended, [])
  assert.throws(() => createRenderer(false, { host: {} }), /needs env.host with window and document/)
})

gate('probeAndCreateWebGPURenderer probes WebGPU, builds the renderer with forceWebGL false, awaits init and then applies the common setup', async () => {
  const made = makeEnv({}, { search: '?gputime=1' })
  const renderer = await probeAndCreateWebGPURenderer(false, false, made.env)
  assert.deepEqual(renderer.parameters, { antialias: true, powerPreference: 'high-performance', forceWebGL: false, trackTimestamp: true })
  assert.deepEqual(renderer.calls, [['init'], ['setSize', 1280, 720], ['setPixelRatio', 2]])
  assert.ok(made.log.includes('device destroyed'))
  const plain = await probeAndCreateWebGPURenderer(true, false, makeEnv({}, { search: '?gputime=10' }).env)
  assert.deepEqual([plain.parameters.antialias, plain.parameters.trackTimestamp], [false, false])
})

gate('probeAndCreateWebGPURenderer throws NO_WEBGPU with the probe detail when WebGPU is refused, and with forceWebGL it asks only for WebGL2', async () => {
  const refused = makeEnv({ adapterInfo: { vendor: 'google', architecture: 'swiftshader', device: '', description: 'SwiftShader Device' } })
  await assert.rejects(() => probeAndCreateWebGPURenderer(false, false, refused.env), (error) => error.code === NO_WEBGPU && error.message.startsWith('WebGPU is not available: the adapter is software') && error.detail.adapter === true)
  const forced = makeEnv({ gpu: false })
  const renderer = await probeAndCreateWebGPURenderer(false, true, forced.env)
  assert.equal(renderer.parameters.forceWebGL, true)
  assert.ok(!forced.log.some((line) => line.startsWith('requestAdapter')), 'forceWebGL still asked for an adapter')
  await assert.rejects(() => probeAndCreateWebGPURenderer(false, true, makeEnv({ gpu: false, context: 'none' }).env), (error) => error.code === NO_WEBGL2)
  await assert.rejects(() => probeAndCreateWebGPURenderer(false, false, { ...makeEnv().env, loadWebGPURenderer: null }), /needs env.loadWebGPURenderer/)
})

gate('negative control: a fixture row with one changed field does not equal the port', () => {
  const changed = JSON.parse(JSON.stringify(fixture.rows))
  changed[6].result.detail.webgl2InWorker = false
  assert.notDeepEqual(ran, changed)
})

gate('the module reads no browser global: every window, document, navigator, location, Worker and timer is taken from the injected host', () => {
  const source = readFileSync(new URL('../src/client/rendererProbes.js', import.meta.url), 'utf8').replace(/`[^`]*`/g, '').replace(/'[^']*'/g, '')
  const bare = source.match(/(^|[^.\w])(window|document|navigator|location|Worker|OffscreenCanvas|HTMLCanvasElement|URL|Blob|setTimeout|clearTimeout|console|globalThis)\b/gm)
  assert.equal(bare, null)
  assert.equal(/\/\/|\/\*/.test(source), false)
})

finish()
