import * as THREE from 'three'
import { FSR1 } from '../../src/client/fsr1.js'

const W = 200
const H = 200
const result = { ok: false, errors: [], edgeChanged: 0, interiorLeftDelta: 0, interiorRightDelta: 0, fsrSize: null }
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
const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.4, 0.4) }))
plane.position.set(-0.5, 0, 0)
scene.add(plane)
const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10)
camera.position.z = 5

const controls = { get: (key) => ({ fsr1Sharpness: 0.5 })[key] }
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
  const fsr = new FSR1(renderer, controls)
  renderer.render(scene, camera)
  fsr.compute()
  fsr.composite()
  const out = read()
  let edgeChanged = 0
  for (let x = 90; x <= 110; x++) if (Math.abs(sumAt(out, x, 100) - sumAt(plain, x, 100)) > 2) edgeChanged++
  result.edgeChanged = edgeChanged
  result.interiorLeftDelta = Math.abs(sumAt(out, 30, 100) - sumAt(plain, 30, 100))
  result.interiorRightDelta = Math.abs(sumAt(out, 170, 100) - sumAt(plain, 170, 100))
  result.fsrSize = [fsr._w, fsr._h]
  fsr.dispose()
  result.ok = result.errors.length === 0 && edgeChanged >= 1 && result.interiorLeftDelta <= 2 && result.interiorRightDelta <= 2 && result.fsrSize[0] === W && result.fsrSize[1] === H
} catch (error) {
  result.errors.push('thrown ' + (error && error.message ? error.message : String(error)))
}
window.playerFsr1Result = result
