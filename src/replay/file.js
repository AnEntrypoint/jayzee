import { encode, decode } from './msgpack.js'

export const SPOINTREPLAY_MAGIC = 'spointreplay'
export const SPOINTREPLAY_VERSION = 2

const READABLE_VERSIONS = [1, SPOINTREPLAY_VERSION]

export const encodeReplay = ({ header, inputs, ticks, events }) => {
  if (!header || typeof header !== 'object') throw new TypeError('encodeReplay requires a header object')
  if (!Array.isArray(inputs)) throw new TypeError('encodeReplay requires an inputs array')
  return encode({
    magic: SPOINTREPLAY_MAGIC,
    version: SPOINTREPLAY_VERSION,
    header,
    inputs,
    ticks: Array.isArray(ticks) ? ticks : [],
    events: Array.isArray(events) ? events : [],
  })
}

export const decodeReplay = (bytes) => {
  let envelope
  try {
    envelope = decode(bytes)
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
