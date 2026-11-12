const FNV_PRIME = 16777619
const FNV_OFFSET = 0x811c9dc5
const CANONICAL_NAN_BITS = 0x7ff8000000000000n

function fnv1aStep(hash, byte) {
  return Math.imul((hash ^ byte) >>> 0, FNV_PRIME) >>> 0
}

function byteViewOf(bytes) {
  if (bytes instanceof Uint8Array || bytes instanceof Uint8ClampedArray) return bytes
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes)
  if (bytes instanceof DataView) return new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  throw new TypeError('fnv1a32 takes a byte slice: a Uint8Array, a Uint8ClampedArray, an ArrayBuffer or a DataView')
}

export function fnv1a32(bytes) {
  const view = byteViewOf(bytes)
  let hash = FNV_OFFSET
  for (let i = 0; i < view.length; i++) hash = fnv1aStep(hash, view[i])
  return hash >>> 0
}

const encoder = new TextEncoder()

export function fnv1aStr(text) {
  if (typeof text !== 'string') throw new TypeError('fnv1aStr takes a string')
  if (!text.isWellFormed()) throw new TypeError('fnv1aStr takes well-formed text: a lone surrogate has no UTF-8 bytes, and encoding it as U+FFFD would give two different strings one hash')
  return fnv1a32(encoder.encode(text))
}

const foldBytes = new Uint8Array(8)
const foldView = new DataView(foldBytes.buffer)

export function fnv1aFoldF64(hash, n) {
  if (Number.isNaN(n)) foldView.setBigUint64(0, CANONICAL_NAN_BITS, true)
  else foldView.setFloat64(0, n === 0 ? 0 : n, true)
  let folded = hash >>> 0
  for (let i = 0; i < 8; i++) folded = fnv1aStep(folded, foldBytes[i])
  return folded
}
