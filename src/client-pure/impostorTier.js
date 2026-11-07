export const IMPOSTOR_DISSOLVE_FADE_BAND_M = 3.0
export const IMPOSTOR_DEFAULT_ATLAS_PX = 1024
export const IMPOSTOR_DEFAULT_MAX_INSTANCES = 20000
export const IMPOSTOR_DEFAULT_INIT_CAPACITY = 4096

const DITHER_SCALE = 52.9829189
const DITHER_X = 0.06711056
const DITHER_Y = 0.00583715

export function impostorHandoffDistances(nearCutoff) {
  return { impostorStart: nearCutoff - IMPOSTOR_DISSOLVE_FADE_BAND_M, meshEnd: nearCutoff + IMPOSTOR_DISSOLVE_FADE_BAND_M }
}

export function hasNearLodCutoff(nearCutoff) {
  return Number.isFinite(nearCutoff) && nearCutoff > 0
}

export function usesTopDownAtlasStorage(renderer) {
  return !!(renderer && renderer.isWebGPURenderer && renderer.backend && renderer.backend.isWebGPUBackend)
}

export function impostorInstanceCapacity(opts = {}) {
  const capacity = Math.min(opts.maxInstances || IMPOSTOR_DEFAULT_MAX_INSTANCES, opts.initCapacity || IMPOSTOR_DEFAULT_INIT_CAPACITY)
  return { capacity, webgpuCapacity: opts.maxInstances || capacity }
}

function fract(x) { return x - Math.floor(x) }

export function impostorDissolveKeeps(camDist, nearCutoff, fragX, fragY) {
  const fade = Math.max(0, Math.min(1, (camDist - (nearCutoff - IMPOSTOR_DISSOLVE_FADE_BAND_M)) / IMPOSTOR_DISSOLVE_FADE_BAND_M))
  const dither = fract(DITHER_SCALE * fract(fragX * DITHER_X + fragY * DITHER_Y))
  return !(dither > fade)
}

export function planImpostorAtlas(species, opts = {}) {
  const list = (species || []).filter(a => a && a.albedo)
  const n = list.length
  if (n === 0) return null
  const atlasSize = opts.atlasSize || (list[0].imageWidth || IMPOSTOR_DEFAULT_ATLAS_PX)
  const gridSide = Math.max(1, Math.ceil(Math.sqrt(n)))
  const mega = atlasSize * gridSide
  const hasNormal = list.every(a => a.normal)
  const topDown = opts.topDown === true
  const tiles = []
  const copies = []
  for (let i = 0; i < n; i++) {
    const col = i % gridSide
    const row = Math.floor(i / gridSide)
    const dstX = col * atlasSize
    const dstY = topDown ? mega - (row + 1) * atlasSize : row * atlasSize
    copies.push({ index: i, dst: [dstX, dstY], copyNormal: hasNormal && !!list[i].normal })
    tiles.push({ species: i, col, row, offset: [col / gridSide, row / gridSide] })
  }
  const normalPlanes = hasNormal ? 2 : 1
  return {
    gridSide,
    atlasSize,
    mega,
    tileScale: 1 / gridSide,
    hasNormal,
    tiles,
    copies,
    megaBytes: mega * mega * 4 * normalPlanes,
    perSpeciesBytes: n * atlasSize * atlasSize * 4 * normalPlanes,
  }
}
