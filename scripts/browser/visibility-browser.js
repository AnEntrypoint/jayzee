import { loadRenderer } from '../../src/engine/renderer.js'

const WIDTH = 960
const HEIGHT = 540
const FRAMES = 3
const MAX_UPLOAD_FRAMES = 64
const GRID = 12
const MODEL_VERTICES = (GRID + 1) * (GRID + 1)
const MODEL_INDICES = GRID * GRID * 6
const MODELS = 8
const VERTEX_STRIDE_WORDS = 8
const FOV_Y = (50 * Math.PI) / 180
const EYE = [6, 0, 6]
const TARGET = [6, 0, -20]
const UP = [0, 1, 0]
const CLEAR_GREEN = 18
const TOLERANCE = 4
const MAX_DIFFERING_FRACTION = 0.005
const CONFIGS = [
  { name: 'forward', path: 'forward', occlusion: false },
  { name: 'visibility', path: 'visibility', occlusion: false },
  { name: 'occlusion', path: 'visibility', occlusion: true },
]
const WEBGL2_CONFIGS = [
  { name: 'forward', path: 'forward', occlusion: false },
  { name: 'visibility-requested', path: 'visibility', occlusion: true },
]
const QUERY = new URLSearchParams(location.search)
const BACKEND = QUERY.get('backend') === 'webgl2' ? 'webgl2' : 'webgpu'
const DUMP = QUERY.has('dump')
const SCENE = QUERY.get('scene') === 'occluded' ? 'occluded' : 'walls'
const CULL_READY_TRIES = 400
const CULL_READY_GAP_MS = 5
const toBase64 = (bytes) => {
  let text = ''
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(text)
}

const result = { done: false, error: null, backend: null, adapter: null, scene: SCENE, models: [], configs: [], comparisons: {}, totals: null, ok: false }
window.visibilityResult = result
const report = (line) => {
  const el = document.getElementById('result')
  if (el) el.textContent += line + '\n'
}

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalize = (a) => {
  const length = Math.hypot(a[0], a[1], a[2])
  return [a[0] / length, a[1] / length, a[2] / length]
}

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

const lookAt = (eye, target, up) => {
  const f = normalize(sub(target, eye))
  const s = normalize(cross(f, up))
  const u = cross(s, f)
  const out = new Float32Array(16)
  out[0] = s[0]
  out[4] = s[1]
  out[8] = s[2]
  out[12] = -dot(s, eye)
  out[1] = u[0]
  out[5] = u[1]
  out[9] = u[2]
  out[13] = -dot(u, eye)
  out[2] = -f[0]
  out[6] = -f[1]
  out[10] = -f[2]
  out[14] = dot(f, eye)
  out[15] = 1
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

const layoutOf = (slot) => {
  if (SCENE === 'occluded') {
    return slot < 4 ? { sx: 8, sy: 3, depth: 4 } : { sx: 1, sy: 1, depth: -4 }
  }
  return { sx: 1, sy: slot % 2 === 1 ? 1.5 : 1, depth: slot % 2 === 1 ? -2 : 0 }
}

const writeModel = (renderer, handle, slot) => {
  const module = renderer.module
  const vertexWords = module._engine_models_vertex_ptr(handle) >> 2
  const indexWords = module._engine_models_index_ptr(handle) >> 2
  const layout = layoutOf(slot)
  for (let j = 0; j <= GRID; j++) {
    for (let i = 0; i <= GRID; i++) {
      const v = j * (GRID + 1) + i
      const base = vertexWords + v * VERTEX_STRIDE_WORDS
      module.HEAPF32[base] = (-1 + (2 * i) / GRID) * layout.sx
      module.HEAPF32[base + 1] = (-1 + (2 * j) / GRID) * layout.sy
      module.HEAPF32[base + 2] = layout.depth
      for (let w = 3; w < VERTEX_STRIDE_WORDS; w++) module.HEAPU32[base + w] = 0
    }
  }
  for (let j = 0; j < GRID; j++) {
    for (let i = 0; i < GRID; i++) {
      const a = j * (GRID + 1) + i
      const b = a + 1
      const c = a + (GRID + 1)
      const d = c + 1
      const base = indexWords + (j * GRID + i) * 6
      module.HEAPU32[base] = a
      module.HEAPU32[base + 1] = b
      module.HEAPU32[base + 2] = d
      module.HEAPU32[base + 3] = a
      module.HEAPU32[base + 4] = d
      module.HEAPU32[base + 5] = c
    }
  }
  module._engine_models_mark_dirty(handle)
}

const buildScene = (renderer) => {
  for (let slot = 0; slot < MODELS; slot++) {
    const handle = renderer.module._engine_models_acquire(MODEL_VERTICES, MODEL_INDICES)
    if (!(handle > 0)) throw new Error('engine_models_acquire refused slot ' + slot + ' with ' + handle)
    writeModel(renderer, handle, slot)
    const engineSlot = renderer.module._engine_models_slot_of(handle)
    result.models.push({ slot, handle, engineSlot })
  }
}

const CLUSTER_RECORD_BYTES = 24
const CLUSTER_INDEX_COUNT_BYTE = 20
const clusterTotals = (renderer) => {
  const module = renderer.module
  const perSlot = module._engine_models_cluster_stride()
  const base = module._engine_models_clusters_ptr()
  let clusters = 0
  let triangles = 0
  for (const model of result.models) {
    for (let c = 0; c < perSlot; c++) {
      const at = base + (model.engineSlot * perSlot + c) * CLUSTER_RECORD_BYTES + CLUSTER_INDEX_COUNT_BYTE
      const indexCount = module.HEAPU32[at >> 2]
      if (indexCount > 0) {
        clusters += 1
        triangles += indexCount / 3
      }
    }
  }
  return { models: result.models.length, clustersPerSlot: perSlot, clusters, triangles }
}

const viewProjection = () => {
  const view = lookAt(EYE, TARGET, UP)
  const proj = perspective(FOV_Y, WIDTH / HEIGHT, 0.1, 200)
  return multiply(proj, view)
}

const grab = (renderer, canvas) => {
  if (renderer.backendName === 'webgl2') {
    const gl = canvas.getContext('webgl2')
    const pixels = new Uint8Array(WIDTH * HEIGHT * 4)
    gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels)
    return Promise.resolve(pixels)
  }
  return takePixels(copyOut(renderer, canvas))
}

