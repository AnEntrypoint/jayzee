import { createHash } from 'node:crypto'
import * as THREE from 'three'
import { canon } from './canon.mjs'

export const SSR_CASE_LABELS = [
  'the ssr, wetness and composite materials start with the spoint uniforms, flags and shaders, and the quad scene holds only the ssr quad',
  'compute does nothing without a shared gbuffer, with a render target set, or when the frame copy fails',
  'compute copies the frame, renders the wetness pass with the override material, then draws the ssr quad into a half-size target',
  'composite draws the ssr quad again with autoClear off, and its own composite material is never drawn',
  'a resize rebuilds the half-size targets and reruns the wetness and ssr passes at the new size',
  'a control change and a weather value above 1 reach the next compute, and weather wetness is clamped to 0 to 1',
  'dispose disposes the materials, geometry and targets and keeps the last size',
  'the ssr graph nodes are named, ordered and read from their inputs',
  'the compute node needs ssr and ssao on, the composite node needs the compute of the same frame, and the compute node hands its gbuffer to ssr before it runs',
  'installSSR keeps one instance per context and refuses a WebGPU renderer',
]

const sha = (text) => createHash('sha256').update(text).digest('hex').slice(0, 16)

const describeValue = (v) => {
  if (v === null || v === undefined) return null
  if (typeof v === 'number' || typeof v === 'boolean') return v
  if (ArrayBuffer.isView(v)) return Array.from(v)
  if (typeof v.toArray === 'function') return v.toArray()
  if (v.image) return { texture: [v.image.width, v.image.height] }
  return 'opaque'
}

const uniformsOf = (material) => {
  if (!material.uniforms) return material.type
  return Object.fromEntries(Object.entries(material.uniforms).map(([key, u]) => [key, describeValue(u.value)]))
}

const flagsOf = (m) => ({
  type: m.type,
  transparent: m.transparent,
  depthTest: m.depthTest,
  depthWrite: m.depthWrite,
  side: m.side,
  blending: m.blending,
  vertex: sha(m.vertexShader),
  fragment: sha(m.fragmentShader),
})

const DISPOSABLE = ['_ssrMat', '_wetnessMat', '_compositeMat', '_quadGeo', '_ssrTarget', '_wetnessTarget', '_sceneCopyTex']

