export const SNAPSHOT_VERSION = 1

const HEADER_BYTES = 7
const COORD_BYTES = 4
const MAX_BODIES = 0xffff

export const encodeSnapshot = ({ tick, count, positions }) => {
  if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) throw new RangeError('tick must be a uint32')
  if (!Number.isInteger(count) || count < 0 || count > MAX_BODIES) throw new RangeError('count must be a uint16')
  if (positions.length < count * 3) throw new RangeError('positions holds fewer coordinates than count')
  const view = new DataView(new ArrayBuffer(HEADER_BYTES + count * 3 * COORD_BYTES))
  view.setUint8(0, SNAPSHOT_VERSION)
  view.setUint32(1, tick, true)
  view.setUint16(5, count, true)
  for (let i = 0; i < count * 3; i++) view.setFloat32(HEADER_BYTES + i * COORD_BYTES, positions[i], true)
  return view.buffer
}

export const decodeSnapshot = (buffer) => {
  if (!(buffer instanceof ArrayBuffer)) throw new TypeError('snapshot must be an ArrayBuffer')
  if (buffer.byteLength < HEADER_BYTES) throw new RangeError('snapshot is truncated')
  const view = new DataView(buffer)
  if (view.getUint8(0) !== SNAPSHOT_VERSION) throw new RangeError('unsupported snapshot version ' + view.getUint8(0))
  const tick = view.getUint32(1, true)
  const count = view.getUint16(5, true)
  if (buffer.byteLength !== HEADER_BYTES + count * 3 * COORD_BYTES) throw new RangeError('snapshot length does not match its body count')
  const positions = new Float64Array(count * 3)
  for (let i = 0; i < count * 3; i++) positions[i] = view.getFloat32(HEADER_BYTES + i * COORD_BYTES, true)
  return { tick, count, positions }
}
