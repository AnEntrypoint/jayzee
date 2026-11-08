import * as THREE from 'three'
import { installPlayerLodRenderer } from '../../src/client/playerLodRenderer.js'

const WIDTH = 320
const HEIGHT = 240
const result = { ok: false, errors: [] }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 300))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const canvas = document.getElementById('c')
const webgl = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
webgl.setSize(WIDTH, HEIGHT, false)
webgl.setClearColor(0x000000, 1)

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(60, WIDTH / HEIGHT, 0.1, 1000)
camera.position.set(12.5, 30, 60)
camera.lookAt(12.5, 0, 12.5)
const lod = installPlayerLodRenderer(scene, {})
lod.tick([], { x: 0, y: 2, z: 0 }, [[0, 0, 4], [1, 0, 1], [-1, -1, 9]], null)
webgl.render(scene, camera)

const gl = webgl.getContext()
const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
let dotPixels = 0
for (let i = 0; i < pixels.length; i += 4) {
  const r = pixels[i], g = pixels[i + 1], b = pixels[i + 2]
  if (r > 120 && g > 100 && b < 150 && r > b + 60) dotPixels++
}
result.dotPixels = dotPixels
result.drawCalls = webgl.info.render.calls
result.side = lod.dots.instancedMesh.material.side === THREE.FrontSide ? 'FrontSide' : 'other'
result.instances = lod.dots.count

const spoint = await (await fetch('../fixtures/spoint/player-lod-renderer.json')).json()
const scenario = spoint.scenarios.find((s) => s.label === 'server bucket dots with no ground use the viewer height')
const replay = installPlayerLodRenderer(new THREE.Scene(), {})
let mismatches = 0
for (const step of scenario.steps) {
  replay.tick(structuredClone(step.entries), step.viewer, step.serverDots, null)
  const arr = replay.dots.instancedMesh.instanceMatrix.array
  if (replay.dots.count !== step.expect.count) mismatches++
  step.expect.instances.forEach((want, i) => {
    for (let k = 0; k < 3; k++) if (arr[i * 16 + 12 + k] !== Math.fround(want.position[k])) mismatches++
  })
}
result.replayed = scenario.label
result.mismatches = mismatches
result.ok = result.errors.length === 0 && dotPixels > 0 && mismatches === 0 && result.instances === 3 && result.side === 'FrontSide'
window.playerLodResult = result
