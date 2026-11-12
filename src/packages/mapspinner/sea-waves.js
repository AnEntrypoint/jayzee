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

export const SEA_OCTAVES = OCTAVE_COUNT
export const SEA_FREQ = 0.2
export const SEA_FREQ_LF = 0.16
export const SEA_SPEED = 2.4
const SEA_OCTAVE_ANGLE = 1.57079633
const SEA_FREQ_GAIN = 1.9
const TIME_SPLIT_X = 0.6
const TIME_SPLIT_Y = 0.4
const OCTAVE_TIME_SLOWDOWN = 0.08
const LF_DIR_A = 0.866
const LF_DIR_B = 0.5

function finiteArg(name, value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new RangeError(`sea waves: ${name} must be a finite number, got ${value}`)
  return value
}

function checkedArgs(x, y, time, oceanChoppiness, oceanAmplitude) {
  finiteArg('x', x)
  finiteArg('y', y)
  finiteArg('time', time)
  finiteArg('oceanAmplitude', oceanAmplitude)
  if (!(finiteArg('oceanChoppiness', oceanChoppiness) > 0)) throw new RangeError(`sea waves: oceanChoppiness must be positive, got ${oceanChoppiness}`)
}

export function seaOctave(ux, uy, choppiness) {
  return waveOctave(ux, uy, choppiness)
}

export function seaHeight(x, y, time, oceanChoppiness, oceanAmplitude, octaveStart = 0, octaveEnd = OCTAVE_COUNT) {
  checkedArgs(x, y, time, oceanChoppiness, oceanAmplitude)
  if (!Number.isInteger(octaveStart) || !Number.isInteger(octaveEnd)) throw new RangeError(`sea waves: the octave range must be integers, got ${octaveStart} and ${octaveEnd}`)
  let frequency = SEA_FREQ
  let amplitude = oceanAmplitude * BASE_AMPLITUDE_M
  let choppiness = oceanChoppiness
  const timeX = time * SEA_SPEED * TIME_SPLIT_X
  const timeY = time * SEA_SPEED * TIME_SPLIT_Y
  let height = 0
  for (let i = 0; i < OCTAVE_COUNT; i++) {
    if (i >= octaveStart && i < octaveEnd) {
      const angle = i * SEA_OCTAVE_ANGLE
      const sa = Math.sin(angle)
      const ca = Math.cos(angle)
      const slow = 1 - OCTAVE_TIME_SLOWDOWN * i
      height += waveOctave((ca * x + sa * y + timeX * slow) * frequency, (ca * y - sa * x + timeY * slow) * frequency, choppiness) * amplitude
    }
    frequency *= SEA_FREQ_GAIN
    amplitude *= AMPLITUDE_GAIN
    choppiness += (1 - choppiness) * CHOPPINESS_TO_ONE_RATE
  }
  return height
}

export function seaHeightLF(x, y, time, oceanChoppiness, oceanAmplitude) {
  checkedArgs(x, y, time, oceanChoppiness, oceanAmplitude)
  const qx = x * SEA_FREQ_LF
  const qy = y * SEA_FREQ_LF
  const s0 = time * SEA_SPEED * TIME_SPLIT_X
  const s1 = time * SEA_SPEED * TIME_SPLIT_Y
  const a = waveOctave(qx + LF_DIR_A * s0, qy + LF_DIR_B * s0, oceanChoppiness)
  const b = waveOctave(qx - LF_DIR_B * s1, qy + LF_DIR_A * s1, oceanChoppiness)
  return (a + b) * (oceanAmplitude * BASE_AMPLITUDE_M * 0.5)
}

export function seaOctaveMean(oceanChoppiness, octave = 0) {
  if (!Number.isInteger(octave) || octave < 0 || octave >= OCTAVE_COUNT) throw new RangeError(`sea waves: octave must be an integer in 0..${OCTAVE_COUNT - 1}, got ${octave}`)
  return octaveMeans(oceanChoppiness)[octave]
}
