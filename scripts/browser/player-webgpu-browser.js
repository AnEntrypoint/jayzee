import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createVATCrowdRenderer } from '../../src/client/playerVatRenderer.js'
import { installPlayerLodRenderer } from '../../src/client/playerLodRenderer.js'

const VAT_W = 200
const VAT_H = 200
const LOD_W = 320
const LOD_H = 240
const FRAMES = 3
const PHASES = [0, 0.25, 0.5, 0.75]
const result = { ok: false, backend: null, errors: [], vat: [], dots: null, draws: 0, thrown: null }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 400))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const makeVat = () => {
  const data = new Float32Array(4 * FRAMES * 4)
  for (let f = 0; f < FRAMES; f++) {
    for (let v = 0; v < 4; v++) {
      const o = (f * 4 + v) * 4
      data[o] = f * 0.5
      data[o + 3] = 1
    }
  }
  const texture = new THREE.DataTexture(data, 4, FRAMES, THREE.RGBAFormat, THREE.FloatType)
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.needsUpdate = true
  return { texture, width: 4, rowsPerFrame: 1, frameCount: FRAMES, duration: 1 }
}

const expectedShift = (p) => {
  const frame = p * (FRAMES - 1)
  const f0 = Math.floor(frame)
  const f1 = Math.min(f0 + 1, FRAMES - 1)
  const a = frame - f0
  return (f0 * 0.5) * (1 - a) + (f1 * 0.5) * a
}

const rowPixels = (width) => Math.ceil((width * 4) / 256) * 64

const litColumns = (pixels, width, height) => {
  let minCol = Infinity
  let maxCol = -Infinity
  const stride = rowPixels(width)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * stride + x) * 4
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) {
        minCol = Math.min(minCol, x)
        maxCol = Math.max(maxCol, x)
      }
    }
  }
  return { minCol, maxCol }
}

const canvas = document.getElementById('c')
const renderer = new WebGPURenderer({ canvas, antialias: false })
renderer.setClearColor(0x000000, 1)
await renderer.init()
const backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'other'

const renderPass = (scene, camera) => (renderer.renderAsync ? renderer.renderAsync(scene, camera) : Promise.resolve(renderer.render(scene, camera)))

const runVatCase = async (phase) => {
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  const target = new THREE.RenderTarget(VAT_W, VAT_H)
  const dots = createVATCrowdRenderer(scene, new THREE.PlaneGeometry(1, 1, 1, 1), makeVat(), { capacity: 4, renderer })
  dots.update('p', { x: 0, y: 0, z: 0 }, 0, 0, phase / 0.15)
  const slotPhase = dots.debugSlots()[0].phase
  renderer.setRenderTarget(target)
  await renderPass(scene, camera)
  renderer.setRenderTarget(null)
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, VAT_W, VAT_H)
  const { minCol, maxCol } = litColumns(pixels, VAT_W, VAT_H)
  const centreAt = ((VAT_H / 2) * rowPixels(VAT_W) + VAT_W / 2) * 4
  const centre = Array.from(pixels.slice(centreAt, centreAt + 4))
  const shift = expectedShift(phase)
  const wantMin = 50 + 100 * shift
  const wantMax = Math.min(VAT_W - 1, 150 + 100 * shift - 1)
  dots.dispose()
  target.dispose()
  return {
    phase,
    slotPhase,
    minCol,
    maxCol,
    wantMin,
    wantMax,
    pass: Math.abs(minCol - wantMin) <= 2 && Math.abs(maxCol - wantMax) <= 2 && Math.abs(slotPhase - phase) < 1e-9,
  }
}

const runDots = async () => {
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, LOD_W / LOD_H, 0.1, 1000)
  camera.position.set(12.5, 30, 60)
  camera.lookAt(12.5, 0, 12.5)
  const target = new THREE.RenderTarget(LOD_W, LOD_H)
  const lod = installPlayerLodRenderer(scene, { renderer })
  lod.tick([], { x: 0, y: 2, z: 0 }, [[0, 0, 4], [1, 0, 1], [-1, -1, 9]], null)
  renderer.setRenderTarget(target)
  await renderPass(scene, camera)
  renderer.setRenderTarget(null)
  const pixels = await renderer.readRenderTargetPixelsAsync(target, 0, 0, LOD_W, LOD_H)
  let dotPixels = 0
  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
    if (r > 120 && g > 100 && b < 150 && r > b + 60) dotPixels++
  }
  const instances = lod.dots.count
  lod.dispose()
  target.dispose()
  return { dotPixels, instances, ok: dotPixels > 0 && instances === 3 }
}

try {
  for (const phase of PHASES) result.vat.push(await runVatCase(phase))
  result.dots = await runDots()
  result.draws = renderer.info.render.calls
} catch (error) {
  result.thrown = String(error && error.message ? error.message : error)
}
result.backend = backend
result.ok = backend === 'webgpu' && result.thrown === null && result.errors.length === 0 && result.vat.length === PHASES.length && result.vat.every((c) => c.pass) && result.dots !== null && result.dots.ok
window.playerWebgpuResult = result
