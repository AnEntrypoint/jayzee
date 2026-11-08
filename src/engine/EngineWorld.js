import { checkVector, isFiniteNumber, resolveWorldOptions } from '../world/options.js'

const MAX_STEPS_PER_ADVANCE = 8
const BOX_WORDS = 6
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const ENGINE_MAX_BODIES = 4096
const ENGINE_MAX_STATICS = 64
const ENGINE_OK = 0
const ENGINE_ZERO_THICKNESS = -6
const ENGINE_TOO_MANY_STATICS = -5
const DEFAULT_GLUE = new URL('../../engine/out/engine-core-64mib.mjs', import.meta.url).href

const fnvWords = (hash, words) => {
  let h = hash
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], FNV_PRIME)
  return h
}

const engineError = (status, message) => new RangeError(message + ' (engine status ' + status + ')')

export class EngineWorld {
  #module
  #capacity
  #tickRate
  #count = 0
  #accumulator = 0

  constructor(module, settings) {
    this.#module = module
    this.#capacity = settings.capacity
    this.#tickRate = settings.tickRate
  }

  get count() {
    return this.#count
  }

  get tick() {
    return Number(this.#module._engine_ticks())
  }

  get stepSeconds() {
    return 1 / this.#tickRate
  }

  spawn(position, velocity = [0, 0, 0]) {
    checkVector(position, 'position')
    checkVector(velocity, 'velocity')
    if (this.#count === this.#capacity) throw new RangeError('world is full: capacity ' + this.#capacity)
    const id = this.#module._engine_spawn(position[0], position[1], position[2], velocity[0], velocity[1], velocity[2])
    if (id < 0) throw engineError(id, 'engine refused the spawn')
    this.#count += 1
    return id
  }

  position(id) {
    this.#checkId(id)
    return Array.from(this.#floats(this.#module._engine_positions(), id * 3, 3))
  }

  velocity(id) {
    this.#checkId(id)
    return Array.from(this.#floats(this.#module._engine_velocities(), id * 3, 3))
  }

  setVelocity(id, velocity) {
    this.#checkId(id)
    checkVector(velocity, 'velocity')
    this.#write(this.#module._engine_set_velocity(id, velocity[0], velocity[1], velocity[2]), 'velocity')
  }

  step() {
    this.#module._engine_tick(1)
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
    const positions = this.#floats(this.#module._engine_positions(), 0, this.#count * 3)
    const velocities = this.#floats(this.#module._engine_velocities(), 0, this.#count * 3)
    const words = (view) => new Uint32Array(view.buffer, view.byteOffset, view.length * 2)
    return fnvWords(fnvWords(FNV_OFFSET, words(positions)), words(velocities)) >>> 0
  }

  snapshot() {
    return {
      tick: this.tick,
      count: this.#count,
      positions: this.#floats(this.#module._engine_positions(), 0, this.#count * 3).slice(),
    }
  }

  setPosition(id, position) {
    this.#checkId(id)
    checkVector(position, 'position')
    this.#write(this.#module._engine_set_position(id, position[0], position[1], position[2]), 'position')
  }

  exportState() {
    return {
      tick: this.tick,
      count: this.#count,
      positions: this.#floats(this.#module._engine_positions(), 0, this.#count * 3).slice(),
      velocities: this.#floats(this.#module._engine_velocities(), 0, this.#count * 3).slice(),
    }
  }

  importState(state) {
    const words = this.#count * 3
    if (state.count !== this.#count) throw new RangeError('state holds ' + state.count + ' bodies, world has ' + this.#count)
    if (state.positions.length !== words || state.velocities.length !== words) {
      throw new RangeError('state arrays do not match the body count')
    }
    for (let id = 0; id < this.#count; id++) {
      const p = state.positions.slice(id * 3, id * 3 + 3)
      const v = state.velocities.slice(id * 3, id * 3 + 3)
      this.#write(this.#module._engine_set_position(id, p[0], p[1], p[2]), 'position')
      this.#write(this.#module._engine_set_velocity(id, v[0], v[1], v[2]), 'velocity')
    }
    this.#module._engine_set_tick(BigInt(state.tick))
    this.#accumulator = 0
  }

  #floats(pointer, offset, length) {
    const start = pointer / 8 + offset
    return this.#module.HEAPF64.subarray(start, start + length)
  }

  #write(status, name) {
    if (status !== ENGINE_OK) throw engineError(status, 'engine refused the ' + name)
  }

  #checkId(id) {
    if (!Number.isInteger(id) || id < 0 || id >= this.#count) throw new RangeError('no body with id ' + id)
  }
}

export const createEngineWorld = async (options = {}, glue = DEFAULT_GLUE) => {
  const settings = resolveWorldOptions(options)
  if (settings.capacity > ENGINE_MAX_BODIES) throw new RangeError('engine capacity is at most ' + ENGINE_MAX_BODIES)
  if (settings.boxCount > ENGINE_MAX_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
  if (settings.drag >= 1) throw new RangeError('drag must be below 1 on the engine, where it is a Jolt damping factor')
  const factory = (await import(glue)).default
  const module = await factory()
  if (module._engine_init() !== ENGINE_OK) throw new Error('engine_init failed')
  const configured = module._engine_world_configure(
    settings.capacity,
    settings.tickRate,
    settings.gravity,
    settings.drag,
    settings.radius,
    settings.restitution,
    settings.solverIterations,
  )
  if (configured !== ENGINE_OK) throw engineError(configured, 'engine refused the world configuration')
  for (let offset = 0; offset < settings.flatBoxes.length; offset += BOX_WORDS) {
    const box = settings.flatBoxes.slice(offset, offset + BOX_WORDS)
    const status = module._engine_world_add_box(box[0], box[1], box[2], box[3], box[4], box[5])
    if (status === ENGINE_ZERO_THICKNESS) throw new RangeError('a box has zero thickness on an axis')
    if (status === ENGINE_TOO_MANY_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
    if (status !== ENGINE_OK) throw engineError(status, 'engine refused a box')
  }
  return new EngineWorld(module, settings)
}
