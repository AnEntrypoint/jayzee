export const WIRE_STRUCTURES = Object.freeze([
  Object.freeze(['type', 'payload']),
  Object.freeze(['seq', 'tick', 'serverTime', 'players', 'entities', 'removed', 'delta', 'dots', 'me', 'chartEpoch'])
])

const FNV1A_32_OFFSET_BASIS = 0x811c9dc5
const FNV1A_32_PRIME = 0x01000193

const fnv1aStepString = (hash, text) => {
  let next = hash
  for (let i = 0; i < text.length; i++) next = Math.imul(next ^ text.charCodeAt(i), FNV1A_32_PRIME)
  return next
}

const computeWireStructHash = () => {
  let hash = FNV1A_32_OFFSET_BASIS
  for (const fields of WIRE_STRUCTURES) {
    hash = fnv1aStepString(hash, '|')
    for (const field of fields) hash = fnv1aStepString(fnv1aStepString(hash, field), ',')
  }
  return (hash >>> 0).toString(16)
}

export const WIRE_STRUCT_HASH = computeWireStructHash()

const WIRE_STRUCT_HASH_PATTERN = /^[0-9a-f]{1,8}$/

export function parseWireStructHash(value) {
  if (value === undefined || value === null) return { kind: 'absent', value }
  if (typeof value !== 'string') return { kind: 'malformed', reason: 'wire-struct-hash-not-a-string', value }
  if (!WIRE_STRUCT_HASH_PATTERN.test(value)) return { kind: 'malformed', reason: 'wire-struct-hash-not-a-hex32', value }
  return { kind: 'hash', hash: value }
}

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()
const scratchView = new DataView(new ArrayBuffer(8))

const pushBigEndian = (out, value, size) => {
  const bits = BigInt.asUintN(size * 8, BigInt(value))
  for (let shift = BigInt((size - 1) * 8); shift >= 0n; shift -= 8n) {
    out.push(Number((bits >> shift) & 0xffn))
  }
}

const pushFloat64 = (out, value) => {
  scratchView.setFloat64(0, value)
  out.push(0xcb)
  for (let i = 0; i < 8; i++) out.push(scratchView.getUint8(i))
}

const encodeNumber = (out, value) => {
  if (!Number.isSafeInteger(value) || Object.is(value, -0)) {
    pushFloat64(out, value)
  } else if (value >= 0) {
    if (value < 0x80) out.push(value)
    else if (value < 0x100) out.push(0xcc, value)
    else if (value < 0x10000) { out.push(0xcd); pushBigEndian(out, value, 2) }
    else if (value < 0x100000000) { out.push(0xce); pushBigEndian(out, value, 4) }
    else { out.push(0xcf); pushBigEndian(out, value, 8) }
  } else if (value >= -32) {
    out.push(value & 0xff)
  } else if (value >= -0x80) {
    out.push(0xd0, value & 0xff)
  } else if (value >= -0x8000) {
    out.push(0xd1); pushBigEndian(out, value, 2)
  } else if (value >= -0x80000000) {
    out.push(0xd2); pushBigEndian(out, value, 4)
  } else {
    out.push(0xd3); pushBigEndian(out, value, 8)
  }
}

const encodeText = (out, text) => {
  const bytes = textEncoder.encode(text)
  const length = bytes.length
  if (length < 32) out.push(0xa0 | length)
  else if (length < 0x100) out.push(0xd9, length)
  else if (length < 0x10000) { out.push(0xda); pushBigEndian(out, length, 2) }
  else { out.push(0xdb); pushBigEndian(out, length, 4) }
  for (const b of bytes) out.push(b)
}

const encodeBinary = (out, bytes) => {
  const length = bytes.length
  if (length < 0x100) out.push(0xc4, length)
  else if (length < 0x10000) { out.push(0xc5); pushBigEndian(out, length, 2) }
  else { out.push(0xc6); pushBigEndian(out, length, 4) }
  for (const b of bytes) out.push(b)
}

const encodeArray = (out, items) => {
  const length = items.length
  if (length < 16) out.push(0x90 | length)
  else if (length < 0x10000) { out.push(0xdc); pushBigEndian(out, length, 2) }
  else { out.push(0xdd); pushBigEndian(out, length, 4) }
  for (const item of items) encodeValue(out, item)
}

const encodeMap = (out, object) => {
  const source = object instanceof Map ? [...object.entries()] : Object.entries(object)
  const entries = source.filter(([, value]) => value !== undefined)
  const count = entries.length
  if (count < 16) out.push(0x80 | count)
  else if (count < 0x10000) { out.push(0xde); pushBigEndian(out, count, 2) }
  else { out.push(0xdf); pushBigEndian(out, count, 4) }
  for (const [key, value] of entries) {
    if (typeof key !== 'string') throw new TypeError('[msgpack] map keys must be strings')
    encodeText(out, key)
    encodeValue(out, value)
  }
}

