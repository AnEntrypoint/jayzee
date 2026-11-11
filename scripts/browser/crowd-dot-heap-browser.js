import * as THREE from 'three'
import { WebGPURenderer } from 'three/webgpu'
import { createCrowdDotRendererWebGPU } from '../../src/client/playerLodRendererWebGPU.js'

const DOTS = 64
const WARMUP_UPDATES = 20000
const MEASURED_UPDATES = 2000
const CONTROL_OBJECTS = 600
const loop = { ready: false, backend: null, error: null, measuredUpdates: 0, controlObjects: 0, instances: 0 }
window.crowdDotLoop = loop

const run = async () => {
  const canvas = document.getElementById('c')
  const renderer = new WebGPURenderer({ canvas, antialias: false })
  await renderer.init()
  loop.backend = renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2'
  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(60, canvas.width / canvas.height, 0.1, 1000)
  camera.position.set(12.5, 30, 60)
  camera.lookAt(12.5, 0, 12.5)
  const dots = createCrowdDotRendererWebGPU(scene, {})
  const input = Array.from({ length: DOTS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])
  for (let i = 0; i < WARMUP_UPDATES; i++) dots.update(input, 0, null)
  for (let i = 0; i < 3; i++) await renderer.renderAsync(scene, camera)
  loop.instances = dots.count
  window.crowdDotMeasure = function crowdDotMeasure() {
    for (let i = 0; i < MEASURED_UPDATES; i++) dots.update(input, 0, null)
    loop.measuredUpdates += MEASURED_UPDATES
    const hold = []
    for (let i = 0; i < CONTROL_OBJECTS; i++) hold.push({ index: i })
    window.crowdDotControl = hold
    loop.controlObjects = hold.length
    return loop.measuredUpdates
  }
  loop.ready = true
}

run().catch((error) => {
  loop.error = String(error && error.stack ? error.stack : error)
})
