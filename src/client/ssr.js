import * as THREE from 'three'
import { SSR_FULLSCREEN_VERT, SSR_FRAG, SSR_WETNESS_GBUFFER_VERT, SSR_WETNESS_GBUFFER_FRAG, SSR_COMPOSITE_FRAG } from '../render/postFxShaders.js'

const defaultOnBeforeRender = new THREE.Object3D().onBeforeRender
const sizeScratch = new THREE.Vector2()
const prevClearColor = new THREE.Color()
const seaUniform = { value: new Float32Array([-100000, 0, 0, 0]) }
const seaShiftUniform = { value: new Float32Array([0, 0, 0]) }
let weatherWetness = 0

export function setWeatherWetness(w) {
  weatherWetness = THREE.MathUtils.clamp(Number.isFinite(w) ? w : 0, 0, 1)
}

function renderDeferringUnreadyPrograms(renderer, scene, camera) {
  const prev = renderer.deferUnreadyPrograms
  renderer.deferredProgramDraws = renderer.deferredProgramDraws || 0
  renderer.deferUnreadyPrograms = true
  try { renderer.render(scene, camera) } finally { renderer.deferUnreadyPrograms = prev }
}

export class SSR {
  constructor(renderer, scene, camera, controls) {
    if (!controls || typeof controls.get !== 'function') throw new TypeError('SSR needs controls.get')
    this.renderer = renderer
    this.scene = scene
    this.camera = camera
    this.controls = controls
    this._w = 0
    this._h = 0
    this._built = false

    this._quadScene = new THREE.Scene()
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._quadGeo = new THREE.PlaneGeometry(2, 2)

    this._ssrMat = new THREE.ShaderMaterial({
      vertexShader: SSR_FULLSCREEN_VERT,
      fragmentShader: SSR_FRAG,
      uniforms: {
        tGBuffer: { value: null },
        tScene: { value: null },
        tWetness: { value: null },
        uHasWetness: { value: false },
        uWeatherWetness: { value: 0 },
        uResolution: { value: new THREE.Vector2(1, 1) },
        uProjectionMatrix: { value: new THREE.Matrix4() },
        uFovFactor: { value: 1 },
        uAspect: { value: 1 },
        uIntensity: { value: controls.get('ssrIntensity') },
        uMaxDistance: { value: controls.get('ssrMaxDistance') },
        uCamWorld: { value: new THREE.Vector3() },
        uBandHeight: { value: controls.get('ssrBandHeight') },
        uNormalViewToWorld: { value: new THREE.Matrix3() },
        spointSea: seaUniform,
        spointSeaShift: seaShiftUniform,
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
    })
    this._quad = new THREE.Mesh(this._quadGeo, this._ssrMat)
    this._quad.frustumCulled = false
    this._quadScene.add(this._quad)

    this._wetnessMat = new THREE.ShaderMaterial({
      vertexShader: SSR_WETNESS_GBUFFER_VERT,
      fragmentShader: SSR_WETNESS_GBUFFER_FRAG,
      uniforms: { uWetness: { value: 0 } },
      side: THREE.DoubleSide,
    })

    this._compositeMat = new THREE.ShaderMaterial({
      vertexShader: SSR_FULLSCREEN_VERT,
      fragmentShader: SSR_COMPOSITE_FRAG,
      uniforms: { tSSR: { value: null } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.NormalBlending,
    })
    this._compositeQuad = new THREE.Mesh(this._quadGeo, this._compositeMat)
    this._compositeQuad.frustumCulled = false
  }

  _ensureTargets(fullW, fullH) {
    const w = Math.max(4, Math.floor(fullW * 0.5))
    const h = Math.max(4, Math.floor(fullH * 0.5))
    const fullResChanged = fullW !== this._fullW || fullH !== this._fullH
    if (this._built && w === this._w && h === this._h && !fullResChanged) return
    this._disposeTargets()
    this._w = w
    this._h = h
    this._fullW = fullW
    this._fullH = fullH
    this._ssrTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
    })
    this._wetnessTarget = new THREE.WebGLRenderTarget(w, h, {
      type: THREE.UnsignedByteType,
      format: THREE.RGBAFormat,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
    })
    this._sceneCopyTex = new THREE.FramebufferTexture(fullW, fullH)
    this._ssrMat.uniforms.uResolution.value.set(w, h)
    this._built = true
  }

  _disposeTargets() {
    if (this._ssrTarget) this._ssrTarget.dispose()
    if (this._wetnessTarget) this._wetnessTarget.dispose()
    if (this._sceneCopyTex) this._sceneCopyTex.dispose()
  }

