const MAX_SOLVER_ITERATIONS = 32
const BOX_WORDS = 6

export const WORLD_DEFAULTS = Object.freeze({
  capacity: 256,
  tickRate: 64,
  gravity: -18,
  drag: 0.1,
  radius: 0.35,
  restitution: 0.2,
  solverIterations: 8,
  boxes: Object.freeze([]),
})

export const isPositiveInteger = (value) => Number.isInteger(value) && value > 0
export const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export const flattenBoxes = (boxes) => {
  if (!Array.isArray(boxes)) throw new TypeError('boxes must be an array of [minX, minY, minZ, maxX, maxY, maxZ]')
  boxes.forEach((box, index) => {
    if (!Array.isArray(box) || box.length !== BOX_WORDS || !box.every(isFiniteNumber)) {
      throw new TypeError('box ' + index + ' must hold six finite numbers')
    }
    if (box[0] > box[3] || box[1] > box[4] || box[2] > box[5]) {
      throw new RangeError('box ' + index + ' has min above max on an axis')
    }
  })
  return boxes.flat()
}

export const checkVector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !isFiniteNumber(value[0]) || !isFiniteNumber(value[1]) || !isFiniteNumber(value[2])) {
    throw new TypeError(name + ' must be a finite [x, y, z] triple')
  }
}

export const resolveWorldOptions = (options = {}) => {
  const settings = {}
  for (const key of Object.keys(WORLD_DEFAULTS)) {
    settings[key] = options[key] === undefined ? WORLD_DEFAULTS[key] : options[key]
  }
  const { capacity, tickRate, gravity, drag, radius, restitution, solverIterations, boxes } = settings
  if (!isPositiveInteger(capacity)) throw new RangeError('capacity must be a positive integer')
  if (!isPositiveInteger(tickRate)) throw new RangeError('tickRate must be a positive integer')
  if (!isFiniteNumber(gravity)) throw new TypeError('gravity must be a finite number')
  if (!isFiniteNumber(drag) || drag < 0) throw new RangeError('drag must be a finite number at or above zero')
  if (!isFiniteNumber(radius) || radius <= 0) throw new RangeError('radius must be a finite number above zero')
  if (!isFiniteNumber(restitution) || restitution < 0 || restitution > 1) throw new RangeError('restitution must lie in 0..1')
  if (!Number.isInteger(solverIterations) || solverIterations < 1 || solverIterations > MAX_SOLVER_ITERATIONS) {
    throw new RangeError('solverIterations must be an integer in 1..' + MAX_SOLVER_ITERATIONS)
  }
  const flatBoxes = flattenBoxes(boxes)
  return { capacity, tickRate, gravity, drag, radius, restitution, solverIterations, boxes, flatBoxes, boxCount: boxes.length }
}
