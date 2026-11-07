export const ACK_VERSION = 1

const ACK_BYTES = 5

export const encodeAck = (tick) => {
  if (!Number.isInteger(tick) || tick < 0 || tick > 0xffffffff) throw new RangeError('ack tick must be a uint32')
  const view = new DataView(new ArrayBuffer(ACK_BYTES))
  view.setUint8(0, ACK_VERSION)
  view.setUint32(1, tick, true)
  return view.buffer
}

export const decodeAck = (buffer) => {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength !== ACK_BYTES) throw new RangeError('ack must be ' + ACK_BYTES + ' bytes')
  const view = new DataView(buffer)
  if (view.getUint8(0) !== ACK_VERSION) throw new RangeError('unsupported ack version ' + view.getUint8(0))
  return view.getUint32(1, true)
}