const copyOut = (renderer, canvas) => {
  const device = renderer.device
  const texture = canvas.getContext('webgpu').getCurrentTexture()
  const bytesPerRow = WIDTH * 4
  const buffer = device.createBuffer({ size: bytesPerRow * HEIGHT, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ })
  const encoder = device.createCommandEncoder()
  encoder.copyTextureToBuffer({ texture }, { buffer, bytesPerRow, rowsPerImage: HEIGHT }, { width: WIDTH, height: HEIGHT, depthOrArrayLayers: 1 })
  device.queue.submit([encoder.finish()])
  return buffer
}

const takePixels = async (buffer) => {
  await buffer.mapAsync(GPUMapMode.READ)
  const pixels = new Uint8Array(buffer.getMappedRange().slice(0))
  buffer.unmap()
  buffer.destroy()
  return pixels
}

const hashOf = (pixels) => {
  let hash = 0x811c9dc5
  for (let i = 0; i < pixels.length; i++) hash = Math.imul(hash ^ pixels[i], 16777619) >>> 0
  return '0x' + hash.toString(16).padStart(8, '0')
}

const countBackground = (pixels) => {
  let background = 0
  for (let i = 0; i < pixels.length; i += 4) {
    if (Math.abs(pixels[i + 1] - CLEAR_GREEN) <= 2) background += 1
  }
  return pixels.length / 4 - background
}

const compare = (a, b) => {
  let differing = 0
  let maxDelta = 0
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0
    for (let c = 0; c < 3; c++) delta = Math.max(delta, Math.abs(a[i + c] - b[i + c]))
    if (delta > 0) differing += 1
    maxDelta = Math.max(maxDelta, delta)
  }
  return { pixels: a.length / 4, differing, maxDelta }
}

const readCullCounts = async (renderer) => {
  const module = renderer.module
  for (let i = 0; i < CULL_READY_TRIES; i++) {
    if (module._engine_render_cull_ready() === 1) break
    await new Promise((done) => setTimeout(done, CULL_READY_GAP_MS))
  }
  const at = module._engine_render_cull_counts() >> 2
  return { passA: module.HEAPU32[at], candidates: module.HEAPU32[at + 1], passB: module.HEAPU32[at + 2], frame: module.HEAPU32[at + 3] }
}

