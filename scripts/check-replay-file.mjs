import { deepStrictEqual } from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { SPOINTREPLAY_MAGIC, SPOINTREPLAY_VERSION, encodeReplay, decodeReplay } from '../src/replay/index.js'
import { pack, unpack } from '../src/protocol/msgpack.js'

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
    { tick: 2, playerId: 'p1', sequence: 2, data: { buttons: 0, x: 0.25 } },
    { tick: 3, playerId: 'p1', sequence: null, data: { buttons: 255, x: 2 ** 40 } },
  ],
  ticks: [{ tick: 1, dt: 1 / 64 }, { tick: 2, dt: 1 / 64 }, { tick: 3, dt: 1 / 64 }],
  events: [{ tick: 2, kind: 'spawn', text: 'héllo ✓' }],
})

const patched = (bytes, needle, offset, byte) => {
  const at = Buffer.from(bytes).indexOf(Buffer.from(needle))
  assert(at >= 0, 'needle not found in the file: ' + needle)
  const copy = Buffer.from(bytes)
  copy[at + offset] = byte
  return copy
}

const withVersion = (bytes, version) => pack({ ...unpack(bytes), version })

const original = sample()
const written = encodeReplay(original)

gate('magic and version are the spoint constants: spointreplay and 2', () => {
  assert(SPOINTREPLAY_MAGIC === 'spointreplay', 'magic constant is ' + SPOINTREPLAY_MAGIC)
  assert(SPOINTREPLAY_VERSION === 2, 'version constant is ' + SPOINTREPLAY_VERSION)
})

gate('the envelope opens with the msgpackr record definition that spoint writes (0xd4 0x72)', () => {
  assert(written[0] === 0xd4 && written[1] === 0x72, 'envelope starts ' + Buffer.from(written.subarray(0, 4)).toString('hex'))
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
  const padded = Buffer.concat([Buffer.from(written), Buffer.from([0x00])])
  assert(refuses(() => decodeReplay(padded)), 'a file with a trailing byte was accepted')
})

gate('a file whose first byte is the reserved marker 0xc1 is refused', () => {
  const foreign = Buffer.from(written)
  foreign[0] = 0xc1
  assert(refuses(() => decodeReplay(foreign)), 'a file starting with 0xc1 was accepted')
})

gate('a flipped payload byte is accepted: the format has no checksum (documented, not detected)', () => {
  const flipped = patched(written, 'arena', 0, 'b'.charCodeAt(0))
  const envelope = decodeReplay(flipped)
  assert(envelope.header.worldName === 'brena', 'the flipped byte did not reach the decoded header')
})

gate('a header-less envelope is refused', () => {
  const headerless = pack({ magic: SPOINTREPLAY_MAGIC, version: SPOINTREPLAY_VERSION, inputs: [] })
  assert(refuses(() => decodeReplay(headerless)), 'an envelope without a header was accepted')
})

gate('the writer refuses a value it cannot encode', () => {
  const bad = { header: { worldName: 'arena' }, inputs: [{ tick: 1, data: { x: undefined } }] }
  assert(refuses(() => encodeReplay(bad)), 'an undefined field was written')
})

gate('the reader refuses a non-binary input', () => {
  assert(refuses(() => decodeReplay('not bytes')), 'a string was read as a replay')
})

finish()
