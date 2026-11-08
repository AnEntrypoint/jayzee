import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import {
  ENTITY_RECORD_BYTES,
  PLAYER_RECORD_BYTES,
  WIRE_UNITS_PER_METER,
  encodeEntityRecord,
  decodeEntityRecord,
  encodePlayerRecord,
  decodePlayerRecord,
  encodeSmallestThree,
  decodeSmallestThree,
  msgpackArrayHeader,
  frameRecordArray
} from '../src/wire/index.js'
import { pack } from '../src/protocol/msgpack.js'

const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const span = (rand, low, high) => low + rand() * (high - low)

const POSITION_ROUND_TRIP = 0.5 / WIRE_UNITS_PER_METER + 1e-9
const QUAT_STEP_TOLERANCE = 4 / (511 * Math.SQRT2)

const unit = (components) => {
  const length = Math.sqrt(components.reduce((sum, value) => sum + value * value, 0))
  return components.map((value) => value / length)
}

const largestIndex = (components) => components.reduce((best, value, index) => (Math.abs(value) > Math.abs(components[best]) ? index : best), 0)

const entityFixture = () => ({ position: [1.5, -2, 0.25], rotationWord: 0x12345678, velocity: [1, -0.5, 0], scale: [1, 2, 0.5], flags: 0x5a })
const playerFixture = () => ({ position: [1.5, -2, 0.25], rotationWord: 0x12345678, velocity: [1, -0.5, 0] })

gate('an entity record is exactly 29 bytes and a player record exactly 22', () => {
  assert.equal(ENTITY_RECORD_BYTES, 29)
  assert.equal(PLAYER_RECORD_BYTES, 22)
  assert.equal(encodeEntityRecord(entityFixture()).length, 29)
  assert.equal(encodePlayerRecord(playerFixture()).length, 22)
  assert.throws(() => decodeEntityRecord(encodePlayerRecord(playerFixture())), RangeError)
  assert.throws(() => decodePlayerRecord(encodeEntityRecord(entityFixture())), RangeError)
})

gate('fields land at the byte offsets the spoint layout names', () => {
  const expected = [
    0x96, 0x00, 0x00, 0x00,
    0x38, 0xff, 0xff, 0xff,
    0x19, 0x00, 0x00, 0x00,
    0x64, 0x00, 0xce, 0xff, 0x00, 0x00,
    0x78, 0x56, 0x34, 0x12,
    0x64, 0x00, 0xc8, 0x00, 0x32, 0x00,
    0x5a
  ]
  assert.deepEqual([...encodeEntityRecord(entityFixture())], expected)
  assert.deepEqual([...encodePlayerRecord(playerFixture())], expected.slice(0, 22))
})

gate('round trips keep position and velocity within half a wire unit and scale and flags exactly', () => {
  const rand = random(7)
  for (let i = 0; i < 500; i++) {
    const input = {
      position: [span(rand, -9000, 9000), span(rand, -50, 50), span(rand, -9000, 9000)],
      rotationWord: Math.floor(rand() * 2 ** 32),
      velocity: [span(rand, -300, 300), span(rand, -300, 300), span(rand, -300, 300)],
      scale: [span(rand, 0, 655), span(rand, 0, 655), span(rand, 0, 655)],
      flags: Math.floor(rand() * 256)
    }
    const entity = decodeEntityRecord(encodeEntityRecord(input))
    const player = decodePlayerRecord(encodePlayerRecord(input))
    for (let axis = 0; axis < 3; axis++) {
      assert.ok(Math.abs(entity.position[axis] - input.position[axis]) <= POSITION_ROUND_TRIP, 'entity position ' + axis + ' ' + input.position[axis])
      assert.ok(Math.abs(entity.velocity[axis] - input.velocity[axis]) <= POSITION_ROUND_TRIP, 'entity velocity ' + axis + ' ' + input.velocity[axis])
      assert.ok(Math.abs(entity.scale[axis] - input.scale[axis]) <= POSITION_ROUND_TRIP, 'entity scale ' + axis + ' ' + input.scale[axis])
      assert.ok(Math.abs(player.position[axis] - input.position[axis]) <= POSITION_ROUND_TRIP, 'player position ' + axis + ' ' + input.position[axis])
      assert.ok(Math.abs(player.velocity[axis] - input.velocity[axis]) <= POSITION_ROUND_TRIP, 'player velocity ' + axis + ' ' + input.velocity[axis])
    }
    assert.equal(entity.rotationWord, input.rotationWord)
    assert.equal(player.rotationWord, input.rotationWord)
    assert.equal(entity.flags, input.flags)
  }
})

