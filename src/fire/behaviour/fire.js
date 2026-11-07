import { describeValue, isVec3 } from './spec.js'
import { FIRE_MAX_BYTE, FIRE_MAX_WIND_COMPONENT, FIRE_MAX_IGNITE_RADIUS_CELLS, FIRE_MAX_EXTINGUISH_RADIUS_CELLS } from '../wire.js'

export function checkFireCell(lattice, face, I, J, what) {
  if (!Number.isInteger(face) || face < 0 || face >= lattice.faceCount || !Number.isInteger(I) || !Number.isInteger(J) || I < 0 || J < 0 || I >= lattice.cellsPerFace || J >= lattice.cellsPerFace) throw new RangeError(`[fire] ${what}(${face}, ${I}, ${J}) is outside the lattice`)
}

export function checkFireByte(value, what) {
  if (!Number.isInteger(value) || value < 0 || value > FIRE_MAX_BYTE) throw new RangeError(`[fire] ${what} must be an integer from 0 to ${FIRE_MAX_BYTE}, got ${describeValue(value)}`)
  return value
}

export function igniteAreaRadiusCells(radiusM, cellM) {
  if (!Number.isFinite(radiusM) || radiusM < 0) throw new RangeError(`[fire] igniteArea radius must be a non-negative number of metres, got ${describeValue(radiusM)}`)
  return Math.min(FIRE_MAX_IGNITE_RADIUS_CELLS, Math.ceil(radiusM / cellM))
}

export function extinguishRadiusCells(radiusMetres, cellM) {
  if (!Number.isFinite(radiusMetres) || radiusMetres < 0) throw new RangeError(`[fire] extinguish radius must be a non-negative number of metres, got ${describeValue(radiusMetres)}`)
  return Math.min(FIRE_MAX_EXTINGUISH_RADIUS_CELLS, Math.ceil(radiusMetres / cellM))
}

export function checkExtinguishRadiusCells(radiusCells) {
  if (!Number.isInteger(radiusCells) || radiusCells < 0 || radiusCells > FIRE_MAX_EXTINGUISH_RADIUS_CELLS) throw new RangeError(`[fire] extinguish radius must be 0..${FIRE_MAX_EXTINGUISH_RADIUS_CELLS} cells, got ${describeValue(radiusCells)}`)
  return radiusCells
}

export function checkWindVector(vector) {
  if (!(isVec3(vector) && vector.every(c => Number.isInteger(c) && Math.abs(c) <= FIRE_MAX_WIND_COMPONENT))) throw new TypeError(`[fire] wind must be [x, y, z] integers within +-${FIRE_MAX_WIND_COMPONENT}`)
  return vector
}

export function parseKeyframeRow(row) {
  if (!Array.isArray(row) || row.length !== 3 || !Number.isSafeInteger(row[0]) || typeof row[1] !== 'number' || typeof row[2] !== 'string') throw new TypeError(`[fire] malformed keyframe row ${JSON.stringify(row)}`)
  return { tick: row[0], hash: row[1], b64: row[2] }
}

export function parseChecksumRow(row) {
  if (!Array.isArray(row) || row.length !== 2 || !Number.isSafeInteger(row[0]) || !Number.isSafeInteger(row[1])) throw new TypeError(`[fire] malformed checksum row ${JSON.stringify(row)}`)
  return { tick: row[0], hash: row[1] }
}

export function createChecksumLedger({ limit = 64 } = {}) {
  const localHistory = new Map()
  const remote = new Map()
  const stats = { rows: 0, compared: 0, missed: 0, mismatches: 0, firstMismatch: null }
  return {
    stats,
    get history() { return [...localHistory.entries()] },
    rememberLocal(tick, hash) {
      localHistory.set(tick, hash)
      if (localHistory.size > limit) localHistory.delete(localHistory.keys().next().value)
    },
    receiveRemote(tick, hash) {
      stats.rows++
      remote.set(tick, hash)
      if (remote.size > limit) remote.delete(remote.keys().next().value)
    },
    compare(simTick) {
      for (const [tick, hash] of [...remote]) {
        if (tick > simTick) continue
        remote.delete(tick)
        const mine = localHistory.get(tick)
        if (mine === undefined) { stats.missed++; continue }
        stats.compared++
        if (mine !== hash) {
          stats.mismatches++
          stats.firstMismatch ??= { tick, local: mine, remote: hash }
        }
      }
    },
    clear() { localHistory.clear(); remote.clear() },
  }
}
