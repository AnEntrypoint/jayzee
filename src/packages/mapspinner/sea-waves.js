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

const octaveMeansByChoppiness = new Map()

function octaveMeans(oceanChoppiness) {
  let means = octaveMeansByChoppiness.get(oceanChoppiness)
  if (means !== undefined) return means
  means = new Float64Array(OCTAVE_COUNT)
  let choppiness = oceanChoppiness
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    means[i] = octaveMean(choppiness, PHASE_STEP * i)
    choppiness += (1 - choppiness) * CHOPPINESS_TO_ONE_RATE
  }
  if (octaveMeansByChoppiness.size >= MEAN_CACHE_LIMIT) octaveMeansByChoppiness.clear()
  octaveMeansByChoppiness.set(oceanChoppiness, means)
  return means
}

function unitAmplitudeMean(oceanChoppiness) {
  const means = octaveMeans(oceanChoppiness)
  let total = 0
  let amplitude = BASE_AMPLITUDE_M
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    total += amplitude * means[i]
    amplitude *= AMPLITUDE_GAIN
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

export const SEA_OCTAVE_COUNT = OCTAVE_COUNT
export const SEA_LF_OCTAVE_COUNT = 3
export const SEA_BASE_FREQUENCY = 0.16
export const SEA_FREQUENCY_GAIN = 1.9
export const SEA_WAVE_SPEED = 0.8
const SEA_STRETCH_X = 0.75
const OCTAVE_ROTATE_A = 0.8
const OCTAVE_ROTATE_B = 0.6

function finiteArg(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`sea waves: ${name} must be a finite number, got ${value}`)
  return value
}

function seaOctaves(x, z, time, oceanChoppiness, octaves) {
  let ux = x * SEA_STRETCH_X
  let uy = z
  let frequency = SEA_BASE_FREQUENCY
  let amplitude = BASE_AMPLITUDE_M
  let choppiness = oceanChoppiness
  let total = 0
  const drift = time * SEA_WAVE_SPEED
  for (let i = 0; i < octaves; i++) {
    const phase = PHASE_STEP * i
    const forward = waveOctave((ux + drift) * frequency + phase, (uy + drift) * frequency + phase, choppiness)
    const backward = waveOctave((ux - drift) * frequency + phase, (uy - drift) * frequency + phase, choppiness)
    total += amplitude * 0.5 * (forward + backward)
    const rx = OCTAVE_ROTATE_A * ux + OCTAVE_ROTATE_B * uy
    uy = OCTAVE_ROTATE_A * uy - OCTAVE_ROTATE_B * ux
    ux = rx
    frequency *= SEA_FREQUENCY_GAIN
    amplitude *= AMPLITUDE_GAIN
    choppiness += (1 - choppiness) * CHOPPINESS_TO_ONE_RATE
  }
  return total
}

function checkedArgs(x, z, time, oceanChoppiness, oceanAmplitude) {
  finiteArg('x', x)
  finiteArg('z', z)
  finiteArg('time', time)
  finiteArg('oceanAmplitude', oceanAmplitude)
  if (!(finiteArg('oceanChoppiness', oceanChoppiness) > 0)) throw new RangeError(`sea waves: oceanChoppiness must be positive, got ${oceanChoppiness}`)
}

export function seaHeight(x, z, time, oceanChoppiness, oceanAmplitude) {
  checkedArgs(x, z, time, oceanChoppiness, oceanAmplitude)
  return seaOctaves(x, z, time, oceanChoppiness, OCTAVE_COUNT) * oceanAmplitude
}

export function seaHeightLF(x, z, time, oceanChoppiness, oceanAmplitude) {
  checkedArgs(x, z, time, oceanChoppiness, oceanAmplitude)
  const means = octaveMeans(oceanChoppiness)
  let tail = 0
  let amplitude = BASE_AMPLITUDE_M
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    if (i >= SEA_LF_OCTAVE_COUNT) tail += amplitude * means[i]
    amplitude *= AMPLITUDE_GAIN
  }
  return (seaOctaves(x, z, time, oceanChoppiness, SEA_LF_OCTAVE_COUNT) + tail) * oceanAmplitude
}

export function seaHeightLFBound(oceanAmplitude) {
  let bound = 0
  let amplitude = BASE_AMPLITUDE_M
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    if (i >= SEA_LF_OCTAVE_COUNT) bound += amplitude
    amplitude *= AMPLITUDE_GAIN
  }
  return bound * Math.abs(oceanAmplitude)
}
