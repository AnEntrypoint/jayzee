export const FIRE_REQUEST_TYPE = 'fire'

const isVec3 = (v) => v !== null && typeof v === 'object' && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

export function createFireRequestWriter({ epochOf, viewTickOf }) {
  if (typeof epochOf !== 'function') throw new TypeError('createFireRequestWriter needs epochOf, a function returning the chart epoch the client simulates in')
  if (typeof viewTickOf !== 'function') throw new TypeError('createFireRequestWriter needs viewTickOf, a function returning the server tick the client is viewing')
  const message = { type: FIRE_REQUEST_TYPE, origin: [0, 0, 0], direction: [0, 0, 0], viewTick: 0, chartEpoch: 0 }
  const stats = { written: 0, heldNoEpoch: 0, refusedShape: 0 }
  return {
    stats,
    write(origin, direction) {
      if (!isVec3(origin) || !isVec3(direction)) { stats.refusedShape++; return null }
      if (direction[0] === 0 && direction[1] === 0 && direction[2] === 0) { stats.refusedShape++; return null }
      const epoch = epochOf()
      if (!Number.isInteger(epoch)) { stats.heldNoEpoch++; return null }
      const viewTick = viewTickOf()
      if (!Number.isFinite(viewTick)) { stats.refusedShape++; return null }
      message.origin[0] = origin[0]; message.origin[1] = origin[1]; message.origin[2] = origin[2]
      message.direction[0] = direction[0]; message.direction[1] = direction[1]; message.direction[2] = direction[2]
      message.viewTick = viewTick
      message.chartEpoch = epoch
      stats.written++
      return message
    },
  }
}
