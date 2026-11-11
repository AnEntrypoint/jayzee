import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { SLOT_MASK, loadEngineModule } from '../src/engine/EngineWorld.js'
import { createInterest, INTEREST } from '../src/engine/interest.js'

const BODIES = 1024
const CLIENTS = 64
const CELLS_PER_SIDE = 8
const CELL_SIZE = 8
const ORIGIN = -32
const RADIUS_CELLS = 1
const UNCHANGED_DELTA_BYTES = 16
const MOVED_BODY = 0
const MOVE_BY = 0.5
const OUTSIDE_X = 100

const bodyX = (i) => -30 + (i % 32) * 1.8
const bodyZ = (i) => -30 + Math.floor(i / 32) * 1.8
const clientX = (k) => -28 + (k % 8) * 8
const clientZ = (k) => -28 + Math.floor(k / 8) * 8
const cellIndex = (value) => Math.min(CELLS_PER_SIDE - 1, Math.max(0, Math.floor((value - ORIGIN) / CELL_SIZE)))

const crowd = Array.from({ length: BODIES }, (_, i) => [bodyX(i), bodyZ(i)])

const expectedInWindow = (k) => {
  const cx = cellIndex(clientX(k))
  const cz = cellIndex(clientZ(k))
  let total = 0
  for (const [x, z] of crowd) {
    if (Math.abs(cellIndex(x) - cx) <= RADIUS_CELLS && Math.abs(cellIndex(z) - cz) <= RADIUS_CELLS) total++
  }
  return total
}

const module = await loadEngineModule()
assert.equal(module._engine_world_configure(BODIES, 60, 0, 0, 0.35, 0, 8), 0)
const handles = []
for (let i = 0; i < BODIES; i++) {
  const handle = module._engine_spawn(bodyX(i), 0.5, bodyZ(i), 0, 0, 0)
  assert.ok(handle >= 0, 'spawn ' + i + ' failed')
  assert.equal(handle & SLOT_MASK, i)
  handles.push(handle)
}
module._engine_tick(1)

const interest = createInterest(module, { players: CLIENTS })
const VISIBLE = (interest.segmentBytes - INTEREST.HEADER_BYTES) / (INTEREST.RECORD_BYTES + INTEREST.REMOVED_BYTES)
assert.ok(Number.isInteger(VISIBLE) && VISIBLE > 0, 'segment size does not match 16 + 37 per visible slot')

assert.equal(interest.configure(CLIENTS, CELL_SIZE, ORIGIN, ORIGIN, CELLS_PER_SIDE, RADIUS_CELLS), 0)
for (let k = 0; k < CLIENTS; k++) assert.equal(interest.setClient(k, clientX(k), clientZ(k), true), 0)

const readHeader = (slot) => {
  const view = new DataView(module.HEAPU8.buffer, interest.segmentOffset(slot), INTEREST.HEADER_BYTES)
  return {
    tick: view.getUint32(0, true),
    baseline: view.getUint32(4, true),
    records: view.getUint32(8, true),
    removed: view.getUint32(12, true),
  }
}

const readRecordIndices = (slot, count) => {
  const view = new DataView(module.HEAPU8.buffer, interest.segmentOffset(slot), INTEREST.HEADER_BYTES + count * INTEREST.RECORD_BYTES)
  const indices = []
  for (let r = 0; r < count; r++) indices.push(view.getUint32(INTEREST.HEADER_BYTES + r * INTEREST.RECORD_BYTES, true))
  return indices
}

gate('a dense crowd of 1024 bodies and 64 clients keeps every visible list at or below visiblePerClient', () => {
  const expected = Array.from({ length: CLIENTS }, (_, k) => expectedInWindow(k))
  assert.ok(Math.max(...expected) > VISIBLE, 'the crowd must overflow the visible limit to test truncation')
  assert.equal(interest.update(1), 0)
  let truncatedExpected = 0
  for (let k = 0; k < CLIENTS; k++) {
    const count = interest.visibleCount(k)
    assert.ok(count <= VISIBLE, 'client ' + k + ' sees ' + count + ' bodies, above ' + VISIBLE)
    assert.equal(count, Math.min(expected[k], VISIBLE), 'client ' + k + ' visible count')
    truncatedExpected += Math.max(0, expected[k] - VISIBLE)
  }
  assert.equal(interest.truncated(), truncatedExpected, 'truncation total')
})

gate('an unchanged crowd encodes a delta of exactly the 16-byte header', () => {
  assert.equal(interest.update(2), 0)
  assert.equal(interest.encode(0, 1), UNCHANGED_DELTA_BYTES)
  assert.deepEqual(readHeader(0), { tick: 2, baseline: 1, records: 0, removed: 0 })
})

gate('a moved body appears once in each delta that carries it, and only it is re-sent', () => {
  assert.equal(module._engine_set_position(handles[MOVED_BODY], bodyX(MOVED_BODY) + MOVE_BY, 0.5, bodyZ(MOVED_BODY)), 0)
  module._engine_tick(1)
  assert.equal(interest.update(3), 0)
  let carried = 0
  for (let k = 0; k < CLIENTS; k++) {
    const length = interest.encode(k, 2)
    assert.ok(length >= UNCHANGED_DELTA_BYTES, 'delta for client ' + k + ' is shorter than its header')
    const header = readHeader(k)
    assert.equal(length, INTEREST.HEADER_BYTES + header.records * INTEREST.RECORD_BYTES + header.removed * INTEREST.REMOVED_BYTES)
    const indices = readRecordIndices(k, header.records)
    assert.equal(new Set(indices).size, indices.length, 'client ' + k + ' delta repeats a body')
    const occurrences = indices.filter((index) => index === MOVED_BODY).length
    assert.ok(occurrences <= 1)
    carried += occurrences
    if (k === 0) {
      assert.equal(header.records, 1, 'client 0 should re-send only the moved body')
      assert.equal(indices[0], MOVED_BODY)
    }
  }
  assert.ok(carried >= 1, 'no delta carried the moved body')
})

gate('a body outside the grid is placed in the nearest edge cell and counted', () => {
  assert.equal(module._engine_set_position(handles[MOVED_BODY], OUTSIDE_X, 0.5, bodyZ(MOVED_BODY)), 0)
  module._engine_tick(1)
  assert.equal(interest.update(4), 0)
  assert.equal(interest.outside(), 1)
})

finish()
