import * as THREE from 'three'
import { FSR1_FULLSCREEN_VERT, FSR1_EASU_FRAG, FSR1_RCAS_FRAG, FSR1_COMPOSITE_FRAG } from '../render/postFxShaders.js'

const sizeScratch = new THREE.Vector2()

export class FSR1 {
  constructor(renderer, controls) {
    if (!controls || typeof controls.get !== 'function') throw new TypeError('FSR1 needs controls.get')
    this.renderer = renderer
    this.controls = controls
    this._w = 0
    this._h = 0
    this._built = false

    this._quadScene = new THREE.Scene()
    this._quadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
    this._quadGeo = new THREE.PlaneGeometry(2, 2)

    this._easuMat = new THREE.ShaderMaterial({
      vertexShader: FSR1_FULLSCREEN_VERT,
      fragmentShader: FSR1_EASU_FRAG,
      uniforms: { tSource: { value: null }, uSrcTexel: { value: new THREE.Vector2(0, 0) } },
      depthTest: false,
      depthWrite: false,
    })
    this._rcasMat = new THREE.ShaderMaterial({
      vertexShader: FSR1_FULLSCREEN_VERT,
      fragmentShader: FSR1_RCAS_FRAG,
      uniforms: { tSource: { value: null }, uTexel: { value: new THREE.Vector2(0, 0) }, uSharpness: { value: controls.get('fsr1Sharpness') } },
      depthTest: false,
      depthWrite: false,
    })
    this._compositeMat = new THREE.ShaderMaterial({
      vertexShader: FSR1_FULLSCREEN_VERT,
      fragmentShader: FSR1_COMPOSITE_FRAG,
      uniforms: { tSource: { value: null } },
      depthTest: false,
      depthWrite: false,
    })
    this._quad = new THREE.Mesh(this._quadGeo, this._easuMat)
    this._quad.frustumCulled = false
    this._quadScene.add(this._quad)
  }

  _ensureTargets(w, h) {
    if (this._built && w === this._w && h === this._h) return
    this._disposeTargets()
    this._w = w; this._h = h
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }
    this._easuTarget = new THREE.WebGLRenderTarget(w, h, opts)
    this._rcasTarget = new THREE.WebGLRenderTarget(w, h, opts)
    this._sceneCopyTex = new THREE.FramebufferTexture(w, h)
    this._built = true
  }

  _disposeTargets() {
    if (this._easuTarget) this._easuTarget.dispose()
    if (this._rcasTarget) this._rcasTarget.dispose()
    if (this._sceneCopyTex) this._sceneCopyTex.dispose()
  }

  compute() {
    this.renderer.getSize(sizeScratch)
    const pr = this.renderer.getPixelRatio ? this.renderer.getPixelRatio() : 1
    const w = Math.max(4, Math.round(sizeScratch.x * pr))
    const h = Math.max(4, Math.round(sizeScratch.y * pr))
    this._ensureTargets(w, h)

    const prevTarget = this.renderer.getRenderTarget()
    const prevAutoClear = this.renderer.autoClear
    if (prevTarget !== null) {
      this.renderer.setRenderTarget(prevTarget)
      this.renderer.autoClear = prevAutoClear
      return
    }

    try {
      this.renderer.copyFramebufferToTexture(this._sceneCopyTex)
    } catch {
      return
    }

    this._easuMat.uniforms.tSource.value = this._sceneCopyTex
    this._easuMat.uniforms.uSrcTexel.value.set(1 / w, 1 / h)
    this._quad.material = this._easuMat
    this.renderer.setRenderTarget(this._easuTarget)
    this.renderer.autoClear = true
    this.renderer.render(this._quadScene, this._quadCamera)

    this._rcasMat.uniforms.tSource.value = this._easuTarget.texture
    this._rcasMat.uniforms.uTexel.value.set(1 / w, 1 / h)
    this._rcasMat.uniforms.uSharpness.value = this.controls.get('fsr1Sharpness')
    this._quad.material = this._rcasMat
    this.renderer.setRenderTarget(this._rcasTarget)
    this.renderer.autoClear = true
    this.renderer.render(this._quadScene, this._quadCamera)

    this.outputTexture = this._rcasTarget.texture
    this.renderer.setRenderTarget(prevTarget)
    this.renderer.autoClear = prevAutoClear
  }

  composite() {
    if (!this.outputTexture) return
    this._compositeMat.uniforms.tSource.value = this.outputTexture
    this._quad.material = this._compositeMat
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = true
    this.renderer.render(this._quadScene, this._quadCamera)
    this.renderer.autoClear = prevAutoClear
  }

  dispose() {
    this._disposeTargets()
    this._easuMat.dispose()
    this._rcasMat.dispose()
    this._compositeMat.dispose()
    this._quadGeo.dispose()
  }
}

function dprIsDownscaled(controls, display) {
  if (!display) return false
  const dpr = controls.get('dpr')
  if (dpr == null) return false
  const scale = typeof dpr === 'object' ? +dpr.scale : +dpr / (display.devicePixelRatio || 1)
  return Number.isFinite(scale) && scale < 0.999
}

export function buildFSR1Nodes(controls, display) {
  return [
    {
      id: 'fsr1-compute',
      reads: ['sceneColor', 'bloomComposited', 'ssrComposited'],
      writes: ['fsr1Computed'],
      shouldRun: ctx => controls.get('fsr1') === true && !!ctx.fsr1 && dprIsDownscaled(controls, display),
      run(ctx) {
        ctx.fsr1.compute()
        ctx.res.fsr1Computed = ctx.frameId
      },
    },
    {
      id: 'fsr1-composite',
      reads: ['fsr1Computed'],
      writes: ['fsr1Composited'],
      targets: { fsr1Composited: 'canvas' },
      shouldRun: ctx => controls.get('fsr1') === true && !!ctx.fsr1 && ctx.res.fsr1Computed === ctx.frameId,
      run(ctx) {
        ctx.fsr1.composite()
        ctx.res.fsr1Composited = ctx.frameId
      },
    },
  ]
}

export function installFSR1(ctx, renderer, controls) {
  if (!ctx.fsr1) {
    if (renderer && renderer.isWebGPURenderer) throw new Error('FSR1 WebGPU is not ported; installFSR1 takes a WebGL renderer')
    ctx.fsr1 = new FSR1(renderer, controls)
  }
  return ctx.fsr1
}
