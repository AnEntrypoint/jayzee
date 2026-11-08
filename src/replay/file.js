import { pack, unpack } from '../protocol/msgpack.js'

export const SPOINTREPLAY_MAGIC = 'spointreplay'
export const SPOINTREPLAY_VERSION = 2

const READABLE_VERSIONS = [1, SPOINTREPLAY_VERSION]

const refuseUndefined = (value, path) => {
  if (value === undefined) throw new TypeError('encodeReplay cannot write an undefined value at ' + path)
  if (Array.isArray(value)) {
    value.forEach((item, index) => refuseUndefined(item, path + '[' + index + ']'))
  } else if (value !== null && typeof value === 'object' && !(value instanceof Uint8Array)) {
    for (const [key, item] of Object.entries(value)) refuseUndefined(item, path + '.' + key)
  }
}

export const encodeReplay = ({ header, inputs, ticks, events }) => {
  if (!header || typeof header !== 'object') throw new TypeError('encodeReplay requires a header object')
  if (!Array.isArray(inputs)) throw new TypeError('encodeReplay requires an inputs array')
  const envelope = {
    magic: SPOINTREPLAY_MAGIC,
    version: SPOINTREPLAY_VERSION,
    header,
    inputs,
    ticks: Array.isArray(ticks) ? ticks : [],
    events: Array.isArray(events) ? events : [],
  }
  refuseUndefined(envelope, 'envelope')
  return pack(envelope)
}

export const decodeReplay = (bytes) => {
  let envelope
  try {
    envelope = unpack(bytes)
  } catch (error) {
    throw new RangeError('decodeReplay: not a valid .spointreplay file (' + error.message + ')')
  }
  if (!envelope || typeof envelope !== 'object' || envelope.magic !== SPOINTREPLAY_MAGIC) {
    throw new RangeError('decodeReplay: not a .spointreplay file (bad magic)')
  }
  if (!READABLE_VERSIONS.includes(envelope.version)) {
    throw new RangeError('decodeReplay: unsupported version ' + envelope.version + ' (expected 1 or ' + SPOINTREPLAY_VERSION + ')')
  }
  if (!envelope.header || !Array.isArray(envelope.inputs)) {
    throw new RangeError('decodeReplay: malformed envelope (missing header or inputs)')
  }
  if (!Array.isArray(envelope.ticks)) envelope.ticks = []
  return envelope
}
