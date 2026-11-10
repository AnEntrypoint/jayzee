export const PHYSICS_REBASE_M = 1024

const distanceSquared = (a, b) => (a[0] - b[0]) * (a[0] - b[0]) + (a[1] - b[1]) * (a[1] - b[1]) + (a[2] - b[2]) * (a[2] - b[2])

export const rebaseDue = (origin, eye, limit = PHYSICS_REBASE_M) => distanceSquared(origin, eye) > limit * limit

export const bodyRelative = (absolute, origin, out) => {
  for (let k = 0; k < 3; k++) out[k] = Math.fround(absolute[k] - origin[k])
  return out
}

export const bodyAbsolute = (relative, origin, out) => {
  for (let k = 0; k < 3; k++) out[k] = origin[k] + relative[k]
  return out
}

export const rebaseBody = (relative, origin, eye, out) => {
  for (let k = 0; k < 3; k++) out[k] = Math.fround(relative[k] - (eye[k] - origin[k]))
  return out
}

export const rebaseCost = ({ bodies, liveSlots }) => ({
  positionWrites: bodies,
  positionBytes: bodies * 12,
  syncs: liveSlots,
  readbackBytes: liveSlots * (24 + 24 + 28),
})
