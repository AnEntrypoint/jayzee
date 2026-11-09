import * as THREE from 'three'
import { createVATCrowdRenderer } from '../../src/client/playerVatRenderer.js'

const WIDTH = 200
const HEIGHT = 200
const FRAMES = 3
const PHASES = [0, 0.25, 0.5, 0.75]
const WARM_FRAMES = 60
const LOOP_FRAMES = 600
const LOOP_DOTS = 4
const result = { ok: false, errors: [], cases: [] }
const realError = console.error
console.error = (...args) => {
  result.errors.push(args.map(String).join(' ').slice(0, 400))
  realError(...args)
}
window.addEventListener('error', (e) => result.errors.push('uncaught ' + e.message))

const canvas = document.getElementById('c')
const webgl = new THREE.WebGLRenderer({ canvas, antialias: false, preserveDrawingBuffer: true })
webgl.setSize(WIDTH, HEIGHT, false)
webgl.setClearColor(0x000000, 1)
const gl = webgl.getContext()

const loop = { warmed: false, done: false, warmFrames: 0, frames: 0, error: null }
window.playerVatLoop = loop

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

const runCase = (phase) => {
  const scene = new THREE.Scene()
  scene.add(new THREE.AmbientLight(0xffffff, 1))
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
  camera.position.set(0, 0, 5)
  camera.lookAt(0, 0, 0)
  const dots = createVATCrowdRenderer(scene, new THREE.PlaneGeometry(1, 1, 1, 1), makeVat(), { capacity: 4, renderer: webgl })
  dots.update('p', { x: 0, y: 0, z: 0 }, 0, 0, phase / 0.15)
  const slotPhase = dots.debugSlots()[0].phase
  webgl.render(scene, camera)
  const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
  let minCol = Infinity
  let maxCol = -Infinity
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const i = (y * WIDTH + x) * 4
      if (pixels[i] + pixels[i + 1] + pixels[i + 2] > 60) {
        minCol = Math.min(minCol, x)
        maxCol = Math.max(maxCol, x)
      }
    }
  }
  const shift = expectedShift(phase)
  const wantMin = 50 + 100 * shift
  const wantMax = Math.min(WIDTH - 1, 150 + 100 * shift - 1)
  dots.dispose()
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

result.cases = PHASES.map(runCase)
result.draws = webgl.info.render.calls
result.ok = result.errors.length === 0 && result.cases.every((c) => c.pass)
window.playerVatResult = result

const loopScene = new THREE.Scene()
loopScene.add(new THREE.AmbientLight(0xffffff, 1))
const loopCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100)
loopCamera.position.set(0, 0, 5)
loopCamera.lookAt(0, 0, 0)
const loopDots = createVATCrowdRenderer(loopScene, new THREE.PlaneGeometry(1, 1, 1, 1), makeVat(), { capacity: LOOP_DOTS, renderer: webgl })

const drawLoopFrame = (n) => {
  for (let s = 0; s < LOOP_DOTS; s++) {
    loopDots.update('p' + s, { x: s * 0.2 - 0.3, y: 0, z: 0 }, 0, 0, ((n + s * 7) % 60) / 60 / 0.15)
  }
  webgl.render(loopScene, loopCamera)
}

const stepLoop = () => {
  try {
    drawLoopFrame(loop.warmFrames + loop.frames)
    if (!loop.warmed) {
      loop.warmFrames += 1
      loop.warmed = loop.warmFrames >= WARM_FRAMES
    } else {
      loop.frames += 1
      if (loop.frames >= LOOP_FRAMES) {
        loopDots.dispose()
        loop.done = true
        return
      }
    }
  } catch (error) {
    loop.error = String(error)
    loop.done = true
    return
  }
  setTimeout(stepLoop, 0)
}
setTimeout(stepLoop, 0)
