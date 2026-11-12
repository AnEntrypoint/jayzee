import { loadRenderer } from '../../src/engine/renderer.js'
import { relativeLookAt } from '../../src/engine/cameraRelative.js'

const WIDTH = 960
const HEIGHT = 540
const SETTLE_FRAMES = 4
const COLUMNS = 20
const ROWS = 20
const BODIES = COLUMNS * ROWS
const SPACING_X = 2
const SPACING_Z = 4
const FIRST_Z = -10
const BODY_Y = 2
const FOV_Y = (50 * Math.PI) / 180
const EYE = [0, 30, 20]
const TARGET = [0, 0, -45]
const UP = [0, 1, 0]
const TICK_RATE = 60
const SPHERE_RADIUS = 0.5
const SOLVER_ITERATIONS = 8
const NO_CLASS = 255
const PROP_CLASSES = 4
const QUERY = new URLSearchParams(location.search)
const BACKEND = QUERY.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu'
const GLUE = new URL('../../engine/out/engine-core-64mib.mjs', import.meta.url).href

const state = { ready: false, error: null, backend: null }
window.propCutoff = state

const perspective = (fovY, aspect, near, far) => {
  const f = 1 / Math.tan(fovY / 2)
  const out = new Float32Array(16)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) / (near - far)
  out[11] = -1
  out[14] = (2 * far * near) / (near - far)
  return out
}

const multiply = (a, b) => {
  const out = new Float32Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

const positionOf = (i) => [((i % COLUMNS) - (COLUMNS - 1) / 2) * SPACING_X, BODY_Y, FIRST_Z - Math.floor(i / COLUMNS) * SPACING_Z]

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const beforeSeal = (module) => {
    const status = module._engine_world_configure(BODIES, TICK_RATE, 0, 0, SPHERE_RADIUS, 0, SOLVER_ITERATIONS)
    if (status !== 0) throw new Error('world configure status ' + status)
  }
  const renderer = await loadRenderer({ glue: GLUE, canvas, requested: BACKEND, players: 64, workers: 1, budgetBytes: 67108864, beforeSeal, models: false })
  const module = renderer.module
  state.backend = renderer.backendName
  for (let i = 0; i < BODIES; i++) {
    const at = positionOf(i)
    if (module._engine_spawn(at[0], at[1], at[2], 0, 0, 0) < 0) throw new Error('spawn refused body ' + i)
  }
  module._engine_tick(1)
  const classes = new Uint8Array(renderer.bodySlots).fill(NO_CLASS)
  for (let i = 0; i < BODIES; i++) classes[i] = i % PROP_CLASSES
  renderer.setBodyClasses(classes)
  renderer.setLight(0, { position: [0, 60, -45], radius: 400, colour: [1, 1, 1], intensity: 3 })
  renderer.setLightCount(1)
  const viewProj = multiply(perspective(FOV_Y, WIDTH / HEIGHT, 0.1, 400), relativeLookAt(EYE, TARGET, UP, new Float64Array(16)))
  renderer.setCamera({ viewProj, eye: EYE })
  for (let f = 0; f < SETTLE_FRAMES; f++) renderer.frame()
  renderer.markWarmup()

  window.propCutoffStep = (budget) => {
    renderer.setPropBudget(budget)
    renderer.setCamera({ viewProj, eye: EYE })
    let status = 0
    for (let f = 0; f < SETTLE_FRAMES; f++) status = renderer.frame()
    const cutoffSquared = module._engine_render_prop_cutoff_squared()
    const bodies = []
    for (let i = 0; i < BODIES; i++) {
      const at = positionOf(i)
      const rel = [Math.fround(at[0] - EYE[0]), Math.fround(at[1] - EYE[1]), Math.fround(at[2] - EYE[2])]
      const w = viewProj[3] * rel[0] + viewProj[7] * rel[1] + viewProj[11] * rel[2] + viewProj[15]
      const x = (viewProj[0] * rel[0] + viewProj[4] * rel[1] + viewProj[8] * rel[2] + viewProj[12]) / w
      const y = (viewProj[1] * rel[0] + viewProj[5] * rel[1] + viewProj[9] * rel[2] + viewProj[13]) / w
      const squared = Math.fround(Math.fround(Math.fround(rel[0] * rel[0]) + Math.fround(rel[1] * rel[1])) + Math.fround(rel[2] * rel[2]))
      bodies.push({ px: Math.round((x * 0.5 + 0.5) * WIDTH), py: Math.round((0.5 - y * 0.5) * HEIGHT), squared, inside: cutoffSquared === 0 || squared < cutoffSquared })
    }
    const stats = renderer.stats()
    return JSON.stringify({
      status,
      budget,
      cutoffSquared,
      prop: renderer.propBudget(),
      visible: stats.visible,
      createsAfterSeal: stats.createsAfterSeal,
      allocationsSinceWarmup: String(stats.allocationsSinceWarmup),
      bodies,
    })
  }
}

run().catch((error) => {
  state.error = error && error.message ? error.message : String(error)
}).finally(() => {
  state.ready = true
})