const renderConfig = async (renderer, canvas, config) => {
  renderer.setModelPath(config.path)
  renderer.setOcclusion(config.occlusion)
  renderer.setCamera({ viewProj: viewProjection(), eye: EYE })
  let status = 0
  for (let f = 0; f < FRAMES; f++) status = renderer.frame()
  status = renderer.frame()
  const pending = grab(renderer, canvas)
  const cull = config.path === 'visibility' || renderer.backendName === 'webgl2' ? await readCullCounts(renderer) : null
  const stats = renderer.stats()
  const pixels = await pending
  return {
    name: config.name,
    status,
    requestedPath: renderer.modelPath,
    effectivePath: renderer.effectiveModelPath,
    occlusion: renderer.occlusion,
    statsPath: stats.modelPath,
    nonBackground: countBackground(pixels),
    hash: hashOf(pixels),
    cull,
    pixels,
  }
}

const cullRecord = (shot, totals) => {
  if (!shot.cull) return null
  const { passA, candidates, passB } = shot.cull
  const drawn = passA + passB
  return {
    drawnClusters: drawn,
    frustumCulledClusters: totals.clusters - (passA + candidates),
    occlusionCulledClusters: candidates - passB,
    drawnFraction: drawn / totals.clusters,
    passACandidates: candidates,
    passBSurvivors: passB,
  }
}

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const renderer = await loadRenderer({ canvas, requested: BACKEND, players: 1, workers: 1, budgetBytes: 67108864 })
  result.backend = renderer.backendName
  result.adapter = { modelTier: renderer.modelTier, clusterStride: renderer.clusterStride() }
  buildScene(renderer)
  let uploadFrames = 0
  while (renderer.module._engine_models_dirty() > 0) {
    if (renderer.frame() !== 0 || uploadFrames >= MAX_UPLOAD_FRAMES) throw new Error('the model pool did not finish uploading in ' + uploadFrames + ' frames')
    uploadFrames += 1
  }
  result.uploadFrames = uploadFrames
  result.totals = clusterTotals(renderer)
  if (renderer.backendName === 'webgpu') renderer.module._engine_render_set_count_readback(1)
  const rendered = []
  for (const config of BACKEND === 'webgl2' ? WEBGL2_CONFIGS : CONFIGS) {
    const shot = await renderConfig(renderer, canvas, config)
    rendered.push(shot)
    result.configs.push({ name: shot.name, status: shot.status, requestedPath: shot.requestedPath, effectivePath: shot.effectivePath, occlusion: shot.occlusion, statsPath: shot.statsPath, nonBackground: shot.nonBackground, hash: shot.hash, cull: cullRecord(shot, result.totals) })
  }
  if (renderer.backendName === 'webgpu') renderer.module._engine_render_set_count_readback(0)
  if (DUMP) result.dumps = Object.fromEntries(rendered.map((shot) => [shot.name, toBase64(shot.pixels)]))
  if (BACKEND === 'webgl2') {
    const [forward, requested] = rendered
    result.ok =
      result.backend === 'webgl2' &&
      rendered.every((shot) => shot.status === 0 && shot.nonBackground > 0) &&
      forward.effectivePath === 'forward' &&
      requested.requestedPath === 'visibility' &&
      requested.effectivePath === 'forward' &&
      forward.hash === requested.hash
    return
  }
  const [forward, visibility, occlusion] = rendered
  result.comparisons.forwardVsVisibility = compare(forward.pixels, visibility.pixels)
  result.comparisons.visibilityVsOcclusion = compare(visibility.pixels, occlusion.pixels)
  const differingFraction = result.comparisons.forwardVsVisibility.differing / result.comparisons.forwardVsVisibility.pixels
  result.ok =
    result.backend === 'webgpu' &&
    rendered.every((shot) => shot.status === 0 && shot.nonBackground > 0) &&
    forward.effectivePath === 'forward' &&
    visibility.effectivePath === 'visibility' &&
    occlusion.effectivePath === 'visibility' &&
    occlusion.occlusion === true &&
    result.comparisons.forwardVsVisibility.maxDelta <= TOLERANCE &&
    differingFraction <= MAX_DIFFERING_FRACTION &&
    result.comparisons.visibilityVsOcclusion.differing === 0
}

run()
  .catch((error) => {
    result.error = error && error.message ? error.message : String(error)
  })
  .finally(() => {
    result.done = true
    report(JSON.stringify(result))
  })
