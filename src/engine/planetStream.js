import { PAGE_SIDE, PAGE_U_EDGE, PAGE_V_EDGE, cellOrigin } from './pageLayout.js'
import { cellOf, configurePlanet, locateCell, PLANET } from './sceneSetup.js'

export const PATH_WINDOW = 2
export const PAGES_PER_FRAME = 8
export const CAMERA_RADIUS = 60
export const CAMERA_HEIGHT = 25
export const PATH_STEP_M = 30 / 60

export const cameraEngineSpot = (frame, surface, stepM = PATH_STEP_M, heightM = CAMERA_HEIGHT) => {
  const angle = frame * (stepM / CAMERA_RADIUS)
  const x = Math.sin(angle) * CAMERA_RADIUS
  const z = Math.cos(angle) * CAMERA_RADIUS
  return { x, y: surface(x, z) + heightM, z }
}

export const createPlanetStreamer = (module, { sink = null, window = PATH_WINDOW, perFrame = PAGES_PER_FRAME, stepM = PATH_STEP_M, heightM = CAMERA_HEIGHT } = {}) => {
  const surface = configurePlanet(module)
  const ref = cellOf(module, 0, PLANET.radius, 0)
  const current = { face: ref.face, cx: ref.cx, cy: ref.cy }
  const placed = new Map()
  const queue = { stage: [], release: [] }
  const probe = { face: 0, cx: 0, cy: 0 }

  const plan = (cell) => {
    const wanted = new Map()
    for (let dy = -window; dy < window; dy++) {
      for (let dx = -window; dx < window; dx++) {
        wanted.set(module._engine_planet_key(cell.face, cell.cx + dx, cell.cy + dy), [cell.cx + dx - ref.cx, cell.cy + dy - ref.cy])
      }
    }
    queue.release = [...placed.keys()].filter((key) => !wanted.has(key))
    queue.stage = [...wanted].filter(([key]) => !placed.has(key))
  }

  const fillPage = (slot, key) => {
    const samples = module._engine_page_samples(slot) >> 2
    const k = Math.abs(Number(key)) % 97
    for (let s = 0; s < PAGE_SIDE * PAGE_SIDE; s++) {
      module.HEAPF32[samples + s] = 0.5 * Math.sin((s % PAGE_SIDE) * 0.6 + k) * Math.cos(Math.floor(s / PAGE_SIDE) * 0.6)
    }
  }

  const stream = (limit) => {
    let budget = limit
    while (budget > 0 && queue.release.length > 0) {
      const key = queue.release.pop()
      const held = placed.get(key)
      if (held === undefined) continue
      if (sink) sink.unplace(held.slot)
      module._engine_page_release(key)
      placed.delete(key)
      budget -= 1
    }
    while (budget > 0 && queue.stage.length > 0) {
      const [key, [dx, dy]] = queue.stage.pop()
      if (placed.has(key)) continue
      const slot = module._engine_page_stage(key)
      if (slot < 0) throw new Error('page stage refused at window cell ' + dx + ',' + dy)
      fillPage(slot, key)
      module._engine_page_commit(slot)
      if (sink) sink.place(slot, cellOrigin(dx, dy), PAGE_U_EDGE, PAGE_V_EDGE)
      placed.set(key, { slot })
      budget -= 1
    }
  }

  plan(ref)
  stream(Infinity)

  return {
    surface,
    placed,
    step(frame) {
      const spot = cameraEngineSpot(frame, surface, stepM, heightM)
      const cell = locateCell(module, spot.x, PLANET.radius, spot.z, probe)
      if (cell.face !== current.face || cell.cx !== current.cx || cell.cy !== current.cy) {
        plan(cell)
        current.face = cell.face
        current.cx = cell.cx
        current.cy = cell.cy
      }
      stream(perFrame)
      return spot
    },
  }
}
