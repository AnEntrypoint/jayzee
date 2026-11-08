import * as THREE from 'three'
import { Bloom } from '../../src/client/bloom.js'

const W = 200
const H = 200
const result = { ok: false, errors: [], haloGain: 0, cornerDelta: 0, centreDelta: 0, draws: 0, bloomSize: null }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 300))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const canvas = document.getElementById('c')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
renderer.setSize(W, H, false)
renderer.setClearColor(0x000000, 1)
const gl = renderer.getContext()

const scene = new THREE.Scene()
const patch = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.4), new THREE.MeshBasicMaterial({ color: new THREE.Color(1, 0.9, 0.5) }))
scene.add(patch)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
camera.position.z = 5

const controls = { get: (key) => ({ bloom: true, bloomThreshold: 0.5, bloomIntensity: 1.2, bloomResolutionScale: 0.5, bloomBlurPasses: 1 })[key] }
const read = () => {
  const pixels = new Uint8Array(W * H * 4)
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  return pixels
}
const sumAt = (pixels, x, y) => {
  const i = ((H - 1 - y) * W + x) * 4
  return pixels[i] + pixels[i + 1] + pixels[i + 2]
}

try {
  renderer.render(scene, camera)
  const plain = read()
  const bloom = new Bloom(renderer, controls)
  renderer.render(scene, camera)
  bloom.compute()
  bloom.composite()
  const lit = read()
  let haloGain = 0
  for (let x = 121; x <= 135; x++) haloGain += sumAt(lit, x, 100) - sumAt(plain, x, 100)
  result.haloGain = haloGain
  result.cornerDelta = Math.abs(sumAt(lit, 5, 5) - sumAt(plain, 5, 5))
  result.centreDelta = sumAt(lit, 100, 100) - sumAt(plain, 100, 100)
  result.draws = renderer.info.render.calls
  result.bloomSize = [bloom._w, bloom._h]
  bloom.dispose()
  result.ok = result.errors.length === 0 && haloGain > 0 && result.cornerDelta <= 3 && result.bloomSize[0] === 100 && result.bloomSize[1] === 100
} catch (error) {
  result.errors.push('thrown ' + (error && error.message ? error.message : String(error)))
}
window.playerBloomResult = result
