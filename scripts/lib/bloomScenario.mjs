import { canon } from './canon.mjs'

export const BLOOM_CASE_LABELS = [
  'the threshold, blur and composite materials start with the spoint uniforms',
  'compute copies the frame, thresholds it into a half-size target and blurs it in each pass',
  'composite adds the bloom texture with its intensity and does not clear the canvas',
  'a resize rebuilds the half-size targets and runs the same passes',
  'dispose leaves the bloom size at the last target',
  'the bloom graph nodes are named, ordered and read from their inputs',
  'the composite node waits for the bloom compute of the same frame',
]

const describeValue = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (typeof v.toArray === 'function') return v.toArray()
  if (v.image) return { texture: [v.image.width, v.image.height] }
  return 'opaque'
}
const uniformsOf = (material) => Object.fromEntries(Object.entries(material.uniforms).map(([key, u]) => [key, describeValue(u.value)]))

export function runBloomScenario(api) {
  const rows = []
  const log = []
  const renderer = {
    autoClear: true,
    width: 640,
    height: 360,
    target: null,
    getSize(v) { v.set(this.width, this.height); return v },
    getRenderTarget() { return this.target },
    setRenderTarget(t) { this.target = t; log.push(['setRenderTarget', t ? [t.width, t.height] : null]) },
    copyFramebufferToTexture(tex) { log.push(['copy', tex.image.width, tex.image.height]) },
    render(scene) {
      const material = scene.children[0].material
      log.push(['render', this.target ? [this.target.width, this.target.height] : 'canvas', uniformsOf(material), this.autoClear])
    },
  }
  const take = () => log.splice(0)
  const record = (label, value) => rows.push(canon({ label, value }))

  const bloom = api.make(renderer)
  record(BLOOM_CASE_LABELS[0], {
    threshold: uniformsOf(bloom._thresholdMat),
    blur: uniformsOf(bloom._blurMat),
    composite: uniformsOf(bloom._compositeMat),
  })

  bloom.compute()
  record(BLOOM_CASE_LABELS[1], take())
  bloom.composite()
  record(BLOOM_CASE_LABELS[2], take())

  renderer.width = 320
  renderer.height = 180
  bloom.compute()
  record(BLOOM_CASE_LABELS[3], take())

  bloom.dispose()
  record(BLOOM_CASE_LABELS[4], { w: bloom._w, h: bloom._h, logged: take().length })

  const nodes = api.buildBloomNodes()
  const stub = { _w: 0 }
  record(BLOOM_CASE_LABELS[5], nodes.map((n) => ({ id: n.id, reads: n.reads, writes: n.writes, targets: n.targets ?? null, idleShouldRun: n.shouldRun({ bloom: stub, frameId: 2, res: {} }) })))
  record(BLOOM_CASE_LABELS[6], nodes.map((n) => ({ id: n.id, computedShouldRun: n.shouldRun({ bloom: stub, frameId: 2, res: { bloomComputed: 2 } }) })))

  return { rows }
}
