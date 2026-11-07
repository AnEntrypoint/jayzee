const FNV_PRIME = 16777619
const FNV_OFFSET = 0x811c9dc5
const CANONICAL_NAN_BITS = 0x7ff8000000000000n

function fnv1aStep(hash, byte) {
  return Math.imul((hash ^ byte) >>> 0, FNV_PRIME) >>> 0
}

export function fnv1a32(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('fnv1a32 takes a Uint8Array')
  let hash = FNV_OFFSET
  for (let i = 0; i < bytes.length; i++) hash = fnv1aStep(hash, bytes[i])
  return hash >>> 0
}

export function fnv1aStr(text) {
  return fnv1a32(new TextEncoder().encode(text))
}

function float64LittleEndianBytes(n) {
  const bytes = new Uint8Array(8)
  const view = new DataView(bytes.buffer)
  if (Number.isNaN(n)) {
    view.setBigUint64(0, CANONICAL_NAN_BITS, true)
  } else {
    view.setFloat64(0, n === 0 ? 0 : n, true)
  }
  return bytes
}

export function fnv1aFoldF64(hash, n) {
  let folded = hash >>> 0
  for (const byte of float64LittleEndianBytes(n)) folded = fnv1aStep(folded, byte)
  return folded
}
