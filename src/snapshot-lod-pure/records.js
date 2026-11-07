import { decodeSmallestThree, encodeSmallestThree, POSITION_UNITS_LIMIT, quantize } from '../wire/index.js'

export const PLAYER_TIER_FULL = 0
export const PLAYER_TIER_REDUCED = 1

export const packQuat = (rx, ry, rz, rw) => encodeSmallestThree([rx, ry, rz, rw])

export const unpackQuat = (packed, out) => {
  const components = decodeSmallestThree(packed)
  for (let i = 0; i < 4; i++) out[i] = components[i]
  return out
}

export const packReducedPlayerPose = (id, x, z, yawN) => [
  id,
  quantize('position[0]', x, -POSITION_UNITS_LIMIT, POSITION_UNITS_LIMIT),
  quantize('position[2]', z, -POSITION_UNITS_LIMIT, POSITION_UNITS_LIMIT),
  yawN,
  PLAYER_TIER_REDUCED
]
