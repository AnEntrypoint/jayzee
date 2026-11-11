const FREE_HEADER = 1

export const poseRegionBuffers = ({ slots, poseBytes }) => {
  if (!Number.isInteger(slots) || slots < 1) throw new RangeError('slots must be a whole number at least 1')
  if (!Number.isInteger(poseBytes) || poseBytes < 1) throw new RangeError('poseBytes must be a whole number at least 1')
  return {
    slots,
    poseBytes,
    poses: new SharedArrayBuffer(slots * poseBytes),
    state: new SharedArrayBuffer((slots * 2 + FREE_HEADER) * Int32Array.BYTES_PER_ELEMENT),
  }
}

export const attachPoseRegion = (buffers, { owner = false } = {}) => {
  const { slots, poseBytes } = buffers
  const poses = new Uint8Array(buffers.poses)
  const views = Array.from({ length: slots }, (_, k) => poses.subarray(k * poseBytes, (k + 1) * poseBytes))
  const state = new Int32Array(buffers.state)
  const frames = state.subarray(0, slots)
  const free = state.subarray(slots, slots * 2)
  const count = state.subarray(slots * 2, slots * 2 + FREE_HEADER)
  if (owner) {
    for (let k = 0; k < slots; k++) free[k] = slots - 1 - k
    count[0] = slots
  }
  return {
    slots,
    poseBytes,
    view: (slot) => views[slot],
    frameOf: (slot) => frames[slot],
    setFrame: (slot, frame) => {
      frames[slot] = frame
    },
    acquire: () => {
      if (count[0] === 0) return -1
      count[0] -= 1
      return free[count[0]]
    },
    release: (slot) => {
      free[count[0]] = slot
      count[0] += 1
    },
    freeCount: () => count[0],
  }
}
