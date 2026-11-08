import { SurfaceSolveError } from '../terrain-pure/planetFrame.js'

const noLog = () => {}
const reportedWhere = new Set()

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v)
const isKnownExtent = (v) => typeof v === 'number' && !Number.isNaN(v)

function sampleGround(where, heightFn, x, z, log) {
  let y
  try {
    y = heightFn(x, z)
  } catch (error) {
    if (!(error instanceof SurfaceSolveError)) throw error
    if (!reportedWhere.has(where)) {
      reportedWhere.add(where)
      log(`[terrain] ${where}: no ground height at chart-local (${x}, ${z}), the tile extent is empty: ${error.message}`)
    }
    return null
  }
  if (y === null) return null
  if (!isFiniteNumber(y)) {
    throw new RangeError(`commitTileExtent ${where}: the ground sampler returned ${String(y)} at chart-local (${x}, ${z}); only a finite height or null for no ground is accepted`)
  }
  return y
}

export function commitTileExtent(where, heightFn, sampleXZ, bounds, minY, maxY, padM, log = noLog) {
  if (typeof where !== 'string' || where === '') throw new TypeError('commitTileExtent: where must name the caller')
  if (typeof heightFn !== 'function') throw new TypeError('commitTileExtent: heightFn must be a function')
  if (!Array.isArray(sampleXZ) || sampleXZ.length !== 2 || !sampleXZ.every(isFiniteNumber)) {
    throw new RangeError('commitTileExtent: sampleXZ must be [x, z] as two finite numbers')
  }
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(isFiniteNumber)) {
    throw new RangeError('commitTileExtent: bounds must be [minX, minZ, maxX, maxZ] as four finite numbers')
  }
  if (!isKnownExtent(minY) || !isKnownExtent(maxY)) throw new RangeError('commitTileExtent: minY and maxY must be numbers, infinities allowed')
  if (!isFiniteNumber(padM) || padM < 0) throw new RangeError('commitTileExtent: padM must be a finite number of metres, zero or more')
  const [minX, minZ, maxX, maxZ] = bounds
  if (minY <= maxY) return { empty: false, aabbMin: [minX, minY, minZ], aabbMax: [maxX, maxY, maxZ] }
  const y = sampleGround(where, heightFn, sampleXZ[0], sampleXZ[1], log)
  if (y === null) return { empty: true, aabbMin: null, aabbMax: null }
  return { empty: false, aabbMin: [minX, y - padM, minZ], aabbMax: [maxX, y + padM, maxZ] }
}
