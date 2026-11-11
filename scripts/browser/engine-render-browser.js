import { loadRenderer, RENDER_LAYOUT } from '../../src/engine/renderer.js'
import { cellOrigin, PAGE_SIDE, PAGE_U_EDGE, PAGE_V_EDGE, planetCellSize } from '../../src/engine/pageLayout.js'
import { solverIterationsFor } from '../../src/engine/solverIterations.js'
import { createPhysicsHandoff } from '../../src/engine/physicsHandoff.js'
import { readLayout } from '../../src/engine/bridge.js'
import { WITNESS_PATCH_BLOCK, buildPlanetScene, witnessSceneSpec } from '../../src/engine/planetScene.js'
import { createLeafBlock, createVegetationFollower } from '../../src/engine/vegetationStream.js'
import { relativeLookAt } from '../../src/engine/cameraRelative.js'

const QUERY = new URLSearchParams(location.search)
const PHASE = QUERY.get('phase') === '11' ? 11 : 10
const TIER = QUERY.get('tier') === '1024' ? 1024 : 64
const TIMED = QUERY.get('timed') === '1'
const DRAW = QUERY.get('draw') !== '0'
const MODELS = QUERY.get('models') === '1'
const HOLD_END = QUERY.get('hold') === '1'
const THREADS = QUERY.get('threads') === '1' && TIER === 1024
const WORKERS = THREADS ? 4 : 1
const LARGE_MEMORY = TIER === 1024 || MODELS
const TIER_GLUE = THREADS
  ? '../../engine/out/engine-core-512mib-timed-threads-simd.mjs'
  : (LARGE_MEMORY ? '../../engine/out/engine-core-512mib' : '../../engine/out/engine-core-64mib') + (TIMED ? '-timed' : '') + '.mjs'
const TIER_BUDGET = LARGE_MEMORY ? 512 * 1024 * 1024 : 64 * 1024 * 1024
const WARMUP_FRAMES = 60
const FRAMES = QUERY.has('frames') ? Number(QUERY.get('frames')) : 600
if (!Number.isInteger(FRAMES) || FRAMES <= WARMUP_FRAMES) throw new RangeError('frames must be a whole number above the warm-up frames')
const BODIES = TIER === 1024 ? 10240 : 512
const LIGHTS = 8
const ALBEDO_SIDE = 16
const TICK_STEPS = 1
const CAMERA_RADIUS = 60
const CAMERA_HEIGHT = 25
const CAMERA_FOV = Math.PI / 3
const NEAR = 0.1
const FAR = 500
const GROUND = [-200, -1, -200, 200, 0, 200]
const SOLVER_ITERATIONS_QUERY = QUERY.get('iterations')
const runConfig = { solverIterations: null }
const WORLD = { capacity: TIER === 1024 ? 10240 : 2048, tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0 }
const PLANET = { radius: 6371000, cellSize: planetCellSize(6371000), gravity: 9.8, maxHeight: 8000 }
const CLASS_MATERIALS = [0, 1, 2, 3]

const result = { phase: PHASE, errors: [], done: false, warmAt: null, lastFrame: -1, heldAtEnd: false }
window.engineRenderResult = result
const report = (line) => {
  const el = document.getElementById('result')
  if (el) el.textContent += line + '\n'
}
window.addEventListener('error', (event) => result.errors.push('uncaught ' + event.message))

const perspective = (fovY, aspect, near, far, out) => {
  const f = 1 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  out.fill(0)
  out[0] = f / aspect
  out[5] = f
  out[10] = (far + near) * nf
  out[11] = -1
  out[14] = 2 * far * near * nf
  return out
}

const multiply = (p, v, out) => {
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += p[k * 4 + r] * v[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

const checker = () => {
  const pixels = new Uint8Array(ALBEDO_SIDE * ALBEDO_SIDE * 4)
  for (let y = 0; y < ALBEDO_SIDE; y++) {
    for (let x = 0; x < ALBEDO_SIDE; x++) {
      const on = ((x >> 2) + (y >> 2)) & 1
      const i = (y * ALBEDO_SIDE + x) * 4
      pixels[i] = on ? 230 : 60
      pixels[i + 1] = on ? 200 : 90
      pixels[i + 2] = on ? 90 : 160
      pixels[i + 3] = 255
    }
  }
  return pixels
}

const p99 = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))]
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const FNV_OFFSET = 0x811c9dc5
const fnvWords = (hash, words) => {
  let h = hash
  for (const w of words) h = Math.imul(h ^ w, 0x01000193) >>> 0
  return h
}
const floatWords = (values) => Array.from(new Uint32Array(Float32Array.from(values).buffer))
const sceneDigest = (module, placed, camera) => {
  let hash = fnvWords(FNV_OFFSET, floatWords([...camera.eye, ...camera.viewProj]))
  for (const p of placed) {
    hash = fnvWords(hash, floatWords([...p.origin, ...p.uEdge, ...p.vEdge]))
    const samples = module._engine_page_samples(p.slot) >> 2
    hash = fnvWords(hash, Array.from(module.HEAPU32.subarray(samples, samples + PAGE_SIDE * PAGE_SIDE)))
  }
  return hash.toString(16).padStart(8, '0')
}

