export const STATE_VERSION = 1

const HEADER_BYTES = 7
const WORD_BYTES = 8
const MAX_BODIES = 0xffff

export const encodeState = ({ tick, count, positions, velocities }) => {
  if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) throw new RangeError('tick must be a uint32')
  if (!Number.isInteger(count) || count < 0 || count > MAX_BODIES) throw new RangeError('count must be a uint16')
  const words = count * 3
  if (positions.length !== words || velocities.length !== words) throw new RangeError('state arrays must hold three values per body')
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + words * 2 * WORD_BYTES))
  view.setUint8(0, STATE_VERSION)
  view.setUint32(1, tick, true)
  view.setUint16(5, count, true)
  for (let i = 0; i < words; i++) view.setFloat64(HEADER_BYTES + i * WORD_BYTES, positions[i], true)
  for (let i = 0; i < words; i++) view.setFloat64(HEADER_BYTES + (words + i) * WORD_BYTES, velocities[i], true)
  return view.buffer
}

export const decodeState = (buffer) => {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('state must be an ArrayBuffer')
  if (buffer.byteLength < HEADER_BYTES) throw new RangeError('state is truncated')
  const view = new DataView(buffer)
  if (view.getUint8(0) !== STATE_VERSION) throw new RangeError('unsupported state version ' + view.getUint8(0))
  const tick = view.getUint32(1, true)
  const count = view.getUint16(5, true)
  const words = count * 3
  if (buffer.byteLength !== HEADER_BYTES + words * 2 * WORD_BYTES) throw new RangeError('state length does not match its body count')
  const positions = new Float64Array(words)
  const velocities = new Float64Array(words)
  for (let i = 0; i < words; i++) positions[i] = view.getFloat64(HEADER_BYTES + i * WORD_BYTES, true)
  for (let i = 0; i < words; i++) velocities[i] = view.getFloat64(HEADER_BYTES + (words + i) * WORD_BYTES, true)
  return { tick, count, positions, velocities }
}
