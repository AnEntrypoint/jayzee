import { thermalErode, hydraulicErode } from './terrainErosion.js'
import { createSplineCarveLayer } from './splineCarve.js'
import { createCaveCarveLayer } from './caveSdf.js'
import { stampStructures } from './structureStamp.js'

function refuse(what) {
  throw new TypeError('[carved-height] ' + what)
}

function parseTile(tile) {
  if (!tile || typeof tile !== 'object') refuse('tile is ' + JSON.stringify(tile) + ': erosion runs on one square grid, so the tile states its corner, its node count per side and its spacing in metres')
  const { cornerX, cornerZ, width, spacing } = tile
  if (!Number.isFinite(cornerX) || !Number.isFinite(cornerZ)) refuse('tile corner (' + cornerX + ', ' + cornerZ + ') is not finite')
  if (!Number.isInteger(width) || width < 3) refuse('tile width ' + String(width) + ' is not an integer of at least 3 nodes per side')
  if (!Number.isFinite(spacing) || !(spacing > 0)) refuse('tile spacing ' + String(spacing) + ' is not a positive length in metres')
  const feather = tile.featherNodes === undefined ? 2 : tile.featherNodes
  if (!Number.isInteger(feather) || feather < 0 || feather * 2 >= width) refuse('tile featherNodes ' + String(feather) + ' is not an integer from 0 to under half the width')
  return { cornerX, cornerZ, width, spacing, feather }
}

function sampleBase(baseHeightAt, tile) {
  const n = tile.width
  const grid = new Float32Array(n * n)
  for (let iz = 0; iz < n; iz++) {
    for (let ix = 0; ix < n; ix++) {
      const h = baseHeightAt(tile.cornerX + ix * tile.spacing, tile.cornerZ + iz * tile.spacing)
      grid[iz * n + ix] = typeof h === 'number' ? h : NaN
    }
  }
  return grid
}

function erodeGrid(base, tile, erosion) {
  let grid = base
  if (erosion.thermal) {
    const t = erosion.thermal
    grid = thermalErode(grid, tile.width, tile.spacing, t.talusAngle, t.iterations, t.rate)
  }
  if (erosion.hydraulic) grid = hydraulicErode(grid, tile.width, tile.spacing, erosion.hydraulic)
  return grid
}

function featherWeights(tile) {
  const n = tile.width
  const w = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const edge = Math.min(i, n - 1 - i)
    w[i] = tile.feather === 0 ? 1 : Math.min(1, edge / tile.feather)
  }
  return w
}