const setupWorld = (module) => {
  runConfig.solverIterations = SOLVER_ITERATIONS_QUERY === null ? solverIterationsFor(readLayout(module).players) : Number(SOLVER_ITERATIONS_QUERY)
  const status = module._engine_world_configure(WORLD.capacity, WORLD.tickRate, WORLD.gravity, WORLD.drag, WORLD.radius, WORLD.restitution, runConfig.solverIterations)
  if (status !== 0) throw new Error('world configure status ' + status)
  module._engine_world_add_box(...GROUND)
  for (let i = 0; i < BODIES; i++) {
    const at = TIER === 1024 ? [(i % 100) * 0.6 - 30, 1 + (i % 5), Math.floor(i / 100) * 0.6 - 30] : [(i % 32) * 2 - 32, 2 + (i % 5), Math.floor(i / 32) * 2 - 16]
    module._engine_spawn(at[0], at[1], at[2], 0, 0, 0)
  }
}

const planetSurface = (module) => {
  const anchor = module._engine_planet_height(0, PLANET.radius, 0)
  return (x, z) => module._engine_planet_height(x, PLANET.radius, z) - anchor
}

const locateCell = (module, x, y, z, out) => {
  module._engine_planet_locate(x, y, z)
  const at = module._engine_planet_scratch() >> 2
  out.face = module.HEAPU32[at]
  out.cx = module.HEAPU32[at + 1]
  out.cy = module.HEAPU32[at + 2]
  return out
}

const cellOf = (module, x, y, z) => locateCell(module, x, y, z, { face: 0, cx: 0, cy: 0 })

const configurePlanet = (module) => {
  const status = module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight)
  if (status !== 0) throw new Error('planet configure status ' + status)
  return planetSurface(module)
}

const setupPlanet = (module, renderer, placed) => {
  const surface = configurePlanet(module)
  const anchor = cellOf(module, 0, PLANET.radius, 0)
  const uEdge = PAGE_U_EDGE
  const vEdge = PAGE_V_EDGE
  let k = 0
  for (let dy = -3; dy <= 2; dy++) {
    for (let dx = -3; dx <= 2; dx++) {
      const key = module._engine_planet_key(anchor.face, anchor.cx + dx, anchor.cy + dy)
      const slot = module._engine_page_stage(key)
      if (slot < 0) throw new Error('page stage refused at cell ' + dx + ',' + dy)
      const samples = module._engine_page_samples(slot) >> 2
      for (let s = 0; s < PAGE_SIDE * PAGE_SIDE; s++) {
        module.HEAPF32[samples + s] = 0.5 * Math.sin((s % PAGE_SIDE) * 0.6 + k) * Math.cos(Math.floor(s / PAGE_SIDE) * 0.6)
      }
      module._engine_page_commit(slot)
      if (dx >= -2 && dx <= 1 && dy >= -2 && dy <= 1) {
        const origin = cellOrigin(dx, dy)
        renderer.placePage(slot, origin, uEdge, vEdge)
        placed.push({ slot, origin, uEdge, vEdge })
      }
      k += 1
    }
  }
  return surface
}

