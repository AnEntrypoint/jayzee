import { gate, finish } from './lib/gate.mjs'
import { allocateRingBuffer, assertRingLayout, isRingAvailable, TransformRingWriter, TransformRingReader } from '../src/transport/transformRing.js'
import { WIRE_BATCH_PREFIX, WIRE_BATCH_THRESHOLD, toArrayBuffer, encodeBatch, decodeBatch, decodeWireFrame, frameForQueue, isLargeWirePayload } from '../src/transport/wireweaveFraming.js'
import { createWorkerSender, createPeerSender, SendContractError } from '../src/transport/workerMessages.js'
import { deriveWebTransportUrl, readErrorBackoffMs } from '../src/transport/webTransportPolicy.js'

const RING_CAPACITY_FOUR_BYTES = 16 + 4 * 2 * 4 + 4 * 10 * 8
const GENERATION_WORD = 2

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const throwsAs = (fn, ErrorType) => {
  try {
    fn()
  } catch (error) {
    return error instanceof ErrorType
  }
  return false
}

const withIsolation = (fn) => {
  const previous = globalThis.crossOriginIsolated
  globalThis.crossOriginIsolated = true
  try {
    return fn()
  } finally {
    if (previous === undefined) delete globalThis.crossOriginIsolated
    else globalThis.crossOriginIsolated = previous
  }
}

const ringOf = (capacity) => withIsolation(() => allocateRingBuffer(capacity)).sab

const setGeneration = (sab, value) => {
  Atomics.store(new Int32Array(sab, 0, 4), GENERATION_WORD, value)
}

const bytes = (...values) => new Uint8Array(values).buffer
const bytesOf = (value) => JSON.stringify(Array.from(ArrayBuffer.isView(value) ? new Uint8Array(value.buffer, value.byteOffset, value.byteLength) : new Uint8Array(value)))
const sameBytes = (a, b) => bytesOf(a) === bytesOf(b)

const poseOf = (seed) => ({ position: [seed, seed + 1, seed + 2], rotation: [0, 0, 0, 1], velocity: [seed * 2, 0, -seed] })
const expectedPose = (seed) => ({ ...poseOf(seed), stale: false })

gate('isRingAvailable and allocateRingBuffer stay off without cross-origin isolation', () => {
  assert(isRingAvailable() === false, 'ring reported available without isolation')
  assert(allocateRingBuffer(4) === null, 'ring allocated without isolation')
  const granted = withIsolation(() => allocateRingBuffer(4))
  assert(granted !== null && granted.sab.byteLength === RING_CAPACITY_FOUR_BYTES, 'isolated allocation has the wrong layout size')
})

gate('a pose round-trips through the ring for every placed player', () => {
  const sab = ringOf(4)
  const writer = new TransformRingWriter(sab, 4)
  const reader = new TransformRingReader(sab, 4)
  assert(writer.write(7, poseOf(1).position, poseOf(1).rotation, poseOf(1).velocity), 'write for player 7 refused')
  assert(writer.write(9, poseOf(2).position, poseOf(2).rotation, poseOf(2).velocity), 'write for player 9 refused')
  const players = reader.readAll()
  assert(JSON.stringify(players.get(7)) === JSON.stringify(expectedPose(1)), 'player 7 pose differs: ' + JSON.stringify(players.get(7)))
  assert(JSON.stringify(players.get(9)) === JSON.stringify(expectedPose(2)), 'player 9 pose differs')
  assert(players.get(8) === undefined, 'negative control: an unwritten player id appeared')
  assert(players.get(7).position[0] !== 2, 'negative control: player 7 carries player 9 values')
})

gate('a ring nobody has written reads as empty, not as player 0', () => {
  const sab = ringOf(4)
  const reader = new TransformRingReader(sab, 4)
  assert(reader.readAll().size === 0, 'unwritten ring read ' + reader.readAll().size + ' players')
  const writer = new TransformRingWriter(sab, 4)
  writer.write(0, poseOf(3).position, poseOf(3).rotation, poseOf(3).velocity)
  assert(JSON.stringify(reader.readAll().get(0)) === JSON.stringify(expectedPose(3)), 'negative control: player 0 unreadable after a real write')
})

