export const PAGE_SIDE = 16
export const PAGE_SPAN = 20

const PAGE_STEPS = PAGE_SIDE - 1

export const PAGE_U_EDGE = Object.freeze([PAGE_SPAN, 0, 0])
export const PAGE_V_EDGE = Object.freeze([0, 0, -PAGE_SPAN])

export const planetCellSize = (radius) => {
  if (!(radius > 0)) throw new RangeError('planet radius must be positive: ' + radius)
  return radius / Math.round((radius * Math.PI) / (4 * PAGE_SPAN))
}

export const cellOrigin = (dx, dy) => [dx * PAGE_SPAN, 0, (0 - dy) * PAGE_SPAN]

export const sampleOffset = (col, row) => [
  (col / PAGE_STEPS) * PAGE_SPAN,
  0,
  (0 - row / PAGE_STEPS) * PAGE_SPAN,
]
