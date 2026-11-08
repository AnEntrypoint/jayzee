import * as THREE from 'three'
import { SSR, setWeatherWetness } from '../../src/client/ssr.js'

const W = 200
const H = 200
const weather = Number(new URLSearchParams(window.location.search).get('wet') ?? 1)
const result = { weather, ok: false, errors: [], changedFloor: 0, skyMaxDelta: 0, maxDelta: 0, ssrSize: null, reflectionBuilt: false }
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
const floor = new THREE.Mesh(new THREE.PlaneGeometry(40, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 0.4, 0.4) }))
floor.userData.wetness = Number(new URLSearchParams(window.location.search).get('wet') ?? 1)
scene.add(floor)
const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.9, 0.3, 0.2) }))
box.position.set(0, 0.5, 0)
scene.add(box)
const camera = new THREE.PerspectiveCamera(50, W / H, 0.1, 50)
camera.position.set(0, 1.5, 5)
camera.lookAt(0, 0.4, 0)
camera.updateMatrixWorld()

const gbufferMaterial = new THREE.ShaderMaterial({
  vertexShader: 'varying vec3 vN; varying vec3 vV; void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); vV = mv.xyz; vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'varying vec3 vN; varying vec3 vV; void main() { gl_FragColor = vec4(normalize(vN) * 0.5 + 0.5, -vV.z); }',
})
const gbuffer = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, format: THREE.RGBAFormat, depthBuffer: true })

const controls = { get: (key) => ({ ssr: true, ssao: true, ssrIntensity: 1, ssrMaxDistance: 30, ssrBandHeight: 1.5 })[key] }
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
  renderer.setRenderTarget(gbuffer)
  renderer.setClearColor(0x000000, 0)
  renderer.clear()
  scene.overrideMaterial = gbufferMaterial
  renderer.render(scene, camera)
  scene.overrideMaterial = null
  renderer.setRenderTarget(null)
  renderer.setClearColor(0x000000, 1)
  renderer.render(scene, camera)
  const ssr = new SSR(renderer, scene, camera, controls)
  ssr.setSharedGBuffer(gbuffer.texture)
  setWeatherWetness(weather)
  ssr.compute()
  ssr.composite()
  const out = read()
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.abs(sumAt(out, x, y) - sumAt(plain, x, y))
    if (d > result.maxDelta) result.maxDelta = d
    if (y >= 100 && d > 3) result.changedFloor++
    if (y < 40 && d > result.skyMaxDelta) result.skyMaxDelta = d
  }
  result.reflectionBuilt = !!ssr.reflectionTexture
  result.ssrSize = [ssr._w, ssr._h]
  ssr.dispose()
  gbuffer.dispose()
  result.ok = result.errors.length === 0 && result.reflectionBuilt && result.changedFloor >= 20 && result.skyMaxDelta <= 2 && result.ssrSize[0] === 100 && result.ssrSize[1] === 100
} catch (error) {
  result.errors.push('thrown ' + (error && error.message ? error.message : String(error)))
}
window.playerSsrResult = result