gate('rotation words keep bit 31 unsigned and a one-unit position change is visible after decoding', () => {
  for (const word of [0xffffffff, 0x80000000, 0]) {
    assert.equal(decodePlayerRecord(encodePlayerRecord({ ...playerFixture(), rotationWord: word })).rotationWord, word)
  }
  const moved = decodePlayerRecord(encodePlayerRecord({ ...playerFixture(), position: [1.52, -2, 0.25] }))
  assert.notEqual(moved.position[0], 1.5)
  assert.ok(Math.abs(moved.position[0] - 1.52) <= POSITION_ROUND_TRIP)
})

gate('smallest-three keeps the largest index and decodes a negative largest component as its positive double cover', () => {
  const q = unit([0.2, -0.1, 0.9, 0.3])
  const word = encodeSmallestThree(q)
  assert.equal(Math.floor(word / 2 ** 30), 2)
  const back = decodeSmallestThree(word)
  assert.ok(back[2] >= 0)
  q.forEach((value, axis) => assert.ok(Math.abs(back[axis] - value) <= QUAT_STEP_TOLERANCE, 'axis ' + axis))

  const negative = [0, 0, -1, 0]
  const decoded = decodeSmallestThree(encodeSmallestThree(negative))
  const expectedPositive = [0, 0, 1, 0]
  expectedPositive.forEach((value, axis) => assert.ok(Math.abs(decoded[axis] - value) <= QUAT_STEP_TOLERANCE, 'double cover axis ' + axis))
  assert.ok(Math.abs(decoded[2] - negative[2]) > 1, 'decoded largest component kept its negative sign')
  assert.equal(encodeSmallestThree(negative), encodeSmallestThree(negative.map((value) => -value)))
})

gate('smallest-three round trip stays within four steps and keeps the largest index for random unit quaternions', () => {
  const rand = random(11)
  for (let i = 0; i < 2000; i++) {
    const q = unit([0, 0, 0, 0].map(() => span(rand, -1, 1)))
    const word = encodeSmallestThree(q)
    const index = largestIndex(q)
    assert.equal(Math.floor(word / 2 ** 30), index, 'index for sample ' + i)
    const sign = q[index] < 0 ? -1 : 1
    const back = decodeSmallestThree(word)
    assert.ok(back[index] >= 0, 'largest component sign for sample ' + i)
    q.forEach((value, axis) => assert.ok(Math.abs(back[axis] - sign * value) <= QUAT_STEP_TOLERANCE, 'sample ' + i + ' axis ' + axis))
  }
})

gate('smallest-three refuses a non-unit quaternion, a non-finite component and words no unit quaternion can give', () => {
  assert.throws(() => encodeSmallestThree([1, 1, 0, 0]), RangeError)
  assert.throws(() => encodeSmallestThree([NaN, 0, 0, 1]), RangeError)
  assert.throws(() => decodeSmallestThree(0x3fffffff), RangeError)
  assert.throws(() => decodeSmallestThree(-1), RangeError)
  assert.throws(() => decodeSmallestThree(2 ** 32), RangeError)
})