gate('release removes a player from reads and hands its slot to the next player', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const reader = new TransformRingReader(sab, 2)
  writer.write(7, poseOf(1).position, poseOf(1).rotation, poseOf(1).velocity)
  assert(writer.slotOf(7) === 0, 'first player did not take slot 0')
  assert(reader.readAll().has(7), 'negative control: player 7 missing before release')
  assert(writer.release(7) === true, 'release of placed player refused')
  assert(!reader.readAll().has(7), 'released player still read')
  assert(writer.release(7) === false, 'negative control: second release reported success')
  writer.write(9, poseOf(2).position, poseOf(2).rotation, poseOf(2).velocity)
  assert(writer.slotOf(9) === 0, 'released slot was not reused')
})

gate('a full ring refuses a new player while placed players keep writing', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const pose = poseOf(1)
  assert(writer.write(1, pose.position, pose.rotation, pose.velocity) === true, 'slot 1 of 2 refused')
  assert(writer.write(2, pose.position, pose.rotation, pose.velocity) === true, 'slot 2 of 2 refused')
  assert(writer.write(3, pose.position, pose.rotation, pose.velocity) === false, 'third player accepted by a 2-slot ring')
  assert(writer.hasSlot(3) === false, 'refused player was assigned a slot')
  assert(writer.write(1, pose.position, pose.rotation, pose.velocity) === true, 'placed player refused after the ring filled')
  writer.release(1)
  assert(writer.write(3, pose.position, pose.rotation, pose.velocity) === true, 'negative control: player 3 still refused after a release freed a slot')
})

gate('the writer refuses while the ring generation is odd', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const pose = poseOf(1)
  setGeneration(sab, 1)
  assert(writer.write(1, pose.position, pose.rotation, pose.velocity) === false, 'write accepted while the ring is locked')
  setGeneration(sab, 2)
  assert(writer.write(1, pose.position, pose.rotation, pose.velocity) === true, 'negative control: write refused after unlock')
})

gate('a cut taken over a locked ring is inconsistent and marks its poses stale', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const reader = new TransformRingReader(sab, 2)
  const pose = poseOf(1)
  writer.write(7, pose.position, pose.rotation, pose.velocity)
  setGeneration(sab, 1)
  const locked = reader.readCut(0)
  assert(locked.consistent === false && locked.generation === -1, 'locked cut reported consistent')
  assert(locked.players.get(7).stale === true, 'locked cut pose not marked stale')
  setGeneration(sab, 2)
  const settled = reader.readCut(0)
  assert(settled.consistent === true && settled.generation === 2, 'negative control: settled cut reported inconsistent')
  assert(settled.players.get(7).stale === false, 'negative control: settled pose marked stale')
})

gate('a release advances the epoch and a plain write does not', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const reader = new TransformRingReader(sab, 2)
  const pose = poseOf(1)
  const before = reader.readCut()
  writer.write(7, pose.position, pose.rotation, pose.velocity)
  const afterWrite = reader.readCut()
  assert(afterWrite.epoch === before.epoch, 'a plain write advanced the epoch')
  writer.release(7)
  const afterRelease = reader.readCut()
  assert(afterRelease.epoch === before.epoch + 1, 'release did not advance the epoch by one')
  assert(!afterRelease.players.has(7), 'negative control: released cut still lists the player')
})

gate('assertRingLayout accepts only a buffer stamped with this capacity and magic', () => {
  const sab = ringOf(4)
  assertRingLayout(sab, 4)
  assert(throwsAs(() => assertRingLayout(sab, 5), RangeError), 'capacity mismatch accepted')
  assert(throwsAs(() => assertRingLayout(new SharedArrayBuffer(RING_CAPACITY_FOUR_BYTES), 4), RangeError), 'buffer without magic accepted')
  assert(throwsAs(() => assertRingLayout(new ArrayBuffer(RING_CAPACITY_FOUR_BYTES), 4), TypeError), 'non-shared buffer accepted')
})

gate('the writer rejects a malformed pose or player id before touching the ring', () => {
  const sab = ringOf(2)
  const writer = new TransformRingWriter(sab, 2)
  const pose = poseOf(1)
  assert(throwsAs(() => writer.write(1, [1, 2], pose.rotation, pose.velocity), RangeError), 'short position accepted')
  assert(throwsAs(() => writer.tryAssign(-1), RangeError), 'negative player id accepted')
  assert(throwsAs(() => writer.tryAssign(1.5), RangeError), 'fractional player id accepted')
  assert(writer.hasSlot(1) === false, 'malformed write assigned a slot')
  assert(writer.write(1, pose.position, pose.rotation, pose.velocity) === true, 'negative control: well-formed write refused')
})

