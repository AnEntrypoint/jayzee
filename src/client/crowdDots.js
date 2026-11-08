import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'

export const CROWD_DOT_SIZE = 1.4
export const CROWD_DOT_LIFT = 0.05
const CROWD_SCALE_CAP = 3
const CROWD_SCALE_BASE = 0.6
const CROWD_SCALE_PER_ROOT = 0.35

export const crowdDotScale = (count, dotSize = CROWD_DOT_SIZE) =>
  dotSize * Math.min(CROWD_SCALE_CAP, CROWD_SCALE_BASE + Math.sqrt(count) * CROWD_SCALE_PER_ROOT)

const bucketPose = (record, cellM, dotSize, viewerY, groundHeightFn) => {
  const x = (record[0] + 0.5) * cellM
  const z = (record[1] + 0.5) * cellM
  const y = groundHeightFn ? groundHeightFn(x, z) : viewerY
  return { x, y: y + CROWD_DOT_LIFT, z, scale: crowdDotScale(record[2], dotSize) }
}

const flatPose = (record, dotSize, groundHeightFn) => {
  const y = groundHeightFn ? groundHeightFn(record.x, record.z) : record.y
  return { x: record.x, y: y + CROWD_DOT_LIFT, z: record.z, scale: dotSize }
}

export const decodeCrowdDots = (dots, options = {}) => {
  if (!dots || dots.length === 0) return []
  const cellM = options.dotCellM || CROWD_DOT_CELL_M
  const dotSize = options.dotSize || CROWD_DOT_SIZE
  const { viewerY, groundHeightFn } = options
  const buckets = Array.isArray(dots[0])
  return dots.map((record) => (buckets
    ? bucketPose(record, cellM, dotSize, viewerY, groundHeightFn)
    : flatPose(record, dotSize, groundHeightFn)))
}
