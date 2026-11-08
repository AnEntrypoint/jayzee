import * as THREE from 'three'
import { MeshBasicNodeMaterial, QuadMesh } from 'three/webgpu'
import { Fn, texture, uv, vec2, vec3, vec4, float, clamp, max, dot } from 'three/tsl'

const KNEE = 0.15
const LUMA = vec3(0.2126, 0.7152, 0.0722)
const BLUR_CENTRE_WEIGHT = 0.227
const BLUR_TAPS = 4
const sizeScratch = new THREE.Vector2()

function buildThresholdNode(sceneTex, threshold) {
  return Fn(() => {
    const c = texture(sceneTex, uv()).rgb.toVar()
    const lum = dot(c, LUMA)
    const soft = clamp(lum.sub(threshold).add(KNEE), 0.0, 2 * KNEE).toVar()
    soft.assign(soft.mul(soft).div(Math.max(0.0001, 4 * KNEE)))
    const contribution = max(soft, lum.sub(threshold))
    const scale = lum.greaterThan(0.0001).select(contribution.div(lum), float(0.0))
    return vec4(c.mul(clamp(scale, 0.0, 1.0)), 1.0)
  })()
}

function buildBlurNode(sourceTex, stepX, stepY) {
  return Fn(() => {
    const uvCoord = uv()
    const direction = vec2(stepX, stepY)
    const sum = texture(sourceTex, uvCoord).rgb.mul(BLUR_CENTRE_WEIGHT).toVar()
    for (let i = 1; i <= BLUR_TAPS; i++) {
      const w = 0.194 - i * 0.03
      const o = direction.mul(float(i))
      sum.addAssign(texture(sourceTex, uvCoord.add(o)).rgb.mul(w))
      sum.addAssign(texture(sourceTex, uvCoord.sub(o)).rgb.mul(w))
    }
    return vec4(max(sum, 0.0), 1.0)
  })()
}

function buildCompositeNode(bloomTex, intensity) {
  return Fn(() => vec4(texture(bloomTex, uv()).rgb.mul(intensity), 1.0))()
}

export class BloomWebGPU {
  constructor(renderer, controls) {
    if (!controls || typeof controls.get !== 'function') throw new TypeError('BloomWebGPU needs controls.get')
    this.renderer = renderer
    this.controls = controls
    this._w = 0
    this._h = 0
    this._built = false
    this._threshold = null
    this._intensity = null
    this._compositeSource = null

    this._thresholdMat = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false })
    this._blurMatH = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false })
    this._blurMatV = new MeshBasicNodeMaterial({ depthTest: false, depthWrite: false })
    this._compositeMat = new MeshBasicNodeMaterial({
      depthTest: false, depthWrite: false, transparent: true, blending: THREE.AdditiveBlending,
    })

    this._quad = new QuadMesh(this._thresholdMat)
  }

  _ensureTargets(fullW, fullH) {
    const scale = this.controls.get('bloomResolutionScale') || 0.5
    const w = Math.max(4, Math.floor(fullW * scale))
    const h = Math.max(4, Math.floor(fullH * scale))
    const fullResChanged = fullW !== this._fullW || fullH !== this._fullH
    if (this._built && w === this._w && h === this._h && !fullResChanged) return
    this._disposeTargets()
    this._w = w
    this._h = h
    this._fullW = fullW
    this._fullH = fullH
    const opts = {
      type: THREE.HalfFloatType,
      format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    }
    this._brightTarget = new THREE.RenderTarget(w, h, opts)
    this._pingTarget = new THREE.RenderTarget(w, h, opts)
    this._sceneCopyTex = new THREE.FramebufferTexture(fullW, fullH)

    this._threshold = this.controls.get('bloomThreshold')
    this._thresholdMat.colorNode = buildThresholdNode(this._sceneCopyTex, this._threshold)
    this._thresholdMat.needsUpdate = true
    this._blurMatH.colorNode = buildBlurNode(this._brightTarget.texture, 1 / w, 0)
    this._blurMatH.needsUpdate = true
    this._blurMatV.colorNode = buildBlurNode(this._pingTarget.texture, 0, 1 / h)
    this._blurMatV.needsUpdate = true
    this._built = true
  }

  _disposeTargets() {
    if (this._brightTarget) this._brightTarget.dispose()
    if (this._pingTarget) this._pingTarget.dispose()
    if (this._sceneCopyTex) this._sceneCopyTex.dispose()
  }

  compute() {
    this.renderer.getSize(sizeScratch)
    if (sizeScratch.x <= 0 || sizeScratch.y <= 0) return
    this._ensureTargets(sizeScratch.x, sizeScratch.y)

    const prevTarget = this.renderer.getRenderTarget()
    if (prevTarget !== null) {
      this.renderer.setRenderTarget(prevTarget)
      return
    }

    try {
      this.renderer.copyFramebufferToTexture(this._sceneCopyTex)
    } catch (_) {
      return
    }

    const threshold = this.controls.get('bloomThreshold')
    if (threshold !== this._threshold) {
      this._threshold = threshold
      this._thresholdMat.colorNode = buildThresholdNode(this._sceneCopyTex, threshold)
      this._thresholdMat.needsUpdate = true
    }

    this._quad.material = this._thresholdMat
    this.renderer.setRenderTarget(this._brightTarget)
    this._quad.render(this.renderer)

    const passes = Math.max(1, this.controls.get('bloomBlurPasses') || 1)
    for (let i = 0; i < passes; i++) {
      this._quad.material = this._blurMatH
      this.renderer.setRenderTarget(this._pingTarget)
      this._quad.render(this.renderer)

      this._quad.material = this._blurMatV
      this.renderer.setRenderTarget(this._brightTarget)
      this._quad.render(this.renderer)
    }
    this.bloomTexture = this._brightTarget.texture

    this.renderer.setRenderTarget(prevTarget)
  }

  composite() {
    if (!this.bloomTexture) return
    const intensity = this.controls.get('bloomIntensity')
    if (this._compositeSource !== this.bloomTexture || intensity !== this._intensity) {
      this._compositeMat.colorNode = buildCompositeNode(this.bloomTexture, intensity)
      this._compositeMat.needsUpdate = true
      this._compositeSource = this.bloomTexture
      this._intensity = intensity
    }
    this._quad.material = this._compositeMat
    const prevAutoClear = this.renderer.autoClear
    this.renderer.autoClear = false
    this._quad.render(this.renderer)
    this.renderer.autoClear = prevAutoClear
  }

  dispose() {
    this._disposeTargets()
    this._thresholdMat.dispose()
    this._blurMatH.dispose()
    this._blurMatV.dispose()
    this._compositeMat.dispose()
  }
}
