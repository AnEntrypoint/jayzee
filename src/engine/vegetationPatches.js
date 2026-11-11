import { FACE_FRAME } from '../terrain-pure/cubeSphereCells.js'
import { PLANET_RADIUS_M } from './sphere.js'
import { capAreaKm2 } from './population.js'

export const PATCH_FACES = 6
export const MAX_PATCH_LEVEL = 25
const FACE_ANGLE = Math.PI / 4
const CORNERS = Object.freeze([0, 0, 1, 0, 0, 1, 1, 1])

const levelOffset = (level) => (4 ** level - 1) / 3
export const PATCH_IDS_PER_FACE = levelOffset(MAX_PATCH_LEVEL + 1)

const whole = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new RangeError(name + ' must be a whole number in ' + min + '..' + max + ', not ' + value)
}

export const leafPatchId = (face, level, tx, ty) => {
  whole(face, 'face', 0, PATCH_FACES - 1)
  whole(level, 'level', 0, MAX_PATCH_LEVEL)
  const side = 2 ** level
  whole(tx, 'tx', 0, side - 1)
  whole(ty, 'ty', 0, side - 1)
  return face * PATCH_IDS_PER_FACE + levelOffset(level) + ty * side + tx
}

export const patchLeaf = (id, out = { face: 0, level: 0, tx: 0, ty: 0 }) => {
  whole(id, 'patch id', 0, PATCH_FACES * PATCH_IDS_PER_FACE - 1)
  const face = Math.floor(id / PATCH_IDS_PER_FACE)
  const inFace = id - face * PATCH_IDS_PER_FACE
  let level = 0
  while (level < MAX_PATCH_LEVEL && levelOffset(level + 1) <= inFace) level += 1
  const side = 2 ** level
  const cell = inFace - levelOffset(level)
  const ty = Math.floor(cell / side)
  out.face = face
  out.level = level
  out.tx = cell - ty * side
  out.ty = ty
  return out
}

const direction = (face, level, cellU, cellV, out) => {
  const side = 2 ** level
  const wu = Math.tan(((cellU / side) * 2 - 1) * FACE_ANGLE)
  const wv = Math.tan(((cellV / side) * 2 - 1) * FACE_ANGLE)
  const F = FACE_FRAME[face]
  const x = F.c[0] + wu * F.u[0] + wv * F.v[0]
  const y = F.c[1] + wu * F.u[1] + wv * F.v[1]
  const z = F.c[2] + wu * F.u[2] + wv * F.v[2]
  const len = Math.sqrt(x * x + y * y + z * z)
  out[0] = x / len
  out[1] = y / len
  out[2] = z / len
  return out
}

export const createLeafPatchCentre = () => {
  const leaf = { face: 0, level: 0, tx: 0, ty: 0 }
  const centre = new Float64Array(3)
  const corner = new Float64Array(3)
  return (id, out = { latRad: 0, lonRad: 0, capRad: 0 }) => {
    patchLeaf(id, leaf)
    direction(leaf.face, leaf.level, leaf.tx + 0.5, leaf.ty + 0.5, centre)
    let widest = 0
    for (let k = 0; k < 4; k++) {
      direction(leaf.face, leaf.level, leaf.tx + CORNERS[k * 2], leaf.ty + CORNERS[k * 2 + 1], corner)
      const cx = centre[1] * corner[2] - centre[2] * corner[1]
      const cy = centre[2] * corner[0] - centre[0] * corner[2]
      const cz = centre[0] * corner[1] - centre[1] * corner[0]
      const angle = Math.atan2(Math.sqrt(cx * cx + cy * cy + cz * cz), centre[0] * corner[0] + centre[1] * corner[1] + centre[2] * corner[2])
      if (angle > widest) widest = angle
    }
    out.latRad = Math.asin(Math.max(-1, Math.min(1, centre[1])))
    out.lonRad = Math.atan2(centre[0], centre[2])
    out.capRad = widest
    return out
  }
}

export const leafPatchDirection = (id, out = [0, 0, 0]) => {
  const leaf = patchLeaf(id)
  return direction(leaf.face, leaf.level, leaf.tx + 0.5, leaf.ty + 0.5, out)
}

export const vegetationLevelFor = ({ capacityPerPatch, densityPerKm2, radiusM = PLANET_RADIUS_M }) => {
  whole(capacityPerPatch, 'capacityPerPatch', 1, Number.MAX_SAFE_INTEGER)
  if (!(densityPerKm2 > 0) || !Number.isFinite(densityPerKm2)) throw new RangeError('densityPerKm2 must be a positive finite number')
  const centreOf = createLeafPatchCentre()
  const probe = { latRad: 0, lonRad: 0, capRad: 0 }
  for (let level = 1; level <= MAX_PATCH_LEVEL; level++) {
    const middle = 2 ** (level - 1)
    centreOf(leafPatchId(0, level, middle, middle), probe)
    if (Math.round(densityPerKm2 * capAreaKm2(probe.capRad, radiusM)) <= capacityPerPatch) return level
  }
  throw new RangeError('no patch level up to ' + MAX_PATCH_LEVEL + ' holds ' + densityPerKm2 + ' per km2 within ' + capacityPerPatch + ' instances')
}

export const leafPatchIds = (face, leaves, level, out) => {
  whole(face, 'face', 0, PATCH_FACES - 1)
  whole(level, 'level', 0, MAX_PATCH_LEVEL)
  const base = face * PATCH_IDS_PER_FACE + levelOffset(level)
  const side = 2 ** level
  let count = 0
  let previous = -1
  for (let k = 0; k < leaves.length; k++) {
    const leaf = leaves[k]
    if (leaf.level < level) continue
    const shrink = 2 ** (leaf.level - level)
    const id = base + Math.floor(leaf.ty / shrink) * side + Math.floor(leaf.tx / shrink)
    if (id === previous) continue
    previous = id
    out[count] = id
    count += 1
  }
  return count
}
