import { createPlacementLattice } from './placementLattice.js'

export const SECTOR_M = 8
const scratchCentre = [0, 0, 0]
const sectorCaches = new WeakMap()

function sectorCacheFor(anchorField, frame) {
  let byField = sectorCaches.get(frame)
  if (!byField) {
    byField = new WeakMap()
    sectorCaches.set(frame, byField)
  }
  let entry = byField.get(anchorField)
  if (!entry) {
    entry = { lattice: createPlacementLattice(frame.radius, SECTOR_M, 1), values: new Map() }
    byField.set(anchorField, entry)
  }
  return entry
}

export function createCachedAnchorField(anchorField, frame) {
  if (!anchorField || !frame) return anchorField
  const sector = sectorCacheFor(anchorField, frame)
  const lattice = sector.lattice
  const cache = sector.values

  function atDir(dir) {
    const key = lattice.chunkKeyOfDir(dir[0], dir[1], dir[2])
    let value = cache.get(key)
    if (value !== undefined) return value
    const centre = lattice.chunkCentreDir(key, scratchCentre)
    const sample = anchorField.sampleDir ? anchorField.sampleDir(centre) : null
    value = sample ? { temp: sample.temp, humidity: sample.humidity, erosion: sample.erosion, seaBias: sample.seaBias } : null
    cache.set(key, value)
    return value
  }

  return {
    climateUsesLocalXZ: false,
    climateAtLocal(x, z, dir) {
      return atDir(dir || frame.localToDir(x, z))
    },
    sampleDir(dir) {
      return anchorField.sampleDir ? anchorField.sampleDir(dir) : null
    },
    clear() { cache.clear() },
    get size() { return cache.size },
    _underlying: anchorField,
  }
}