  _renderWetnessGBuffer() {
    if (!this._wetnessTarget) return false
    const mat = this._wetnessMat
    const pushWetness = function () {
      mat.uniforms.uWetness.value = this.userData.wetness || 0
    }
    const touched = []
    this.scene.traverse((o) => {
      if (!o.isMesh || !o.visible) return
      if (o.onBeforeRender !== defaultOnBeforeRender) return
      touched.push([o, o.onBeforeRender])
      o.onBeforeRender = pushWetness
    })
    const prevTarget = this.renderer.getRenderTarget()
    const prevOverride = this.scene.overrideMaterial
    const prevAutoClear = this.renderer.autoClear
    this.renderer.getClearColor(prevClearColor)
    const prevClearAlpha = this.renderer.getClearAlpha()

    this.renderer.setRenderTarget(this._wetnessTarget)
    this.renderer.autoClear = true
    this.renderer.setClearColor(0x000000, 1)
    this.scene.overrideMaterial = this._wetnessMat
    renderDeferringUnreadyPrograms(this.renderer, this.scene, this.camera)
    this.scene.overrideMaterial = prevOverride

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
    this.renderer.setClearColor(prevClearColor, prevClearAlpha)
    for (const [o, orig] of touched) o.onBeforeRender = orig
    return true
  }

  setSharedGBuffer(gbufferTexture) {
    this._sharedGBuffer = gbufferTexture || null
  }

  compute() {
    const gbuffer = this._sharedGBuffer
    if (!gbuffer) return
    const size = sizeScratch
    this.renderer.getSize(size)
    if (size.x <= 0 || size.y <= 0) return
    this._ensureTargets(size.x, size.y)

    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    if (prevTarget !== null) return

    try {
      this.renderer.copyFramebufferToTexture(this._sceneCopyTex)
    } catch {
      return
    }

    const hasWetness = this._renderWetnessGBuffer()

    const fov = this.camera.fov ? THREE.MathUtils.degToRad(this.camera.fov) : Math.PI / 3
    const u = this._ssrMat.uniforms
    u.tGBuffer.value = gbuffer
    u.tScene.value = this._sceneCopyTex
    u.tWetness.value = hasWetness ? this._wetnessTarget.texture : null
    u.uHasWetness.value = hasWetness
    u.uWeatherWetness.value = THREE.MathUtils.clamp(weatherWetness, 0, 1)
    u.uProjectionMatrix.value.copy(this.camera.projectionMatrix)
    u.uFovFactor.value = Math.tan(fov / 2)
    u.uAspect.value = size.x / size.y
    u.uIntensity.value = this.controls.get('ssrIntensity')
    u.uMaxDistance.value = this.controls.get('ssrMaxDistance')
    u.uBandHeight.value = this.controls.get('ssrBandHeight')
    this.camera.getWorldPosition(u.uCamWorld.value)
    const vm = this.camera.matrixWorldInverse.elements
    u.uNormalViewToWorld.value.set(
      vm[0], vm[1], vm[2],
      vm[4], vm[5], vm[6],
      vm[8], vm[9], vm[10],
    ).transpose()

    this.renderer.setRenderTarget(this._ssrTarget)
    this.renderer.autoClear = true
    this.renderer.render(this._quadScene, this._quadCamera)

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
    this.reflectionTexture = this._ssrTarget.texture
  }

  composite() {
    if (!this.reflectionTexture) return
    this._compositeMat.uniforms.tSSR.value = this.reflectionTexture
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.render(this._quadScene, this._quadCamera)
    this.renderer.autoClear = prevAutoClear
  }

  dispose() {
    this._disposeTargets()
    this._ssrMat.dispose()
    this._wetnessMat.dispose()
    this._compositeMat.dispose()
    this._quadGeo.dispose()
  }
}

export function buildSSRNodes(controls) {
  return [
    {
      id: 'ssr-compute',
      reads: ['sceneColor', 'ssaoComputed'],
      writes: ['ssrComputed'],
      shouldRun: (ctx) => controls.get('ssr') === true && !!ctx.ssr && controls.get('ssao') === true,
      run(ctx) {
        if (ctx.ssao && ctx.ssao._gbufferTarget) ctx.ssr.setSharedGBuffer(ctx.ssao._gbufferTarget.texture)
        ctx.ssr.compute()
        ctx.res.ssrComputed = ctx.frameId
      },
    },
    {
      id: 'ssr-composite',
      reads: ['ssrComputed', 'bloomComposited'],
      writes: ['ssrComposited'],
      targets: { ssrComposited: 'canvas' },
      shouldRun: (ctx) => controls.get('ssr') === true && !!ctx.ssr && ctx.res.ssrComputed === ctx.frameId,
      run(ctx) {
        ctx.ssr.composite()
        ctx.res.ssrComposited = ctx.frameId
      },
    },
  ]
}

export function installSSR(ctx, renderer, scene, camera, controls) {
  if (!ctx.ssr) {
    if (renderer && renderer.isWebGPURenderer) throw new Error('SSR WebGPU is not ported')
    ctx.ssr = new SSR(renderer, scene, camera, controls)
  }
  return ctx.ssr
}
