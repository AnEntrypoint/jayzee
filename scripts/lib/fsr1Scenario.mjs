import { createHash } from 'node:crypto'
import { canon } from './canon.mjs'

export const FSR1_CASE_LABELS = [
  'the EASU, RCAS and composite materials start with the spoint shader text and uniforms at the default sharpness',
  'compute at 640 by 360 copies the frame, runs EASU then RCAS into targets of that size, and sets the source texel',
  'composite draws the RCAS output to the canvas with the clear on',
  'a sharpness change, a resize to 320 by 180 and a pixel ratio of 2 rebuild the targets and run the same passes',
  'compute with a non-canvas render target restores that target and draws nothing',
  'compute with a failing frame copy draws nothing',
  'a zero-size canvas renders into 4 by 4 targets, because the clamp runs before any check',
  'dispose leaves the last target size and logs nothing',
  'the FSR1 graph nodes are named, ordered and read from their inputs',
  'the compute node runs only with fsr1 on, a context and a downscaled buffer, and the composite node waits for the compute of the same frame',
  'installFSR1 builds one WebGL FSR1 per context and refuses a WebGPU renderer',
]

const sha = (text) => createHash('sha256').update(text).digest('hex')

const describeValue = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v.toArray === 'function') return v.toArray()
  if (v.image) return { texture: [v.image.width, v.image.height] }
  return 'opaque'
}
const uniformsOf = (material) => Object.fromEntries(Object.entries(material.uniforms).map(([key, u]) => [key, describeValue(u.value)]))
const shaderOf = (material) => ({ vertex: sha(material.vertexShader), fragment: sha(material.fragmentShader) })
const describeMaterial = (material) => ({ shader: shaderOf(material), uniforms: uniformsOf(material) })

export function runFsr1Scenario(api) {
  const rows = []
  const log = []
  const renderer = {
    autoClear: true,
    width: 640,
    height: 360,
    pixelRatio: 1,
    failCopy: false,
    target: null,
    getSize(v) { v.set(this.width, this.height); return v },
    getPixelRatio() { return this.pixelRatio },
    getRenderTarget() { return this.target },
    setRenderTarget(t) { this.target = t; log.push(['setRenderTarget', t ? [t.width, t.height] : null]) },
    copyFramebufferToTexture(tex) {
      if (this.failCopy) throw new Error('copy refused')
      log.push(['copy', tex.image.width, tex.image.height])
    },
    render(scene) {
      const material = scene.children[0].material
      log.push(['render', this.target ? [this.target.width, this.target.height] : 'canvas', shaderOf(material), uniformsOf(material), this.autoClear])
    },
  }
  const take = () => log.splice(0)
  const record = (label, value) => rows.push(canon({ label, value }))

  const fsr1 = api.make(renderer)
  record(FSR1_CASE_LABELS[0], { easu: describeMaterial(fsr1._easuMat), rcas: describeMaterial(fsr1._rcasMat), composite: describeMaterial(fsr1._compositeMat) })

  renderer.width = 640
  renderer.height = 360
  fsr1.compute()
  record(FSR1_CASE_LABELS[1], take())
  fsr1.composite()
  record(FSR1_CASE_LABELS[2], take())

  api.set('fsr1Sharpness', 0.8)
  renderer.width = 320
  renderer.height = 180
  fsr1.compute()
  renderer.pixelRatio = 2
  fsr1.compute()
  renderer.pixelRatio = 1
  record(FSR1_CASE_LABELS[3], take())

  renderer.width = 640
  renderer.height = 360
  renderer.target = { width: 96, height: 54 }
  fsr1.compute()
  renderer.target = null
  record(FSR1_CASE_LABELS[4], take())

  renderer.failCopy = true
  fsr1.compute()
  renderer.failCopy = false
  record(FSR1_CASE_LABELS[5], take())

  renderer.width = 0
  renderer.height = 0
  fsr1.compute()
  renderer.width = 640
  renderer.height = 360
  record(FSR1_CASE_LABELS[6], take())

  fsr1.dispose()
  record(FSR1_CASE_LABELS[7], { w: fsr1._w, h: fsr1._h, logged: take().length })

  api.set('fsr1', false)
  api.set('dpr', null)
  const nodes = api.buildNodes(null)
  record(FSR1_CASE_LABELS[8], nodes.map((n) => ({ id: n.id, reads: n.reads, writes: n.writes, targets: n.targets ?? null })))

  const probes = [
    { fsr1: false, dpr: null, display: { devicePixelRatio: 2 } },
    { fsr1: true, dpr: { scale: 0.5 }, display: null },
    { fsr1: true, dpr: 1, display: { devicePixelRatio: 2 } },
    { fsr1: true, dpr: 1, display: { devicePixelRatio: 1 } },
    { fsr1: true, dpr: { scale: 0.75 }, display: { devicePixelRatio: 1 } },
    { fsr1: true, dpr: { scale: 1 }, display: { devicePixelRatio: 1 } },
    { fsr1: true, dpr: null, display: { devicePixelRatio: 2 } },
  ]
  record(FSR1_CASE_LABELS[9], probes.map((p) => {
    api.set('fsr1', p.fsr1)
    api.set('dpr', p.dpr)
    const [compute, composite] = api.buildNodes(p.display)
    return {
      compute: compute.shouldRun({ fsr1: {}, frameId: 2, res: {} }),
      computeWithoutFsr1: compute.shouldRun({ fsr1: null, frameId: 2, res: {} }),
      composite: composite.shouldRun({ fsr1: {}, frameId: 2, res: { fsr1Computed: 2 } }),
      staleComposite: composite.shouldRun({ fsr1: {}, frameId: 2, res: { fsr1Computed: 1 } }),
    }
  }))
  api.set('fsr1', false)
  api.set('dpr', null)

  const ctx = {}
  const first = api.install(ctx, { isWebGPURenderer: false })
  const second = api.install(ctx, { isWebGPURenderer: false })
  let webgpuThrows = false
  try { api.install({}, { isWebGPURenderer: true }) } catch { webgpuThrows = true }
  record(FSR1_CASE_LABELS[10], { className: first.constructor.name, sameInstance: first === second, ctxHoldsIt: ctx.fsr1 === first, webgpuThrows })

  return { rows }
}
