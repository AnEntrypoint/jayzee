import { PLANET_RADIUS_M } from './planet-radius.js'
import { LOD_DEFAULTS } from './lod-defaults.js'

const TAN_40DEG = Math.tan(40.0 / 180.0 * Math.PI)
const QUADTREE_DEFAULT_SIZE = PLANET_RADIUS_M
const QUADTREE_LEVEL_CEILING = 32
const MIN_SPLIT_DIST = 1.1
const SPLIT_DIST_VIEWPORT_REFERENCE = 1024.0
const DEFAULT_FAR_COARSEN_FLOOR = 0.6
const FAR_COARSEN_FLOOR_RANGE = [0.30, 0.60]
const FAR_COARSEN_LOG_SLOPE = 0.05
const ALTITUDE_LOG_REFERENCE_M = 5000.0
const NEAR_PROTECT_MIN_M = 10000.0
const DEFAULT_NEAR_LEAF_FLOOR_SPAN = 2.0
const CULL_LEVEL_THRESHOLD = 2
const FACE_ANGLE_SCALE = Math.PI / 4.0

function positiveFinite(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new RangeError(`Quadtree: ${name} must be a positive finite number, got ${value}: a zero, negative or non-finite ${name} makes every split test unrepresentable, so the tree collapses to one leaf and the whole planet renders as a single patch, which must fail here and never reach updateQuadtree`)
  }
  return value
}

function levelCount(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > QUADTREE_LEVEL_CEILING) {
    throw new RangeError(`Quadtree: ${name} must be a finite number in 0..${QUADTREE_LEVEL_CEILING}, got ${value}: any other value disables subdivision silently, so the whole planet renders as a single patch`)
  }
  return value
}

function positiveFiniteOr(value, fallback) {
  return (typeof value === 'number' && isFinite(value) && value > 0) ? value : fallback
}

function nonNegativeFiniteOr(value, fallback) {
  return (typeof value === 'number' && isFinite(value) && value >= 0) ? value : fallback
}

function nodeOutsideFrustum(cull, ox, oy, l) {
  const R = cull.R
  const maxElev = cull.maxElev
  const ux = cull.ux, uy = cull.uy, uz = cull.uz
  const vx = cull.vx, vy = cull.vy, vz = cull.vz
  const cx = cull.cx, cy = cull.cy, cz = cull.cz
  const outerRadius = R + maxElev
  const edgeX0 = R * Math.tan((ox / R) * FACE_ANGLE_SCALE)
  const edgeX1 = R * Math.tan(((ox + l) / R) * FACE_ANGLE_SCALE)
  const edgeY0 = R * Math.tan((oy / R) * FACE_ANGLE_SCALE)
  const edgeY1 = R * Math.tan(((oy + l) / R) * FACE_ANGLE_SCALE)
  const centreX = R * Math.tan(((ox + l * 0.5) / R) * FACE_ANGLE_SCALE)
  const centreY = R * Math.tan(((oy + l * 0.5) / R) * FACE_ANGLE_SCALE)
  let ax = centreX * ux + centreY * vx + R * cx
  let ay = centreX * uy + centreY * vy + R * cy
  let az = centreX * uz + centreY * vz + R * cz
  let len = Math.sqrt(ax * ax + ay * ay + az * az) || 1
  const centreOnSphereX = (ax / len) * R
  const centreOnSphereY = (ay / len) * R
  const centreOnSphereZ = (az / len) * R
  let maxRadiusSq = 0
  for (let corner = 0; corner < 4; corner++) {
    const wx = (corner & 1) ? edgeX1 : edgeX0
    const wy = (corner & 2) ? edgeY1 : edgeY0
    ax = wx * ux + wy * vx + R * cx
    ay = wx * uy + wy * vy + R * cy
    az = wx * uz + wy * vz + R * cz
    len = Math.sqrt(ax * ax + ay * ay + az * az) || 1
    const dx = (ax / len) * outerRadius - centreOnSphereX
    const dy = (ay / len) * outerRadius - centreOnSphereY
    const dz = (az / len) * outerRadius - centreOnSphereZ
    const distSq = dx * dx + dy * dy + dz * dz
    if (distSq > maxRadiusSq) maxRadiusSq = distSq
  }
  const bound = Math.sqrt(maxRadiusSq) + maxElev
  const Cx = centreOnSphereX - cull.ex
  const Cy = centreOnSphereY - cull.ey
  const Cz = centreOnSphereZ - cull.ez
  const P = cull.planes
  const nearSignedDistance = P[16] * Cx + P[17] * Cy + P[18] * Cz + P[19]
  if (nearSignedDistance <= -bound) return true
  if (nearSignedDistance < bound) return false
  if (P[0] * Cx + P[1] * Cy + P[2] * Cz + P[3] < -bound) return true
  if (P[4] * Cx + P[5] * Cy + P[6] * Cz + P[7] < -bound) return true
  if (P[8] * Cx + P[9] * Cy + P[10] * Cz + P[11] < -bound) return true
  if (P[12] * Cx + P[13] * Cy + P[14] * Cz + P[15] < -bound) return true
  if (P[20] * Cx + P[21] * Cy + P[22] * Cz + P[23] < -bound) return true
  return false
}

