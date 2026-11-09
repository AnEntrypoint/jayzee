import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'

export const CROWD_DOT_SIZE = 1.4
export const CROWD_DOT_LIFT = 0.05
export const CROWD_POSE_STRIDE = 4
const CROWD_SCALE_CAP = 3
const CROWD_SCALE_BASE = 0.6
const CROWD_SCALE_PER_ROOT = 0.35
const SCRATCH_DOTS = 512

export const crowdDotScale = (count, dotSize = CROWD_DOT_SIZE) =>
  dotSize * Math.min(CROWD_SCALE_CAP, CROWD_SCALE_BASE + Math.sqrt(count) * CROWD_SCALE_PER_ROOT)

export const crowdPoseBuffer = (dotCapacity) => new Float64Array(dotCapacity * CROWD_POSE_STRIDE)

export const crowdPoseBufferFor = (poses, dotCount) =>
  poses.length >= dotCount * CROWD_POSE_STRIDE ? poses : crowdPoseBuffer(Math.max(dotCount, (poses.length / CROWD_POSE_STRIDE) * 2))

const writeBucketPose = (poses, at, record, cellM, dotSize, viewerY, groundHeightFn) => {
  const x = (record[0] + 0.5) * cellM
  const z = (record[1] + 0.5) * cellM
  const y = groundHeightFn ? groundHeightFn(x, z) : viewerY
  poses[at] = x
  poses[at + 1] = y + CROWD_DOT_LIFT
  poses[at + 2] = z
  poses[at + 3] = crowdDotScale(record[2], dotSize)
}

const writeFlatPose = (poses, at, record, dotSize, groundHeightFn) => {
  const y = groundHeightFn ? groundHeightFn(record.x, record.z) : record.y
  poses[at] = record.x
  poses[at + 1] = y + CROWD_DOT_LIFT
  poses[at + 2] = record.z
  poses[at + 3] = dotSize
}

export const decodeCrowdDotPoses = (dots, options, poses) => {
  if (!dots || dots.length === 0) return 0
  const count = dots.length
  if (!(poses instanceof Float64Array)) throw new TypeError('poses must be a Float64Array from crowdPoseBuffer')
  if (poses.length < count * CROWD_POSE_STRIDE) throw new RangeError('poses holds ' + poses.length / CROWD_POSE_STRIDE + ' dots, below the ' + count + ' given')
  const cellM = options.dotCellM || CROWD_DOT_CELL_M
  const dotSize = options.dotSize || CROWD_DOT_SIZE
  const viewerY = options.viewerY
  const groundHeightFn = options.groundHeightFn
  const buckets = Array.isArray(dots[0])
  for (let i = 0; i < count; i++) {
    if (buckets) writeBucketPose(poses, i * CROWD_POSE_STRIDE, dots[i], cellM, dotSize, viewerY, groundHeightFn)
    else writeFlatPose(poses, i * CROWD_POSE_STRIDE, dots[i], dotSize, groundHeightFn)
  }
  return count
}

let scratch = crowdPoseBuffer(SCRATCH_DOTS)

export const decodeCrowdDots = (dots, options = {}, out = []) => {
  const wanted = dots ? dots.length : 0
  scratch = crowdPoseBufferFor(scratch, wanted)
  const count = decodeCrowdDotPoses(dots, options, scratch)
  out.length = count
  for (let i = 0; i < count; i++) {
    const at = i * CROWD_POSE_STRIDE
    const pose = out[i] || (out[i] = { x: 0, y: 0, z: 0, scale: 0 })
    pose.x = scratch[at]
    pose.y = scratch[at + 1]
    pose.z = scratch[at + 2]
    pose.scale = scratch[at + 3]
  }
  return out
}
