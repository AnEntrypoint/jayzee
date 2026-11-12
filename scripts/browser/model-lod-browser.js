import { loadRenderer } from '../../src/engine/renderer.js'
import { relativeLookAt } from '../../src/engine/cameraRelative.js'

const WIDTH = 960
const HEIGHT = 540
const SETTLE_FRAMES = 3
const MAX_UPLOAD_FRAMES = 64
const MODELS = 8
const VERTEX_STRIDE_WORDS = 8
const CLUSTER_INDICES = 384
const GRIDS = [[8, 8], [16, 8], [16, 16]]
const LOD_INDICES = GRIDS.map(([nx, ny]) => nx * ny * 6)
const MODEL_INDICES = LOD_INDICES.reduce((a, b) => a + b, 0)
const MODEL_VERTICES = GRIDS.reduce((a, [nx, ny]) => a + (nx + 1) * (ny + 1), 0)
const FULL_PIXELS = 128
const FOV_Y = (50 * Math.PI) / 180
const ROW_X = 6
const ROW_Z = -20
const UP = [0, 1, 0]
const NEAR_M = 20
const MIDDLE_M = 80
const FAR_M = 160
const LOOSE_BUDGET = 7000
const TIGHT_BUDGET = 3000
const CULL_READY_TRIES = 400
const CULL_READY_GAP_MS = 5
const QUERY = new URLSearchParams(location.search)
const BACKEND = QUERY.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu'

const result = { done: false, error: null, backend: null, modelTier: null, steps: [], ok: false }
window.modelLodResult = result

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

const writeModel = (module, handle) => {
  const vertexWords = module._engine_models_vertex_ptr(handle) >> 2
  const indexWords = module._engine_models_index_ptr(handle) >> 2
  let vertex = 0
  let index = 0
  for (const [nx, ny] of GRIDS) {
    const first = vertex
    for (let j = 0; j <= ny; j++) {
      for (let i = 0; i <= nx; i++) {
        const base = vertexWords + vertex * VERTEX_STRIDE_WORDS
        module.HEAPF32[base] = -1 + (2 * i) / nx
        module.HEAPF32[base + 1] = -1 + (2 * j) / ny
        module.HEAPF32[base + 2] = 0
        for (let w = 3; w < VERTEX_STRIDE_WORDS; w++) module.HEAPU32[base + w] = 0
        vertex += 1
      }
    }
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const a = first + j * (nx + 1) + i
        const b = a + 1
        const c = a + (nx + 1)
        const d = c + 1
        module.HEAPU32.set([a, b, d, a, d, c], indexWords + index)
        index += 6
      }
    }
  }
  module._engine_models_mark_dirty(handle)
}

const viewProjection = (eye) => multiply(perspective(FOV_Y, WIDTH / HEIGHT, 0.1, 400), relativeLookAt(eye, [ROW_X, 0, ROW_Z], UP, new Float64Array(16)))

const readCull = async (module) => {
  let ready = false
  for (let i = 0; i < CULL_READY_TRIES && !ready; i++) {
    ready = module._engine_render_cull_ready() === 1
    if (!ready) await new Promise((done) => setTimeout(done, CULL_READY_GAP_MS))
  }
  if (!ready) throw new Error('the cluster counts of the frame were not read back, so the draw cannot be counted on this browser')
  const at = module._engine_render_cull_counts() >> 2
  return module.HEAPU32[at] + module.HEAPU32[at + 2]
}

