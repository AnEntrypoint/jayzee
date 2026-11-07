import { test } from 'node:test'
import assert from 'node:assert/strict'
import { encodeInputs, decodeInputs, encodeSnapshot, decodeSnapshot } from '../src/index.js'

test('input packets round-trip sequence, axes, yaw and buttons', () => {
  const records = [
    { sequence: 7, moveX: 1, moveZ: -1, yaw: 0, buttons: 0b101 },
    { sequence: 8, moveX: 0.5, moveZ: 0, yaw: Math.PI, buttons: 0xffffffff },
  ]
  const decoded = decodeInputs(encodeInputs(records))
  assert.equal(decoded.length, 2)
  assert.equal(decoded[0].sequence, 7)
  assert.ok(Math.abs(decoded[0].moveX - 1) < 1e-9)
  assert.ok(Math.abs(decoded[0].moveZ + 1) < 1e-9)
  assert.equal(decoded[0].buttons, 0b101)
  assert.ok(Math.abs(decoded[1].moveX - 0.5) < 1 / 127)
  assert.ok(Math.abs(decoded[1].yaw - Math.PI) < 2 * Math.PI / 65536)
  assert.equal(decoded[1].buttons, 0xffffffff)
})

test('input yaw wraps into a single turn before it is encoded', () => {
  const [record] = decodeInputs(encodeInputs([{ sequence: 1, moveX: 0, moveZ: 0, yaw: 2 * Math.PI + 0.5, buttons: 0 }]))
  assert.ok(Math.abs(record.yaw - 0.5) < 2 * Math.PI / 65536)
})

test('input encoding refuses out-of-range fields instead of clamping them', () => {
  const base = { sequence: 1, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 }
  assert.throws(() => encodeInputs([{ ...base, moveX: 1.01 }]), RangeError)
  assert.throws(() => encodeInputs([{ ...base, sequence: -1 }]), RangeError)
  assert.throws(() => encodeInputs([{ ...base, buttons: 2 ** 32 }]), RangeError)
  assert.throws(() => encodeInputs([{ ...base, yaw: Number.NaN }]), TypeError)
  assert.throws(() => encodeInputs([]), RangeError)
})

test('input decoding rejects a wrong version, a truncated packet and a bad count', () => {
  const good = encodeInputs([{ sequence: 1, moveX: 0, moveZ: 0, yaw: 0, buttons: 0 }])
  const wrongVersion = new Uint8Array(good)
  wrongVersion[0] = 9
  assert.throws(() => decodeInputs(wrongVersion.buffer), RangeError)
  assert.throws(() => decodeInputs(good.slice(0, good.byteLength - 1)), RangeError)
  const badCount = new Uint8Array(good)
  badCount[1] = 2
  assert.throws(() => decodeInputs(badCount.buffer), RangeError)
})

test('snapshots round-trip tick and positions at float32 precision', () => {
  const positions = Float64Array.from([1.5, -2.25, 1000.125, 0, 0.1, -7])
  const decoded = decodeSnapshot(encodeSnapshot({ tick: 4242, count: 2, positions }))
  assert.equal(decoded.tick, 4242)
  assert.equal(decoded.count, 2)
  assert.deepEqual(Array.from(decoded.positions.subarray(0, 3)), [1.5, -2.25, 1000.125])
  assert.ok(Math.abs(decoded.positions[4] - 0.1) < 1e-7)
})

test('snapshot decoding rejects a length that does not match its body count', () => {
  const buffer = encodeSnapshot({ tick: 1, count: 1, positions: [0, 0, 0] })
  assert.throws(() => decodeSnapshot(buffer.slice(0, buffer.byteLength - 4)), RangeError)
})