const FLYOVER = QUERY.get('path') === 'flyover'
const PATH = FLYOVER || QUERY.get('path') === 'planet' ? 'planet' : 'orbit'
const PATH_SPEED_M_PER_S = FLYOVER ? 300 : 30
const PATH_STEP_M = PATH_SPEED_M_PER_S / 60
const PATH_HEIGHT_M = FLYOVER ? 250 : CAMERA_HEIGHT
const pagePlacement = new Map()
const PART_NAMES = ["stage", "fill", "commit", "place"]
const PART_CAP = 1 << 16
const pathStats = { restages: 0, restageCount: 0, restageMs: new Float64Array(FRAMES), cellChanges: 0, stageCount: 0, parts: { stage: new Float64Array(PART_CAP), fill: new Float64Array(PART_CAP), commit: new Float64Array(PART_CAP), place: new Float64Array(PART_CAP) } }
let pathRef = null
let pathCell = null
const PATH_CELL_NOW = { face: 0, cx: 0, cy: 0 }
const CELL_BIAS = 1 << 20
const CELL_RADIX = 1 << 21
const packCell = (face, cx, cy) => (face * CELL_RADIX + (cx + CELL_BIAS)) * CELL_RADIX + (cy + CELL_BIAS)
const cellFaceOf = (packed) => Math.floor(Math.floor(packed / CELL_RADIX) / CELL_RADIX)
const cellXOf = (packed) => (Math.floor(packed / CELL_RADIX) % CELL_RADIX) - CELL_BIAS
const cellYOf = (packed) => (packed % CELL_RADIX) - CELL_BIAS

const PATH_WINDOW = Math.max(1, Math.min(8, Number(QUERY.get('window') ?? 2)))
const PAGES_PER_FRAME = Math.max(1, Number(QUERY.get('streamPerFrame') ?? 8))
const wantedPages = new Map()
const pageQueue = { releaseKey: [], stageKey: [], stageCell: [] }
const PAGE_FRAME = { origin: new Float64Array(3), uEdge: new Float64Array(3), vEdge: new Float64Array(3) }

const planWindow = (module, cell) => {
  wantedPages.clear()
  for (let dy = -PATH_WINDOW; dy < PATH_WINDOW; dy++) {
    for (let dx = -PATH_WINDOW; dx < PATH_WINDOW; dx++) {
      const cx = cell.cx + dx
      const cy = cell.cy + dy
      wantedPages.set(module._engine_planet_key(cell.face, cx, cy), packCell(cell.face, cx, cy))
    }
  }
  pageQueue.releaseKey.length = 0
  for (const key of pagePlacement.keys()) if (!wantedPages.has(key)) pageQueue.releaseKey.push(key)
  pageQueue.stageKey.length = 0
  pageQueue.stageCell.length = 0
  for (const [key, cellKey] of wantedPages) {
    if (pagePlacement.has(key)) continue
    pageQueue.stageKey.push(key)
    pageQueue.stageCell.push(cellKey)
  }
  pathStats.restages += 1
}

const placePageFrame = (module, face, cx, cy) => {
  if (module._engine_planet_cell_frame(face, cx, cy) !== 0) throw new Error('cell frame refused at ' + face + ',' + cx + ',' + cy)
  const at = module._engine_planet_scratch_f64() / 8
  const f = module.HEAPF64
  for (let k = 0; k < 3; k++) {
    PAGE_FRAME.origin[k] = f[at + k]
    PAGE_FRAME.uEdge[k] = f[at + 3 + k]
    PAGE_FRAME.vEdge[k] = f[at + 6 + k]
  }
  return PAGE_FRAME
}

const recordPart = (name, value) => {
  if (pathStats.stageCount >= PART_CAP) throw new RangeError('page timing buffer full')
  pathStats.parts[name][pathStats.stageCount] = value
}

const streamPages = (module, renderer, limit) => {
  if (pageQueue.releaseKey.length === 0 && pageQueue.stageKey.length === 0) return
  const started = performance.now()
  let budget = limit
  while (budget > 0 && pageQueue.releaseKey.length > 0) {
    const key = pageQueue.releaseKey.pop()
    const slot = pagePlacement.get(key)
    if (slot === undefined) continue
    renderer.unplacePage(slot)
    module._engine_page_release(key)
    pagePlacement.delete(key)
    budget -= 1
  }
  while (budget > 0 && pageQueue.stageKey.length > 0) {
    const key = pageQueue.stageKey.pop()
    const cell = pageQueue.stageCell.pop()
    if (pagePlacement.has(key)) continue
    const face = cellFaceOf(cell)
    const cx = cellXOf(cell)
    const cy = cellYOf(cell)
    const t0 = performance.now()
    const slot = module._engine_page_stage(key)
    if (slot < 0) throw new Error('page stage refused at cell ' + face + ',' + cx + ',' + cy)
    const t1 = performance.now()
    const samples = module._engine_page_samples(slot) >> 2
    const k = Math.abs(Number(key)) % 97
    for (let s = 0; s < PAGE_SIDE * PAGE_SIDE; s++) {
      module.HEAPF32[samples + s] = 0.5 * Math.sin((s % PAGE_SIDE) * 0.6 + k) * Math.cos(Math.floor(s / PAGE_SIDE) * 0.6)
    }
    const t2 = performance.now()
    module._engine_page_commit(slot)
    const t3 = performance.now()
    const frame = placePageFrame(module, face, cx, cy)
    renderer.placePage(slot, frame.origin, frame.uEdge, frame.vEdge)
    const t4 = performance.now()
    recordPart('stage', t1 - t0)
    recordPart('fill', t2 - t1)
    recordPart('commit', t3 - t2)
    recordPart('place', t4 - t3)
    pathStats.stageCount += 1
    pagePlacement.set(key, slot)
    budget -= 1
  }
  if (pathStats.restageCount >= pathStats.restageMs.length) throw new RangeError('restage timing buffer full')
  pathStats.restageMs[pathStats.restageCount] = performance.now() - started
  pathStats.restageCount += 1
}

