const CONTROL_INTS_PER_SLOT = 2
const PAYLOAD_FLOATS_PER_SLOT = 10
const HEADER_INTS = 4
const RING_MAGIC = 0x54524e47
const HEADER_MAGIC = 0
const HEADER_CAPACITY = 1
const HEADER_GENERATION = 2
const HEADER_EPOCH = 3
const SLOT_GENERATION = 0
const SLOT_PLAYER = 1
const POSITION_AT = 0
const POSITION_LENGTH = 3
const ROTATION_AT = 3
const ROTATION_LENGTH = 4
const VELOCITY_AT = 7
const VELOCITY_LENGTH = 3
const EMPTY_PLAYER = -1
const INT32_MAX = 0x7fffffff
const WRITE_LOCK_ATTEMPTS = 64
const SLOT_READ_ATTEMPTS = 4
const CUT_READ_ATTEMPTS = 4
const UNVERSIONED = -1

export const TRANSFORM_RING_LAYOUT = Object.freeze({
  headerInts: HEADER_INTS,
  controlIntsPerSlot: CONTROL_INTS_PER_SLOT,
  payloadFloatsPerSlot: PAYLOAD_FLOATS_PER_SLOT
})

const isLocked = (generation) => (generation & 1) === 1
const headerBytes = () => HEADER_INTS * Int32Array.BYTES_PER_ELEMENT
const controlBytes = (capacity) => capacity * CONTROL_INTS_PER_SLOT * Int32Array.BYTES_PER_ELEMENT
const payloadBytes = (capacity) => capacity * PAYLOAD_FLOATS_PER_SLOT * Float64Array.BYTES_PER_ELEMENT
const layoutBytes = (capacity) => headerBytes() + controlBytes(capacity) + payloadBytes(capacity)

export const isRingAvailable = () =>
  globalThis.crossOriginIsolated === true && typeof SharedArrayBuffer !== 'undefined' && typeof Atomics !== 'undefined'

const clearSlots = (control, capacity) => {
  for (let slot = 0; slot < capacity; slot++) {
    Atomics.store(control, slot * CONTROL_INTS_PER_SLOT + SLOT_PLAYER, EMPTY_PLAYER)
  }
}

export const allocateRingBuffer = (capacity = 64) => {
  if (!isRingAvailable()) return null
  const sab = new SharedArrayBuffer(layoutBytes(capacity))
  const header = new Int32Array(sab, 0, HEADER_INTS)
  Atomics.store(header, HEADER_MAGIC, RING_MAGIC)
  Atomics.store(header, HEADER_CAPACITY, capacity)
  clearSlots(viewsOf(sab, capacity).control, capacity)
  return { sab, capacity }
}

export const assertRingLayout = (sab, capacity) => {
  if (!(sab instanceof SharedArrayBuffer)) throw new TypeError('[transform-ring] expected a SharedArrayBuffer')
  if (sab.byteLength < headerBytes()) {
    throw new RangeError(`[transform-ring] buffer is ${sab.byteLength} bytes, too small for the ${headerBytes()}-byte layout header`)
  }
  const header = new Int32Array(sab, 0, HEADER_INTS)
  const magic = Atomics.load(header, HEADER_MAGIC)
  if (magic !== RING_MAGIC) {
    throw new RangeError(`[transform-ring] buffer carries no TransformRing header (magic 0x${(magic >>> 0).toString(16)}), so writer and reader cannot agree on its layout`)
  }
  const stamped = Atomics.load(header, HEADER_CAPACITY)
  if (stamped !== capacity) throw new RangeError(`[transform-ring] capacity mismatch: buffer holds ${stamped} slots but ${capacity} were requested`)
  if (sab.byteLength !== layoutBytes(capacity)) {
    throw new RangeError(`[transform-ring] buffer is ${sab.byteLength} bytes, expected ${layoutBytes(capacity)} for ${capacity} slots`)
  }
}

const viewsOf = (sab, capacity) => {
  assertRingLayout(sab, capacity)
  return {
    header: new Int32Array(sab, 0, HEADER_INTS),
    control: new Int32Array(sab, headerBytes(), capacity * CONTROL_INTS_PER_SLOT),
    payload: new Float64Array(sab, headerBytes() + controlBytes(capacity), capacity * PAYLOAD_FLOATS_PER_SLOT)
  }
}

const assertPlayerId = (playerId) => {
  if (!Number.isInteger(playerId) || playerId < 0 || playerId > INT32_MAX) {
    throw new RangeError(`[transform-ring] player id must be an integer in [0, ${INT32_MAX}], got ${String(playerId)}`)
  }
}

const assertLength = (name, values, length) => {
  if (values === null || typeof values !== 'object' || values.length !== length) {
    throw new RangeError(`[transform-ring] ${name} must be an array-like of ${length} numbers`)
  }
}

const assertPose = (position, rotation, velocity) => {
  assertLength('position', position, POSITION_LENGTH)
  assertLength('rotation', rotation, ROTATION_LENGTH)
  assertLength('velocity', velocity, VELOCITY_LENGTH)
}

export class TransformRingWriter {
  #header
  #control
  #payload
  #slots = new Map()
  #freeSlots = []

  constructor(sab, capacity) {
    const { header, control, payload } = viewsOf(sab, capacity)
    this.#header = header
    this.#control = control
    this.#payload = payload
    for (let slot = capacity - 1; slot >= 0; slot--) this.#freeSlots.push(slot)
  }