gate('encodeBatch frames items with big-endian lengths and decodes them back in order', () => {
  const items = [bytes(1, 2, 3), bytes(), bytes(WIRE_BATCH_PREFIX, 0, 0, 0, 1, 0x41)]
  const frame = new Uint8Array(encodeBatch(items))
  assert(frame[0] === WIRE_BATCH_PREFIX && frame[1] === 0 && frame[4] === 3, 'header is not prefix plus big-endian length 3')
  const decoded = decodeWireFrame(frame.buffer)
  assert(decoded.length === 3, 'decoded ' + decoded.length + ' items, expected 3')
  decoded.forEach((item, index) => assert(sameBytes(item, items[index]), 'item ' + index + ' differs after round trip'))
  assert(!sameBytes(decoded[0], items[1]), 'negative control: first decoded item equals the second input')
})

gate('decodeBatch returns null for a frame cut inside a length header or a body', () => {
  const frame = new Uint8Array(encodeBatch([bytes(1, 2, 3)]))
  const batchOnly = (length) => new Uint8Array(frame.buffer, 1, length)
  assert(decodeBatch(batchOnly(7)) !== null, 'negative control: whole batch rejected')
  assert(decodeBatch(batchOnly(2)) === null, 'header cut accepted')
  assert(decodeBatch(batchOnly(6)) === null, 'body cut accepted')
})

gate('a payload that starts with the batch prefix survives when sent alone', () => {
  const payload = bytes(WIRE_BATCH_PREFIX, 0, 0, 0, 1, 0x41)
  const frame = frameForQueue([payload])
  const delivered = decodeWireFrame(frame)
  assert(delivered.length === 1 && sameBytes(delivered[0], payload), 'wrapped prefix payload not delivered whole')
  assert(!sameBytes(decodeWireFrame(payload)[0], payload), 'negative control: unwrapped prefix payload was delivered intact')
})

gate('frameForQueue sends nothing for an empty queue, a lone plain payload unchanged, and several as one batch', () => {
  const first = bytes(1, 2)
  const second = bytes(3, 4, 5)
  assert(frameForQueue([]) === null, 'empty queue produced a frame')
  assert(frameForQueue([first]) === first, 'lone plain payload was re-framed')
  const batch = frameForQueue([first, second])
  assert(new Uint8Array(batch)[0] === WIRE_BATCH_PREFIX, 'several payloads not sent as a batch')
  const delivered = decodeWireFrame(batch)
  assert(delivered.length === 2 && sameBytes(delivered[0], first) && sameBytes(delivered[1], second), 'batch lost order or content')
  assert(frameForQueue([first, second]) !== first, 'negative control: batch identical to its first item')
})

gate('decodeWireFrame passes an unprefixed or malformed frame through whole', () => {
  const plain = bytes(1, 2, 3)
  const malformed = bytes(WIRE_BATCH_PREFIX, 0, 0, 0, 9, 1)
  const plainOut = decodeWireFrame(plain)
  assert(plainOut.length === 1 && sameBytes(plainOut[0], plain), 'unprefixed frame altered')
  const malformedOut = decodeWireFrame(malformed)
  assert(malformedOut.length === 1 && sameBytes(malformedOut[0], malformed), 'malformed batch not passed through whole')
  assert(decodeWireFrame(encodeBatch([plain, plain])).length === 2, 'negative control: well-formed batch not unwrapped')
})

gate('the large-payload threshold is 128 bytes', () => {
  assert(WIRE_BATCH_THRESHOLD === 128, 'threshold is ' + WIRE_BATCH_THRESHOLD)
  assert(isLargeWirePayload(new ArrayBuffer(128)) === true, '128-byte payload not large')
  assert(isLargeWirePayload(new ArrayBuffer(127)) === false, 'negative control: 127-byte payload counted as large')
})

gate('toArrayBuffer copies the bytes of a view and refuses non-byte input', () => {
  const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])
  const copy = toArrayBuffer(source.subarray(2, 5))
  assert(sameBytes(copy, bytes(3, 4, 5)), 'copy holds the wrong bytes')
  source[2] = 99
  assert(sameBytes(copy, bytes(3, 4, 5)), 'copy aliases the source view')
  const arrayBuffer = bytes(1)
  assert(toArrayBuffer(arrayBuffer) !== arrayBuffer, 'negative control: ArrayBuffer returned by identity')
  assert(throwsAs(() => toArrayBuffer(5), TypeError), 'number accepted as a payload')
  assert(throwsAs(() => toArrayBuffer([1, 2]), TypeError), 'plain array accepted as a payload')
})

