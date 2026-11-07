import { instantiateKernel } from '../kernel/load.js'

const MAX_STEPS_PER_ADVANCE = 8
const MIN_GRID_BUCKETS = 64
const GRID_BUCKETS_PER_BODY = 2
const MAX_SOLVER_ITERATIONS = 32
const BOX_WORDS = 6
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

const isPositiveInteger = (value) => Number.isInteger(value) && value > 0
const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const flattenBoxes = (boxes) => {
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

const checkVector = (value, name) => {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isFiniteNumber)) {
    throw new TypeError(name + ' must be a finite [x, y, z] triple')
  }
}

const fnvWords = (hash, words) => {
  let h = hash
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], FNV_PRIME)
  return h
}

export class World {
  #memory
  #kernel
  #capacity
  #tickRate
  #gravity
  #drag
  #radius
  #restitution
  #iterations
  #boxCount
  #position
  #velocity
  #boxes
  #head
  #next
  #cells
  #count = 0
  #tick = 0
  #accumulator = 0

  constructor({
    capacity = 256,
    tickRate = 64,
    gravity = -18,
    drag = 0.1,
    radius = 0.35,
    restitution = 0.2,
    solverIterations = 8,
    boxes = [],
  } = {}) {
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

    const instance = instantiateKernel()
    this.#memory = instance.memory
    this.#kernel = instance.exports
    this.#capacity = capacity
    this.#tickRate = tickRate
    this.#gravity = gravity
    this.#drag = drag
    this.#radius = radius
    this.#restitution = restitution
    this.#iterations = solverIterations
    this.#boxCount = boxes.length
    this.#position = this.#memory.Float64Array(capacity * 3)
    this.#velocity = this.#memory.Float64Array(capacity * 3)
    this.#boxes = this.#memory.Float64Array(Math.max(1, boxes.length) * BOX_WORDS)
    this.#memory.read(this.#boxes).set(flatBoxes)
    this.#head = this.#memory.Int32Array(Math.max(MIN_GRID_BUCKETS, capacity * GRID_BUCKETS_PER_BODY))
    this.#next = this.#memory.Int32Array(capacity)
    this.#cells = this.#memory.Int32Array(capacity * 3)
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
    this.#view(this.#position).set(position, id * 3)
    this.#view(this.#velocity).set(velocity, id * 3)
    this.#count += 1
    return id
  }

  position(id) {
    this.#checkId(id)
    return Array.from(this.#view(this.#position).subarray(id * 3, id * 3 + 3))
  }

  velocity(id) {
    this.#checkId(id)
    return Array.from(this.#view(this.#velocity).subarray(id * 3, id * 3 + 3))
  }

  setVelocity(id, velocity) {
    this.#checkId(id)
    checkVector(velocity, 'velocity')
    this.#view(this.#velocity).set(velocity, id * 3)
  }

  step() {
    this.#kernel.step(
      this.#position,
      this.#velocity,
      this.#count,
      this.#boxes,
      this.#boxCount,
      this.#gravity,
      this.#drag,
      this.stepSeconds,
      this.#radius,
      this.#restitution,
      this.#iterations,
      this.#head,
      this.#next,
      this.#cells,
    )
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
    const positions = this.#view(this.#position).subarray(0, this.#count * 3)
    const velocities = this.#view(this.#velocity).subarray(0, this.#count * 3)
    const words = (view) => new Uint32Array(view.buffer, view.byteOffset, view.length * 2)
    return fnvWords(fnvWords(FNV_OFFSET, words(positions)), words(velocities)) >>> 0
  }

  snapshot() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#view(this.#position).slice(0, this.#count * 3),
    }
  }

  #view(handle) {
    return this.#memory.read(handle)
  }

  #checkId(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.#count) throw new RangeError('no body with id ' + id)
  }
}
