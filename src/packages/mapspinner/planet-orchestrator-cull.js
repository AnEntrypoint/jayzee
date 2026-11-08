import { PLANET_RADIUS_M } from './planet-radius.js'
import { FACE_FRAME } from './anchor-field-bands.js'

export { FACE_FRAME }

export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const ATAN_INV_K = 4.0 / Math.PI
const FACE_COUNT = 6

export function worldToFaceLocal(face, camWorld, R) {
  const F = FACE_FRAME[face]
  const cu = dot(camWorld, F.u), cv = dot(camWorld, F.v), cc = dot(camWorld, F.c)
  const cameraInFrontOfFace = cc > 1.0
  if (cameraInFrontOfFace) {
    return [ATAN_INV_K * R * Math.atan(cu / cc), ATAN_INV_K * R * Math.atan(cv / cc), cc]
  }
  return [cu >= 0 ? R : -R, cv >= 0 ? R : -R, cc]
}

const CULL_MAX_ELEV = 500000.0
export const CULL_ELEV_FRAC = CULL_MAX_ELEV / PLANET_RADIUS_M
export const CULL_NDC_MARGIN = 0.06
const BEHIND_NEAR_W = 1e-6
const WARP_K = Math.PI / 4.0

export function quadOutsideFrustum(face, ox, oy, l, R, vpr, eye) {
  const F = FACE_FRAME[face]
  const ex = eye ? eye[0] : 0, ey = eye ? eye[1] : 0, ez = eye ? eye[2] : 0
  const hl = l * 0.5
  const wX0 = R * Math.tan((ox / R) * WARP_K), wX1 = R * Math.tan(((ox + hl) / R) * WARP_K), wX2 = R * Math.tan(((ox + l) / R) * WARP_K)
  const wY0 = R * Math.tan((oy / R) * WARP_K), wY1 = R * Math.tan(((oy + hl) / R) * WARP_K), wY2 = R * Math.tan(((oy + l) / R) * WARP_K)
  const radLo = R * (1.0 - CULL_ELEV_FRAC), radHi = R * (1.0 + CULL_ELEV_FRAC)
  const p0 = vpr[0], p1 = vpr[1], p2 = vpr[2], p3 = vpr[3], p4 = vpr[4], p5 = vpr[5], p6 = vpr[6], p7 = vpr[7]
  const p8 = vpr[8], p9 = vpr[9], p10 = vpr[10], p11 = vpr[11], p12 = vpr[12], p13 = vpr[13], p14 = vpr[14], p15 = vpr[15]
  const u0 = F.u[0], u1 = F.u[1], u2 = F.u[2], v0 = F.v[0], v1 = F.v[1], v2 = F.v[2], c0 = F.c[0], c1 = F.c[1], c2 = F.c[2]
  const LO = -1 - CULL_NDC_MARGIN, HI = 1 + CULL_NDC_MARGIN
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
  let anyFront = false, anyBehind = false, allBeyondFar = true
  for (let gx = 0; gx < 3; gx++) {
    const wpx = gx === 0 ? wX0 : gx === 1 ? wX1 : wX2
    for (let gy = 0; gy < 3; gy++) {
      const wpy = gy === 0 ? wY0 : gy === 1 ? wY1 : wY2
      const len = Math.hypot(wpx, wpy, R) || 1
      const ax = wpx / len, ay = wpy / len, az = R / len
      const dx = ax * u0 + ay * v0 + az * c0
      const dy = ax * u1 + ay * v1 + az * c1
      const dz = ax * u2 + ay * v2 + az * c2
      for (let s = 0; s < 2; s++) {
        const rad = s === 0 ? radLo : radHi
        const X = dx * rad - ex, Y = dy * rad - ey, Z = dz * rad - ez
        const cw = p3 * X + p7 * Y + p11 * Z + p15
        if (cw <= BEHIND_NEAR_W) {
          if (anyFront) return false
          anyBehind = true
          continue
        }
        if (anyBehind) return false
        anyFront = true
        const cz = p2 * X + p6 * Y + p10 * Z + p14
        if (cz <= cw) allBeyondFar = false
        const nx = (p0 * X + p4 * Y + p8 * Z + p12) / cw, ny = (p1 * X + p5 * Y + p9 * Z + p13) / cw
        if (nx < minX) minX = nx
        if (nx > maxX) maxX = nx
        if (ny < minY) minY = ny
        if (ny > maxY) maxY = ny
      }
      if (!allBeyondFar && maxX >= LO && minX <= HI && maxY >= LO && minY <= HI) return false
    }
  }
  if (!anyFront) return true
  if (anyBehind) return false
  if (allBeyondFar) return true
  return maxX < LO || minX > HI || maxY < LO || minY > HI
}

function setPlane(out, i, a, b, c, d) {
  const len = Math.hypot(a, b, c) || 1, o = i * 4
  out[o] = a / len
  out[o + 1] = b / len
  out[o + 2] = c / len
  out[o + 3] = d / len
}

export function extractFrustumPlanes(m, out) {
  const r0x = m[0], r0y = m[4], r0z = m[8], r0w = m[12]
  const r1x = m[1], r1y = m[5], r1z = m[9], r1w = m[13]
  const r2x = m[2], r2y = m[6], r2z = m[10], r2w = m[14]
  const r3x = m[3], r3y = m[7], r3z = m[11], r3w = m[15]
  const W = 1.0 + CULL_NDC_MARGIN
  setPlane(out, 0, W * r3x + r0x, W * r3y + r0y, W * r3z + r0z, W * r3w + r0w)
  setPlane(out, 1, W * r3x - r0x, W * r3y - r0y, W * r3z - r0z, W * r3w - r0w)
  setPlane(out, 2, W * r3x + r1x, W * r3y + r1y, W * r3z + r1z, W * r3w + r1w)
  setPlane(out, 3, W * r3x - r1x, W * r3y - r1y, W * r3z - r1z, W * r3w - r1w)
  setPlane(out, 4, r3x + r2x, r3y + r2y, r3z + r2z, r3w + r2w)
  setPlane(out, 5, r3x - r2x, r3y - r2y, r3z - r2z, r3w - r2w)
}

export function pickFace(camWorld) {
  const len = Math.hypot(camWorld[0], camWorld[1], camWorld[2]) || 1
  const dir = [camWorld[0] / len, camWorld[1] / len, camWorld[2] / len]
  let best = 0, bestDot = -Infinity
  for (let f = 0; f < FACE_COUNT; f++) {
    const d = dot(dir, FACE_FRAME[f].c)
    if (d > bestDot) { bestDot = d; best = f }
  }
  return best
}
