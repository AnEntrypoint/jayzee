import { checkVector, isFiniteNumber, resolveWorldOptions } from '../world/options.js'
import { createBridge, readLayout } from './bridge.js'
import { solverIterationsFor } from './solverIterations.js'
import { PHYSICS_REBASE_M } from './physicsOrigin.js'
import { closeMailbox, trackMailboxWaits } from './threadMailbox.js'

const MAX_STEPS_PER_ADVANCE = 8
const BOX_WORDS = 6
const BATCH_WORDS = 6
const PAGE_SAMPLES = 256
export const SLOT_BITS = 17
export const SLOT_MASK = (1 << SLOT_BITS) - 1
export const LAST_BODY_GENERATION = (1 << (32 - SLOT_BITS)) - 2
const FNV_OFFSET = 0x811c9dc5
const FNV_PRIME = 0x01000193
const ENGINE_OK = 0
const ENGINE_MAX_STATICS = 64
const ENGINE_ZERO_THICKNESS = -6
const ENGINE_TOO_MANY_STATICS = -5
const ENGINE_WORKERS_DO_NOT_FIT = -8
const ENGINE_SEALED = -9
const QUERY_HIT = 1
const QUERY_MISS = 0
const HIT_WORDS = 9
const HIT_KINDS = Object.freeze(['none', 'planet', 'body', 'static', 'vegetation'])
const DEFAULT_PLAYERS = 64
const DEFAULT_WORKERS = 1
const DEFAULT_BUDGET_BYTES = 64 * 1024 * 1024
const MAX_PLAYERS = 1024
const MAX_WORKERS = 8
const DEFAULT_GLUE = new URL('../../engine/out/engine-core-64mib.mjs', import.meta.url).href
const NO_VELOCITY = Object.freeze([0, 0, 0])
const PROMOTED_ROW_WORDS = 2
const PROMOTED_STATE_WORDS = 2
const PROMOTED_BIT = 0x80000000
export const PROMOTED_BODY_GONE = 0xffffffff

export const TREE_CLASS = { trunk: 0, rock: 1, pass: 2 }

const engineError = (status, message) => new RangeError(message + ' (engine status ' + status + ')')

export class WorkersDoNotFitError extends RangeError {
  constructor(workers, players, budgetBytes) {
    super('the ' + workers + ' worker count does not fit ' + players + ' players in ' + budgetBytes + ' bytes')
    this.name = 'WorkersDoNotFitError'
    this.code = 'workers-do-not-fit'
    this.status = -8
    this.workers = workers
    this.players = players
    this.budgetBytes = budgetBytes
  }
}

export class BatchBeyondRebaseError extends RangeError {
  constructor(row, distanceM) {
    super('spawnMany row ' + row + ' is ' + distanceM + ' m from row 0, and the physics origin follows row 0 only, so a row past ' + PHYSICS_REBASE_M + ' m is stored in coarser float32 steps; spawn it in its own batch')
    this.name = 'BatchBeyondRebaseError'
    this.code = 'batch-beyond-rebase'
    this.row = row
    this.distanceM = distanceM
    this.limitM = PHYSICS_REBASE_M
  }
}

export class ArenaSealedError extends RangeError {
  constructor(name) {
    super('the engine arena is sealed, so the ' + name + ' is refused: it would allocate after setup')
    this.name = 'ArenaSealedError'
    this.code = 'arena-sealed'
    this.status = ENGINE_SEALED
  }
}

const bySlot = (a, b) => (a & SLOT_MASK) - (b & SLOT_MASK)

export const resolvePlan = (options = {}) => {
  const players = options.players ?? DEFAULT_PLAYERS
  const workers = options.workers ?? DEFAULT_WORKERS
  const budgetBytes = options.budgetBytes ?? DEFAULT_BUDGET_BYTES
  if (!Number.isInteger(players) || players < 1 || players > MAX_PLAYERS) throw new RangeError('players must be an integer in 1..' + MAX_PLAYERS)
  if (!Number.isInteger(workers) || workers < 1 || workers > MAX_WORKERS) throw new RangeError('workers must be an integer in 1..' + MAX_WORKERS)
  if (!isFiniteNumber(budgetBytes) || budgetBytes < 0) throw new RangeError('budgetBytes must be a finite number at or above zero')
  return Object.freeze({ players, workers, budgetBytes })
}