function encodeValue(out, value) {
  if (value === null || value === undefined) out.push(0xc0)
  else if (value === false) out.push(0xc2)
  else if (value === true) out.push(0xc3)
  else if (typeof value === 'number') encodeNumber(out, value)
  else if (typeof value === 'string') encodeText(out, value)
  else if (value instanceof Uint8Array) encodeBinary(out, value)
  else if (Array.isArray(value)) encodeArray(out, value)
  else if (typeof value === 'object') encodeMap(out, value)
  else throw new TypeError(`[msgpack] cannot encode a value of type ${typeof value}`)
}

export function pack(value) {
  const out = []
  encodeValue(out, value)
  return Uint8Array.from(out)
}

const UNSIGNED_GETTERS = { 1: 'getUint8', 2: 'getUint16', 4: 'getUint32' }
const SIGNED_GETTERS = { 1: 'getInt8', 2: 'getInt16', 4: 'getInt32' }

const createReader = (bytes) => {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let offset = 0
  const take = (count) => {
    if (offset + count > bytes.length) {
      throw new RangeError(`[msgpack] truncated input: needs ${count} byte(s) at offset ${offset}, ${bytes.length - offset} remain`)
    }
    const start = offset
    offset += count
    return start
  }
  const readInteger = (size, signed) => {
    const at = take(size)
    if (size === 8) return Number(signed ? view.getBigInt64(at) : view.getBigUint64(at))
    return view[(signed ? SIGNED_GETTERS : UNSIGNED_GETTERS)[size]](at)
  }
  const readFloat = (size) => {
    const at = take(size)
    return size === 4 ? view.getFloat32(at) : view.getFloat64(at)
  }
  const readBytes = (length) => {
    const at = take(length)
    return bytes.slice(at, at + length)
  }
  const readText = (length) => {
    const at = take(length)
    return textDecoder.decode(bytes.subarray(at, at + length))
  }
  return {
    byte: () => readInteger(1, false),
    unsigned: readInteger,
    signed: (size) => readInteger(size, true),
    float: readFloat,
    binary: readBytes,
    text: readText,
    offset: () => offset,
    remaining: () => bytes.length - offset,
  }
}

const readArray = (reader, length) => {
  const items = []
  for (let i = 0; i < length; i++) items.push(readValue(reader))
  return items
}

const readMap = (reader, count) => {
  const object = {}
  for (let i = 0; i < count; i++) {
    const key = readValue(reader)
    if (typeof key !== 'string') throw new RangeError(`[msgpack] map key at index ${i} is not a string`)
    Object.defineProperty(object, key, { value: readValue(reader), enumerable: true, writable: true, configurable: true })
  }
  return object
}

const UNSUPPORTED = 'unsupported'

function readValue(reader) {
  const marker = reader.byte()
  if (marker <= 0x7f) return marker
  if (marker >= 0xe0) return marker - 0x100
  if (marker >= 0x80 && marker <= 0x8f) return readMap(reader, marker & 0x0f)
  if (marker >= 0x90 && marker <= 0x9f) return readArray(reader, marker & 0x0f)
  if (marker >= 0xa0 && marker <= 0xbf) return reader.text(marker & 0x1f)
  switch (marker) {
    case 0xc0: return null
    case 0xc2: return false
    case 0xc3: return true
    case 0xc4: return reader.binary(reader.unsigned(1))
    case 0xc5: return reader.binary(reader.unsigned(2))
    case 0xc6: return reader.binary(reader.unsigned(4))
    case 0xca: return reader.float(4)
    case 0xcb: return reader.float(8)
    case 0xcc: return reader.unsigned(1)
    case 0xcd: return reader.unsigned(2)
    case 0xce: return reader.unsigned(4)
    case 0xcf: return reader.unsigned(8)
    case 0xd0: return reader.signed(1)
    case 0xd1: return reader.signed(2)
    case 0xd2: return reader.signed(4)
    case 0xd3: return reader.signed(8)
    case 0xd9: return reader.text(reader.unsigned(1))
    case 0xda: return reader.text(reader.unsigned(2))
    case 0xdb: return reader.text(reader.unsigned(4))
    case 0xdc: return readArray(reader, reader.unsigned(2))
    case 0xdd: return readArray(reader, reader.unsigned(4))
    case 0xde: return readMap(reader, reader.unsigned(2))
    case 0xdf: return readMap(reader, reader.unsigned(4))
    default: throw new RangeError(`[msgpack] ${UNSUPPORTED} marker 0x${marker.toString(16)} at offset ${reader.offset() - 1}`)
  }
}

export function unpack(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  if (!(bytes instanceof Uint8Array)) throw new TypeError('[msgpack] unpack needs a Uint8Array or ArrayBuffer')
  const reader = createReader(bytes)
  const value = readValue(reader)
  if (reader.remaining() !== 0) throw new RangeError(`[msgpack] ${reader.remaining()} trailing byte(s) after the value`)
  return value
}
