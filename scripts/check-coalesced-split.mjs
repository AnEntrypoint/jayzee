import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { readFileSync } from 'node:fs'
import { coalescedCases, runCoalesced } from './lib/netPortScenario.mjs'
import { COALESCE_SENTINEL, forEachCoalescedPart, frameCoalesced, isCoalesced, splitCoalesced } from '../src/protocol/coalescedFrame.js'
import { WIRE_BATCH_PREFIX, decodeWireFrame, encodeBatch, forEachBatchItem, frameForQueue } from '../src/transport/wireweaveFraming.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/net-port.json', import.meta.url), 'utf8')).sections.coalesced
const splitWireBatch = decodeWireFrame

const bufferOf = (...bytes) => Uint8Array.from(bytes).buffer
const hexOf = (bytes) => Buffer.from(bytes.buffer ? new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength) : new Uint8Array(bytes)).toString('hex')

const collect = (frame) => {
  const seen = []
  const count = forEachBatchItem(frame, (bytes, index) => seen.push([index, hexOf(bytes)]))
  return { count, seen }
}

gate('frameCoalesced and splitCoalesced give the spoint bytes and parts on 44 queues: the 0xff sentinel, little-endian lengths, and a lone message sent bare', () => {
  assert.equal(COALESCE_SENTINEL, 0xff)
  assert.equal(fixture.length, coalescedCases().length)
  assert.deepEqual(runCoalesced({ frame: frameCoalesced, split: splitCoalesced }), fixture)
  assert.ok(fixture.filter((c) => c.parts !== null).length > 25, 'only ' + fixture.filter((c) => c.parts !== null).length + ' coalesced cases')
})

gate('a frame cut inside a length or a body gives the parts before the cut, as spoint, and jayzee also reports the cut', () => {
  const framed = frameCoalesced([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5), Uint8Array.of(6)])
  const reports = []
  assert.equal(splitCoalesced(framed, (count) => reports.push(count)).length, 3)
  assert.deepEqual(reports, [])
  assert.equal(splitCoalesced(framed.subarray(0, framed.length - 1), (count) => reports.push(count)).length, 2)
  assert.equal(splitCoalesced(framed.subarray(0, 10), (count) => reports.push(count)).length, 1)
  assert.deepEqual(reports, [2, 1])
  assert.equal(forEachCoalescedPart(framed, () => {}), 3)
  assert.equal(forEachCoalescedPart(framed.subarray(0, 10), () => {}), -2)
})

gate('the parts are views into the frame, and three packed messages coalesced into one frame read back as the same messages', () => {
  const messages = [{ type: 16, payload: { n: 1 } }, { type: 51, payload: [1, 2, 3] }, { type: 3, payload: null }]
  const framed = frameCoalesced(messages.map((message) => pack(message)))
  assert.equal(isCoalesced(framed), true)
  const parts = splitCoalesced(framed)
  assert.ok(parts.every((part) => part.buffer === framed.buffer), 'a part was copied out of the frame')
  assert.deepEqual(parts.map((part) => unpack(part)), messages)
  assert.equal(isCoalesced(frameCoalesced([pack(messages[0])])), false)
  assert.throws(() => frameCoalesced([]), /at least one packed message/)
})

gate('negative control: reading the lengths big-endian, as the wireweave batch does, does not split a spoint coalesced frame', () => {
  const framed = frameCoalesced([Uint8Array.of(1, 2, 3), Uint8Array.of(4, 5)])
  const swapped = Uint8Array.from(framed)
  swapped[0] = WIRE_BATCH_PREFIX
  assert.equal(decodeWireFrame(swapped.buffer).length, 1)
  assert.equal(splitCoalesced(framed).length, 2)
})

gate('the wireweave batch split gives the three payloads of a batch frame in order', () => {
  const items = [bufferOf(1, 2, 3), bufferOf(), bufferOf(9)]
  const parts = splitWireBatch(encodeBatch(items))
  assert.deepEqual(parts.map(hexOf), ['010203', '', '09'])
})

gate('the wireweave batch split passes a lone payload through as one part, and a payload that starts with the batch prefix survives the queue', () => {
  const plain = bufferOf(7, 8)
  assert.equal(splitWireBatch(plain).length, 1)
  assert.equal(splitWireBatch(plain)[0], plain)
  const prefixed = bufferOf(WIRE_BATCH_PREFIX, 0, 0, 0, 1, 5)
  assert.deepEqual(splitWireBatch(frameForQueue([prefixed])).map(hexOf), [hexOf(prefixed)])
})

gate('a frame cut inside a length header or a body is passed through whole, never as a short list', () => {
  const whole = new Uint8Array(encodeBatch([bufferOf(1, 2, 3), bufferOf(4, 5)]))
  for (const cut of [whole.length - 1, whole.length - 3, 3]) {
    const torn = whole.slice(0, cut).buffer
    assert.equal(splitWireBatch(torn).length, 1)
    assert.equal(splitWireBatch(torn)[0], torn)
    assert.deepEqual(collect(torn), { count: 1, seen: [[0, hexOf(torn)]] })
  }
})

gate('decodeWireFrame and forEachBatchItem agree on 300 seeded queues of 0 to 6 payloads', () => {
  let seed = 12345
  const random = () => { seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff; return seed / 0x7fffffff }
  let frames = 0
  for (let round = 0; round < 300; round++) {
    const items = Array.from({ length: Math.floor(random() * 7) }, () => Uint8Array.from({ length: Math.floor(random() * 40) }, () => Math.floor(random() * 256)).buffer)
    const frame = frameForQueue(items)
    if (frame === null) { assert.equal(items.length, 0); continue }
    frames++
    const want = items.map(hexOf)
    assert.deepEqual(splitWireBatch(frame).map(hexOf), want)
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
  assert.equal(forEachBatchItem(padded.subarray(4), (bytes) => views.push(bytes)), 2)
  assert.ok(views.every((view) => view.buffer === padded.buffer), 'a part was copied out of the frame')
  assert.deepEqual(views.map(hexOf), ['0102', '03'])
  assert.throws(() => forEachBatchItem(frame.buffer), /needs a visit function/)
  assert.throws(() => forEachBatchItem('frame', () => {}), /ArrayBuffer or a view of bytes/)
})

gate('three packed messages coalesced into one frame read back as the same three messages', () => {
  const messages = [{ type: 'a', payload: { n: 1 } }, { type: 'b', payload: [1, 2, 3] }, { type: 'c', payload: null }]
  const frame = frameForQueue(messages.map((message) => { const bytes = pack(message); return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) }))
  assert.deepEqual(splitWireBatch(frame).map((part) => unpack(new Uint8Array(part.buffer ?? part, part.byteOffset ?? 0, part.byteLength))), messages)
})

gate('negative control: a frame whose prefix byte is changed is no longer split', () => {
  const frame = new Uint8Array(encodeBatch([bufferOf(1, 2, 3), bufferOf(4)]))
  assert.equal(splitWireBatch(frame.buffer).length, 2)
  frame[0] = WIRE_BATCH_PREFIX ^ 1
  assert.equal(splitWireBatch(frame.buffer).length, 1)
  assert.equal(collect(frame.buffer).count, 1)
})

finish()
