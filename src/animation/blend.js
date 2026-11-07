const NEAREST_SAMPLE_COUNT = 3
const MIN_SAMPLE_DISTANCE = 0.01

const zeroWeights = (count) => new Array(count).fill(0)

export function blendWeights1D(thresholds, parameter) {
  const count = thresholds.length
  const weights = zeroWeights(count)
  if (count === 0) return weights

  let lowIndex = -1
  let highIndex = -1
  for (let i = 0; i < count; i++) {
    if (thresholds[i] <= parameter) lowIndex = i
    if (thresholds[i] >= parameter && highIndex === -1) highIndex = i
  }

  if (lowIndex === -1) {
    weights[0] = 1
    return weights
  }
  if (highIndex === -1 || lowIndex === highIndex) {
    weights[lowIndex] = 1
    return weights
  }

  const lowThreshold = thresholds[lowIndex]
  const range = thresholds[highIndex] - lowThreshold
  if (range <= 0) {
    weights[lowIndex] = 1
    return weights
  }

  const mix = (parameter - lowThreshold) / range
  weights[lowIndex] = 1 - mix
  weights[highIndex] = mix
  return weights
}

export function blendWeights2D(samples, x, y) {
  const weights = zeroWeights(samples.length)
  if (samples.length === 0) return weights

  const byDistance = samples
    .map((sample, index) => ({ index, distance: Math.sqrt((sample.x - x) ** 2 + (sample.y - y) ** 2) }))
    .sort((a, b) => a.distance - b.distance)

  if (byDistance[0].distance === 0) {
    weights[byDistance[0].index] = 1
    return weights
  }

  const influences = byDistance
    .slice(0, NEAREST_SAMPLE_COUNT)
    .map(({ index, distance }) => ({ index, inverse: 1 / Math.max(distance, MIN_SAMPLE_DISTANCE) }))
  const totalInverse = influences.reduce((sum, { inverse }) => sum + inverse, 0)
  for (const { index, inverse } of influences) {
    weights[index] = inverse / totalInverse
  }
  return weights
}
