export const RENDER_COLLISION_TOLERANCE_M = 1e-3
export const RENDER_COLLISION_RANGE_M = 4096

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
const normalise = (v) => {
  const len = Math.hypot(v[0], v[1], v[2])
  return [v[0] / len, v[1] / len, v[2] / len]
}

export const relativeLookAt = (eye, target, up, out) => {
  const f = normalise([target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]])
  const s = normalise(cross(f, up))
  const u = cross(s, f)
  out[0] = s[0]
  out[4] = s[1]
  out[8] = s[2]
  out[12] = 0
  out[1] = u[0]
  out[5] = u[1]
  out[9] = u[2]
  out[13] = 0
  out[2] = -f[0]
  out[6] = -f[1]
  out[10] = -f[2]
  out[14] = 0
  out[3] = 0
  out[7] = 0
  out[11] = 0
  out[15] = 1
  return out
}

export const relativeOf = (absolute, frameOrigin, out) => {
  out[0] = Math.fround(absolute[0] - frameOrigin[0])
  out[1] = Math.fround(absolute[1] - frameOrigin[1])
  out[2] = Math.fround(absolute[2] - frameOrigin[2])
  return out
}

export const renderedPosition = (origin, frameOrigin, transform, rel, out) => {
  relativeOf(origin, frameOrigin, rel)
  for (let k = 0; k < 3; k++) out[k] = frameOrigin[k] + Math.fround(rel[k] + transform[k])
  return out
}

export const absolutePosition = (origin, transform, out) => {
  for (let k = 0; k < 3; k++) out[k] = Math.fround(Math.fround(origin[k]) + transform[k])
  return out
}

export const maxAbsDifference = (a, b) => Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]))