  hasSlot(playerId) {
    return this.#slots.has(playerId)
  }

  slotOf(playerId) {
    const slot = this.#slots.get(playerId)
    return slot === undefined ? null : slot
  }

  tryAssign(playerId) {
    assertPlayerId(playerId)
    if (this.#slots.has(playerId)) return
    const slot = this.#freeSlots.pop()
    if (slot === undefined) return
    this.#slots.set(playerId, slot)
  }

  release(playerId) {
    const slot = this.slotOf(playerId)
    if (slot === null) return false
    const generation = this.#beginWrite()
    if (generation === null) return false
    const base = slot * CONTROL_INTS_PER_SLOT
    const slotGeneration = Atomics.load(this.#control, base + SLOT_GENERATION)
    Atomics.store(this.#control, base + SLOT_GENERATION, slotGeneration + 1)
    Atomics.store(this.#control, base + SLOT_PLAYER, EMPTY_PLAYER)
    Atomics.store(this.#control, base + SLOT_GENERATION, slotGeneration + 2)
    Atomics.add(this.#header, HEADER_EPOCH, 1)
    this.#endWrite(generation)
    this.#slots.delete(playerId)
    this.#freeSlots.push(slot)
    return true
  }

  write(playerId, position, rotation, velocity) {
    assertPose(position, rotation, velocity)
    this.tryAssign(playerId)
    const slot = this.slotOf(playerId)
    if (slot === null) return false
    const generation = this.#beginWrite()
    if (generation === null) return false
    const base = slot * CONTROL_INTS_PER_SLOT
    const payloadBase = slot * PAYLOAD_FLOATS_PER_SLOT
    const slotGeneration = Atomics.load(this.#control, base + SLOT_GENERATION)
    Atomics.store(this.#control, base + SLOT_GENERATION, slotGeneration + 1)
    Atomics.store(this.#control, base + SLOT_PLAYER, playerId)
    this.#payload.set(position, payloadBase + POSITION_AT)
    this.#payload.set(rotation, payloadBase + ROTATION_AT)
    this.#payload.set(velocity, payloadBase + VELOCITY_AT)
    Atomics.store(this.#control, base + SLOT_GENERATION, slotGeneration + 2)
    this.#endWrite(generation)
    return true
  }

  #beginWrite() {
    for (let attempt = 0; attempt < WRITE_LOCK_ATTEMPTS; attempt++) {
      const generation = Atomics.load(this.#header, HEADER_GENERATION)
      if (isLocked(generation)) continue
      if (Atomics.compareExchange(this.#header, HEADER_GENERATION, generation, generation + 1) === generation) return generation
    }
    return null
  }

  #endWrite(generation) {
    Atomics.store(this.#header, HEADER_GENERATION, generation + 2)
  }
}

export class TransformRingReader {
  #header
  #control
  #payload
  #capacity

  constructor(sab, capacity) {
    const { header, control, payload } = viewsOf(sab, capacity)
    this.#header = header
    this.#control = control
    this.#payload = payload
    this.#capacity = capacity
  }

  #readPose(payloadBase) {
    const payload = this.#payload
    return {
      position: [payload[payloadBase + POSITION_AT], payload[payloadBase + POSITION_AT + 1], payload[payloadBase + POSITION_AT + 2]],
      rotation: [payload[payloadBase + ROTATION_AT], payload[payloadBase + ROTATION_AT + 1], payload[payloadBase + ROTATION_AT + 2], payload[payloadBase + ROTATION_AT + 3]],
      velocity: [payload[payloadBase + VELOCITY_AT], payload[payloadBase + VELOCITY_AT + 1], payload[payloadBase + VELOCITY_AT + 2]],
      stale: false
    }
  }

  #readSlot(slot) {
    const base = slot * CONTROL_INTS_PER_SLOT
    for (let attempt = 0; attempt < SLOT_READ_ATTEMPTS; attempt++) {
      const before = Atomics.load(this.#control, base + SLOT_GENERATION)
      if (isLocked(before)) continue
      const playerId = Atomics.load(this.#control, base + SLOT_PLAYER)
      if (playerId === EMPTY_PLAYER) {
        if (Atomics.load(this.#control, base + SLOT_GENERATION) === before) return null
        continue
      }
      const pose = this.#readPose(slot * PAYLOAD_FLOATS_PER_SLOT)
      if (Atomics.load(this.#control, base + SLOT_GENERATION) !== before) continue
      return { playerId, pose }
    }
    return null
  }

  #readSlots() {
    const players = new Map()
    for (let slot = 0; slot < this.#capacity; slot++) {
      const found = this.#readSlot(slot)
      if (found !== null) players.set(found.playerId, found.pose)
    }
    return players
  }

  readCut(maxRetries = CUT_READ_ATTEMPTS) {
    let players = null
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const generation = Atomics.load(this.#header, HEADER_GENERATION)
      if (isLocked(generation)) continue
      const epoch = Atomics.load(this.#header, HEADER_EPOCH)
      players = this.#readSlots()
      if (Atomics.load(this.#header, HEADER_GENERATION) === generation) {
        return { generation, epoch, players, consistent: true }
      }
    }
    const sampled = players ?? this.#readSlots()
    for (const pose of sampled.values()) pose.stale = true
    return { generation: UNVERSIONED, epoch: UNVERSIONED, players: sampled, consistent: false }
  }

  readAll(maxRetries = CUT_READ_ATTEMPTS) {
    return this.readCut(maxRetries).players
  }
}
