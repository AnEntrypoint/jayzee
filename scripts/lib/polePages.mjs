export const PAGE_SIDE = 16
const PAGE_STEPS = PAGE_SIDE - 1
const POLE_FACE = 2
const QUARTER_TURN = Math.PI / 4

export const createPoleTerrain = (world, planet, { cells, heightOf }) => {
  const cellMetres = planet.cellSize * QUARTER_TURN
  const poleCell = Math.round(planet.radius / planet.cellSize)
  const face = world.locateCell([0.25 * cellMetres, planet.radius, -0.25 * cellMetres]).face
  if (face !== POLE_FACE) throw new RangeError('the pole is on face ' + face + ', expected face ' + POLE_FACE)
  const pages = new Map()
  for (let cy = -cells; cy < cells; cy++) {
    for (let cx = -cells; cx < cells; cx++) {
      const samples = new Float32Array(PAGE_SIDE * PAGE_SIDE)
      for (let j = 0; j < PAGE_SIDE; j++) {
        for (let i = 0; i < PAGE_SIDE; i++) {
          samples[j * PAGE_SIDE + i] = heightOf((cx + i / PAGE_STEPS) * cellMetres, (cy + j / PAGE_STEPS) * cellMetres, cx, cy)
        }
      }
      world.writePage(world.cellKey(face, poleCell + cx, poleCell + cy), samples)
      pages.set(cx + ',' + cy, samples)
    }
  }
  world.applyPages()

  const direction = (alongU, alongV, out = [0, 0, 0]) => {
    const x = Math.tan(alongU / planet.radius)
    const z = -Math.tan(alongV / planet.radius)
    const length = Math.hypot(x, 1, z)
    out[0] = x / length
    out[1] = 1 / length
    out[2] = z / length
    return out
  }

  const point = (alongU, alongV, altitude, out = [0, 0, 0]) => {
    direction(alongU, alongV, out)
    const reach = planet.radius + altitude
    out[0] *= reach
    out[1] *= reach
    out[2] *= reach
    return out
  }

  const along = (position) => [planet.radius * Math.atan(position[0] / position[1]), planet.radius * Math.atan(-position[2] / position[1])]

  const height = (alongU, alongV) => {
    const offsetU = alongU / cellMetres
    const offsetV = alongV / cellMetres
    const cx = Math.floor(offsetU)
    const cy = Math.floor(offsetV)
    const samples = pages.get(cx + ',' + cy)
    if (samples === undefined) return 0
    const gx = Math.min(Math.max(offsetU - cx, 0), 1) * PAGE_STEPS
    const gy = Math.min(Math.max(offsetV - cy, 0), 1) * PAGE_STEPS
    const i0 = Math.min(Math.floor(gx), PAGE_SIDE - 2)
    const j0 = Math.min(Math.floor(gy), PAGE_SIDE - 2)
    const tx = gx - i0
    const ty = gy - j0
    const s00 = samples[j0 * PAGE_SIDE + i0]
    const s10 = samples[j0 * PAGE_SIDE + i0 + 1]
    const s01 = samples[(j0 + 1) * PAGE_SIDE + i0]
    const s11 = samples[(j0 + 1) * PAGE_SIDE + i0 + 1]
    if (ty <= tx) return s00 + tx * (s10 - s00) + ty * (s11 - s10)
    return s00 + ty * (s01 - s00) + tx * (s11 - s01)
  }

  const altitudeOf = (position) => Math.hypot(position[0], position[1], position[2]) - planet.radius

  return { cellMetres, sampleMetres: cellMetres / PAGE_STEPS, pageCount: pages.size, direction, point, along, height, altitudeOf }
}