const setupPlanetPath = (module, renderer) => {
  const surface = configurePlanet(module)
  pathRef = cellOf(module, 0, PLANET.radius, 0)
  pathCell = { face: pathRef.face, cx: pathRef.cx, cy: pathRef.cy }
  planWindow(module, pathRef)
  streamPages(module, renderer, Infinity)
  pathStats.restages = 0
  pathStats.restageCount = 0
  pathStats.stageCount = 0
  return surface
}

const planetCamera = (module, renderer, frame, aspect, surface) => {
  module._engine_page_apply()
  const angle = frame * (PATH_STEP_M / CAMERA_RADIUS)
  const x = Math.sin(angle) * CAMERA_RADIUS
  const z = Math.cos(angle) * CAMERA_RADIUS
  const cell = locateCell(module, x, PLANET.radius, z, PATH_CELL_NOW)
  if (cell.face !== pathCell.face || cell.cx !== pathCell.cx || cell.cy !== pathCell.cy) {
    pathStats.cellChanges += 1
    planWindow(module, cell)
    pathCell.face = cell.face
    pathCell.cx = cell.cx
    pathCell.cy = cell.cy
  }
  streamPages(module, renderer, PAGES_PER_FRAME)
  CAMERA.eye[0] = x
  CAMERA.eye[1] = surface(x, z) + PATH_HEIGHT_M
  CAMERA.eye[2] = z
  relativeLookAt(CAMERA.eye, ORIGIN, UP, VIEW)
  perspective(CAMERA_FOV, aspect, NEAR, FAR, PROJ)
  multiply(PROJ, VIEW, CAMERA.viewProj)
  return CAMERA
}

const setupScene = (module, renderer, placed, worldReady = false) => {
  if (!worldReady) setupWorld(module)
  const surface = PATH === 'planet' ? setupPlanetPath(module, renderer) : setupPlanet(module, renderer, placed)
  const classes = new Uint8Array(RENDER_LAYOUT.BODY_SLOTS).fill(255)
  for (let i = 0; i < BODIES; i++) classes[i] = i % RENDER_LAYOUT.PROP_CLASSES
  renderer.setBodyClasses(classes)
  CLASS_MATERIALS.forEach((material, cls) => renderer.setClassMaterial(cls, material))
  const palette = [[0.8, 0.3, 0.2], [0.2, 0.7, 0.3], [0.3, 0.4, 0.9], [0.9, 0.8, 0.3]]
  palette.forEach((colour, slot) => renderer.setMaterial(slot, { colour: [colour[0], colour[1], colour[2], 1], roughness: 0.5, metallic: 0, emissive: [0, 0, 0], albedoLayer: slot === 1 ? 1 : 0 }))
  renderer.setAlbedo(1, checker())
  for (let i = 0; i < LIGHTS; i++) {
    const angle = (i / LIGHTS) * Math.PI * 2
    renderer.setLight(i, { position: [Math.cos(angle) * 30, 12, Math.sin(angle) * 30], radius: 60, colour: [1, 0.95, 0.85], intensity: 0.8 })
  }
  renderer.setLightCount(LIGHTS)
  return surface
}

const ORIGIN = [0, 0, 0]
const UP = [0, 1, 0]
const VIEW = new Float64Array(16)
const PROJ = new Float64Array(16)
const CAMERA = { viewProj: new Float64Array(16), eye: new Float64Array(3) }

