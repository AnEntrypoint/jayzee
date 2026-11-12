export const COALESCE_SENTINEL = 0xff
export const COALESCE_LENGTH_BYTES = 4

export function frameCoalesced(buffers) {
  if (!Array.isArray(buffers) || buffers.length === 0) throw new TypeError('[coalesce] frameCoalesced needs at least one packed message')
  if (buffers.length === 1) return buffers[0]
  let total = 1
  for (const buffer of buffers) total += COALESCE_LENGTH_BYTES + buffer.length
  const out = new Uint8Array(total)
  const view = new DataView(out.buffer)
  out[0] = COALESCE_SENTINEL
  let offset = 1
  for (const buffer of buffers) {
    view.setUint32(offset, buffer.length, true)
    offset += COALESCE_LENGTH_BYTES
    out.set(buffer, offset)
    offset += buffer.length
  }
  return out
}

export const isCoalesced = (bytes) => bytes.length > 0 && bytes[0] === COALESCE_SENTINEL

export function forEachCoalescedPart(bytes, visit) {
  let offset = 1
  let count = 0
  const end = bytes.length
  while (offset < end) {
    if (offset + COALESCE_LENGTH_BYTES > end) return -count - 1
    const length = (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0
    offset += COALESCE_LENGTH_BYTES
    if (offset + length > end) return -count - 1
    visit(bytes.subarray(offset, offset + length), count)
    offset += length
    count++
  }
  return count
}

export function splitCoalesced(bytes, onTruncated = null) {
  const out = []
  const result = forEachCoalescedPart(bytes, (part) => out.push(part))
  if (result < 0 && onTruncated !== null) onTruncated(out.length)
  return out
}
