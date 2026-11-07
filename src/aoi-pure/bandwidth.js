import { unpackBinRecord } from './binRecord.js'
import {
  BANDWIDTH_BUDGET_BYTES_PER_TICK,
  BANDWIDTH_TRIM_MAX_ITERATIONS,
  BANDWIDTH_TRIM_MIN_ENTITIES,
  BIN_POSITION_MIN_BYTES,
  RECORD_FRAMING_BYTES_ESTIMATE,
} from './constants.js'

const byFarthestFirst = (a, b) => b.d2 - a.d2
const trimScratch = {}

const cachedCustomBytes = (entry, src, custom) => {
  if (entry._custBytesV !== src._customV) {
    let len
    try { len = JSON.stringify(custom).length } catch (_) { len = 16 }
    entry._custBytes = len
    entry._custBytesV = src._customV
  }
  return entry._custBytes
}

const jsonBytes = (value) => {
  try { return JSON.stringify(value).length } catch (_) { return 16 }
}

export function estimateEntityBytes(enc, dynCache) {
  let n = RECORD_FRAMING_BYTES_ESTIMATE
  for (let i = 1; i < enc.length; i++) {
    const f = enc[i]
    if (f == null) continue
    if (f instanceof Uint8Array) n += f.byteLength
    else if (typeof f === 'string') n += f.length + 1
    else if (typeof f === 'number') n += 2
    else if (typeof f === 'object') {
      const entry = dynCache ? dynCache.get(enc[0]) : undefined
      const src = entry ? entry.srcEntity : null
      if (src && f === src.custom && typeof src._customV === 'number') n += cachedCustomBytes(entry, src, f)
      else n += jsonBytes(f)
    }
    else n += 1
  }
  return n
}

const positionBinOf = (enc) => (enc.length > 2 && enc[2] instanceof Uint8Array && enc[2].byteLength >= BIN_POSITION_MIN_BYTES ? enc[2] : null)

const squaredDistanceTo = (enc, viewerPos) => {
  const bin = positionBinOf(enc)
  if (!bin) return Infinity
  unpackBinRecord(bin, trimScratch)
  const dx = trimScratch.px - viewerPos[0], dy = trimScratch.py - viewerPos[1], dz = trimScratch.pz - viewerPos[2]
  return dx * dx + dy * dy + dz * dz
}

export function trimEntitiesToBudget(entities, staticCount, viewerPos, dynCache) {
  if (entities.length - staticCount < BANDWIDTH_TRIM_MIN_ENTITIES) return { entities, trimmedCount: 0 }
  let total = 0
  const sized = new Array(entities.length)
  for (let i = 0; i < entities.length; i++) {
    const bytes = estimateEntityBytes(entities[i], dynCache)
    sized[i] = bytes
    total += bytes
  }
  if (total <= BANDWIDTH_BUDGET_BYTES_PER_TICK) return { entities, trimmedCount: 0 }
  const viewer = viewerPos ?? [0, 0, 0]
  const candidates = []
  for (let i = staticCount; i < entities.length; i++) {
    candidates.push({ i, d2: squaredDistanceTo(entities[i], viewer) })
  }
  candidates.sort(byFarthestFirst)
  const dropSet = new Set()
  let iterations = 0
  for (const c of candidates) {
    if (total <= BANDWIDTH_BUDGET_BYTES_PER_TICK) break
    if (++iterations > BANDWIDTH_TRIM_MAX_ITERATIONS) break
    dropSet.add(c.i)
    total -= sized[c.i]
  }
  if (dropSet.size === 0) return { entities, trimmedCount: 0 }
  const trimmed = entities.filter((_, i) => !dropSet.has(i))
  return { entities: trimmed, trimmedCount: dropSet.size }
}
