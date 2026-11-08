import { checkVector, isFiniteNumber, resolveWorldOptions } from '../world/options.js'
import { createBridge } from './bridge.js'

const MAX_STEPS_PER_ADVANCE = 8
const BOX_WORDS = 6
const BATCH_WORDS = 6
const PAGE_SAMPLES = 256
const SLOT_MASK = 0xffff
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const ENGINE_OK = 0
const ENGINE_MAX_BODIES = 4096
const ENGINE_MAX_STATICS = 64
const ENGINE_ZERO_THICKNESS = -6
const ENGINE_TOO_MANY_STATICS = -5
const DEFAULT_GLUE = new URL('../../engine/out/engine-core-64mib.mjs', import.meta.url).href

export const TREE_CLASS = { trunk: 0, rock: 1, pass: 2 }

const fnvWords = (hash, words) => {
  let h = hash
  for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], FNV_PRIME)
  return h
}

const engineError = (status, message) => new RangeError(message + ' (engine status ' + status + ')')

const bySlot = (a, b) => (a & SLOT_MASK) - (b & SLOT_MASK)

export const loadEngineModule = async (glue = DEFAULT_GLUE) => {
  const factory = (await import(glue)).default
  const module = await factory()
  if (module._engine_init() !== ENGINE_OK) throw new Error('engine_init failed')
  return module
}

export class EngineWorld {
  #module
  #bridge
  #capacity
  #tickRate
  #alive = new Set()
  #accumulator = 0

  constructor(module, settings) {
    this.#module = module
    this.#bridge = createBridge(module)
    this.#capacity = settings.capacity
    this.#tickRate = settings.tickRate
  }

  get count() {
    return this.#alive.size
  }

