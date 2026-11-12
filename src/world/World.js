import { instantiateKernel } from '../kernel/load.js'
import { checkVector, isFiniteNumber, resolveWorldOptions } from './options.js'

const MAX_STEPS_PER_ADVANCE = 8
const MIN_GRID_BUCKETS = 64
const GRID_BUCKETS_PER_BODY = 2
const GRID_BUCKETS_PER_OCCUPANCY_WORD = 4
const FNV_OFFSET = 0x811c9dc5

export const gridBucketsFor = (capacity) => {
  let buckets = MIN_GRID_BUCKETS
  while (buckets < capacity * GRID_BUCKETS_PER_BODY) buckets *= 2
  return buckets
}

export class World {
  #step
  #stepMany
  #hash
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
  #count = 0
  #tick = 0
  #accumulator = 0

  constructor(options = {}) {
    const resolved = resolveWorldOptions(options)
    const buckets = gridBucketsFor(resolved.capacity)
    const kernel = instantiateKernel({ capacity: resolved.capacity, boxCount: Math.max(1, resolved.boxCount), buckets, occupancyWords: buckets / GRID_BUCKETS_PER_OCCUPANCY_WORD })
    this.#step = kernel.run.step
    this.#stepMany = kernel.run.stepMany
    this.#hash = kernel.run.hash
    this.#capacity = resolved.capacity
    this.#tickRate = resolved.tickRate
    this.#gravity = resolved.gravity
    this.#drag = resolved.drag
    this.#radius = resolved.radius
    this.#restitution = resolved.restitution
    this.#iterations = resolved.solverIterations
    this.#boxCount = resolved.boxCount
    this.#position = kernel.positions
    this.#velocity = kernel.velocities
    kernel.boxes.set(resolved.flatBoxes)
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

  position(id, out = []) {
    this.#checkId(id)
    return this.#copyBody(this.#position, id, out)
  }

  velocity(id, out = []) {
    this.#checkId(id)
    return this.#copyBody(this.#velocity, id, out)
  }

  setVelocity(id, velocity) {
    this.#checkId(id)
    checkVector(velocity, 'velocity')
    this.#velocity.set(velocity, id * 3)
  }

  step() {
    this.#step(this.#count, this.#boxCount, this.#gravity, this.#drag, this.stepSeconds, this.#radius, this.#restitution, this.#iterations)
    this.#tick += 1
  }

  advance(seconds) {
    if (!isFiniteNumber(seconds) || seconds < 0) throw new RangeError('seconds must be a finite number at or above zero')
    const dt = this.stepSeconds
    this.#accumulator = Math.min(this.#accumulator + seconds, MAX_STEPS_PER_ADVANCE * dt)
    let steps = 0
    while (this.#accumulator >= dt) {
      this.#accumulator -= dt
      steps += 1
    }
    if (steps > 0) {
      this.#stepMany(steps, this.#count, this.#boxCount, this.#gravity, this.#drag, dt, this.#radius, this.#restitution, this.#iterations)
      this.#tick += steps
    }
    return steps
  }

  hash() {
    return this.#hash(this.#count, FNV_OFFSET) >>> 0
  }

  snapshot() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#position.slice(0, this.#count * 3),
    }
  }

  setPosition(id, position) {
    this.#checkId(id)
    checkVector(position, 'position')
    this.#position.set(position, id * 3)
  }

  exportState() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#position.slice(0, this.#count * 3),
      velocities: this.#velocity.slice(0, this.#count * 3),
    }
  }

  importState(state) {
    const words = this.#count * 3
    if (state.count !== this.#count) throw new RangeError('state holds ' + state.count + ' bodies, world has ' + this.#count)
    if (state.positions.length !== words || state.velocities.length !== words) {
      throw new RangeError('state arrays do not match the body count')
    }
    this.#position.set(state.positions, 0)
    this.#velocity.set(state.velocities, 0)
    this.#tick = state.tick
    this.#accumulator = 0
  }

  #copyBody(view, id, out) {
    const base = id * 3
    out[0] = view[base]
    out[1] = view[base + 1]
    out[2] = view[base + 2]
    return out
  }

  #checkId(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.#count) throw new RangeError('no body with id ' + id)
  }
}