export function createCarvedHeightQuery(spec) {
  if (!spec || typeof spec.baseHeightAt !== 'function') refuse('baseHeightAt is missing: the query carves one (x, z) -> y ground function, so that function is the first argument')
  const baseHeightAt = spec.baseHeightAt
  const erosion = spec.erosion || null
  const tile = erosion ? parseTile(spec.tile) : null
  let delta = null
  let eroded = null
  if (erosion) {
    const base = sampleBase(baseHeightAt, tile)
    eroded = erodeGrid(base, tile, erosion)
    const fade = featherWeights(tile)
    const n = tile.width
    delta = new Float32Array(n * n)
    for (let iz = 0; iz < n; iz++) {
      for (let ix = 0; ix < n; ix++) {
        const i = iz * n + ix
        const d = eroded[i] - base[i]
        delta[i] = Number.isFinite(d) ? d * fade[ix] * fade[iz] : 0
      }
    }
  }

  function erosionDeltaAt(x, z) {
    if (delta === null) return 0
    const n = tile.width
    const gx = (x - tile.cornerX) / tile.spacing
    const gz = (z - tile.cornerZ) / tile.spacing
    if (!(gx >= 0) || !(gz >= 0) || gx > n - 1 || gz > n - 1) return 0
    const ix = gx >= n - 1 ? n - 2 : Math.floor(gx)
    const iz = gz >= n - 1 ? n - 2 : Math.floor(gz)
    const fx = gx - ix, fz = gz - iz
    const i = iz * n + ix
    const top = delta[i] + (delta[i + 1] - delta[i]) * fx
    const bottom = delta[i + n] + (delta[i + n + 1] - delta[i + n]) * fx
    return top + (bottom - top) * fz
  }

  function erodedHeightAt(x, z) {
    const base = baseHeightAt(x, z)
    if (typeof base !== 'number' || !Number.isFinite(base)) return base
    return base + erosionDeltaAt(x, z)
  }

  const splineLayer = createSplineCarveLayer()
  const splines = spec.splines === undefined ? [] : spec.splines
  if (!Array.isArray(splines)) refuse('splines is ' + JSON.stringify(splines) + ': the carved rivers and roads are an array')
  for (let i = 0; i < splines.length; i++) {
    const s = splines[i]
    const result = splineLayer.carve(s && s.controlPoints, s && s.width, s && s.depth, s && s.kind, erodedHeightAt, { seed: s && s.seed, widthVariance: s && s.widthVariance, bankErosion: s && s.bankErosion })
    if (result.touched === 0) refuse('spline ' + i + ' carved no cell: a spline is two or more control points with a positive width, a finite depth and the kind river or road, over ground that has a height')
  }

  const caveLayer = createCaveCarveLayer()
  const caves = spec.caves === undefined ? [] : spec.caves
  if (!Array.isArray(caves)) refuse('caves is ' + JSON.stringify(caves) + ': the cave volumes are an array')
  for (let i = 0; i < caves.length; i++) {
    if (!caveLayer.addCaveVolume(caves[i]).added) refuse('cave ' + i + ' is ' + JSON.stringify(caves[i]) + ': a cave volume is a finite world centre with a positive radius and a known shape')
  }

  const caveVolumes = caveLayer.volumes

  function caveDeltaAt(x, z, surfaceY) {
    let floor = surfaceY
    for (let i = 0; i < caveVolumes.length; i++) {
      const vol = caveVolumes[i]
      const dx = x - vol.worldX, dz = z - vol.worldZ
      const d2 = dx * dx + dz * dz
      const r = vol.worldRadius
      if (d2 > r * r) continue
      const span = vol.shape.kind === 'sphere' ? Math.sqrt(r * r - d2) : r * vol.shape.verticalSpan
      if (!(span > 0)) continue
      if (vol.worldY + span < surfaceY) continue
      const bottom = vol.worldY - span
      if (bottom < floor) floor = bottom
    }
    return floor - surfaceY
  }

  function heightAt(x, z) {
    const eroded = erodedHeightAt(x, z)
    if (typeof eroded !== 'number' || !Number.isFinite(eroded)) return eroded
    const carved = eroded + splineLayer.deltaAt(x, z)
    return carved + caveDeltaAt(x, z, carved)
  }

  const stamps = spec.stamps === undefined ? [] : spec.stamps
  const posts = stampStructures(stamps, heightAt)

  function checksum() {
    let h = 2166136261
    const mix = (v) => { h = Math.imul(h ^ (v | 0), 16777619) >>> 0 }
    if (delta !== null) {
      const words = new Int32Array(delta.buffer, delta.byteOffset, delta.length)
      for (let i = 0; i < words.length; i++) mix(words[i])
    }
    mix(splineLayer.cellCount)
    mix(caveLayer.volumeCount)
    mix(posts.length)
    return h >>> 0
  }

  return {
    heightAt,
    erodedHeightAt,
    erosionDeltaAt,
    baseHeightAt,
    kindAt: (x, z) => splineLayer.kindAt(x, z),
    splineDeltaAt: (x, z) => splineLayer.deltaAt(x, z),
    caveDeltaAt,
    posts,
    tile,
    erodedGrid: eroded,
    erosionDelta: delta,
    checksum,
    toJSON: () => ({ version: 1, splines: splineLayer.toJSON(), caves: caveLayer.toJSON() }),
  }
}
