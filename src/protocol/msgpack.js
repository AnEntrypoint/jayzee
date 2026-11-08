import { Packr, Unpackr, NEVER, DECIMAL_ROUND } from 'msgpackr'

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
    for (const item of value) assertEncodable(item)
  } else if (value instanceof Map) {
    for (const [key, item] of value) {
      assertEncodable(key)
      assertEncodable(item)
    }
  } else {
    for (const key of Object.keys(value)) assertEncodable(value[key])
  }
}

export function pack(value) {
  assertEncodable(value)
  return new Uint8Array(packer.pack(value))
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
