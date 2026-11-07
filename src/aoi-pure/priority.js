import { PRIORITY_DECAY, PRIORITY_ENTITY_BUDGET } from './constants.js'
import { primeEntryDecode } from './binRecord.js'

const BUCKET_FLOORS = [3, 2, 1]

const bucketIndexOf = (score) => {
  for (let i = 0; i < BUCKET_FLOORS.length; i++) {
    if (score >= BUCKET_FLOORS[i]) return i
  }
  return BUCKET_FLOORS.length
}

export function createPriorityScheduler() {
  const accumulators = new Map()
  const buckets = [[], [], [], []]

  const accumulatorFor = (playerId) => {
    let acc = accumulators.get(playerId)
    if (!acc) { acc = new Map(); accumulators.set(playerId, acc) }
    return acc
  }

  const accumulate = (acc, relevantIds, dynCache, viewerPos) => {
    const vx = viewerPos[0], vy = viewerPos[1], vz = viewerPos[2]
    for (const id of relevantIds) {
      const entry = dynCache.get(id)
      if (!entry) continue
      primeEntryDecode(entry)
      const dx = entry._pX - vx, dy = entry._pY - vy, dz = entry._pZ - vz
      const distSq = dx * dx + dy * dy + dz * dz
      const distScore = 1 / (1 + distSq * 0.001)
      let box = acc.get(id)
      if (box === undefined) { box = { s: 0 }; acc.set(id, box) }
      box.s += distScore + entry._pVelScore + PRIORITY_DECAY
    }
    for (const id of acc.keys()) {
      if (!dynCache.has(id)) acc.delete(id)
    }
  }

  const topScoredIds = (acc) => {
    for (const bucket of buckets) bucket.length = 0
    for (const [id, box] of acc) buckets[bucketIndexOf(box.s)].push(id)
    const topIds = new Set()
    let remaining = PRIORITY_ENTITY_BUDGET
    for (const bucket of buckets) {
      for (const id of bucket) {
        if (remaining-- <= 0) break
        topIds.add(id)
        acc.get(id).s = 0
      }
      if (remaining <= 0) break
    }
    return topIds
  }

  return {
    clearPlayer(playerId) { accumulators.delete(playerId) },
    scoreOf(playerId, id) { return accumulators.get(playerId)?.get(id)?.s },
    priorityIds(playerId, relevantIds, dynCache, viewerPos) {
      const acc = accumulatorFor(playerId)
      accumulate(acc, relevantIds, dynCache, viewerPos)
      if (acc.size <= PRIORITY_ENTITY_BUDGET) return relevantIds
      return topScoredIds(acc)
    },
  }
}
