export const WIRE_BATCH_PREFIX = 0xbe
export const WIRE_BATCH_THRESHOLD = 128

const LENGTH_BYTES = 4

export const toArrayBuffer = (data) => {
  if (data instanceof ArrayBuffer) return data.slice(0)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
  throw new TypeError(`[wireweave] payload must be an ArrayBuffer or a view of bytes, got ${Object.prototype.toString.call(data).slice(8, -1)}`)
}

export const beginsWithBatchPrefix = (buffer) => buffer.byteLength > 0 && new Uint8Array(buffer)[0] === WIRE_BATCH_PREFIX

export const isLargeWirePayload = (buffer) => buffer.byteLength >= WIRE_BATCH_THRESHOLD

export const encodeBatch = (items) => {
  const totalLength = items.reduce((sum, item) => sum + LENGTH_BYTES + item.byteLength, 0)
  const frame = new Uint8Array(1 + totalLength)
  const view = new DataView(frame.buffer)
  frame[0] = WIRE_BATCH_PREFIX
  let offset = 1
  for (const item of items) {
    view.setUint32(offset, item.byteLength)
    offset += LENGTH_BYTES
    frame.set(new Uint8Array(item), offset)
    offset += item.byteLength
  }
  return frame.buffer
}

export const decodeBatch = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const items = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (offset + LENGTH_BYTES > bytes.byteLength) return null
    const length = view.getUint32(offset)
    offset += LENGTH_BYTES
    if (offset + length > bytes.byteLength) return null
    items.push(bytes.subarray(offset, offset + length))
    offset += length
  }
  return items.length > 0 ? items : null
}

export const wireFrameOf = (buffer) => (beginsWithBatchPrefix(buffer) ? encodeBatch([buffer]) : buffer)

export const frameForQueue = (items) => {
  if (items.length === 0) return null
  return items.length === 1 ? wireFrameOf(items[0]) : encodeBatch(items)
}

export const decodeWireFrame = (buffer) => {
  if (!beginsWithBatchPrefix(buffer)) return [buffer]
  const items = decodeBatch(new Uint8Array(buffer, 1))
  return items === null ? [buffer] : items
}
