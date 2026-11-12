import { Packr, Unpackr, NEVER, DECIMAL_ROUND } from 'msgpackr'
import { FNV1A_32_OFFSET_BASIS, fnv1aStepString } from '../shared/fnv1a.js'

export const WIRE_STRUCTURES = Object.freeze([
  Object.freeze(['type', 'payload']),
  Object.freeze(['seq', 'tick', 'serverTime', 'players', 'entities', 'removed', 'delta', 'dots', 'me', 'chartEpoch'])
])

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

const wireOptions = (useFloat32) => ({
  useFloat32,
  bundleStrings: true,
  structures: WIRE_STRUCTURES.map((fields) => fields.slice()),
  saveStructures: false,
  maxSharedStructures: WIRE_STRUCTURES.length
})

const packer = new Packr(wireOptions(NEVER))
const unpacker = new Unpackr(wireOptions(DECIMAL_ROUND))

const assertEncodable = (value) => {
  if (typeof value === 'function') throw new TypeError('[msgpack] cannot encode a value of type function')
  if (value === null || typeof value !== 'object' || value instanceof Uint8Array) return
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) assertEncodable(value[i])
  } else if (value instanceof Map) {
    for (const key of value.keys()) assertEncodable(key)
    for (const item of value.values()) assertEncodable(item)
  } else {
    for (const key in value) if (Object.hasOwn(value, key)) assertEncodable(value[key])
  }
}

const FLOAT64_MARKER = 0xcb
const NEG_ZERO_FLOAT64_TAIL = Uint8Array.of(0x80, 0, 0, 0, 0, 0, 0, 0)
const NEG_ZERO_SENTINELS = [0.8374615592187193, 0.1937725216839527, 0.5772156649015329, 0.2360679774997897]

const isPlainContainer = (value) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const countNegativeZero = (value) => {
  if (Object.is(value, -0)) return 1
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return 0
  let count = 0
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) count += countNegativeZero(value[i])
  } else if (value instanceof Map) {
    for (const item of value.values()) count += countNegativeZero(item)
  } else if (isPlainContainer(value)) {
    for (const key in value) if (Object.hasOwn(value, key)) count += countNegativeZero(value[key])
  }
  return count
}

const replaceNegativeZero = (value, sentinel) => {
  if (Object.is(value, -0)) return sentinel
  if (value === null || typeof value !== 'object' || ArrayBuffer.isView(value)) return value
  if (Array.isArray(value)) return value.map((item) => replaceNegativeZero(item, sentinel))
  if (value instanceof Map) return new Map([...value].map(([key, item]) => [key, replaceNegativeZero(item, sentinel)]))
  if (!isPlainContainer(value)) return value
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceNegativeZero(item, sentinel)]))
}

const float64Bytes = (number) => {
  const view = new DataView(new ArrayBuffer(8))
  view.setFloat64(0, number)
  return new Uint8Array(view.buffer)
}

const overwriteNegativeZero = (bytes, sentinel, expected) => {
  const pattern = float64Bytes(sentinel)
  if (pattern.includes(FLOAT64_MARKER)) return false
  const starts = []
  for (let start = 0; start + 9 <= bytes.length; start++) {
    if (bytes[start] !== FLOAT64_MARKER) continue
    let matches = true
    for (let offset = 0; offset < 8 && matches; offset++) matches = bytes[start + 1 + offset] === pattern[offset]
    if (matches) starts.push(start)
  }
  if (starts.length !== expected) return false
  for (const start of starts) bytes.set(NEG_ZERO_FLOAT64_TAIL, start + 1)
  return true
}

export function pack(value) {
  assertEncodable(value)
  const negativeZeros = countNegativeZero(value)
  if (negativeZeros === 0) return new Uint8Array(packer.pack(value))
  for (const sentinel of NEG_ZERO_SENTINELS) {
    const bytes = new Uint8Array(packer.pack(replaceNegativeZero(value, sentinel)))
    if (overwriteNegativeZero(bytes, sentinel, negativeZeros)) return bytes
  }
  throw new RangeError('[msgpack] every negative-zero sentinel collides with the value')
}

const RESERVED_MARKER_PROTOTYPE = Object.getPrototypeOf(unpacker.unpack(Uint8Array.of(0xc1)))

export function unpack(input) {
  const bytes = input instanceof ArrayBuffer ? new Uint8Array(input) : input
  if (!(bytes instanceof Uint8Array)) throw new TypeError('[msgpack] unpack needs a Uint8Array or ArrayBuffer')
  const value = unpacker.unpack(bytes)
  if (value !== null && typeof value === 'object' && Object.getPrototypeOf(value) === RESERVED_MARKER_PROTOTYPE) {
    throw new RangeError('[msgpack] marker 0xc1 is reserved and carries no value')
  }
  return value
}
