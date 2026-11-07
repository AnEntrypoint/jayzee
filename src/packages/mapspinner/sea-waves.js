const OCTAVE_COUNT = 8
const BASE_AMPLITUDE_M = 0.6
const PHASE_STEP = 0.31
const AMPLITUDE_GAIN = 0.45
const CHOPPINESS_TO_ONE_RATE = 0.3
const MEAN_GRID_SIDE = 256
const MEAN_GRID_STEP = 3.7013
const MEAN_CACHE_LIMIT = 16
const TWO_POW_32 = 4294967296

const unitMeanByChoppiness = new Map()

function cellHash(x, y) {
  const qx = Math.imul(x | 0, 1597334673) >>> 0
  const qy = Math.imul(y | 0, -482951495) >>> 0
  return Math.imul((qx ^ qy) >>> 0, 1597334673) >>> 0
}

function valueNoise(px, py) {
  const ix = Math.floor(px)
  const iy = Math.floor(py)
  let fx = px - ix
  let fy = py - iy
  fx = fx * fx * (3 - 2 * fx)
  fy = fy * fy * (3 - 2 * fy)
  const h00 = cellHash(ix, iy)
  const h10 = cellHash(ix + 1, iy)
  const h01 = cellHash(ix, iy + 1)
  const h11 = cellHash(ix + 1, iy + 1)
  const bottom = h00 + (h10 - h00) * fx
  const top = h01 + (h11 - h01) * fx
  return (bottom + (top - bottom) * fy) / TWO_POW_32
}

function waveOctave(ux, uy, choppiness) {
  const warp = valueNoise(ux, uy)
  const wx0 = ux + warp
  const wy0 = uy + warp
  let wx = 1 - Math.abs(Math.sin(wx0))
  let wy = 1 - Math.abs(Math.sin(wy0))
  const sx = Math.abs(Math.cos(wx0))
  const sy = Math.abs(Math.cos(wy0))
  wx += (sx - wx) * wx
  wy += (sy - wy) * wy
  return Math.pow(1 - Math.pow(wx * wy, 0.65), choppiness)
}

function octaveMean(choppiness, phase) {
  let sum = 0
  for (let iy = 0; iy < MEAN_GRID_SIDE; iy++) {
    for (let ix = 0; ix < MEAN_GRID_SIDE; ix++) {
      sum += waveOctave(ix * MEAN_GRID_STEP + phase, iy * MEAN_GRID_STEP + phase, choppiness)
    }
  }
  return sum / (MEAN_GRID_SIDE * MEAN_GRID_SIDE)
}

function unitAmplitudeMean(oceanChoppiness) {
  let total = 0
  let amplitude = BASE_AMPLITUDE_M
  let choppiness = oceanChoppiness
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    total += amplitude * octaveMean(choppiness, PHASE_STEP * i)
    amplitude *= AMPLITUDE_GAIN
    choppiness += (1 - choppiness) * CHOPPINESS_TO_ONE_RATE
  }
  return total
}

export function seaHeightMean(oceanChoppiness, oceanAmplitude) {
  let mean = unitMeanByChoppiness.get(oceanChoppiness)
  if (mean === undefined) {
    mean = unitAmplitudeMean(oceanChoppiness)
    if (unitMeanByChoppiness.size >= MEAN_CACHE_LIMIT) unitMeanByChoppiness.clear()
    unitMeanByChoppiness.set(oceanChoppiness, mean)
  }
  return mean * oceanAmplitude
}