gate('createWorkerSender posts SEND_CLIENT with the payload and a transfer list naming its buffer', () => {
  const posted = []
  const send = createWorkerSender((message, transfer) => posted.push({ message, transfer }))
  assert(send(bytes(1, 2, 3), 4) === true, 'send did not report reaching the wire')
  const [first] = posted
  assert(first.message.type === 'SEND_CLIENT' && first.message.mt === 4, 'message type or mt wrong')
  assert(first.message.data instanceof ArrayBuffer && first.transfer[0] === first.message.data, 'transfer list does not name the payload buffer')
  assert(sameBytes(first.message.data, bytes(1, 2, 3)), 'payload bytes wrong')
  const larger = new Uint8Array([9, 9, 1, 2, 3, 9]).subarray(2, 5)
  send(larger, 0)
  const second = posted[1]
  assert(second.transfer[0] !== larger.buffer && sameBytes(second.message.data, bytes(1, 2, 3)), 'negative control: a view transferred its whole backing buffer')
})

gate('the transfer list detaches the sent buffer when a clone applies it', () => {
  const payload = bytes(1, 2, 3)
  let delivered = null
  const send = createWorkerSender((message, transfer) => {
    delivered = structuredClone(message, { transfer })
  })
  send(payload, 0)
  assert(payload.byteLength === 0, 'sent buffer still attached after transfer')
  assert(sameBytes(delivered.data, bytes(1, 2, 3)), 'transferred clone holds the wrong bytes')
  const kept = bytes(1, 2, 3)
  structuredClone({ data: kept })
  assert(kept.byteLength === 3, 'negative control: a clone without transfer detached the buffer')
})

gate('createPeerSender posts PEER_SEND with the peer id and refuses non-byte data', () => {
  const posted = []
  const send = createPeerSender('peer-a', (message, transfer) => posted.push({ message, transfer }))
  assert(send(bytes(7), 2) === true, 'peer send did not report reaching the wire')
  const message = posted[0].message
  assert(message.type === 'PEER_SEND' && message.peerId === 'peer-a' && message.mt === 2, 'PEER_SEND shape wrong')
  assert(throwsAs(() => send('abc', 0), SendContractError), 'string payload accepted by a peer sender')
  assert(posted.length === 1, 'negative control: refused payload still posted')
})

gate('worker senders refuse non-byte data and an uncallable postFn with SendContractError', () => {
  const posted = []
  const send = createWorkerSender((message, transfer) => posted.push({ message, transfer }))
  for (const refused of ['abc', [1, 2, 3], 7, new DataView(new ArrayBuffer(4))]) {
    assert(throwsAs(() => send(refused, 0), SendContractError), 'refused payload accepted: ' + String(refused))
  }
  assert(posted.length === 0, 'a refused payload reached the post function')
  assert(throwsAs(() => createWorkerSender(undefined), SendContractError), 'uncallable postFn accepted')
  assert(throwsAs(() => createPeerSender('p', 'not-a-function'), SendContractError), 'uncallable peer postFn accepted')
  assert(send(new Uint8Array(3), 0) === true && posted.length === 1, 'negative control: valid bytes refused')
})

gate('deriveWebTransportUrl keeps the host and uses port 4433 unless one is given', () => {
  assert(deriveWebTransportUrl('wss://game.example/ws') === 'https://game.example:4433/', 'default port wrong')
  assert(deriveWebTransportUrl('ws://127.0.0.1:8080/x', 5000) === 'https://127.0.0.1:5000/', 'explicit port wrong')
  assert(deriveWebTransportUrl('not a url') === null, 'invalid URL not rejected')
  assert(deriveWebTransportUrl('wss://game.example/ws', 5000) !== 'https://game.example:4433/', 'negative control: explicit port replaced by default')
})

gate('readErrorBackoffMs doubles from 10 ms and stops at 1000 ms', () => {
  const schedule = [1, 2, 3, 7, 8, 30].map(readErrorBackoffMs)
  assert(JSON.stringify(schedule) === JSON.stringify([10, 20, 40, 640, 1000, 1000]), 'schedule is ' + JSON.stringify(schedule))
  assert(readErrorBackoffMs(8) !== 1280, 'negative control: backoff not capped at 1000 ms')
})

finish()
