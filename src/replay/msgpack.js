const utf8Decoder = new TextDecoder('utf-8', { fatal: true })

const withUnsigned = (marker, width, value) => {
  const out = Buffer.alloc(width + 1)
  out[0] = marker
  out.writeUIntBE(value, 1, width)
  return out
}

const withSigned = (marker, width, value) => {
  const out = Buffer.alloc(width + 1)
  out[0] = marker
  out.writeIntBE(value, 1, width)
  return out
}

const encodeInteger = (value) => {
  if (value >= 0) {
    if (value <= 0x7f) return Buffer.from([value])
    if (value <= 0xff) return Buffer.from([0xcc, value])
    if (value <= 0xffff) return withUnsigned(0xcd, 2, value)
    if (value <= 0xffffffff) return withUnsigned(0xce, 4, value)
    return null
  }
  if (value >= -32) return Buffer.from([value & 0xff])
  if (value >= -0x80) return Buffer.from([0xd0, value & 0xff])
  if (value >= -0x8000) return withSigned(0xd1, 2, value)
  if (value >= -0x80000000) return withSigned(0xd2, 4, value)
  return null
}

const encodeNumber = (value) => {
  if (Number.isSafeInteger(value) && !Object.is(value, -0)) {
    const integer = encodeInteger(value)
    if (integer) return integer
  }
  const out = Buffer.alloc(9)
  out[0] = 0xcb
  out.writeDoubleBE(value, 1)
  return out
}

const encodeString = (value) => {
  const body = Buffer.from(value, 'utf8')
  if (body.toString('utf8') !== value) throw new TypeError('msgpack cannot encode a string with a lone surrogate')
  const length = body.length
  let head
  if (length <= 31) head = Buffer.from([0xa0 | length])
  else if (length <= 0xff) head = Buffer.from([0xd9, length])
  else if (length <= 0xffff) head = withUnsigned(0xda, 2, length)
  else head = withUnsigned(0xdb, 4, length)
  return Buffer.concat([head, body])
}

const encodeBinary = (value) => {
  const length = value.byteLength
  let head
  if (length <= 0xff) head = Buffer.from([0xc4, length])
  else if (length <= 0xffff) head = withUnsigned(0xc5, 2, length)
  else head = withUnsigned(0xc6, 4, length)
  return Buffer.concat([head, Buffer.from(value.buffer, value.byteOffset, value.byteLength)])
}

const encodeCollection = (count, fixBase, marker16, marker32, parts) => {
  let head
  if (count < 16) head = Buffer.from([fixBase | count])
  else if (count <= 0xffff) head = withUnsigned(marker16, 2, count)
  else head = withUnsigned(marker32, 4, count)
  return Buffer.concat([head, ...parts])
}

const isPlainObject = (value) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const encodeValue = (value) => {
  if (value === null) return Buffer.from([0xc0])
  if (value === false) return Buffer.from([0xc2])
  if (value === true) return Buffer.from([0xc3])
  if (typeof value === 'number') return encodeNumber(value)
  if (typeof value === 'string') return encodeString(value)
  if (value instanceof Uint8Array) return encodeBinary(value)
  if (Array.isArray(value)) return encodeCollection(value.length, 0x90, 0xdc, 0xdd, Array.from(value, encodeValue))
  if (typeof value === 'object' && isPlainObject(value)) {
    const entries = Object.entries(value)
    const parts = entries.flatMap(([key, item]) => [encodeString(key), encodeValue(item)])
    return encodeCollection(entries.length, 0x80, 0xde, 0xdf, parts)
  }
  throw new TypeError('msgpack cannot encode a value of type ' + typeof value)
}

export const encode = (value) => encodeValue(value)

const takeBytes = (reader, count) => {
  if (reader.offset + count > reader.buffer.length) {
    throw new RangeError('msgpack data ends at byte ' + reader.buffer.length + ' inside a value')
  }
  const slice = reader.buffer.subarray(reader.offset, reader.offset + count)
  reader.offset += count
  return slice
}

const readUnsigned = (reader, width) => takeBytes(reader, width).readUIntBE(0, width)

const readSafe = (big) => {
  if (big > BigInt(Number.MAX_SAFE_INTEGER) || big < -BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new RangeError('msgpack integer ' + big + ' is beyond 2^53 and cannot be read exactly')
  }
  return Number(big)
}

const readString = (reader, length) => utf8Decoder.decode(takeBytes(reader, length))

const readArray = (reader, count) => {
  const items = []
  for (let index = 0; index < count; index++) items.push(readValue(reader))
  return items
}

const readMap = (reader, count) => {
  const entries = []
  for (let index = 0; index < count; index++) {
    const key = readValue(reader)
    if (typeof key !== 'string') throw new TypeError('msgpack map key is not a string')
    entries.push([key, readValue(reader)])
  }
  return Object.fromEntries(entries)
}

const readTyped = (reader, marker) => {
  switch (marker) {
    case 0xc0: return null
    case 0xc2: return false
    case 0xc3: return true
    case 0xc4: return Buffer.from(takeBytes(reader, readUnsigned(reader, 1)))
    case 0xc5: return Buffer.from(takeBytes(reader, readUnsigned(reader, 2)))
    case 0xc6: return Buffer.from(takeBytes(reader, readUnsigned(reader, 4)))
    case 0xca: return takeBytes(reader, 4).readFloatBE(0)
    case 0xcb: return takeBytes(reader, 8).readDoubleBE(0)
    case 0xcc: return readUnsigned(reader, 1)
    case 0xcd: return readUnsigned(reader, 2)
    case 0xce: return readUnsigned(reader, 4)
    case 0xcf: return readSafe(takeBytes(reader, 8).readBigUInt64BE(0))
    case 0xd0: return takeBytes(reader, 1).readInt8(0)
    case 0xd1: return takeBytes(reader, 2).readInt16BE(0)
    case 0xd2: return takeBytes(reader, 4).readInt32BE(0)
    case 0xd3: return readSafe(takeBytes(reader, 8).readBigInt64BE(0))
    case 0xd9: return readString(reader, readUnsigned(reader, 1))
    case 0xda: return readString(reader, readUnsigned(reader, 2))
    case 0xdb: return readString(reader, readUnsigned(reader, 4))
    case 0xdc: return readArray(reader, readUnsigned(reader, 2))
    case 0xdd: return readArray(reader, readUnsigned(reader, 4))
    case 0xde: return readMap(reader, readUnsigned(reader, 2))
    case 0xdf: return readMap(reader, readUnsigned(reader, 4))
    default:
      throw new RangeError('msgpack marker 0x' + marker.toString(16) + ' at byte ' + (reader.offset - 1) + ' is not standard msgpack')
  }
}

const readValue = (reader) => {
  const marker = takeBytes(reader, 1)[0]
  if (marker <= 0x7f) return marker
  if (marker >= 0xe0) return marker - 0x100
  if (marker >= 0xa0 && marker <= 0xbf) return readString(reader, marker & 0x1f)
  if (marker >= 0x90 && marker <= 0x9f) return readArray(reader, marker & 0x0f)
  if (marker >= 0x80 && marker <= 0x8f) return readMap(reader, marker & 0x0f)
  return readTyped(reader, marker)
}

export const decode = (bytes) => {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('msgpack input must be a Uint8Array or Buffer')
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const reader = { buffer, offset: 0 }
  const value = readValue(reader)
  if (reader.offset !== buffer.length) {
    throw new RangeError(buffer.length - reader.offset + ' bytes follow the top-level msgpack value')
  }
  return value
}
