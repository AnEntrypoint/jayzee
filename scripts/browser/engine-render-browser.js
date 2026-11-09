import { loadRenderer, RENDER_LAYOUT } from '../../src/engine/renderer.js'

const QUERY = new URLSearchParams(location.search)
const PHASE = QUERY.get('phase') === '11' ? 11 : 10
const TIER = QUERY.get('tier') === '1024' ? 1024 : 64
const TIMED = QUERY.get('timed') === '1'
const DRAW = QUERY.get('draw') !== '0'
const TIER_GLUE = (TIER === 1024 ? '../../engine/out/engine-core-128mib' : '../../engine/out/engine-core-64mib') + (TIMED ? '-timed' : '') + '.mjs'
const TIER_BUDGET = TIER === 1024 ? 128 * 1024 * 1024 : 64 * 1024 * 1024
const FRAMES = 600
const WARMUP_FRAMES = 60
const BODIES = TIER === 1024 ? 10240 : 512
const LIGHTS = 8
const ALBEDO_SIDE = 16
const TICK_STEPS = 1
const PAGE_SPAN = 20
const PAGE_SIDE = 16
const CAMERA_RADIUS = 60
const CAMERA_HEIGHT = 25
const CAMERA_FOV = Math.PI / 3
const NEAR = 0.1
const FAR = 500
const GROUND = [-200, -1, -200, 200, 0, 200]
const WORLD = { capacity: TIER === 1024 ? 10240 : 2048, tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, iterations: 8 }
const PLANET = { radius: 6371000, cellSize: PAGE_SPAN, gravity: 9.8, maxHeight: 8000 }
const CLASS_MATERIALS = [0, 1, 2, 3]

const result = { phase: PHASE, errors: [], done: false }
const report = (line) => {
  const el = document.getElementById('result')
  if (el) el.textContent += line + '\n'
}
window.addEventListener('error', (event) => result.errors.push('uncaught ' + event.message))

const normalise = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1
  return [v[0] / l, v[1] / l, v[2] / l]
}
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const perspective = (fovY, aspect, near, far) => {
  const f = 1 / Math.tan(fovY / 2)
  const nf = 1 / (near - far)
  return [f / aspect, 0, 0, 0, 0, f, 0, 0, 0, 0, (far + near) * nf, -1, 0, 0, 2 * far * near * nf, 0]
}

const lookAt = (eye, target, up) => {
  const z = normalise([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]])
  const x = normalise(cross(up, z))
  const y = cross(z, x)
  return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, eye), -dot(y, eye), -dot(z, eye), 1]
}

const multiply = (p, v) => {
  const out = new Array(16)
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
  const status = module._engine_world_configure(WORLD.capacity, WORLD.tickRate, WORLD.gravity, WORLD.drag, WORLD.radius, WORLD.restitution, WORLD.iterations)
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

const cellOf = (module, x, y, z) => {
  module._engine_planet_locate(x, y, z)
  const at = module._engine_planet_scratch() >> 2
  return { face: module.HEAPU32[at], cx: module.HEAPU32[at + 1], cy: module.HEAPU32[at + 2] }
}

const setupPlanet = (module, renderer, placed) => {
  const status = module._engine_planet_configure(PLANET.radius, PLANET.cellSize, PLANET.gravity, PLANET.maxHeight)
  if (status !== 0) throw new Error('planet configure status ' + status)
  const surface = planetSurface(module)
  const anchor = cellOf(module, 0, PLANET.radius, 0)
  const uEdge = [0, 0, PAGE_SPAN]
  const vEdge = [PAGE_SPAN, 0, 0]
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
        const origin = [dx * PAGE_SPAN, 0, dy * PAGE_SPAN]
        renderer.placePage(slot, origin, uEdge, vEdge)
        placed.push({ slot, origin, uEdge, vEdge })
      }
      k += 1
    }
  }
  return surface
}

const setupScene = (module, renderer, placed) => {
  setupWorld(module)
  const surface = setupPlanet(module, renderer, placed)
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

const orbitCamera = (frame, aspect, surface) => {
  const angle = frame * 0.01
  const ex = Math.sin(angle) * CAMERA_RADIUS
  const ez = Math.cos(angle) * CAMERA_RADIUS
  const eye = [ex, surface(ex, ez) + CAMERA_HEIGHT, ez]
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0])
  const proj = perspective(CAMERA_FOV, aspect, NEAR, FAR)
  return { viewProj: multiply(proj, view), eye }
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