const orbitCamera = (frame, aspect, surface) => {
  const angle = frame * 0.01
  const ex = Math.sin(angle) * CAMERA_RADIUS
  const ez = Math.cos(angle) * CAMERA_RADIUS
  CAMERA.eye[0] = ex
  CAMERA.eye[1] = surface(ex, ez) + CAMERA_HEIGHT
  CAMERA.eye[2] = ez
  relativeLookAt(CAMERA.eye, ORIGIN, UP, VIEW)
  perspective(CAMERA_FOV, aspect, NEAR, FAR, PROJ)
  multiply(PROJ, VIEW, CAMERA.viewProj)
  return CAMERA
}

const adapterInfo = async () => {
  if (PHASE === 11) {
    const gl = document.createElement('canvas').getContext('webgl2')
    const ext = gl && gl.getExtension('WEBGL_debug_renderer_info')
    return ext
      ? { api: 'webgl2', vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL), renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) }
      : { api: 'webgl2', vendor: gl ? gl.getParameter(gl.VENDOR) : null, renderer: gl ? gl.getParameter(gl.RENDERER) : null, debugInfo: false }
  }
  const adapter = await navigator.gpu.requestAdapter()
  if (!adapter) return { api: 'webgpu', adapter: null }
  const info = adapter.info ?? (await adapter.requestAdapterInfo())
  return { api: 'webgpu', vendor: info.vendor, architecture: info.architecture, device: info.device, description: info.description, isFallbackAdapter: adapter.info ? info.isFallbackAdapter : undefined }
}

const MODEL_CHURN_VERTICES = 1024
const MODEL_CHURN_INDICES = 3072
const MODEL_NEW_VERTICES = 4096
const MODEL_NEW_INDICES = 12288
const MODEL_CHURN_LIVE = 12
const MODEL_EVENT_EVERY = 50
const models = { churn: [], events: [], loads: 0, unloads: 0, failures: 0, begin: null }
const roundTo2 = (v) => Math.round(v * 100) / 100

const memorySnapshot = (module) => ({
  wasmBytes: module.HEAPU8.buffer.byteLength,
  allocationsSinceWarmup: String(module._engine_allocations_since_warmup()),
  jsHeapBytes: performance.memory ? performance.memory.usedJSHeapSize : null,
  liveModels: module._engine_models_live(),
})

const modelsStep = (module, frame) => {
  if (frame === WARMUP_FRAMES + 1) models.begin = memorySnapshot(module)
  if (frame < WARMUP_FRAMES) return
  if (frame % 2 === 0) {
    const handle = module._engine_models_load(MODEL_CHURN_VERTICES, MODEL_CHURN_INDICES, frame)
    if (handle > 0) models.churn.push(handle)
    else models.failures += 1
    models.loads += 1
    if (models.churn.length > MODEL_CHURN_LIVE) {
      if (module._engine_models_unload(models.churn.shift()) !== 0) models.failures += 1
      models.unloads += 1
    }
  }
  if ((frame - WARMUP_FRAMES) % MODEL_EVENT_EVERY === 1) {
    const handle = module._engine_models_load(MODEL_NEW_VERTICES, MODEL_NEW_INDICES, 1000 + frame)
    if (handle > 0) models.events.push({ frame, handle })
    else models.failures += 1
  }
}

const modelsReport = (module, frameTimes) => {
  const eventFrames = new Set(models.events.map((e) => e.frame))
  const steady = []
  for (let f = WARMUP_FRAMES; f < frameTimes.length; f++) if (!eventFrames.has(f)) steady.push(frameTimes[f])
  const eventMs = models.events.map((e) => frameTimes[e.frame])
  const newcomerUploaded = models.events.every((e) => module._engine_models_uploaded(e.handle) === 1)
  const dirtyAtEnd = module._engine_models_dirty()
  for (const handle of models.churn.splice(0)) if (module._engine_models_unload(handle) !== 0) models.failures += 1
  for (const e of models.events) if (module._engine_models_unload(e.handle) !== 0) models.failures += 1
  const end = memorySnapshot(module)
  const steadyMedian = median(steady)
  const eventMedian = median(eventMs)
  return {
    poolBytes: module._engine_models_pool_bytes(),
    churnLoads: models.loads,
    churnUnloads: models.unloads,
    failures: models.failures,
    begin: models.begin,
    end,
    dirtyAtEnd,
    newcomers: models.events.length,
    newcomerUploaded,
    steadyFrames: steady.length,
    steadyFrameMedianMs: roundTo2(steadyMedian),
    steadyFrameP99Ms: roundTo2(p99(steady)),
    newcomerFrameMedianMs: roundTo2(eventMedian),
    newcomerFrameMaxMs: roundTo2(Math.max(...eventMs)),
    firstFrameCostMs: roundTo2(eventMedian - steadyMedian),
    firstFrameRatio: roundTo2(eventMedian / steadyMedian),
    newcomerFrames: models.events.map((e) => ({ frame: e.frame, totalMs: roundTo2(frameTimes[e.frame]) })),
    ok: models.failures === 0 && newcomerUploaded && dirtyAtEnd === 0 && end.liveModels === 0 && end.wasmBytes === models.begin.wasmBytes,
  }
}

