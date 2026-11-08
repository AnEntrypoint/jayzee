import * as THREE from 'three'
import { BLOOM_FULLSCREEN_VERT, BLOOM_THRESHOLD_FRAG, BLOOM_BLUR_FRAG, BLOOM_COMPOSITE_FRAG } from '../render/postFxShaders.js'
import { BloomWebGPU } from './bloomWebGPU.js'

const KNEE = 0.15
const sizeScratch = new THREE.Vector2()

export class Bloom {
  constructor(renderer, controls) {
    if (!controls || typeof controls.get !== 'function') throw new TypeError('Bloom needs controls.get')
    this.renderer = renderer
    this.controls = controls
    this._w = 0
    this._h = 0
    this._built = false

    this._quadScene = new THREE.Scene()
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._quadGeo = new THREE.PlaneGeometry(2, 2)

    this._thresholdMat = new THREE.ShaderMaterial({
      vertexShader: BLOOM_FULLSCREEN_VERT,
      fragmentShader: BLOOM_THRESHOLD_FRAG,
      uniforms: {
        tScene: { value: null },
        uThreshold: { value: controls.get('bloomThreshold') },
        uKnee: { value: KNEE },
      },
      depthTest: false,
      depthWrite: false,
    })
    this._blurMat = new THREE.ShaderMaterial({
      vertexShader: BLOOM_FULLSCREEN_VERT,
      fragmentShader: BLOOM_BLUR_FRAG,
      uniforms: { tSource: { value: null }, uDirection: { value: new THREE.Vector2(0, 0) } },
      depthTest: false,
      depthWrite: false,
    })
    this._compositeMat = new THREE.ShaderMaterial({
      vertexShader: BLOOM_FULLSCREEN_VERT,
      fragmentShader: BLOOM_COMPOSITE_FRAG,
      uniforms: { tBloom: { value: null }, uIntensity: { value: controls.get('bloomIntensity') } },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this._quad = new THREE.Mesh(this._quadGeo, this._thresholdMat)
    this._quad.frustumCulled = false
    this._quadScene.add(this._quad)
  }

  _ensureTargets(fullW, fullH) {
    const scale = this.controls.get('bloomResolutionScale') || 0.5
    const w = Math.max(4, Math.floor(fullW * scale))
    const h = Math.max(4, Math.floor(fullH * scale))
    const fullResChanged = fullW !== this._fullW || fullH !== this._fullH
    if (this._built && w === this._w && h === this._h && !fullResChanged) return
    this._disposeTargets()
    this._w = w; this._h = h
    this._fullW = fullW; this._fullH = fullH
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }
    this._brightTarget = new THREE.WebGLRenderTarget(w, h, opts)
    this._pingTarget = new THREE.WebGLRenderTarget(w, h, opts)
    this._sceneCopyTex = new THREE.FramebufferTexture(fullW, fullH)
    this._built = true
  }

  _disposeTargets() {
    if (this._brightTarget) this._brightTarget.dispose()
    if (this._pingTarget) this._pingTarget.dispose()
    if (this._sceneCopyTex) this._sceneCopyTex.dispose()
  }

  compute() {
    const size = sizeScratch
    this.renderer.getSize(size)
    if (size.x <= 0 || size.y <= 0) return
    this._ensureTargets(size.x, size.y)

    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear

    const readBufferIsCanvas = prevTarget === null
    if (!readBufferIsCanvas) {
      this.renderer.setRenderTarget(prevTarget)
      this.renderer.autoClear = prevAutoClear
      return
    }
    try {
      this.renderer.copyFramebufferToTexture(this._sceneCopyTex)
    } catch (_) {
      return
    }

    this._thresholdMat.uniforms.tScene.value = this._sceneCopyTex
    this._thresholdMat.uniforms.uThreshold.value = this.controls.get('bloomThreshold')
    this._quad.material = this._thresholdMat
    this.renderer.setRenderTarget(this._brightTarget)
    this.renderer.autoClear = true
    this.renderer.render(this._quadScene, this._quadCamera)

    const passes = Math.max(1, this.controls.get('bloomBlurPasses') || 1)
    this._quad.material = this._blurMat
    let src = this._brightTarget, dst = this._pingTarget
    for (let i = 0; i < passes; i++) {
      this._blurMat.uniforms.tSource.value = src.texture
      this._blurMat.uniforms.uDirection.value.set(1 / this._w, 0)
      this.renderer.setRenderTarget(dst)
      this.renderer.autoClear = true
      this.renderer.render(this._quadScene, this._quadCamera)
      const tmp1 = src; src = dst; dst = tmp1

      this._blurMat.uniforms.tSource.value = src.texture
      this._blurMat.uniforms.uDirection.value.set(0, 1 / this._h)
      this.renderer.setRenderTarget(dst)
      this.renderer.autoClear = true
      this.renderer.render(this._quadScene, this._quadCamera)
      const tmp2 = src; src = dst; dst = tmp2
    }
    this.bloomTexture = src.texture

    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
  }

  composite() {
    if (!this.bloomTexture) return
    this._compositeMat.uniforms.tBloom.value = this.bloomTexture
    this._compositeMat.uniforms.uIntensity.value = this.controls.get('bloomIntensity')
    this._quad.material = this._compositeMat
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this.renderer.render(this._quadScene, this._quadCamera)
    this.renderer.autoClear = prevAutoClear
  }

  dispose() {
    this._disposeTargets()
    this._thresholdMat.dispose()
    this._blurMat.dispose()
    this._compositeMat.dispose()
    this._quadGeo.dispose()
  }
}

export function buildBloomNodes(controls) {
  return [
    {
      id: 'bloom-compute',
      reads: ['sceneColor'],
      writes: ['bloomComputed'],
      shouldRun: ctx => controls.get('bloom') === true && !!ctx.bloom,
      run(ctx) {
        ctx.bloom.compute()
        ctx.res.bloomComputed = ctx.frameId
      },
    },
    {
      id: 'bloom-composite',
      reads: ['bloomComputed', 'ssaoComposited'],
      writes: ['bloomComposited'],
      targets: { bloomComposited: 'canvas' },
      shouldRun: ctx => controls.get('bloom') === true && !!ctx.bloom && ctx.res.bloomComputed === ctx.frameId,
      run(ctx) {
        ctx.bloom.composite()
        ctx.res.bloomComposited = ctx.frameId
      },
    },
  ]
}

export function installBloom(ctx, renderer, controls) {
  if (!ctx.bloom) {
    ctx.bloom = renderer && renderer.isWebGPURenderer ? new BloomWebGPU(renderer, controls) : new Bloom(renderer, controls)
  }
  return ctx.bloom
}