const run = async () => {
  const canvas = document.getElementById('engine-canvas')
  const navigatorLike = PHASE === 11 ? {} : navigator
  const requested = PHASE === 11 ? 'webgl2' : 'webgpu'
  result.adapter = await adapterInfo()
  const renderer = await loadRenderer({ glue: new URL(TIER_GLUE, import.meta.url).href, canvas, navigatorLike, requested, players: TIER, budgetBytes: TIER_BUDGET })
  const module = renderer.module
  const placed = []
  const surface = setupScene(module, renderer, placed)

  const aspect = canvas.width / canvas.height
  const frameTimes = []
  const frameRows = []
  const PHASE_NAMES = ['pages', 'inputs', 'physics', 'readback', 'plan', 'backend', 'acquire', 'upload', 'submit']
  const phaseCount = TIMED && module._engine_phase_count ? module._engine_phase_count() : 0
  const readPhases = () => Array.from({ length: phaseCount }, (_, i) => module._engine_phase_total_ms(i))
  let lastStats = null
  let lastCamera = null
  await new Promise((resolve, reject) => {
    let frame = 0
    let lastStarted = null
    const step = () => {
      try {
        const started = performance.now()
        const phasesBefore = readPhases()
        module._engine_tick(TICK_STEPS)
        const tickEnd = performance.now()
        const { viewProj, eye } = orbitCamera(frame, aspect, surface)
        renderer.setCamera({ viewProj, eye })
        lastCamera = { viewProj, eye }
        if (DRAW) {
          const status = renderer.frame()
          if (status !== 0) throw new Error('engine_render_frame status ' + status)
        }
        const phasesAfter = readPhases()
        const totalMs = performance.now() - started
        frameTimes.push(totalMs)
        frameRows.push({ frame, started, tickMs: tickEnd - started, renderMs: totalMs - (tickEnd - started), totalMs, gapMs: lastStarted === null ? null : started - lastStarted, active: TIMED ? module._engine_sim_active_bodies() : null, phases: phasesAfter.map((v, i) => v - phasesBefore[i]) })
        lastStarted = started
        if (frame === WARMUP_FRAMES) renderer.markWarmup()
        if (frame >= WARMUP_FRAMES) lastStats = renderer.stats()
        frame += 1
        if (frame < FRAMES) requestAnimationFrame(step)
        else resolve()
      } catch (error) {
        reject(error)
      }
    }
    requestAnimationFrame(step)
  })

  const timed = frameTimes.slice(WARMUP_FRAMES)
  result.backend = renderer.backendName
  result.draw = DRAW ? 1 : 0
  result.tier = TIER
  result.anchorHeightM = module._engine_planet_height(0, PLANET.radius, 0)
  result.bodies = BODIES
  result.frames = FRAMES
  result.frameTimeP99Ms = p99(timed)
  result.frameTimeMedianMs = median(timed)
  result.frameTimeMaxMs = Math.max(...timed)
  const round2 = (v) => Math.round(v * 100) / 100
  const timedRows = frameRows.slice(WARMUP_FRAMES)
  result.timed = TIMED
  result.tickMedianMs = round2(median(timedRows.map((row) => row.tickMs)))
  result.outlierThresholdMs = round2(2 * result.frameTimeMedianMs)
  result.outliers = timedRows.filter((row) => row.totalMs > 2 * result.frameTimeMedianMs).map((row) => ({ frame: row.frame, wallMs: Math.round(performance.timeOrigin + row.started), totalMs: round2(row.totalMs), tickMs: round2(row.tickMs), renderMs: round2(row.renderMs), gapMs: row.gapMs === null ? null : round2(row.gapMs), phasesMs: Object.fromEntries(row.phases.map((v, i) => [PHASE_NAMES[i], round2(v)])) }))
  result.phaseMedianMs = Object.fromEntries(PHASE_NAMES.slice(0, phaseCount).map((name, i) => [name, round2(median(timedRows.map((row) => row.phases[i])))]))
  result.phaseMaxMs = Object.fromEntries(PHASE_NAMES.slice(0, phaseCount).map((name, i) => [name, round2(Math.max(...timedRows.map((row) => row.phases[i])))]))
  result.rowColumns = ['frame', 'startMs', 'tickMs', 'renderMs', 'gapMs', 'active', ...PHASE_NAMES.slice(0, phaseCount)]
  result.rows = timedRows.map((row) => [row.frame, round2(performance.timeOrigin + row.started), round2(row.tickMs), round2(row.renderMs), row.gapMs === null ? null : round2(row.gapMs), row.active, ...row.phases.map((v) => round2(v))])
  if (DRAW) {
    result.apiCallsPerFrame = lastStats.apiCallsLastFrame
    result.allocationsSinceWarmup = String(lastStats.allocationsSinceWarmup)
    result.createsAfterSeal = lastStats.createsAfterSeal
    result.checksum = String(lastStats.checksum)
    result.sceneDigest = sceneDigest(module, placed, lastCamera)
    result.visible = lastStats.visible
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
