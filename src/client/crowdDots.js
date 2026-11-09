import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'

export const CROWD_DOT_SIZE = 1.4
export const CROWD_DOT_LIFT = 0.05
const CROWD_SCALE_CAP = 3
const CROWD_SCALE_BASE = 0.6
const CROWD_SCALE_PER_ROOT = 0.35

export const crowdDotScale = (count, dotSize = CROWD_DOT_SIZE) =>
  dotSize * Math.min(CROWD_SCALE_CAP, CROWD_SCALE_BASE + Math.sqrt(count) * CROWD_SCALE_PER_ROOT)

const writeBucketPose = (pose, record, cellM, dotSize, viewerY, groundHeightFn) => {
  const x = (record[0] + 0.5) * cellM
  const z = (record[1] + 0.5) * cellM
  const y = groundHeightFn ? groundHeightFn(x, z) : viewerY
  pose.x = x
  pose.y = y + CROWD_DOT_LIFT
  pose.z = z
  pose.scale = crowdDotScale(record[2], dotSize)
  return pose
}

const writeFlatPose = (pose, record, dotSize, groundHeightFn) => {
  const y = groundHeightFn ? groundHeightFn(record.x, record.z) : record.y
  pose.x = record.x
  pose.y = y + CROWD_DOT_LIFT
  pose.z = record.z
  pose.scale = dotSize
  return pose
}

export const decodeCrowdDots = (dots, options = {}, out = []) => {
  if (!dots || dots.length === 0) {
    out.length = 0
    return out
  }
  const count = dots.length
  out.length = count
  const cellM = options.dotCellM || CROWD_DOT_CELL_M
  const dotSize = options.dotSize || CROWD_DOT_SIZE
  const { viewerY, groundHeightFn } = options
  const buckets = Array.isArray(dots[0])
  for (let i = 0; i < count; i++) {
    const pose = out[i] || (out[i] = { x: 0, y: 0, z: 0, scale: 0 })
    if (buckets) writeBucketPose(pose, dots[i], cellM, dotSize, viewerY, groundHeightFn)
    else writeFlatPose(pose, dots[i], dotSize, groundHeightFn)
  }
  return out
}
