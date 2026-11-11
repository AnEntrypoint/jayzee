import { PAGE_SIDE, PAGE_U_EDGE, PAGE_V_EDGE, cellOrigin } from './pageLayout.js'
import { cellOf, configurePlanet, locateCell, PLANET } from './sceneSetup.js'

export const PATH_WINDOW = 2
export const PAGES_PER_FRAME = 8
export const CAMERA_RADIUS = 60
export const CAMERA_HEIGHT = 25
export const PATH_PERIOD_FRAMES = 720
export const PATH_STEP_M = (2 * Math.PI * CAMERA_RADIUS) / PATH_PERIOD_FRAMES
const FILL_CLASSES = 97

export const cameraEngineSpot = (frame, surface, stepM, heightM, out) => {
  const angle = frame * (stepM / CAMERA_RADIUS)
  const x = Math.sin(angle) * CAMERA_RADIUS
  const z = Math.cos(angle) * CAMERA_RADIUS
  out[0] = x
  out[1] = surface(x, z) + heightM
  out[2] = z
  return out
}

const fillTemplates = () => {
  const templates = []
  for (let k = 0; k < FILL_CLASSES; k++) {
    const template = new Float32Array(PAGE_SIDE * PAGE_SIDE)
    for (let s = 0; s < template.length; s++) {
      template[s] = 0.5 * Math.sin((s % PAGE_SIDE) * 0.6 + k) * Math.cos(Math.floor(s / PAGE_SIDE) * 0.6)
    }
    templates.push(template)
  }
  return templates
}

const fillClass = (face, cx, cy) => (((face * 7 + cx * 31 + cy * 17) % FILL_CLASSES) + FILL_CLASSES) % FILL_CLASSES

export const createPlanetStreamer = (module, { sink = null, window = PATH_WINDOW, perFrame = PAGES_PER_FRAME, heightM = CAMERA_HEIGHT } = {}) => {
  const surface = configurePlanet(module)
  const ref = cellOf(module, 0, PLANET.radius, 0)
  const cells = 4 * window * window
  const templates = fillTemplates()
  const probe = { face: 0, cx: 0, cy: 0 }
  const spot = new Float64Array(3)
  const pathSpot = new Float64Array(3 * PATH_PERIOD_FRAMES)
  const pathCell = new Int32Array(3 * PATH_PERIOD_FRAMES)

  for (let f = 0; f < PATH_PERIOD_FRAMES; f++) {
    cameraEngineSpot(f, surface, PATH_STEP_M, heightM, spot)
    pathSpot.set(spot, 3 * f)
    const cell = locateCell(module, spot[0], PLANET.radius, spot[2], probe)
    pathCell[3 * f] = cell.face
    pathCell[3 * f + 1] = cell.cx
    pathCell[3 * f + 2] = cell.cy
  }

  const wantedFace = new Int32Array(cells)
  const wantedCx = new Int32Array(cells)
  const wantedCy = new Int32Array(cells)
  const stage = new Int32Array(cells)
  const release = new Int32Array(cells)
  const placedFace = new Int32Array(cells)
  const placedCx = new Int32Array(cells)
  const placedCy = new Int32Array(cells)
  const placedSlot = new Int32Array(cells)
  const placedUsed = new Uint8Array(cells)
  const counts = { wanted: 0, stage: 0, release: 0 }
  const current = { face: -1, cx: 0, cy: 0 }

  const placedIndex = (face, cx, cy) => {
    for (let p = 0; p < cells; p++) {
      if (placedUsed[p] === 1 && placedFace[p] === face && placedCx[p] === cx && placedCy[p] === cy) return p
    }
    return -1
  }

  const wantedHas = (face, cx, cy) => {
    for (let w = 0; w < counts.wanted; w++) {
      if (wantedFace[w] === face && wantedCx[w] === cx && wantedCy[w] === cy) return true
    }
    return false
  }

  const plan = (face, cx, cy) => {
    counts.wanted = 0
    for (let dy = -window; dy < window; dy++) {
      for (let dx = -window; dx < window; dx++) {
        const w = counts.wanted
        wantedFace[w] = face
        wantedCx[w] = cx + dx
        wantedCy[w] = cy + dy
        counts.wanted += 1
      }
    }
    counts.release = 0
    for (let p = 0; p < cells; p++) {
      if (placedUsed[p] === 1 && !wantedHas(placedFace[p], placedCx[p], placedCy[p])) {
        release[counts.release] = p
        counts.release += 1
      }
    }
    counts.stage = 0
    for (let w = 0; w < counts.wanted; w++) {
      if (placedIndex(wantedFace[w], wantedCx[w], wantedCy[w]) < 0) {
        stage[counts.stage] = w
        counts.stage += 1
      }
    }
    current.face = face
    current.cx = cx
    current.cy = cy
  }

  const fillPage = (slot, face, cx, cy) => {
    module.HEAPF32.set(templates[fillClass(face, cx, cy)], module._engine_page_samples(slot) >> 2)
  }

  const freeSlotIndex = () => {
    for (let p = 0; p < cells; p++) if (placedUsed[p] === 0) return p
    throw new Error('planet page table holds more than ' + cells + ' pages')
  }

  const stream = (limit) => {
    let budget = limit
    while (budget > 0 && counts.release > 0) {
      counts.release -= 1
      const p = release[counts.release]
      if (sink) sink.unplace(placedSlot[p])
      module._engine_page_release_cell(placedFace[p], placedCx[p], placedCy[p])
      placedUsed[p] = 0
      budget -= 1
    }
    while (budget > 0 && counts.stage > 0) {
      counts.stage -= 1
      const w = stage[counts.stage]
      const face = wantedFace[w]
      const cx = wantedCx[w]
      const cy = wantedCy[w]
      if (placedIndex(face, cx, cy) >= 0) continue
      const slot = module._engine_page_stage_cell(face, cx, cy)
      if (slot < 0) throw new Error('page stage refused at window cell ' + (cx - ref.cx) + ',' + (cy - ref.cy))
      fillPage(slot, face, cx, cy)
      module._engine_page_commit(slot)
      if (sink) sink.place(slot, cellOrigin(cx - ref.cx, cy - ref.cy), PAGE_U_EDGE, PAGE_V_EDGE)
      const p = freeSlotIndex()
      placedFace[p] = face
      placedCx[p] = cx
      placedCy[p] = cy
      placedSlot[p] = slot
      placedUsed[p] = 1
      budget -= 1
    }
  }

  plan(ref.face, ref.cx, ref.cy)
  stream(Infinity)

  return {
    surface,
    step(frame) {
      const at = 3 * (frame % PATH_PERIOD_FRAMES)
      spot[0] = pathSpot[at]
      spot[1] = pathSpot[at + 1]
      spot[2] = pathSpot[at + 2]
      const face = pathCell[at]
      const cx = pathCell[at + 1]
      const cy = pathCell[at + 2]
      if (face !== current.face || cx !== current.cx || cy !== current.cy) plan(face, cx, cy)
      stream(perFrame)
      return spot
    },
  }
}