gate('out-of-range fields are refused, not clamped', () => {
  assert.throws(() => encodeEntityRecord({ ...entityFixture(), position: [21474836.48, 0, 0] }), RangeError)
  assert.throws(() => encodeEntityRecord({ ...entityFixture(), velocity: [327.68, 0, 0] }), RangeError)
  assert.throws(() => encodeEntityRecord({ ...entityFixture(), scale: [655.36, 1, 1] }), RangeError)
  assert.throws(() => encodeEntityRecord({ ...entityFixture(), scale: [-0.01, 1, 1] }), RangeError)
  assert.throws(() => encodeEntityRecord({ ...entityFixture(), flags: 256 }), RangeError)
  assert.throws(() => encodePlayerRecord({ ...playerFixture(), position: [NaN, 0, 0] }), RangeError)
  assert.throws(() => encodePlayerRecord({ ...playerFixture(), rotationWord: 2 ** 32 }), RangeError)
  assert.throws(() => encodePlayerRecord({ ...playerFixture(), rotationWord: -1 }), RangeError)
  assert.doesNotThrow(() => encodeEntityRecord({ ...entityFixture(), velocity: [327.67, -327.67, 0], scale: [655.35, 0, 0] }))
})

gate('a changed field changes the bytes at its offset and an unchanged input changes nothing', () => {
  const base = encodeEntityRecord(entityFixture())
  const changedOffsets = (mutate) => {
    const other = encodeEntityRecord(mutate(entityFixture()))
    return [...other].flatMap((byte, offset) => (byte !== base[offset] ? [offset] : []))
  }
  assert.deepEqual(changedOffsets((f) => ({ ...f, position: [1.51, -2, 0.25] })), [0])
  assert.deepEqual(changedOffsets((f) => ({ ...f, velocity: [1, -0.5, 0.01] })), [16])
  assert.deepEqual(changedOffsets((f) => ({ ...f, rotationWord: 0x12345679 })), [18])
  assert.deepEqual(changedOffsets((f) => ({ ...f, scale: [1, 2, 0.51] })), [26])
  assert.deepEqual(changedOffsets((f) => ({ ...f, flags: 0x5b })), [28])
  assert.deepEqual(changedOffsets((f) => ({ ...f })), [])
})

gate('a truncated record is refused', () => {
  const entity = encodeEntityRecord(entityFixture())
  const player = encodePlayerRecord(playerFixture())
  assert.throws(() => decodeEntityRecord(entity.subarray(0, 28)), /truncated/)
  assert.throws(() => decodePlayerRecord(player.subarray(0, 21)), /truncated/)
  assert.throws(() => decodePlayerRecord(new Uint8Array(0)), RangeError)
  assert.equal(decodePlayerRecord(new DataView(player.buffer, player.byteOffset, player.byteLength)).rotationWord, 0x12345678)
})

gate('the framing header follows the msgpack array forms and refuses lengths that are not uint32', () => {
  assert.deepEqual([...msgpackArrayHeader(0)], [0x90])
  assert.deepEqual([...msgpackArrayHeader(15)], [0x9f])
  assert.deepEqual([...msgpackArrayHeader(16)], [0xdc, 0x00, 0x10])
  assert.deepEqual([...msgpackArrayHeader(0xffff)], [0xdc, 0xff, 0xff])
  assert.deepEqual([...msgpackArrayHeader(0x10000)], [0xdd, 0x00, 0x01, 0x00, 0x00])
  assert.throws(() => msgpackArrayHeader(-1), RangeError)
  assert.throws(() => msgpackArrayHeader(2 ** 32), RangeError)
})

gate('a framed record array is the header followed by each record in order', () => {
  const first = encodeEntityRecord(entityFixture())
  const second = encodeEntityRecord({ ...entityFixture(), flags: 1 })
  const framed = frameRecordArray([first, second])
  assert.equal(framed.length, 1 + 29 + 29)
  assert.equal(framed[0], 0x92)
  assert.deepEqual(framed.subarray(1, 30), first)
  assert.deepEqual(framed.subarray(30), second)
  assert.notDeepEqual(frameRecordArray([second, first]), framed)
  assert.throws(() => frameRecordArray([[1, 2, 3]]), RangeError)
})

gate('the array header matches the header the shipped msgpack packer writes for the same length', () => {
  for (const length of [0, 1, 15, 16, 255, 0xffff, 0x10000]) {
    const header = [...msgpackArrayHeader(length)]
    const packed = [...pack(new Array(length).fill(0))]
    assert.deepEqual(packed.slice(0, header.length), header, 'length ' + length)
  }
})

finish()
