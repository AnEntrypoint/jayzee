import { loadKernel } from '../kernel/load.js'

const MAX_STEPS_PER_ADVANCE = 8
const GRID_DIM = 16

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const checkBoxes = (boxes) => {
  if (!Array.isArray(boxes)) throw new TypeError('boxes must be an array of [minX, minY, minZ, maxX, maxY, maxZ]')
  boxes.forEach((box, index) => {
    if (!Array.isArray(box) || box.length !== 6 || !box.every(isFiniteNumber)) {
      throw new TypeError('box ' + index + ' must hold six finite numbers')
    }
    if (box[0] > box[3] || box[1] > box[4] || box[2] > box[5]) {
      throw new RangeError('box ' + index + ' has min above max on an axis')
    }
  })
  return Float64Array.from(boxes.flat())
}

const checkVector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new TypeError(name + ' must be a finite [x, y, z] triple')
  }
}

export class World {
  #kernel = loadKernel()
  #capacity
  #tickRate
  #gravity
  #drag
  #radius
  #restitution
  #boxes
  #boxCount
  #position
  #velocity
  #count = 0
  #tick = 0
  #accumulator = 0

  constructor({ capacity = 256, tickRate = 64, gravity = -18, drag = 0.1, radius = 0.35, restitution = 0.2, boxes = [] } = {}) {
    if (!isPositiveInteger(capacity)) throw new RangeError('capacity must be a positive integer')
    if (!isPositiveInteger(tickRate)) throw new RangeError('tickRate must be a positive integer')
    if (!isFiniteNumber(gravity)) throw new TypeError('gravity must be a finite number')
    if (!isFiniteNumber(drag) || drag < 0) throw new RangeError('drag must be a finite number at or above zero')
    if (!isFiniteNumber(radius) || radius <= 0) throw new RangeError('radius must be a finite number above zero')
    if (!isFiniteNumber(restitution) || restitution < 0 || restitution > 1) throw new RangeError('restitution must lie in 0..1')
    this.#capacity = capacity
    this.#tickRate = tickRate
    this.#gravity = gravity
    this.#drag = drag
    this.#radius = radius
    this.#restitution = restitution
    this.#boxes = checkBoxes(boxes)
    this.#boxCount = boxes.length
    this.#position = new Float64Array(capacity * 3)
    this.#velocity = new Float64Array(capacity * 3)
  }

  get count() {
    return this.#count
  }

  get tick() {
    return this.#tick
  }

  get stepSeconds() {
    return 1 / this.#tickRate
  }

  spawn(position, velocity = [0, 0, 0]) {
    checkVector(position, 'position')
    checkVector(velocity, 'velocity')
    if (this.#count === this.#capacity) throw new RangeError('world is full: capacity ' + this.#capacity)
    const id = this.#count
    this.#position.set(position, id * 3)
    this.#velocity.set(velocity, id * 3)
    this.#count += 1
    return id
  }

  position(id) {
    this.#checkId(id)
    return Array.from(this.#position.subarray(id * 3, id * 3 + 3))
  }

  velocity(id) {
    this.#checkId(id)
    return Array.from(this.#velocity.subarray(id * 3, id * 3 + 3))
  }

  setVelocity(id, velocity) {
    this.#checkId(id)
    checkVector(velocity, 'velocity')
    this.#velocity.set(velocity, id * 3)
  }

  step() {
    const kernel = this.#kernel
    const dt = this.stepSeconds
    kernel.integrate(this.#position, this.#velocity, this.#count, this.#gravity, this.#drag, dt)
    kernel.resolveGround(this.#position, this.#velocity, this.#count, this.#radius, this.#restitution)
    kernel.resolveBoxes(this.#position, this.#velocity, this.#count, this.#radius, this.#boxes, this.#boxCount, this.#restitution)
    kernel.resolvePairs(this.#position, this.#velocity, this.#count, this.#radius, this.#restitution, 2 * this.#radius, GRID_DIM)
    this.#tick += 1
  }

  advance(seconds) {
    if (!isFiniteNumber(seconds) || seconds < 0) throw new RangeError('seconds must be a finite number at or above zero')
    const dt = this.stepSeconds
    this.#accumulator = Math.min(this.#accumulator + seconds, MAX_STEPS_PER_ADVANCE * dt)
    let steps = 0
    while (this.#accumulator >= dt) {
      this.step()
      this.#accumulator -= dt
      steps += 1
    }
    return steps
  }

  hash() {
    return this.#kernel.hashState(this.#position, this.#velocity, this.#count)
  }

  snapshot() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#position.slice(0, this.#count * 3),
    }
  }

  #checkId(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.#count) throw new RangeError('no body with id ' + id)
  }
}
