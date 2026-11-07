import { addVec3, cross, readQuat, readVec3, rotate } from './math.js'

export function beltVelocity({ surfaceVelocity = [0, 0, 0], surfaceQuaternion = [0, 0, 0, 1], contactPoint = [0, 0, 0], angularVelocity = [0, 0, 0] } = {}) {
  readVec3(surfaceVelocity, 'surfaceVelocity')
  readQuat(surfaceQuaternion, 'surfaceQuaternion')
  readVec3(contactPoint, 'contactPoint')
  readVec3(angularVelocity, 'angularVelocity')
  const linear = rotate(surfaceQuaternion, surfaceVelocity)
  return addVec3(linear, cross(angularVelocity, contactPoint))
}

export function surfaceVelocityAt({ surfaceVelocity = [0, 0, 0], surfaceQuaternion = [0, 0, 0, 1], contactPoint = [0, 0, 0], angularVelocity = [0, 0, 0], relativeVelocity = [0, 0, 0] } = {}) {
  const belt = beltVelocity({ surfaceVelocity, surfaceQuaternion, contactPoint, angularVelocity })
  readVec3(relativeVelocity, 'relativeVelocity')
  return {
    belt,
    slip: [relativeVelocity[0] - belt[0], relativeVelocity[1] - belt[1], relativeVelocity[2] - belt[2]],
  }
}