  get retiredSlots() {
    return this.#module._engine_retired_slots()
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
    if (this.#alive.size + this.retiredSlots >= this.#capacity) throw new RangeError('world is full: capacity ' + this.#capacity + ' less ' + this.retiredSlots + ' retired')
    const handle = this.#module._engine_spawn(position[0], position[1], position[2], velocity[0], velocity[1], velocity[2])
    if (handle < 0) throw engineError(handle, 'engine refused the spawn')
    this.#alive.add(handle)
    return handle
  }

  spawnMany(rows) {
    if (!Array.isArray(rows)) throw new TypeError('spawnMany takes an array of { position, velocity } rows')
    if (rows.length > this.#capacity - this.#alive.size) {
      throw new RangeError('world has room for ' + (this.#capacity - this.#alive.size) + ' more bodies')
    }
    const staged = rows.map((row) => {
      checkVector(row.position, 'position')
      checkVector(row.velocity ?? [0, 0, 0], 'velocity')
      return [...row.position, ...(row.velocity ?? [0, 0, 0])]
    })
    const stage = this.#module._engine_stage() / 4
    staged.forEach((values, row) => {
      for (let k = 0; k < BATCH_WORDS; k++) this.#module.HEAPF32[stage + row * BATCH_WORDS + k] = values[k]
    })
    const status = this.#module._engine_spawn_batch(rows.length)
    if (status < 0) throw engineError(status, 'engine refused the batch')
    const handles = this.#module._engine_stage_handles() / 4
    const spawned = []
    for (let row = 0; row < rows.length; row++) {
      const handle = this.#module.HEAPU32[handles + row]
      this.#alive.add(handle)
      spawned.push(handle)
    }
    return spawned
  }

  despawn(handle) {
    this.#checkHandle(handle)
    this.#write(this.#module._engine_despawn(handle), 'despawn')
    this.#alive.delete(handle)
  }

  position(handle) {
    this.#checkHandle(handle)
    return Array.from(this.#floats(this.#module._engine_positions(), (handle & SLOT_MASK) * 3, 3))
  }

  velocity(handle) {
    this.#checkHandle(handle)
    return Array.from(this.#floats(this.#module._engine_velocities(), (handle & SLOT_MASK) * 3, 3))
  }

  setVelocity(handle, velocity) {
    this.#checkHandle(handle)
    checkVector(velocity, 'velocity')
    this.#write(this.#module._engine_set_velocity(handle, velocity[0], velocity[1], velocity[2]), 'velocity')
  }

  setPosition(handle, position) {
    this.#checkHandle(handle)
    checkVector(position, 'position')
    this.#write(this.#module._engine_set_position(handle, position[0], position[1], position[2]), 'position')
  }

  step() {
    this.#bridge.tick(1)
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
    const positions = this.#gather(this.#module._engine_positions())
    const velocities = this.#gather(this.#module._engine_velocities())
    const words = (view) => new Uint32Array(view.buffer, view.byteOffset, view.length * 2)
    return fnvWords(fnvWords(FNV_OFFSET, words(positions)), words(velocities)) >>> 0
  }

  snapshot() {
    return {
      tick: this.tick,
      count: this.#alive.size,
      positions: this.#gather(this.#module._engine_positions()),
    }
  }

  exportState() {
    return {
      tick: this.tick,
      count: this.#alive.size,
      positions: this.#gather(this.#module._engine_positions()),
      velocities: this.#gather(this.#module._engine_velocities()),
    }
  }

  importState(state) {
    const words = this.#alive.size * 3
    if (state.count !== this.#alive.size) throw new RangeError('state holds ' + state.count + ' bodies, world has ' + this.#alive.size)
    if (state.positions.length !== words || state.velocities.length !== words) {
      throw new RangeError('state arrays do not match the body count')
    }
    this.#handles().forEach((handle, index) => {
      const p = state.positions.slice(index * 3, index * 3 + 3)
      const v = state.velocities.slice(index * 3, index * 3 + 3)
      this.#write(this.#module._engine_set_position(handle, p[0], p[1], p[2]), 'position')
      this.#write(this.#module._engine_set_velocity(handle, v[0], v[1], v[2]), 'velocity')
    })
    this.#module._engine_set_tick(BigInt(state.tick))
    this.#accumulator = 0
  }

  markWarmup() {
    this.#module._engine_mark_warmup()
  }

  allocationsSinceWarmup() {
    return Number(this.#module._engine_allocations_since_warmup())
  }

  memoryBytes() {
    return Number(this.#module._engine_memory_bytes())
  }

  physicsBodies() {
    return this.#module._engine_physics_bodies()
  }

  addTrunk(position, radius, halfHeight) {
    checkVector(position, 'position')
    this.#write(this.#module._engine_world_add_trunk(position[0], position[1], position[2], radius, halfHeight), 'trunk')
  }

  configurePlanet({ radius, cellSize, gravity, maxHeight }) {
    if (![radius, cellSize, gravity, maxHeight].every(isFiniteNumber)) throw new RangeError('planet values must be finite numbers')
    this.#write(this.#module._engine_planet_configure(radius, cellSize, gravity, maxHeight), 'planet configuration')
  }

  locateCell(point) {
    checkVector(point, 'point')
    this.#write(this.#module._engine_planet_locate(point[0], point[1], point[2]), 'cell lookup')
    const scratch = this.#scratch()
    return { face: scratch[0], cx: scratch[1], cy: scratch[2] }
  }

  resolveCell(face, cx, cy) {
    this.#write(this.#module._engine_planet_resolve(face, cx, cy), 'cell resolve')
    const scratch = this.#scratch()
    return { face: scratch[0], cx: scratch[1], cy: scratch[2] }
  }

  cellKey(face, cx, cy) {
    const key = this.#module._engine_planet_key(face, cx, cy)
    this.#write(this.#scratch()[3], 'cell key')
    return Number(key)
  }

  height(x, y, z) {
    return this.#module._engine_planet_height(x, y, z)
  }

  gapQueries() {
    return Number(this.#module._engine_planet_gap_queries())
  }

  residentPages() {
    return this.#module._engine_planet_resident()
  }

  pageSlot(key) {
    return this.#module._engine_page_lookup(BigInt(key))
  }

  stagePage(key) {
    const slot = this.#module._engine_page_stage(BigInt(key))
    if (slot < 0) throw new RangeError('no free page slot for key ' + key)
    return slot
  }

  writePage(key, samples) {
    if (samples.length !== PAGE_SAMPLES) throw new RangeError('a page holds ' + PAGE_SAMPLES + ' samples')
    const slot = this.stagePage(key)
    const base = this.#module._engine_page_samples(slot) / 4
    this.#module.HEAPF32.set(samples, base)
    this.#write(this.#module._engine_page_commit(slot), 'page commit')
    return slot
  }

  releasePage(key) {
    this.#write(this.#module._engine_page_release(BigInt(key)), 'page release')
  }

  configureVegetation({ origin, cellSize }) {
    if (!isFiniteNumber(origin) || !isFiniteNumber(cellSize)) throw new RangeError('vegetation origin and cellSize must be finite numbers')
    this.#write(this.#module._engine_veg_configure(origin, cellSize), 'vegetation field')
  }

  placeTree(position, yaw, scale, cls) {
    checkVector(position, 'position')
    this.#write(this.#module._engine_veg_place(position[0], position[1], position[2], yaw, scale, cls), 'tree')
  }

  attachVegetation() {
    this.#write(this.#module._engine_veg_attach(), 'vegetation body')
  }

  vegetationPlaced() {
    return Number(this.#module._engine_veg_placed())
  }

  #scratch() {
    const base = this.#module._engine_planet_scratch() / 4
    return this.#module.HEAP32.subarray(base, base + 4)
  }

  #handles() {
    return [...this.#alive].sort(bySlot)
  }

  #gather(pointer) {
    const handles = this.#handles()
    const out = new Float64Array(handles.length * 3)
    handles.forEach((handle, index) => out.set(this.#floats(pointer, (handle & SLOT_MASK) * 3, 3), index * 3))
    return out
  }

  #floats(pointer, offset, length) {
    const start = pointer / 8 + offset
    return this.#module.HEAPF64.subarray(start, start + length)
  }

  #write(status, name) {
    if (status !== ENGINE_OK) throw engineError(status, 'engine refused the ' + name)
  }

  #checkHandle(handle) {
    if (!this.#alive.has(handle)) throw new RangeError('no body with id ' + handle)
  }
}

export const createEngineWorld = async (options = {}, glue = DEFAULT_GLUE) => {
  const settings = resolveWorldOptions(options)
  if (settings.capacity > ENGINE_MAX_BODIES) throw new RangeError('engine capacity is at most ' + ENGINE_MAX_BODIES)
  if (settings.boxCount > ENGINE_MAX_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
  if (settings.drag >= 1) throw new RangeError('drag must be below 1 on the engine, where it is a Jolt damping factor')
  const module = await loadEngineModule(glue)
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