export const releaseEngineModule = (module) => {
  const threads = module.PThread
  if (!threads) return Promise.resolve(0)
  const workers = [...threads.runningWorkers, ...threads.unusedWorkers]
  threads.terminateAllThreads()
  closeMailbox(module.HEAPU8.buffer)
  return Promise.all(workers.map((worker) => worker.terminate())).then(() => workers.length)
}

export const loadEngineModule = async (glue = DEFAULT_GLUE, plan = resolvePlan()) => {
  trackMailboxWaits()
  const factory = (await import(glue)).default
  const module = await factory()
  const status = module._engine_init(plan.players, plan.workers, plan.budgetBytes)
  if (status === ENGINE_WORKERS_DO_NOT_FIT) throw new WorkersDoNotFitError(plan.workers, plan.players, plan.budgetBytes)
  if (status !== ENGINE_OK) throw engineError(status, 'engine_init refused the memory plan')
  return module
}

export class EngineWorld {
  #module
  #bridge
  #layout
  #capacity
  #tickRate
  #alive = new Set()
  #sortedHandles = null
  #accumulator = 0
  #positions
  #velocities
  #stageRows
  #stageHandles
  #scratch
  #hit
  #hashFloats = new Float64Array(0)
  #hashWords = new Uint32Array(0)
  #hashOut = new Uint32Array(1)
  #promotionCap = 0
  #promotedSeen = 0

  constructor(module, settings, layout) {
    this.#module = module
    this.#layout = layout
    this.#bridge = createBridge(module, layout)
    this.#capacity = settings.capacity
    this.#tickRate = settings.tickRate
    const buffer = module.HEAPF64.buffer
    this.#positions = new Float64Array(buffer, layout.regions.positions, layout.bodies * 3)
    this.#velocities = new Float64Array(buffer, layout.regions.velocities, layout.bodies * 3)
    this.#stageRows = new Float64Array(buffer, layout.regions.stageRows, layout.bodies * BATCH_WORDS)
    this.#stageHandles = new Uint32Array(buffer, layout.regions.stageHandles, layout.bodies)
    this.#scratch = new Int32Array(buffer, layout.regions.planetScratch, 4)
    this.#hit = new Float64Array(buffer, module._engine_planet_scratch_f64(), HIT_WORDS)
  }

  get count() {
    return this.#alive.size
  }

  get retiredSlots() {
    return this.#module._engine_retired_slots()
  }

