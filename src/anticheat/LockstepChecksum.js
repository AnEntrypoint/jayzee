import { FNV1A_32_OFFSET_BASIS, FNV1A_32_PRIME, fnv1aStepFloat64 } from '../shared/fnv1a.js'

const SECOND_LANE_SEED = FNV1A_32_PRIME
const SECOND_LANE_BYTE_OFFSET = 1

const canonicalFloat64 = (n) => (n === 0 ? 0 : n)

export function createChecksumFold() {
  let laneA = FNV1A_32_OFFSET_BASIS
  let laneB = SECOND_LANE_SEED
  const fold = (n) => {
    const canonical = canonicalFloat64(n)
    laneA = fnv1aStepFloat64(laneA, canonical)
    laneB = fnv1aStepFloat64(laneB, canonical, SECOND_LANE_BYTE_OFFSET)
  }
  return {
    push(n) {
      fold(n)
      return this
    },
    pushInt(n) {
      fold(n | 0)
      return this
    },
    digest() {
      return (laneA >>> 0).toString(16).padStart(8, '0') + (laneB >>> 0).toString(16).padStart(8, '0')
    },
  }
}

export function checksumBodies(tick, snap) {
  const fold = createChecksumFold().pushInt(tick)
  const ids = snap instanceof Map ? [...snap.keys()] : Object.keys(snap).map(Number)
  ids.sort((x, y) => x - y)
  for (const id of ids) {
    const body = snap instanceof Map ? snap.get(id) : snap[id]
    fold.pushInt(id)
    for (const v of body.position) fold.push(v)
    for (const v of body.rotation) fold.push(v)
    for (const v of body.velocity) fold.push(v)
    for (const v of body.angularVelocity) fold.push(v)
  }
  return fold.digest()
}