const step = async (renderer, handles, name, distance, budget, expect) => {
  const module = renderer.module
  const eye = [ROW_X, 0, ROW_Z + distance]
  renderer.setModelIndexBudget(budget)
  renderer.setCamera({ viewProj: viewProjection(eye), eye })
  let status = 0
  for (let f = 0; f < SETTLE_FRAMES; f++) status = renderer.frame()
  module._engine_render_cull_ready()
  status = renderer.frame()
  const drawnClusters = await readCull(module)
  const lod = renderer.modelLod()
  const levels = handles.map((handle) => renderer.modelLodLevel(handle))
  const row = { name, status, distance, budget, drawnClusters, cost: lod.cost, demand: lod.demand, bias: lod.bias, shed: lod.shed, levels, expect }
  row.ok = status === 0 && drawnClusters === expect.clusters && lod.cost === expect.cost && (expect.cost === 0 || drawnClusters * CLUSTER_INDICES === lod.cost) && (budget === 0 || lod.cost <= budget)
  result.steps.push(row)
  return row.ok
}

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const renderer = await loadRenderer({ canvas, requested: BACKEND, players: 1, workers: 1, budgetBytes: 536870912 })
  const module = renderer.module
  result.backend = renderer.backendName
  result.modelTier = renderer.modelTier
  renderer.setModelPath(BACKEND === 'webgpu' ? 'visibility' : 'forward')
  renderer.setOcclusion(false)
  renderer.setModelLodPixels(FULL_PIXELS)
  if (renderer.backendName === 'webgpu') module._engine_render_set_count_readback(1)
  const handles = []
  for (let slot = 0; slot < MODELS; slot++) {
    const handle = module._engine_models_acquire(MODEL_VERTICES, MODEL_INDICES)
    if (!(handle > 0)) throw new Error('engine_models_acquire refused slot ' + slot + ' with ' + handle)
    writeModel(module, handle)
    handles.push(handle)
  }
  let uploadFrames = 0
  renderer.setCamera({ viewProj: viewProjection([ROW_X, 0, ROW_Z + NEAR_M]), eye: [ROW_X, 0, ROW_Z + NEAR_M] })
  while (module._engine_models_dirty() > 0) {
    if (renderer.frame() !== 0 || uploadFrames >= MAX_UPLOAD_FRAMES) throw new Error('the model pool did not finish uploading in ' + uploadFrames + ' frames')
    uploadFrames += 1
  }
  renderer.markWarmup()
  const whole = MODELS * MODEL_INDICES / CLUSTER_INDICES
  const fine = MODELS * LOD_INDICES[2]
  const middle = MODELS * LOD_INDICES[1]
  const coarse = MODELS * LOD_INDICES[0]
  let ok = await step(renderer, handles, 'no lod ranges, near', NEAR_M, 0, { clusters: whole, cost: 0 })
  for (const handle of handles) renderer.setModelLods(handle, LOD_INDICES)
  ok = (await step(renderer, handles, 'three ranges, near', NEAR_M, 0, { clusters: fine / CLUSTER_INDICES, cost: fine })) && ok
  ok = (await step(renderer, handles, 'three ranges, middle distance', MIDDLE_M, 0, { clusters: middle / CLUSTER_INDICES, cost: middle })) && ok
  ok = (await step(renderer, handles, 'three ranges, far', FAR_M, 0, { clusters: coarse / CLUSTER_INDICES, cost: coarse })) && ok
  ok = (await step(renderer, handles, 'near again', NEAR_M, 0, { clusters: fine / CLUSTER_INDICES, cost: fine })) && ok
  ok = (await step(renderer, handles, 'near under ' + LOOSE_BUDGET + ' indices', NEAR_M, LOOSE_BUDGET, { clusters: middle / CLUSTER_INDICES, cost: middle })) && ok
  ok = (await step(renderer, handles, 'near under ' + TIGHT_BUDGET + ' indices', NEAR_M, TIGHT_BUDGET, { clusters: 7, cost: 7 * CLUSTER_INDICES })) && ok
  ok = (await step(renderer, handles, 'budget cleared', NEAR_M, 0, { clusters: fine / CLUSTER_INDICES, cost: fine })) && ok
  const stats = renderer.stats()
  result.effectivePath = renderer.effectiveModelPath
  result.createsAfterSeal = stats.createsAfterSeal
  result.allocationsSinceWarmup = String(stats.allocationsSinceWarmup)
  result.ok = ok && stats.createsAfterSeal === 0 && Number(stats.allocationsSinceWarmup) === 0
}

run().catch((error) => {
  result.error = error && error.message ? error.message : String(error)
}).finally(() => {
  result.done = true
  const el = document.getElementById('result')
  if (el) el.textContent = JSON.stringify(result, null, 1)
})