const heapSnapshot = (module) => ({
  usedJSHeapSize: performance.memory ? performance.memory.usedJSHeapSize : null,
  wasmBytes: module.HEAPU8.buffer.byteLength,
  arenaUsedBytes: Number(module._engine_arena_used()),
  heapInUseBytes: module._engine_heap_inuse_bytes(),
  heapArenaBytes: module._engine_heap_arena_bytes(),
  modelsPoolBytes: module._engine_models_pool_bytes(),
})

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const navigatorLike = PHASE === 11 ? {} : navigator
  const requested = PHASE === 11 ? 'webgl2' : 'webgpu'
  result.adapter = await adapterInfo()
  let planetScene = null
  let worldReady = false
  const beforeSeal = TIER === 1024 ? (module) => { setupWorld(module); worldReady = true; planetScene = buildPlanetScene({ module, now: () => performance.now(), generate: false, spec: witnessSceneSpec(PLANET.radius) }) } : null
  const renderer = await loadRenderer({ glue: new URL(TIER_GLUE, import.meta.url).href, canvas, navigatorLike, requested, players: TIER, workers: WORKERS, budgetBytes: TIER_BUDGET, beforeSeal, models: TIER === 1024 || MODELS })
  const module = renderer.module
  const placed = []
  const surface = setupScene(module, renderer, placed, worldReady)
  if (planetScene) {
    module._engine_page_apply()
    planetScene.generate()
  }
  const vegetationBlock = planetScene && PATH === 'planet' ? createLeafBlock({ level: planetScene.spec.patchLevel, block: WITNESS_PATCH_BLOCK }) : null
  if (vegetationBlock) vegetationBlock.update(0, PLANET.radius, 0)
  const followVegetation = vegetationBlock ? createVegetationFollower({ scene: planetScene, block: vegetationBlock, radiusM: PLANET.radius }) : null
  const handoff = TIER === 1024 ? createPhysicsHandoff({ module, glue: new URL(TIER_GLUE, import.meta.url).href, players: TIER, budgetBytes: TIER_BUDGET, solverIterations: runConfig.solverIterations, timeTicks: TIMED ? FRAMES : 0, path: { window: PATH_WINDOW, perFrame: PAGES_PER_FRAME, stepM: PATH_STEP_M, heightM: PATH_HEIGHT_M } }) : null
  if (handoff) await handoff.ready

  const aspect = canvas.width / canvas.height
  const frameTimes = new Float64Array(FRAMES)
  const PHASE_NAMES = ['pages', 'inputs', 'physics', 'readback', 'plan', 'backend', 'acquire', 'upload', 'submit', 'encode']
  const phaseCount = TIMED && module._engine_phase_count ? module._engine_phase_count() : 0
  const ROW_FIELDS = 7
  const ROW_WIDTH = ROW_FIELDS + phaseCount
  const rows = new Float64Array(FRAMES * ROW_WIDTH)
  const phasesBefore = new Float64Array(phaseCount)
  const phasesAfter = new Float64Array(phaseCount)
  const readPhases = (out) => {
    for (let i = 0; i < phaseCount; i++) out[i] = module._engine_phase_total_ms(i)
  }
  let lastStats = null
  const lastCamera = { viewProj: new Float64Array(16), eye: new Float64Array(3) }
  const firstCallMs = {}
  const timeFirstCall = (name, call) => {
    const at = performance.now()
    call()
    firstCallMs[name] = performance.now() - at
  }
  timeFirstCall('_engine_tick', () => { if (!handoff) module._engine_tick(0) })
  if (TIMED && module._engine_phase_count) timeFirstCall('_engine_phase_total_ms', () => module._engine_phase_total_ms(0))
  if (TIMED && module._engine_sim_active_bodies) timeFirstCall('_engine_sim_active_bodies', () => module._engine_sim_active_bodies())
  if (DRAW) timeFirstCall('renderer.frame', () => {
    renderer.setCamera(PATH === 'planet' ? planetCamera(module, renderer, 0, aspect, surface) : orbitCamera(0, aspect, surface))
    if (renderer.frame() !== 0) throw new Error('engine_render_frame warm-up status')
  })
  result.firstCallMs = firstCallMs
  await new Promise((resolve, reject) => {
    let frame = 0
    let lastStarted = null
    const step = () => {
      try {
        const started = performance.now()
        readPhases(phasesBefore)
        if (handoff) handoff.requestFrame(frame)
        else module._engine_tick(TICK_STEPS)
        const tickEnd = performance.now()
        renderer.setCamera(PATH === 'planet' ? planetCamera(module, renderer, frame, aspect, surface) : orbitCamera(frame, aspect, surface))
        if (followVegetation) followVegetation(CAMERA.eye[0], CAMERA.eye[1], CAMERA.eye[2], pageQueue.stageKey.length + pageQueue.releaseKey.length)
        if (MODELS) modelsStep(module, frame)
        if (DRAW) {
          const status = renderer.frame()
          if (status !== 0) throw new Error('engine_render_frame status ' + status)
        }
        readPhases(phasesAfter)
        const totalMs = performance.now() - started
        frameTimes[frame] = totalMs
        const at = frame * ROW_WIDTH
        rows[at] = frame
        rows[at + 1] = started
        rows[at + 2] = tickEnd - started
        rows[at + 3] = totalMs - (tickEnd - started)
        rows[at + 4] = totalMs
        rows[at + 5] = lastStarted === null ? NaN : started - lastStarted
        rows[at + 6] = TIMED && module._engine_sim_active_bodies ? module._engine_sim_active_bodies() : NaN
        for (let i = 0; i < phaseCount; i++) rows[at + ROW_FIELDS + i] = phasesAfter[i] - phasesBefore[i]
        lastStarted = started
        if (frame === WARMUP_FRAMES) { renderer.markWarmup(); result.warmAt = frame; result.heapAtWarm = heapSnapshot(module) }
        if (frame === FRAMES - 1) { lastStats = renderer.stats(); result.heapAtEnd = heapSnapshot(module) }
        result.lastFrame = frame
        frame += 1
        if (frame < FRAMES) requestAnimationFrame(step)
        else if (HOLD_END) {
          result.heldAtEnd = true
          window.engineRenderRelease = resolve
        } else resolve()
      } catch (error) {
        reject(error)
      }
    }
    requestAnimationFrame(step)
  })
  lastCamera.viewProj.set(CAMERA.viewProj)
  lastCamera.eye.set(CAMERA.eye)

  const timed = frameTimes.slice(WARMUP_FRAMES)
  const timedCount = FRAMES - WARMUP_FRAMES
  const timedRows = rows.subarray(WARMUP_FRAMES * ROW_WIDTH)
  const column = (c) => {
    const values = new Float64Array(timedCount)
    for (let r = 0; r < timedCount; r++) values[r] = timedRows[r * ROW_WIDTH + c]
    return values
  }
  const nullIfNaN = (v, map = (x) => x) => (Number.isNaN(v) ? null : map(v))
  result.backend = renderer.backendName
  result.draw = DRAW ? 1 : 0
  result.tier = TIER
  result.anchorHeightM = module._engine_planet_height(0, PLANET.radius, 0)
  result.bodies = BODIES
  result.frames = FRAMES
  result.frameTimeP99Ms = p99(timed)
  result.frameTimeMedianMs = median(timed)
  result.frameTimeMaxMs = Math.max(...timed)
  result.frameTimesMs = Array.from(timed, roundTo2)
  result.wallIntervalsMs = Array.from(column(5), roundTo2)
  result.wallIntervalMaxMs = Math.max(...result.wallIntervalsMs)
  result.frameStartsMs = Array.from(column(1), roundTo2)
  result.timeOriginMs = performance.timeOrigin
  result.players = readLayout(module).players
  if (TIER === 1024) result.scene = planetScene.report()
  result.path = PATH
  if (PATH === 'planet') {
    result.pathSpeedMps = PATH_SPEED_M_PER_S
    result.flyover = FLYOVER
    result.pageWindow = PATH_WINDOW
    result.pagesPerFrame = PAGES_PER_FRAME
    result.pagesPlaced = pagePlacement.size
    result.cellChanges = pathStats.cellChanges
    result.restages = pathStats.restages
    if (pathStats.restageCount > 0) {
      const restageMs = pathStats.restageMs.subarray(0, pathStats.restageCount)
      result.restageMsMax = Math.max(...restageMs)
      result.restageMsP99 = p99(restageMs)
      result.restagePartsMaxMs = Object.fromEntries(PART_NAMES.map((name) => [name, Math.max(0, ...pathStats.parts[name].subarray(0, pathStats.stageCount))]))
    }
  }
  const round2 = (v) => Math.round(v * 100) / 100
  result.timed = TIMED
  result.threads = THREADS
  result.workers = WORKERS
  result.glue = TIER_GLUE
  result.solverIterations = runConfig.solverIterations
  result.tickMedianMs = round2(median(column(2)))
  if (handoff && TIMED) {
    const workerTicks = (await handoff.tickTimes()).subarray(WARMUP_FRAMES)
    result.workerTick = { ticks: workerTicks.length, medianMs: round2(median(workerTicks)), p99Ms: round2(p99(workerTicks)), maxMs: round2(Math.max(...workerTicks)), overBudget: workerTicks.filter((ms) => ms > 16.7).length, over25: workerTicks.filter((ms) => ms > 25).length }
  }
  result.outlierThresholdMs = round2(2 * result.frameTimeMedianMs)
  result.outliers = []
  for (let r = 0; r < timedCount; r++) {
    const at = r * ROW_WIDTH
    if (timedRows[at + 4] > 2 * result.frameTimeMedianMs) result.outliers.push({ frame: timedRows[at], wallMs: Math.round(performance.timeOrigin + timedRows[at + 1]), totalMs: round2(timedRows[at + 4]), tickMs: round2(timedRows[at + 2]), renderMs: round2(timedRows[at + 3]), gapMs: nullIfNaN(timedRows[at + 5], round2), phasesMs: Object.fromEntries(Array.from({ length: phaseCount }, (_, i) => [PHASE_NAMES[i], round2(timedRows[at + ROW_FIELDS + i])])) })
  }
  result.phaseMedianMs = Object.fromEntries(PHASE_NAMES.slice(0, phaseCount).map((name, i) => [name, round2(median(column(ROW_FIELDS + i)))]))
  result.phaseMaxMs = Object.fromEntries(PHASE_NAMES.slice(0, phaseCount).map((name, i) => [name, round2(Math.max(...column(ROW_FIELDS + i)))]))
  result.rowColumns = ['frame', 'startMs', 'tickMs', 'renderMs', 'gapMs', 'active', ...PHASE_NAMES.slice(0, phaseCount)]
  result.rows = Array.from({ length: timedCount }, (_, r) => {
    const at = r * ROW_WIDTH
    return [timedRows[at], round2(performance.timeOrigin + timedRows[at + 1]), round2(timedRows[at + 2]), round2(timedRows[at + 3]), nullIfNaN(timedRows[at + 5], round2), nullIfNaN(timedRows[at + 6]), ...Array.from({ length: phaseCount }, (_, i) => round2(timedRows[at + ROW_FIELDS + i]))]
  })
  if (MODELS) result.models = modelsReport(module, frameTimes)
  if (DRAW) {
    result.apiCallsPerFrame = lastStats.apiCallsLastFrame
    result.allocationsSinceWarmup = String(lastStats.allocationsSinceWarmup)
    result.createsAfterSeal = lastStats.createsAfterSeal
    result.checksum = String(lastStats.checksum)
    result.sceneDigest = sceneDigest(module, placed, lastCamera)
    result.visible = lastStats.visible
    result.vegetation = { draws: lastStats.vegetationDraws, instances: lastStats.vegetationInstances, blockMoves: vegetationBlock ? vegetationBlock.moves : null }
    result.pages = lastStats.pages
    result.uploads = lastStats.uploads
    result.lights = lastStats.lights
    result.ok = result.errors.length === 0 && result.allocationsSinceWarmup === '0'
  } else {
    result.ok = result.errors.length === 0
  }
}

run()
  .catch((error) => result.errors.push('thrown ' + (error && error.message ? error.message : String(error))))
  .finally(() => {
    result.done = true
    window.engineRenderResult = result
    report(JSON.stringify(result))
  })
