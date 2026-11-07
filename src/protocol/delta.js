export const DELTA_VERSION = 1

const HAS_BASE = 1
const HEADER_BYTES = 14
const WORD_BYTES = 8
const RECORD_BYTES = 2 + 6 * WORD_BYTES
const MAX_BODIES = 0xffff

const bodyChanged = (state, base, body) => {
  const o = body * 3
  for (let k = 0; k < 3; k++) {
    if (!Object.is(state.positions[o + k], base.positions[o + k])) return true
    if (!Object.is(state.velocities[o + k], base.velocities[o + k])) return true
  }
  return false
}

const checkState = (state) => {
  if (!Number.isInteger(state.tick) || state.tick < 0 || state.tick > 0xffffffff) throw new RangeError('tick must be a uint32')
  if (!Number.isInteger(state.count) || state.count < 0 || state.count > MAX_BODIES) throw new RangeError('count must be a uint16')
  if (state.positions.length !== state.count * 3 || state.velocities.length !== state.count * 3) {
    throw new RangeError('state arrays must hold three values per body')
  }
}

export const encodeDelta = (state, base = null) => {
  checkState(state)
  const usable = base !== null && base.count === state.count && base.tick < state.tick
  const changed = []
  for (let body = 0; body < state.count; body++) {
    if (!usable || bodyChanged(state, base, body)) changed.push(body)
  }
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + changed.length * RECORD_BYTES))
  view.setUint8(0, DELTA_VERSION)
  view.setUint8(1, usable ? HAS_BASE : 0)
  view.setUint32(2, state.tick, true)
  view.setUint32(6, usable ? base.tick : 0, true)
  view.setUint16(10, state.count, true)
  view.setUint16(12, changed.length, true)
  changed.forEach((body, n) => {
    const at = HEADER_BYTES + n * RECORD_BYTES
    view.setUint16(at, body, true)
    for (let k = 0; k < 3; k++) {
      view.setFloat64(at + 2 + k * WORD_BYTES, state.positions[body * 3 + k], true)
      view.setFloat64(at + 2 + (3 + k) * WORD_BYTES, state.velocities[body * 3 + k], true)
    }
  })
  return view.buffer
}

export const decodeDelta = (buffer, lookup = () => null) => {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('delta must be an ArrayBuffer')
  if (buffer.byteLength < HEADER_BYTES) throw new RangeError('delta is truncated')
  const view = new DataView(buffer)
  if (view.getUint8(0) !== DELTA_VERSION) throw new RangeError('unsupported delta version ' + view.getUint8(0))
  const flags = view.getUint8(1)
  const tick = view.getUint32(2, true)
  const baseTick = view.getUint32(6, true)
  const count = view.getUint16(10, true)
  const changed = view.getUint16(12, true)
  if (buffer.byteLength !== HEADER_BYTES + changed * RECORD_BYTES) throw new RangeError('delta length does not match its record count')
  const words = count * 3
  let positions
  let velocities
  if (flags & HAS_BASE) {
    const base = lookup(baseTick)
    if (base === null || base.tick !== baseTick || base.count !== count) {
      throw new RangeError('delta needs the state at tick ' + baseTick + ', which the receiver does not hold')
    }
    positions = Float64Array.from(base.positions)
    velocities = Float64Array.from(base.velocities)
  } else {
    positions = new Float64Array(words)
    velocities = new Float64Array(words)
  }
  for (let n = 0; n < changed; n++) {
    const at = HEADER_BYTES + n * RECORD_BYTES
    const body = view.getUint16(at, true)
    if (body >= count) throw new RangeError('delta names body ' + body + ' of ' + count)
    for (let k = 0; k < 3; k++) {
      positions[body * 3 + k] = view.getFloat64(at + 2 + k * WORD_BYTES, true)
      velocities[body * 3 + k] = view.getFloat64(at + 2 + (3 + k) * WORD_BYTES, true)
    }
  }
  return { tick, count, positions, velocities }
}
