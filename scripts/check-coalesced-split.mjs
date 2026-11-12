import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { WIRE_BATCH_PREFIX, decodeWireFrame, encodeBatch, forEachCoalesced, frameForQueue, splitCoalesced } from '../src/transport/wireweaveFraming.js'

const bufferOf = (...bytes) => Uint8Array.from(bytes).buffer
const hexOf = (bytes) => Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes)).toString('hex')

const collect = (frame) => {
  const seen = []
  const count = forEachCoalesced(frame, (bytes, index) => seen.push([index, hexOf(bytes)]))
  return { count, seen }
}

gate('splitCoalesced splits a coalesced frame of three payloads into the three payloads in order', () => {
  const items = [bufferOf(1, 2, 3), bufferOf(), bufferOf(9)]
  const parts = splitCoalesced(encodeBatch(items))
  assert.deepEqual(parts.map(hexOf), ['010203', '', '09'])
})

gate('splitCoalesced passes a lone payload through as one part, and a payload that starts with the batch prefix survives the queue', () => {
  const plain = bufferOf(7, 8)
  assert.equal(splitCoalesced(plain).length, 1)
  assert.equal(splitCoalesced(plain)[0], plain)
  const prefixed = bufferOf(WIRE_BATCH_PREFIX, 0, 0, 0, 1, 5)
  assert.deepEqual(splitCoalesced(frameForQueue([prefixed])).map(hexOf), [hexOf(prefixed)])
})

gate('a frame cut inside a length header or a body is passed through whole, never as a short list', () => {
  const whole = new Uint8Array(encodeBatch([bufferOf(1, 2, 3), bufferOf(4, 5)]))
  for (const cut of [whole.length - 1, whole.length - 3, 3]) {
    const torn = whole.slice(0, cut).buffer
    assert.equal(splitCoalesced(torn).length, 1)
    assert.equal(splitCoalesced(torn)[0], torn)
    assert.deepEqual(collect(torn), { count: 1, seen: [[0, hexOf(torn)]] })
  }
})

gate('splitCoalesced and decodeWireFrame agree on 300 seeded queues of 0 to 6 payloads', () => {
  let seed = 12345
  const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let frames = 0
  for (let round = 0; round < 300; round++) {
    const items = Array.from({ length: Math.floor(random() * 7) }, () => Uint8Array.from({ length: Math.floor(random() * 40) }, () => Math.floor(random() * 256)).buffer)
    const frame = frameForQueue(items)
    if (frame === null) { assert.equal(items.length, 0); continue }
    frames++
    const want = items.map(hexOf)
    assert.deepEqual(splitCoalesced(frame).map(hexOf), want)
    assert.deepEqual(decodeWireFrame(frame).map(hexOf), want)
    const walked = collect(frame)
    assert.equal(walked.count, items.length)
    assert.deepEqual(walked.seen.map(([, hex]) => hex), want)
  }
  assert.ok(frames > 200, 'only ' + frames + ' frames were built')
})

gate('forEachCoalesced visits views into the frame without copying, and takes a view with an offset', () => {
  const frame = new Uint8Array(encodeBatch([bufferOf(1, 2), bufferOf(3)]))
  const padded = new Uint8Array(frame.length + 4)
  padded.set(frame, 4)
  const views = []
  assert.equal(forEachCoalesced(padded.subarray(4), (bytes) => views.push(bytes)), 2)
  assert.ok(views.every((view) => view.buffer === padded.buffer), 'a part was copied out of the frame')
  assert.deepEqual(views.map(hexOf), ['0102', '03'])
  assert.throws(() => forEachCoalesced(frame.buffer), /needs a visit function/)
  assert.throws(() => forEachCoalesced('frame', () => {}), /ArrayBuffer or a view of bytes/)
})

gate('three packed messages coalesced into one frame read back as the same three messages', () => {
  const messages = [{ type: 'a', payload: { n: 1 } }, { type: 'b', payload: [1, 2, 3] }, { type: 'c', payload: null }]
  const frame = frameForQueue(messages.map((message) => { const bytes = pack(message); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }))
  assert.deepEqual(splitCoalesced(frame).map((part) => unpack(new Uint8Array(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength))), messages)
})

gate('negative control: a frame whose prefix byte is changed is no longer split', () => {
  const frame = new Uint8Array(encodeBatch([bufferOf(1, 2, 3), bufferOf(4)]))
  assert.equal(splitCoalesced(frame.buffer).length, 2)
  frame[0] = WIRE_BATCH_PREFIX ^ 1
  assert.equal(splitCoalesced(frame.buffer).length, 1)
  assert.equal(collect(frame.buffer).count, 1)
})

finish()
