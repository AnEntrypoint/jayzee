import { addVec3, cross, fromAxisAngle, readQuat, readVec3, refusal, rotate } from './math.js'

const PIVOT = 'pivot'

export function pivotTransform({ position, pivot = [0, 0, 0], quaternion = [0, 0, 0, 1], scale = [1, 1, 1] } = {}) {
  readVec3(position, 'position')
  readVec3(pivot, 'pivot')
  readQuat(quaternion, 'quaternion')
  readVec3(scale, 'scale')
  const offset = [position[0] - pivot[0], position[1] - pivot[1], position[2] - pivot[2]]
  const scaled = [offset[0] * scale[0], offset[1] * scale[1], offset[2] * scale[2]]
  return addVec3(pivot, rotate(quaternion, scaled))
}

export function hingeAngle({ openFraction, minAngleRad = 0, maxAngleRad = Math.PI / 2, axis = [0, 1, 0] } = {}) {
  if (!Number.isFinite(openFraction) || openFraction < 0 || openFraction > 1) {
    throw refusal(PIVOT, 'pivot-open-invalid', 'openFraction must be a finite number in [0,1]')
  }
  if (!Number.isFinite(minAngleRad) || !Number.isFinite(maxAngleRad) || maxAngleRad < minAngleRad) {
    throw refusal(PIVOT, 'pivot-angle-invalid', 'angle bounds must be finite with max >= min')
  }
  const angleRad = minAngleRad + (maxAngleRad - minAngleRad) * openFraction
  return { angleRad, quaternion: fromAxisAngle(axis, angleRad) }
}

export function riderReleaseVelocity({ platformVelocity = [0, 0, 0], platformAngularVelocity = [0, 0, 0], riderOffset = [0, 0, 0] } = {}) {
  readVec3(platformVelocity, 'platformVelocity')
  readVec3(platformAngularVelocity, 'platformAngularVelocity')
  readVec3(riderOffset, 'riderOffset')
  return addVec3(platformVelocity, cross(platformAngularVelocity, riderOffset))
}
