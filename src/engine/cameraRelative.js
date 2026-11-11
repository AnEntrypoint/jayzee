export const RENDER_COLLISION_TOLERANCE_M = 1e-3
export const RENDER_COLLISION_RANGE_M = 4096

export const relativeLookAt = (eye, target, up, out) => {
  let fx = target[0] - eye[0]
  let fy = target[1] - eye[1]
  let fz = target[2] - eye[2]
  const fl = Math.hypot(fx, fy, fz)
  fx /= fl
  fy /= fl
  fz /= fl
  let sx = fy * up[2] - fz * up[1]
  let sy = fz * up[0] - fx * up[2]
  let sz = fx * up[1] - fy * up[0]
  const sl = Math.hypot(sx, sy, sz)
  sx /= sl
  sy /= sl
  sz /= sl
  const ux = sy * fz - sz * fy
  const uy = sz * fx - sx * fz
  const uz = sx * fy - sy * fx
  out[0] = sx
  out[4] = sy
  out[8] = sz
  out[12] = 0
  out[1] = ux
  out[5] = uy
  out[9] = uz
  out[13] = 0
  out[2] = -fx
  out[6] = -fy
  out[10] = -fz
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