export function runSsrScenario(api) {
  const rows = []
  const log = []
  const record = (index, value) => rows.push(canon({ label: SSR_CASE_LABELS[index], value }))
  const take = () => log.splice(0)

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera()
  camera.position.set(1, 2, 3)
  camera.lookAt(0, 0, 0)
  camera.updateMatrixWorld()

  const addMesh = (parent, name, wetness) => {
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
    mesh.name = name
    if (wetness !== undefined) mesh.userData.wetness = wetness
    parent.add(mesh)
    return mesh
  }
  const wet = addMesh(scene, 'wet', 0.4)
  const dry = addMesh(scene, 'dry')
  const hidden = addMesh(scene, 'hidden', 0.7)
  hidden.visible = false
  const customHook = () => {}
  const custom = addMesh(scene, 'custom', 0.9)
  custom.onBeforeRender = customHook
  const group = new THREE.Group()
  group.name = 'group'
  scene.add(group)
  const nested = addMesh(group, 'nested', 0.25)

  const renderer = {
    width: 640,
    height: 360,
    autoClear: true,
    target: null,
    clear: { color: 0x123456, alpha: 0.5 },
    copyThrows: false,
    getSize(v) { return v.set(this.width, this.height) },
    getRenderTarget() { return this.target },
    setRenderTarget(t) {
      this.target = t
      log.push(['setRenderTarget', t ? [t.width, t.height] : null])
    },
    copyFramebufferToTexture(tex) {
      if (this.copyThrows) throw new Error('copy refused')
      log.push(['copy', tex.image.width, tex.image.height])
    },
    getClearColor(c) { c.setHex(this.clear.color); return c },
    getClearAlpha() { return this.clear.alpha },
    setClearColor(c, alpha) {
      this.clear = { color: typeof c === 'number' ? c : c.getHex(), alpha }
      log.push(['setClearColor', this.clear.color, alpha])
    },
    render(s, cam) {
      const override = s.overrideMaterial ?? null
      const draws = []
      s.traverse((o) => {
        if (!o.isMesh || !o.visible) return
        const material = override ?? o.material
        o.onBeforeRender(this, s, cam, o.geometry, material, null)
        draws.push([o.name, uniformsOf(material)])
      })
      log.push([
        'render',
        s === scene ? 'scene' : 'quad',
        this.target ? [this.target.width, this.target.height] : 'canvas',
        {
          override: override ? { type: override.type, uniforms: Object.keys(override.uniforms).sort() } : null,
          deferred: this.deferUnreadyPrograms,
          deferredDraws: this.deferredProgramDraws,
          autoClear: this.autoClear,
        },
        draws,
      ])
    },
  }

  const gbuffer = new THREE.Texture({ width: 640, height: 360 })
  const ssr = api.make(renderer, scene, camera)
  record(0, {
    uniforms: { ssr: uniformsOf(ssr._ssrMat), wetness: uniformsOf(ssr._wetnessMat), composite: uniformsOf(ssr._compositeMat) },
    materials: { ssr: flagsOf(ssr._ssrMat), wetness: flagsOf(ssr._wetnessMat), composite: flagsOf(ssr._compositeMat) },
    quad: {
      frustumCulled: ssr._quad.frustumCulled,
      compositeQuadFrustumCulled: ssr._compositeQuad.frustumCulled,
      quadSceneChildren: ssr._quadScene.children.length,
      built: ssr._built,
    },
  })

  ssr.compute()
  const noGBuffer = { built: ssr._built, logged: take() }
  ssr.setSharedGBuffer(gbuffer)
  renderer.target = { width: 1, height: 1 }
  ssr.compute()
  const targetSet = { built: ssr._built, logged: take() }
  renderer.target = null
  renderer.copyThrows = true
  ssr.compute()
  const copyFails = { built: ssr._built, logged: take() }
  renderer.copyThrows = false
  record(1, [noGBuffer, targetSet, copyFails])

  api.setWetness(0.25)
  ssr.compute()
  record(2, {
    passes: take(),
    restored: [wet, dry, nested].map((m) => m.onBeforeRender === THREE.Object3D.prototype.onBeforeRender),
    customKept: custom.onBeforeRender === customHook,
    overrideAfter: scene.overrideMaterial ?? null,
  })

  ssr.composite()
  record(3, { passes: take(), compositeUniforms: uniformsOf(ssr._compositeMat) })

  renderer.width = 320
  renderer.height = 180
  ssr.compute()
  record(4, take())

  api.setControl('ssrIntensity', 0.35)
  api.setControl('ssrMaxDistance', 12.5)
  api.setControl('ssrBandHeight', 2.5)
  api.setWetness(2)
  ssr.compute()
  record(5, take())

  const disposed = []
  for (const name of DISPOSABLE) ssr[name].addEventListener('dispose', () => disposed.push(name))
  ssr.dispose()
  record(6, { disposed, w: ssr._w, h: ssr._h, built: ssr._built, logged: take() })

  const nodes = api.buildSSRNodes()
  record(7, nodes.map((n) => ({
    id: n.id,
    reads: n.reads,
    writes: n.writes,
    targets: n.targets ?? null,
    idleShouldRun: n.shouldRun({ ssr: {}, frameId: 2, res: {} }),
  })))

  const probe = (ssrOn, ssaoOn) => {
    api.setControl('ssr', ssrOn)
    api.setControl('ssao', ssaoOn)
    const [compute, composite] = nodes
    return {
      ssr: ssrOn,
      ssao: ssaoOn,
      compute: compute.shouldRun({ ssr, frameId: 2, res: {} }),
      composite: composite.shouldRun({ ssr, frameId: 2, res: { ssrComputed: 2 } }),
      compositeStale: composite.shouldRun({ ssr, frameId: 2, res: { ssrComputed: 1 } }),
    }
  }
  const matrix = [probe(false, false), probe(true, false), probe(true, true)]
  const gbuffer2 = new THREE.Texture({ width: 600, height: 300 })
  const res = {}
  nodes[0].run({ ssr, ssao: { _gbufferTarget: { texture: gbuffer2 } }, frameId: 2, res })
  nodes[1].run({ ssr, frameId: 2, res })
  record(8, { matrix, res, run: take() })

  const ctxA = {}
  const first = api.install(ctxA, renderer, scene, camera)
  const second = api.install(ctxA, renderer, scene, camera)
  let webgpuRefused = false
  try {
    api.install({}, { isWebGPURenderer: true }, scene, camera)
  } catch {
    webgpuRefused = true
  }
  record(9, { cls: first.constructor.name, same: first === second, webgpuRefused })

  return { rows }
}
