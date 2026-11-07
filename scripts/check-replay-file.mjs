import { deepStrictEqual } from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { SPOINTREPLAY_MAGIC, SPOINTREPLAY_VERSION, encodeReplay, decodeReplay } from '../src/replay/index.js'
import { encode } from '../src/replay/msgpack.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const refuses = (read) => {
  try {
    read()
  } catch {
    return true
  }
  return false
}

const sample = () => ({
  header: {
    worldName: 'arena',
    tickRate: 60,
    startTick: 1,
    endTick: 3,
    recordedAt: 1700000000000,
    collisionSteps: 2,
    players: [{ id: 'p1', name: 'Player 1', spawn: { position: [0, 1.5, -2], rotation: [0, 0, 0, 1], health: 100 } }],
  },
  inputs: [
    { tick: 1, playerId: 'p1', sequence: 1, data: { buttons: 3, x: 0.5 } },
    { tick: 2, playerId: 'p1', sequence: 2, data: { buttons: 0, x: -0 } },
    { tick: 3, playerId: 'p1', sequence: null, data: { buttons: 255, x: 2 ** 40 } },
  ],
  ticks: [{ tick: 1, dt: 1 / 60 }, { tick: 2, dt: 1 / 60 }, { tick: 3, dt: 1 / 60 }],
  events: [{ tick: 2, kind: 'spawn', text: 'héllo ✓' }],
})

const expectedPrefix = Buffer.concat([
  Buffer.from([0x86, 0xa5]),
  Buffer.from('magic'),
  Buffer.from([0xac]),
  Buffer.from('spointreplay'),
  Buffer.from([0xa7]),
  Buffer.from('version'),
  Buffer.from([0x02]),
])

const patched = (bytes, needle, offset, byte) => {
  const at = bytes.indexOf(Buffer.from(needle))
  assert(at >= 0, 'needle not found in the file: ' + needle)
  const copy = Buffer.from(bytes)
  copy[at + offset] = byte
  return copy
}

const valueOfVersion = (bytes) => {
  const at = bytes.indexOf(Buffer.from('version'))
  assert(at >= 0, 'version key not found')
  return bytes[at + 7]
}

const withVersion = (bytes, version) => {
  assert(valueOfVersion(bytes) === SPOINTREPLAY_VERSION, 'the writer did not put version 2 where expected')
  return patched(bytes, 'version', 7, version)
}

const original = sample()
const written = encodeReplay(original)

gate('magic and version match spoint src/netcode/ReplayFile.js lines 3 and 4', () => {
  assert(SPOINTREPLAY_MAGIC === 'spointreplay', 'magic constant is ' + SPOINTREPLAY_MAGIC)
  assert(SPOINTREPLAY_VERSION === 2, 'version constant is ' + SPOINTREPLAY_VERSION)
  const prefix = written.subarray(0, expectedPrefix.length)
  assert(prefix.equals(expectedPrefix), 'envelope prefix is ' + prefix.toString('hex') + ', expected ' + expectedPrefix.toString('hex'))
})

gate('a write then read returns the same records', () => {
  const envelope = decodeReplay(written)
  deepStrictEqual(envelope.header, original.header)
  deepStrictEqual(envelope.inputs, original.inputs)
  deepStrictEqual(envelope.ticks, original.ticks)
  deepStrictEqual(envelope.events, original.events)
  assert(envelope.magic === SPOINTREPLAY_MAGIC, 'magic read back as ' + envelope.magic)
  assert(envelope.version === SPOINTREPLAY_VERSION, 'version read back as ' + envelope.version)
})

gate('a write with no ticks or events reads back empty arrays', () => {
  const envelope = decodeReplay(encodeReplay({ header: original.header, inputs: [] }))
  deepStrictEqual(envelope.ticks, [])
  deepStrictEqual(envelope.events, [])
  deepStrictEqual(envelope.inputs, [])
})

gate('a wrong magic is refused', () => {
  const corrupted = patched(written, 'spointreplay', 11, 'Y'.charCodeAt(0))
  assert(refuses(() => decodeReplay(corrupted)), 'a file with magic spointreplaY was accepted')
})

gate('a wrong version is refused', () => {
  for (const version of [0, 3, 9]) {
    assert(refuses(() => decodeReplay(withVersion(written, version))), 'version ' + version + ' was accepted')
  }
})

gate('version 1 is read, as spoint reader accepts it', () => {
  const envelope = decodeReplay(withVersion(written, 1))
  deepStrictEqual(envelope.inputs, original.inputs)
})

gate('a truncated file is refused at every cut', () => {
  for (let cut = 0; cut < written.length; cut++) {
    assert(refuses(() => decodeReplay(written.subarray(0, cut))), 'a file cut at byte ' + cut + ' was accepted')
  }
})

gate('bytes after the top-level value are refused', () => {
  const padded = Buffer.concat([written, Buffer.from([0x00])])
  assert(refuses(() => decodeReplay(padded)), 'a file with a trailing byte was accepted')
})

gate('the reserved marker 0xc1 of the msgpackr record dialect is refused', () => {
  const foreign = patched(written, [0x86], 0, 0xc1)
  assert(refuses(() => decodeReplay(foreign)), 'a file starting with 0xc1 was accepted')
})

gate('a flipped payload byte is accepted: the format has no checksum (documented, not detected)', () => {
  const flipped = patched(written, 'arena', 0, 'b'.charCodeAt(0))
  const envelope = decodeReplay(flipped)
  assert(envelope.header.worldName === 'brena', 'the flipped byte did not reach the decoded header')
})

gate('a header-less envelope is refused', () => {
  const headerless = encode({ magic: SPOINTREPLAY_MAGIC, version: SPOINTREPLAY_VERSION, inputs: [] })
  assert(refuses(() => decodeReplay(headerless)), 'an envelope without a header was accepted')
})

gate('the writer refuses a value it cannot encode', () => {
  const bad = { header: { worldName: 'arena' }, inputs: [{ tick: 1, data: { x: undefined } }] }
  assert(refuses(() => encodeReplay(bad)), 'an undefined field was written')
})

finish()