  release() {
    return releaseEngineModule(this.#module)
  }

  get tick() {
    return Number(this.#module._engine_ticks())
  }

  get controlTick() {
    return this.#bridge.tickCount()
  }

  get stepSeconds() {
    return 1 / this.#tickRate
  }

  get layout() {
    return this.#layout
  }

  spawn(position, velocity = [0, 0, 0]) {
    checkVector(position, 'position')
    checkVector(velocity, 'velocity')
    if (this.#alive.size + this.retiredSlots >= this.#capacity) throw new RangeError('world is full: capacity ' + this.#capacity + ' less ' + this.retiredSlots + ' retired')
    const handle = this.#module._engine_spawn(position[0], position[1], position[2], velocity[0], velocity[1], velocity[2])
    if (handle < 0) throw engineError(handle, 'engine refused the spawn')
    this.#alive.add(handle)
    this.#sortedHandles = null
    return handle
  }

  follow(point) {
    checkVector(point, 'follow point')
    this.#write(this.#module._engine_follow(point[0], point[1], point[2]), 'physics origin')
  }

  get rebaseCount() {
    return this.#module._engine_world_rebase_count()
  }

  waitCounts() {
    const read = this.#module._engine_wait_count
    if (typeof read !== 'function') return null
    return { mainSpinWaits: read(0), spinTimeouts: read(1), workerWaits: read(2), timedSlices: read(3), yields: read(4) }
  }

  addBox(box) {
    if (!Array.isArray(box) || box.length !== BOX_WORDS || !box.every(isFiniteNumber)) throw new RangeError('a box is six finite numbers: min x, y, z then max x, y, z')
    const status = this.#module._engine_world_add_box(box[0], box[1], box[2], box[3], box[4], box[5])
    if (status === ENGINE_ZERO_THICKNESS) throw new RangeError('a box has zero thickness on an axis')
    if (status === ENGINE_TOO_MANY_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
    this.#write(status, 'box')
  }

  addCharacter({ position, radius, halfHeight }) {
    checkVector(position, 'character position')
    if (![radius, halfHeight].every(isFiniteNumber)) throw new RangeError('character radius and halfHeight must be finite numbers')
    const index = this.#module._engine_character_add(position[0], position[1], position[2], radius, halfHeight)
    if (index === ENGINE_SEALED) throw new ArenaSealedError('character')
    if (index < 0) throw engineError(index, 'engine refused the character')
    return index
  }

  tuneCharacters({ stepUp, stickDown }) {
    if (![stepUp, stickDown].every(isFiniteNumber)) throw new RangeError('character stepUp and stickDown must be finite numbers')
    this.#write(this.#module._engine_character_tune(stepUp, stickDown), 'character tuning')
  }

  raycast(origin, direction, maxDistance, out = { distance: 0, position: [0, 0, 0], normal: [0, 0, 0], kind: 'none', handle: 0 }) {
    checkVector(origin, 'ray origin')
    checkVector(direction, 'ray direction')
    const length = Math.hypot(direction[0], direction[1], direction[2])
    if (!(length > 0)) throw new RangeError('ray direction must not be zero')
    if (!isFiniteNumber(maxDistance) || !(maxDistance > 0)) throw new RangeError('ray maxDistance must be a finite number above zero')
    const scale = maxDistance / length
    const status = this.#module._engine_world_raycast(origin[0], origin[1], origin[2], direction[0] * scale, direction[1] * scale, direction[2] * scale)
    return this.#readHit(status, maxDistance, out, 'ray cast')
  }

  shapeCast({ radius, halfHeight = 0 }, origin, direction, maxDistance, out = { distance: 0, position: [0, 0, 0], normal: [0, 0, 0], kind: 'none', handle: 0 }) {
    checkVector(origin, 'cast origin')
    checkVector(direction, 'cast direction')
    if (![radius, halfHeight].every(isFiniteNumber)) throw new RangeError('cast radius and halfHeight must be finite numbers')
    const length = Math.hypot(direction[0], direction[1], direction[2])
    if (!(length > 0)) throw new RangeError('cast direction must not be zero')
    if (!isFiniteNumber(maxDistance) || !(maxDistance > 0)) throw new RangeError('cast maxDistance must be a finite number above zero')
    const scale = maxDistance / length
    const status = this.#module._engine_world_shapecast(radius, halfHeight, origin[0], origin[1], origin[2], direction[0] * scale, direction[1] * scale, direction[2] * scale)
    return this.#readHit(status, maxDistance, out, 'shape cast')
  }

  probePlanet({ radius, halfHeight = 0 }, center, { planetFirst = false, maxSeparation = 0 } = {}, out = { distance: 0, position: [0, 0, 0], normal: [0, 0, 0], kind: 'none', handle: 0 }) {
    checkVector(center, 'probe centre')
    if (![radius, halfHeight, maxSeparation].every(isFiniteNumber)) throw new RangeError('probe radius, halfHeight and maxSeparation must be finite numbers')
    const status = this.#module._engine_planet_collide_probe(radius, halfHeight, planetFirst ? 1 : 0, maxSeparation, center[0], center[1], center[2])
    return this.#readHit(status, 1, out, 'planet probe')
  }

  setCharacterVelocity(index, velocity) {
    checkVector(velocity, 'character velocity')
    this.#module._engine_character_set_velocity(index, velocity[0], velocity[1], velocity[2])
  }

  characterSupported(index) {
    return this.#module._engine_character_supported(index) === 1
  }

  characterPosition(index, out = [0, 0, 0]) {
    out[0] = this.#module._engine_character_axis(index, 0)
    out[1] = this.#module._engine_character_axis(index, 1)
    out[2] = this.#module._engine_character_axis(index, 2)
    return out
  }

  characterBodyPosition(index, out = [0, 0, 0]) {
    out[0] = this.#module._engine_character_body_axis(index, 0)
    out[1] = this.#module._engine_character_body_axis(index, 1)
    out[2] = this.#module._engine_character_body_axis(index, 2)
    return out
  }

  spawnMany(rows) {
    if (!Array.isArray(rows)) throw new TypeError('spawnMany takes an array of { position, velocity } rows')
    if (rows.length > this.#capacity - this.#alive.size) {
      throw new RangeError('world has room for ' + (this.#capacity - this.#alive.size) + ' more bodies')
    }
    for (let row = 0; row < rows.length; row++) {
      checkVector(rows[row].position, 'position')
      checkVector(rows[row].velocity ?? NO_VELOCITY, 'velocity')
    }
    for (let row = 1; row < rows.length; row++) {
      const first = rows[0].position
      const position = rows[row].position
      const distanceM = Math.hypot(position[0] - first[0], position[1] - first[1], position[2] - first[2])
      if (distanceM > PHYSICS_REBASE_M) throw new BatchBeyondRebaseError(row, distanceM)
    }
    for (let row = 0; row < rows.length; row++) {
      const position = rows[row].position
      const velocity = rows[row].velocity ?? NO_VELOCITY
      const base = row * BATCH_WORDS
      this.#stageRows[base] = position[0]
      this.#stageRows[base + 1] = position[1]
      this.#stageRows[base + 2] = position[2]
      this.#stageRows[base + 3] = velocity[0]
      this.#stageRows[base + 4] = velocity[1]
      this.#stageRows[base + 5] = velocity[2]
    }
    const status = this.#module._engine_spawn_batch(rows.length)
    if (status < 0) throw engineError(status, 'engine refused the batch')
    const spawned = []
    for (let row = 0; row < rows.length; row++) {
      const handle = this.#stageHandles[row]
      this.#alive.add(handle)
      spawned.push(handle)
    }
    this.#sortedHandles = null
    return spawned
  }

  despawn(handle) {
    this.#checkHandle(handle)
    this.#write(this.#module._engine_despawn(handle), 'despawn')
    this.#alive.delete(handle)
    this.#sortedHandles = null
  }

  position(handle, out = [0, 0, 0]) {
    this.#checkHandle(handle)
    const base = (handle & SLOT_MASK) * 3
    out[0] = this.#positions[base]
    out[1] = this.#positions[base + 1]
    out[2] = this.#positions[base + 2]
    return out
  }

  velocity(handle, out = [0, 0, 0]) {
    this.#checkHandle(handle)
    const base = (handle & SLOT_MASK) * 3
    out[0] = this.#velocities[base]
    out[1] = this.#velocities[base + 1]
    out[2] = this.#velocities[base + 2]
    return out
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
    if (this.#promotionCap !== 0) this.#adoptPromoted()
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
    this.hashInto(this.#hashOut, 0)
    return this.#hashOut[0]
  }

  hashInto(out, at) {
    const size = this.#alive.size * 3
    if (this.#hashFloats.length !== size) {
      this.#hashFloats = new Float64Array(size)
      this.#hashWords = new Uint32Array(this.#hashFloats.buffer)
    }
    const words = this.#hashWords
    let h = FNV_OFFSET
    this.#gather(this.#positions, this.#hashFloats)
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], FNV_PRIME)
    this.#gather(this.#velocities, this.#hashFloats)
    for (let i = 0; i < words.length; i++) h = Math.imul(h ^ words[i], FNV_PRIME)
    out[at] = h
  }

  snapshot() {
    return {
      tick: this.tick,
      count: this.#alive.size,
      positions: this.#gather(this.#positions),
    }
  }

  exportState() {
    this.#adoptPromoted()
    const state = {
      tick: this.tick,
      count: this.#alive.size,
      positions: this.#gather(this.#positions),
      velocities: this.#gather(this.#velocities),
    }
    if (this.#promotedSeen > 0) state.promoted = this.#promotedState()
    return state
  }

  importState(state) {
    const promoted = state.promoted
    if (promoted !== undefined && promoted.length % PROMOTED_STATE_WORDS !== 0) throw new RangeError('the promoted list holds pairs of instance and body index')
    this.#adoptPromoted()
    const order = promoted !== undefined || this.#promotedSeen > 0 ? this.#restorePromoted(promoted ?? [], state.count) : this.#handles()
    const words = this.#alive.size * 3
    if (state.count !== this.#alive.size) throw new RangeError('state holds ' + state.count + ' bodies, world has ' + this.#alive.size)
    if (state.positions.length !== words || state.velocities.length !== words) {
      throw new RangeError('state arrays do not match the body count')
    }
    order.forEach((handle, index) => {
      const at = index * 3
      this.#write(this.#module._engine_set_position(handle, state.positions[at], state.positions[at + 1], state.positions[at + 2]), 'position')
      this.#write(this.#module._engine_set_velocity(handle, state.velocities[at], state.velocities[at + 1], state.velocities[at + 2]), 'velocity')
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

  allocationFailures() {
    return Number(this.#module._engine_allocation_failures())
  }

  arenaUsed() {
    return Number(this.#module._engine_arena_used())
  }

  seal() {
    this.#module._engine_arena_seal()
  }

  get sealed() {
    return this.#module._engine_arena_sealed() === 1
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
    return { face: this.#scratch[0], cx: this.#scratch[1], cy: this.#scratch[2] }
  }

  resolveCell(face, cx, cy) {
    this.#write(this.#module._engine_planet_resolve(face, cx, cy), 'cell resolve')
    return { face: this.#scratch[0], cx: this.#scratch[1], cy: this.#scratch[2] }
  }

  cellKey(face, cx, cy) {
    const key = this.#module._engine_planet_key(face, cx, cy)
    this.#write(this.#scratch[3], 'cell key')
    return Number(key)
  }

  height(x, y, z) {
    return this.#module._engine_planet_height(x, y, z)
  }

  faceLocal(point) {
    checkVector(point, 'point')
    const face = this.#module._engine_planet_face_local(point[0], point[1], point[2])
    this.#write(face < 0 ? face : 0, 'face local')
    const at = this.#module._engine_planet_scratch_f64() / 8
    return { face, ox: this.#module.HEAPF64[at], oy: this.#module.HEAPF64[at + 1] }
  }

  cellFrame(face, cx, cy) {
    this.#write(this.#module._engine_planet_cell_frame(face, cx, cy), 'cell frame')
    const at = this.#module._engine_planet_scratch_f64() / 8
    const f = this.#module.HEAPF64
    return {
      origin: [f[at], f[at + 1], f[at + 2]],
      uEdge: [f[at + 3], f[at + 4], f[at + 5]],
      vEdge: [f[at + 6], f[at + 7], f[at + 8]],
    }
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

  applyPages() {
    this.#module._engine_page_apply()
  }

  releasePage(key) {
    this.#write(this.#module._engine_page_release(BigInt(key)), 'page release')
  }

  configureVegetation({ origin, cellSize }) {
    if (!isFiniteNumber(origin) || !isFiniteNumber(cellSize)) throw new RangeError('vegetation origin and cellSize must be finite numbers')
    this.#dropPromoted()
    this.#write(this.#module._engine_veg_configure(origin, cellSize), 'vegetation field')
  }

  placeTree(position, yaw, scale, cls) {
    checkVector(position, 'position')
    this.#write(this.#module._engine_veg_place(position[0], position[1], position[2], yaw, scale, cls), 'tree')
  }

  attachVegetation() {
    this.#write(this.#module._engine_veg_attach(), 'vegetation body')
  }

  setVegetationPromotion(cap) {
    if (!Number.isInteger(cap) || cap < 0) throw new RangeError('the promotion cap is a whole number of instances, or 0 for none')
    this.#write(this.#module._engine_veg_set_promotion(cap), 'vegetation promotion')
    this.#promotionCap = cap
  }

  promoteVegetation(instance) {
    if (!Number.isInteger(instance) || instance < 0) throw new RangeError('the instance is a whole number index into the vegetation field')
    this.#adoptPromoted()
    const handle = this.#module._engine_veg_promote(instance)
    if (handle < 0) throw engineError(handle, 'engine refused the promotion of instance ' + instance)
    this.#adoptPromoted()
    return handle
  }

  promotedVegetation() {
    this.#adoptPromoted()
    const rows = this.#module._engine_veg_promoted_rows() / 4
    const out = []
    for (let i = 0; i < this.#promotedSeen; i++) {
      const instance = this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS]
      const handle = this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS + 1]
      const at = this.#module._engine_veg_instance(instance) / 4
      const f = this.#module.HEAPF32
      out.push({
        instance,
        handle,
        alive: this.#alive.has(handle),
        position: [f[at], f[at + 1], f[at + 2]],
        yaw: f[at + 3],
        scale: f[at + 4],
        cls: (this.#module.HEAPU32[at + 5] & ~PROMOTED_BIT) >>> 0,
      })
    }
    return out
  }

  vegetationPromotion() {
    return {
      cap: Number(this.#module._engine_veg_promotion_cap()),
      promoted: Number(this.#module._engine_veg_promoted_count()),
      refusals: Number(this.#module._engine_veg_promotion_refusals()),
    }
  }

  restoreVegetation() {
    this.#dropPromoted()
    this.#write(this.#module._engine_veg_restore(), 'vegetation restore')
  }

  #adoptPromoted() {
    const count = this.#module._engine_veg_promoted_count()
    if (count === this.#promotedSeen) return
    const rows = this.#module._engine_veg_promoted_rows() / 4
    for (let i = this.#promotedSeen; i < count; i++) this.#alive.add(this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS + 1])
    this.#promotedSeen = count
    this.#sortedHandles = null
  }

  #dropPromoted() {
    this.#adoptPromoted()
    const rows = this.#module._engine_veg_promoted_rows() / 4
    for (let i = 0; i < this.#promotedSeen; i++) this.#alive.delete(this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS + 1])
    this.#promotedSeen = 0
    this.#sortedHandles = null
  }

  #promotedState() {
    const rows = this.#module._engine_veg_promoted_rows() / 4
    const handles = this.#handles()
    const out = new Uint32Array(this.#promotedSeen * PROMOTED_STATE_WORDS)
    for (let i = 0; i < this.#promotedSeen; i++) {
      const handle = this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS + 1]
      out[i * PROMOTED_STATE_WORDS] = this.#module.HEAPU32[rows + i * PROMOTED_ROW_WORDS]
      out[i * PROMOTED_STATE_WORDS + 1] = this.#alive.has(handle) ? handles.indexOf(handle) : PROMOTED_BODY_GONE
    }
    return out
  }

  #restorePromoted(promoted, count) {
    const heap = this.#module.HEAPU32
    const rows = this.#module._engine_veg_promoted_rows() / 4
    const wanted = promoted.length / PROMOTED_STATE_WORDS
    let same = wanted === this.#promotedSeen
    for (let i = 0; same && i < wanted; i++) {
      const held = this.#alive.has(heap[rows + i * PROMOTED_ROW_WORDS + 1])
      same = heap[rows + i * PROMOTED_ROW_WORDS] === promoted[i * PROMOTED_STATE_WORDS] && held === (promoted[i * PROMOTED_STATE_WORDS + 1] !== PROMOTED_BODY_GONE)
    }
    if (!same) {
      this.restoreVegetation()
      for (let i = 0; i < wanted; i++) {
        const handle = this.promoteVegetation(promoted[i * PROMOTED_STATE_WORDS])
        if (promoted[i * PROMOTED_STATE_WORDS + 1] === PROMOTED_BODY_GONE) this.despawn(handle)
      }
    }
    const order = new Array(count).fill(-1)
    const taken = new Set()
    for (let i = 0; i < wanted; i++) {
      const index = promoted[i * PROMOTED_STATE_WORDS + 1]
      if (index === PROMOTED_BODY_GONE) continue
      if (!(index < count) || order[index] !== -1) throw new RangeError('the promoted list names body index ' + index + ' twice or past the body count')
      order[index] = heap[rows + i * PROMOTED_ROW_WORDS + 1]
      taken.add(order[index])
    }
    let next = 0
    for (const handle of this.#handles()) {
      if (taken.has(handle)) continue
      while (next < count && order[next] !== -1) next += 1
      if (next < count) order[next] = handle
      next += 1
    }
    return order
  }

  vegetationPlaced() {
    return Number(this.#module._engine_veg_placed())
  }

  #handles() {
    if (this.#sortedHandles === null) this.#sortedHandles = [...this.#alive].sort(bySlot)
    return this.#sortedHandles
  }

  #gather(source, out = new Float64Array(this.#alive.size * 3)) {
    const handles = this.#handles()
    for (let index = 0; index < handles.length; index++) {
      const from = (handles[index] & SLOT_MASK) * 3
      const to = index * 3
      out[to] = source[from]
      out[to + 1] = source[from + 1]
      out[to + 2] = source[from + 2]
    }
    return out
  }

  #readHit(status, span, out, name) {
    if (status === QUERY_MISS) return null
    if (status !== QUERY_HIT) throw engineError(status, 'engine refused the ' + name)
    const hit = this.#hit
    out.distance = hit[0] * span
    out.position[0] = hit[1]
    out.position[1] = hit[2]
    out.position[2] = hit[3]
    out.normal[0] = hit[4]
    out.normal[1] = hit[5]
    out.normal[2] = hit[6]
    out.kind = HIT_KINDS[hit[7]]
    out.handle = hit[8]
    return out
  }

  #write(status, name) {
    if (status === ENGINE_SEALED) throw new ArenaSealedError(name)
    if (status !== ENGINE_OK) throw engineError(status, 'engine refused the ' + name)
  }

  #checkHandle(handle) {
    if (!this.#alive.has(handle)) throw new RangeError('no body with id ' + handle)
  }
}

export const createEngineWorld = async (options = {}, glue = DEFAULT_GLUE) => {
  const settings = resolveWorldOptions(options)
  if (settings.boxCount > ENGINE_MAX_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
  if (settings.drag >= 1) throw new RangeError('drag must be below 1 on the engine, where it is a Jolt damping factor')
  const plan = resolvePlan(options)
  const module = await loadEngineModule(glue, plan)
  const layout = readLayout(module)
  if (settings.capacity > layout.bodies) {
    throw new RangeError('engine capacity is at most ' + layout.bodies + ' for ' + layout.players + ' players')
  }
  const iterations = options.solverIterations === undefined ? solverIterationsFor(layout.players) : settings.solverIterations
  const configured = module._engine_world_configure(
    settings.capacity,
    settings.tickRate,
    settings.gravity,
    settings.drag,
    settings.radius,
    settings.restitution,
    iterations,
  )
  if (configured === ENGINE_SEALED) throw new ArenaSealedError('world configuration')
  if (configured !== ENGINE_OK) throw engineError(configured, 'engine refused the world configuration')
  for (let offset = 0; offset < settings.flatBoxes.length; offset += BOX_WORDS) {
    const box = settings.flatBoxes.slice(offset, offset + BOX_WORDS)
    const status = module._engine_world_add_box(box[0], box[1], box[2], box[3], box[4], box[5])
    if (status === ENGINE_ZERO_THICKNESS) throw new RangeError('a box has zero thickness on an axis')
    if (status === ENGINE_TOO_MANY_STATICS) throw new RangeError('engine holds at most ' + ENGINE_MAX_STATICS + ' static boxes')
    if (status !== ENGINE_OK) throw engineError(status, 'engine refused a box')
  }
  return new EngineWorld(module, settings, layout)
}
