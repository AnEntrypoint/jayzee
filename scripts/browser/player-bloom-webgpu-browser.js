import * as THREE from 'three'
import { WebGPURenderer, MeshBasicNodeMaterial, QuadMesh } from 'three/webgpu'
import { texture, uv } from 'three/tsl'
import { installBloom } from '../../src/client/bloom.js'

const W = 200
const H = 200
const CONTROLS = { bloomThreshold: 0.5, bloomIntensity: 1, bloomBlurPasses: 2, bloomResolutionScale: 0.5 }
const CORNER_DELTA_MAX = 2
const PATCH = { lo: 75, hi: 125 }
const RING = { near: 4, far: 12 }
const CORNER_LO = 185
const result = { ok: false, backend: null, haloGain: null, controlHaloGain: null, cornerDelta: null, patchMean: null, bloomSize: null, errors: [], thrown: null }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 400))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const controls = { get: (key) => CONTROLS[key] }
const rowPixels = (width) => Math.ceil((width * 4) / 256) * 64
const sumAt = (pixels, x, y) => {
  const i = (y * rowPixels(W) + x) * 4
  return [pixels[i], pixels[i + 1], pixels[i + 2]]
}

const canvas = document.getElementById('c')
const renderer = new WebGPURenderer({ canvas, antialias: false })
renderer.setClearColor(0x000000, 1)
await renderer.init()
result.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'other'

const scene = new THREE.Scene()
const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new MeshBasicNodeMaterial({ color: 0xffffff }))
patch.scale.set(0.5, 0.5, 1)
scene.add(patch)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
camera.position.set(0, 0, 5)
camera.lookAt(0, 0, 0)

const captureTex = new THREE.FramebufferTexture(W, H)
const readTarget = new THREE.RenderTarget(W, H)
const readQuad = new QuadMesh(new MeshBasicNodeMaterial({ colorNode: texture(captureTex, uv()) }))

const renderFrame = async (bloom) => {
  renderer.setRenderTarget(null)
  await renderer.renderAsync(scene, camera)
  if (bloom) {
    bloom.compute()
    bloom.composite()
  }
  renderer.copyFramebufferToTexture(captureTex)
  renderer.setRenderTarget(readTarget)
  readQuad.render(renderer)
  renderer.setRenderTarget(null)
  return renderer.readRenderTargetPixelsAsync(readTarget, 0, 0, W, H)
}

const insideBox = (x, y, lo, hi) => x >= lo && x < hi && y >= lo && y < hi

const ringMean = (pixels) => {
  let total = 0
  let count = 0
  for (let y = PATCH.lo - RING.far; y < PATCH.hi + RING.far; y++) {
    for (let x = PATCH.lo - RING.far; x < PATCH.hi + RING.far; x++) {
      if (insideBox(x, y, PATCH.lo - RING.near, PATCH.hi + RING.near)) continue
      const [r, g, b] = sumAt(pixels, x, y)
      total += r + g + b
      count++
    }
  }
  return total / count
}

const cornerMaxDelta = (a, b) => {
  let worst = 0
  for (let y = CORNER_LO; y < H; y++) {
    for (let x = CORNER_LO; x < W; x++) {
      const pa = sumAt(a, x, y)
      const pb = sumAt(b, x, y)
      for (let c = 0; c < 3; c++) worst = Math.max(worst, Math.abs(pa[c] - pb[c]))
    }
  }
  return worst
}

const patchMean = (pixels) => {
  let total = 0
  let count = 0
  for (let y = PATCH.lo + 10; y < PATCH.hi - 10; y++) {
    for (let x = PATCH.lo + 10; x < PATCH.hi - 10; x++) {
      const [r, g, b] = sumAt(pixels, x, y)
      total += r + g + b
      count++
    }
  }
  return total / count
}

try {
  const bloom = installBloom({}, renderer, controls)
  const bloomPixels = await renderFrame(bloom)
  const controlPixels = await renderFrame(null)
  result.haloGain = ringMean(bloomPixels)
  result.controlHaloGain = ringMean(controlPixels)
  result.cornerDelta = cornerMaxDelta(bloomPixels, controlPixels)
  result.patchMean = patchMean(bloomPixels)
  result.bloomSize = [bloom.bloomTexture.image.width, bloom.bloomTexture.image.height]
} catch (error) {
  result.thrown = String(error && error.message ? error.message : error)
}

result.ok = result.backend === 'webgpu'
  && result.thrown === null
  && result.errors.length === 0
  && result.haloGain > 0
  && result.controlHaloGain === 0
  && result.cornerDelta <= CORNER_DELTA_MAX
  && result.bloomSize !== null && result.bloomSize[0] === 100 && result.bloomSize[1] === 100
window.playerWebgpuResult = result
