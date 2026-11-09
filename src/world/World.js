import { instantiateKernel } from '../kernel/load.js'
import { checkVector, isFiniteNumber, resolveWorldOptions } from './options.js'

const MAX_STEPS_PER_ADVANCE = 8
const MIN_GRID_BUCKETS = 64
const GRID_BUCKETS_PER_BODY = 2
const BOX_WORDS = 6
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193

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

  constructor(options = {}) {
    const resolved = resolveWorldOptions(options)
    const instance = instantiateKernel()
    this.#memory = instance.memory
    this.#kernel = instance.exports
    this.#capacity = resolved.capacity
    this.#tickRate = resolved.tickRate
    this.#gravity = resolved.gravity
    this.#drag = resolved.drag
    this.#radius = resolved.radius
    this.#restitution = resolved.restitution
    this.#iterations = resolved.solverIterations
    this.#boxCount = resolved.boxCount
    this.#position = this.#memory.Float64Array(resolved.capacity * 3)
    this.#velocity = this.#memory.Float64Array(resolved.capacity * 3)
    this.#boxes = this.#memory.Float64Array(Math.max(1, resolved.boxCount) * BOX_WORDS)
    this.#memory.read(this.#boxes).set(resolved.flatBoxes)
    this.#head = this.#memory.Int32Array(Math.max(MIN_GRID_BUCKETS, resolved.capacity * GRID_BUCKETS_PER_BODY))
    this.#next = this.#memory.Int32Array(resolved.capacity)
    this.#cells = this.#memory.Int32Array(resolved.capacity * 3)
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
    const positions = this.#view(this.#position)
    const velocities = this.#view(this.#velocity)
    const wordCount = this.#count * 6
    const positionWords = new Uint32Array(positions.buffer, positions.byteOffset, wordCount)
    const velocityWords = new Uint32Array(velocities.buffer, velocities.byteOffset, wordCount)
    return fnvWords(fnvWords(FNV_OFFSET, positionWords), velocityWords) >>> 0
  }

  snapshot() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#view(this.#position).slice(0, this.#count * 3),
    }
  }

  setPosition(id, position) {
    this.#checkId(id)
    checkVector(position, 'position')
    this.#view(this.#position).set(position, id * 3)
  }

  exportState() {
    return {
      tick: this.#tick,
      count: this.#count,
      positions: this.#view(this.#position).slice(0, this.#count * 3),
      velocities: this.#view(this.#velocity).slice(0, this.#count * 3),
    }
  }

  importState(state) {
    const words = this.#count * 3
    if (state.count !== this.#count) throw new RangeError('state holds ' + state.count + ' bodies, world has ' + this.#count)
    if (state.positions.length !== words || state.velocities.length !== words) {
      throw new RangeError('state arrays do not match the body count')
    }
    this.#view(this.#position).set(state.positions, 0)
    this.#view(this.#velocity).set(state.velocities, 0)
    this.#tick = state.tick
    this.#accumulator = 0
  }

  #view(handle) {
    return this.#memory.read(handle)
  }

  #copyBody(handle, id, out) {
    const view = this.#view(handle)
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
