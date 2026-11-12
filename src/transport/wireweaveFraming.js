export const WIRE_BATCH_PREFIX = 0xbe
export const WIRE_BATCH_THRESHOLD = 128

const LENGTH_BYTES = 4

export const toArrayBuffer = (data) => {
  if (data instanceof ArrayBuffer) return data.slice(0)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength).slice().buffer
  throw new TypeError(`[wireweave] payload must be an ArrayBuffer or a view of bytes, got ${Object.prototype.toString.call(data).slice(8, -1)}`)
}

const bytesBeginWithBatchPrefix = (bytes) => bytes.byteLength > 0 && bytes[0] === WIRE_BATCH_PREFIX

export const beginsWithBatchPrefix = (buffer) => bytesBeginWithBatchPrefix(new Uint8Array(buffer))

export const isLargeWirePayload = (buffer) => buffer.byteLength >= WIRE_BATCH_THRESHOLD

export const encodeBatch = (items) => {
  let totalLength = 0
  for (const item of items) totalLength += LENGTH_BYTES + item.byteLength
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
  const items = []
  let offset = 0
  while (offset < bytes.byteLength) {
    if (offset + LENGTH_BYTES > bytes.byteLength) return null
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
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
  const bytes = new Uint8Array(buffer)
  if (!bytesBeginWithBatchPrefix(bytes)) return [buffer]
  const items = decodeBatch(bytes.subarray(1))
  return items === null ? [buffer] : items
}

export const forEachBatchItem = (buffer, visit) => {
  if (typeof visit !== 'function') throw new TypeError('[wireweave] forEachBatchItem needs a visit function (bytes, index)')
  if (!(buffer instanceof ArrayBuffer) && !ArrayBuffer.isView(buffer)) throw new TypeError(`[wireweave] a wire frame must be an ArrayBuffer or a view of bytes, got ${Object.prototype.toString.call(buffer).slice(8, -1)}`)
  const bytes = buffer instanceof ArrayBuffer ? new Uint8Array(buffer) : new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength)
  if (!bytesBeginWithBatchPrefix(bytes)) { visit(bytes, 0); return 1 }
  let offset = 1
  let count = 0
  while (offset < bytes.byteLength) {
    if (offset + LENGTH_BYTES > bytes.byteLength) { count = 0; break }
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    offset += LENGTH_BYTES
    if (offset + length > bytes.byteLength) { count = 0; break }
    offset += length
    count++
  }
  if (count === 0) { visit(bytes, 0); return 1 }
  offset = 1
  for (let index = 0; index < count; index++) {
    const length = ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0
    offset += LENGTH_BYTES
    visit(bytes.subarray(offset, offset + length), index)
    offset += length
  }
  return count
}