export class Quadtree {
  constructor(size) {
    this.size = positiveFinite('size', size ?? QUADTREE_DEFAULT_SIZE)
    this.maxLevel = levelCount('maxLevel', LOD_DEFAULTS.maxLevel)
    this.splitDist = MIN_SPLIT_DIST
    this.distFactor = 2.0
    this._cam = [0, 0, 0]
    this._camAlt = 0.0
    this._nadir = [0, 0]
    this._aim = null
    this._aimArr = [0, 0]
    this._leaves = []
    this._n = 0
    this._cull = null
    this._altitudeDistTerm = 0.0
    this._nearProtectRadius = 0.0
    this._farCoarsenFloor = DEFAULT_FAR_COARSEN_FLOOR
    this._nearLeafFloor = 0.0
    this._nearLeafFloorSpan = DEFAULT_NEAR_LEAF_FLOOR_SPAN
    this._nearFloorInnerSpan = 0.0
    this._nearFloorClearance = null
  }

  setNearFieldLeafFloor(leafM, spanLeaves = 1.0, groundClearanceM = null, innerSpanLeaves = 0.0) {
    this._nearLeafFloor = positiveFiniteOr(leafM, 0.0)
    this._nearLeafFloorSpan = positiveFiniteOr(spanLeaves, DEFAULT_NEAR_LEAF_FLOOR_SPAN)
    this._nearFloorInnerSpan = positiveFiniteOr(innerSpanLeaves, 0.0)
    this._nearFloorClearance = (typeof groundClearanceM === 'number' && isFinite(groundClearanceM) && groundClearanceM >= 0) ? groundClearanceM : null
    return this._nearLeafFloor
  }

  get nearLeafFloor() { return this._nearLeafFloor }

  setConfig(size, maxLevel, distFactor) {
    this.size = positiveFinite('size', size ?? QUADTREE_DEFAULT_SIZE)
    this.maxLevel = levelCount('maxLevel', maxLevel)
    this.distFactor = positiveFinite('distFactor', distFactor)
  }

  get nearProtectRadius() { return this._nearProtectRadius }

  get farCoarsenFloor() { return this._farCoarsenFloor }

  computeSplitDist(splitFactor, viewportH, fovRad) {
    let splitDist = splitFactor * viewportH / SPLIT_DIST_VIEWPORT_REFERENCE * TAN_40DEG / Math.tan(fovRad / 2.0)
    if (!(splitDist >= MIN_SPLIT_DIST) || !isFinite(splitDist)) splitDist = MIN_SPLIT_DIST
    this.splitDist = splitDist
    return splitDist
  }

  _cameraDist(ox, oy, l) {
    const altitudeTerm = this._altitudeDistTerm
    const dx = Math.min(Math.abs(this._cam[0] - ox), Math.abs(this._cam[0] - (ox + l)))
    const dy = Math.min(Math.abs(this._cam[1] - oy), Math.abs(this._cam[1] - (oy + l)))
    return Math.max(altitudeTerm, Math.max(dx, dy))
  }

  _nearFloorForces(level, ox, oy, l) {
    const nearFloor = this._nearLeafFloor
    if (!(nearFloor > 0.0 && l > nearFloor && level < QUADTREE_LEVEL_CEILING)) return false
    const cx = this._cam[0], cy = this._cam[1]
    const gapX = Math.max(ox - cx, 0.0, cx - (ox + l))
    const gapY = Math.max(oy - cy, 0.0, cy - (oy + l))
    const farX = Math.max(Math.abs(cx - ox), Math.abs(cx - (ox + l)))
    const farY = Math.max(Math.abs(cy - oy), Math.abs(cy - (oy + l)))
    const altitudeTerm = this._nearFloorClearance === null
      ? this._altitudeDistTerm
      : Math.max(this._nearFloorClearance / this.distFactor, 0.0)
    const nearGap = Math.max(altitudeTerm, gapX, gapY)
    const farGap = Math.max(altitudeTerm, farX, farY)
    return nearGap <= nearFloor * this._nearLeafFloorSpan && farGap > nearFloor * this._nearFloorInnerSpan
  }

  _recurse(level, tx, ty, ox, oy, l) {
    if (this._cull !== null && level >= CULL_LEVEL_THRESHOLD && nodeOutsideFrustum(this._cull, ox, oy, l)) return
    const dist = this._cameraDist(ox, oy, l)
    const nadirX = Math.max(ox, Math.min(this._nadir[0], ox + l))
    const nadirY = Math.max(oy, Math.min(this._nadir[1], oy + l))
    let latC = Math.max(Math.abs(this._nadir[0] - nadirX), Math.abs(this._nadir[1] - nadirY))
    if (this._aim !== null) {
      const aimX = Math.max(ox, Math.min(this._aim[0], ox + l))
      const aimY = Math.max(oy, Math.min(this._aim[1], oy + l))
      const latA = Math.max(Math.abs(this._aim[0] - aimX), Math.abs(this._aim[1] - aimY))
      if (latA < latC) latC = latA
    }
    const near = this._nearProtectRadius
    const fall = 1.0 / (1.0 + Math.max(0.0, latC - near) / near)
    const effSplit = this.splitDist * Math.max(this._farCoarsenFloor, fall)
    const forced = this._nearFloorForces(level, ox, oy, l)
    if ((dist < l * effSplit && level < this.maxLevel) || forced) {
      const hl = l / 2.0
      this._recurse(level + 1, 2 * tx, 2 * ty, ox, oy, hl)
      this._recurse(level + 1, 2 * tx + 1, 2 * ty, ox + hl, oy, hl)
      this._recurse(level + 1, 2 * tx, 2 * ty + 1, ox, oy + hl, hl)
      this._recurse(level + 1, 2 * tx + 1, 2 * ty + 1, ox + hl, oy + hl, hl)
    } else {
      const i = this._n++
      let leaf = this._leaves[i]
      if (leaf === undefined) leaf = this._leaves[i] = { level: 0, tx: 0, ty: 0, ox: 0, oy: 0, l: 0 }
      leaf.level = level; leaf.tx = tx; leaf.ty = ty; leaf.ox = ox; leaf.oy = oy; leaf.l = l
    }
  }

  updateQuadtree(camX, camY, camZ, nadirX, nadirY, aimX, aimY, camAlt, cull) {
    this._cam[0] = camX; this._cam[1] = camY; this._cam[2] = camZ
    this._camAlt = (camAlt !== undefined && camAlt !== null)
      ? camAlt
      : Math.sqrt(camX * camX + camY * camY + camZ * camZ) - this.size
    this._nadir[0] = (nadirX !== undefined) ? nadirX : camX
    this._nadir[1] = (nadirY !== undefined) ? nadirY : camY
    if (aimX !== undefined && aimY !== undefined) {
      this._aimArr[0] = aimX; this._aimArr[1] = aimY; this._aim = this._aimArr
    } else {
      this._aim = null
    }
    this._n = 0
    this._cull = (cull != null) ? cull : null
    this._altitudeDistTerm = Math.max(this._camAlt / this.distFactor, 0.0)
    const horizon = Math.sqrt(2.0 * this.size * Math.max(this._camAlt, 0.0))
    this._nearProtectRadius = Math.max(this._camAlt * 2.0, horizon * 0.2, NEAR_PROTECT_MIN_M * (this.size / QUADTREE_DEFAULT_SIZE))
    const altitudeLog = Math.log2(Math.max(this._camAlt, ALTITUDE_LOG_REFERENCE_M) / ALTITUDE_LOG_REFERENCE_M)
    this._farCoarsenFloor = Math.max(FAR_COARSEN_FLOOR_RANGE[0], Math.min(FAR_COARSEN_FLOOR_RANGE[1], DEFAULT_FAR_COARSEN_FLOOR - altitudeLog * FAR_COARSEN_LOG_SLOPE))
    this._recurse(0, 0, 0, -this.size, -this.size, 2.0 * this.size)
    this._leaves.length = this._n
    return this._leaves
  }
}

export function localToDeformed(x, y, z, R) {
  const wx = R * Math.tan((x / R) * FACE_ANGLE_SCALE)
  const wy = R * Math.tan((y / R) * FACE_ANGLE_SCALE)
  const inv = (z + R) / Math.sqrt(wx * wx + wy * wy + R * R)
  return [wx * inv, wy * inv, R * inv]
}

export function groundPerFaceMetre(u, v, R, halfSpanM = 0) {
  const step = Math.max(1e-6, R * 1e-4)
  const halfSpan = (typeof halfSpanM === 'number' && isFinite(halfSpanM) && halfSpanM > 0) ? halfSpanM : 0
  let worst = 0
  for (let su = -1; su <= 1; su++) {
    for (let sv = -1; sv <= 1; sv++) {
      const cu = u + su * halfSpan, cv = v + sv * halfSpan
      const origin = localToDeformed(cu, cv, 0, R)
      for (let axis = 0; axis < 2; axis++) {
        const next = localToDeformed(cu + (axis ? 0 : step), cv + (axis ? step : 0), 0, R)
        const metric = Math.hypot(next[0] - origin[0], next[1] - origin[1], next[2] - origin[2]) / step
        if (metric > worst) worst = metric
      }
    }
  }
  return worst > 0 ? worst : 1
}
