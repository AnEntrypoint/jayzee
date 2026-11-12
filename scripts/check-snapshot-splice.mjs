import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { newRecordMemo, packSnapshotBytes, snapshotPackCounts } from '../src/netcode/SnapshotPacker.js'
import { MSG } from '../src/protocol/messages.js'
import { pack, unpack } from '../src/protocol/msgpack.js'

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const wholeOf = (type, seq, encoded, me, chartEpoch) => pack({ type, payload: { seq, tick: encoded.tick, serverTime: encoded.serverTime, players: encoded.players, entities: encoded.entities, removed: encoded.removed, delta: encoded.delta, dots: encoded.dots, me, chartEpoch } })

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const TYPES = [MSG.SNAPSHOT, MSG.STATE_CORRECTION, 0, 300, 70000, -3, 1.5, 'snapshot', 'abc', 'snäpshot', '', 'a type name that is forty characters long!']
const WORDS = ['tree', 'rock-large', 'ab', 'x', 'models/barrel.glb', 'héllo wörld', '日本語のテキスト', 'a'.repeat(300), 'b'.repeat(5000), '']

function scalarOf(random) {
  const pick = Math.floor(random() * 12)
  if (pick === 0) return -0
  if (pick === 1) return null
  if (pick === 2) return undefined
  if (pick === 3) return random() < 0.5
  if (pick === 4) return Math.floor(random() * 100000) - 50000
  if (pick === 5) return Math.floor(random() * 200)
  if (pick === 6) return 2 ** 40 + Math.floor(random() * 1000)
  return (random() - 0.5) * 2000
}

function playerOf(random, id) {
  const fields = 2 + Math.floor(random() * 12)
  const record = [id]
  for (let i = 0; i < fields; i++) record.push(scalarOf(random))
  if (random() < 0.25) record.push(Uint8Array.from({ length: Math.floor(random() * 40) }, () => Math.floor(random() * 256)))
  return record
}

function looseOf(random, depth) {
  const pick = Math.floor(random() * 9)
  if (pick === 0) return WORDS[Math.floor(random() * WORDS.length)]
  if (pick === 1 && depth < 3) return Array.from({ length: Math.floor(random() * 5) }, () => looseOf(random, depth + 1))
  if (pick === 2 && depth < 3) return Object.fromEntries(Array.from({ length: Math.floor(random() * 4) }, (_, i) => [['id', 'model', 'position', 'hp'][i], looseOf(random, depth + 1)]))
  if (pick === 3) return Uint8Array.from({ length: Math.floor(random() * 20) }, () => Math.floor(random() * 256))
  return scalarOf(random)
}

function caseOf(random, round) {
  const playerCount = round % 17 === 0 ? 300 + Math.floor(random() * 200) : Math.floor(random() * 24)
  const players = Array.from({ length: playerCount }, (_, i) => playerOf(random, i + 1))
  const entityCount = round % 23 === 0 ? 40 : Math.floor(random() * 6)
  const entities = Array.from({ length: entityCount }, (_, i) => [i, WORDS[Math.floor(random() * WORDS.length)], looseOf(random, 0), (random() - 0.5) * 50])
  return {
    type: TYPES[round % TYPES.length],
    seq: Math.floor(random() * 100000),
    chartEpoch: Math.floor(random() * 5),
    me: random() < 0.5 ? undefined : looseOf(random, 0),
    encoded: {
      tick: Math.floor(random() * 1e6),
      serverTime: random() * 1e7,
      players,
      entities,
      removed: random() < 0.5 ? undefined : Array.from({ length: Math.floor(random() * 5) }, () => Math.floor(random() * 500)),
      delta: random() < 0.5 ? 0 : 1,
      dots: random() < 0.6 ? undefined : Array.from({ length: Math.floor(random() * 30) }, () => Math.floor(random() * 65536)),
    },
  }
}

gate('with the numeric SNAPSHOT type the tick host sends, the splice is live and gives the bytes of the whole packed message', () => {
  const encoded = { tick: 5, serverTime: 100.5, players: [[1, 2.5, 3], [2, 7, -1]], entities: [[7, 8, 9]], removed: undefined, delta: 0, dots: undefined }
  const before = snapshotPackCounts.splices
  const spliced = packSnapshotBytes(MSG.SNAPSHOT, 3, encoded, undefined, 0, newRecordMemo())
  assert.ok(spliced !== null, 'the splice refused the tick host shape')
  assert.equal(hex(spliced), hex(wholeOf(MSG.SNAPSHOT, 3, encoded, undefined, 0)))
  assert.equal(snapshotPackCounts.splices - before, 1)
})

gate('with a string type, which msgpackr bundles behind an offset, the splice moves the offset and gives the whole-message bytes', () => {
  const encoded = { tick: 2, serverTime: 3, players: [[1, 0.5, 2], [2, 0.25, 4]], entities: [], removed: undefined, delta: 1, dots: undefined }
  const spliced = packSnapshotBytes('snapshot', 1, encoded, undefined, 0, newRecordMemo())
  assert.ok(spliced !== null, 'the splice refused a string type')
  assert.equal(hex(spliced), hex(wholeOf('snapshot', 1, encoded, undefined, 0)))
  assert.equal(hex(spliced.subarray(0, 3)), '40d662')
})

gate('over 1200 seeded snapshots across 12 message types, with strings, objects, binary fields, negative zero and up to 500 players, every splice equals the whole-message bytes', () => {
  const random = mulberry(20261112)
  let spliced = 0, withStrings = 0, big = 0
  for (let round = 0; round < 1200; round++) {
    const c = caseOf(random, round)
    const got = packSnapshotBytes(c.type, c.seq, c.encoded, c.me, c.chartEpoch, newRecordMemo())
    assert.ok(got !== null, 'round ' + round + ' was refused for type ' + JSON.stringify(c.type))
    const want = wholeOf(c.type, c.seq, c.encoded, c.me, c.chartEpoch)
    if (hex(got) !== hex(want)) assert.fail('round ' + round + ' type ' + JSON.stringify(c.type) + ' differs from the whole-message bytes')
    spliced++
    if (c.encoded.entities.length > 0) withStrings++
    if (c.encoded.players.length >= 300) big++
  }
  assert.ok(spliced === 1200 && withStrings > 600 && big > 50, 'spliced ' + spliced + ', with strings ' + withStrings + ', big ' + big)
})

gate('a tail whose strings pass the msgpackr bundle size limit still splices to the whole-message bytes', () => {
  const entities = Array.from({ length: 60 }, (_, i) => [i, 'entity-name-' + String(i).padStart(4, '0') + '-' + 'q'.repeat(2000)])
  const encoded = { tick: 9, serverTime: 10, players: [[1, 2, 3]], entities, removed: undefined, delta: 0, dots: undefined }
  for (const type of [MSG.SNAPSHOT, 'snapshot']) {
    const got = packSnapshotBytes(type, 7, encoded, { name: 'the local player block' }, 2, newRecordMemo())
    assert.ok(got !== null, 'refused')
    assert.equal(hex(got), hex(wholeOf(type, 7, encoded, { name: 'the local player block' }, 2)))
    assert.ok(got.length > 120000, 'the tail is only ' + got.length + ' bytes')
  }
})

gate('a spliced snapshot reads back to the payload that went in', () => {
  const encoded = { tick: 90, serverTime: 1500, players: [[1, 0.5, -0, 2], [2, Uint8Array.of(9, 9), 4]], entities: [[7, 'crate', 9]], removed: [3], delta: 1, dots: [10, 20] }
  const back = unpack(packSnapshotBytes(MSG.SNAPSHOT, 4, encoded, { hp: 80 }, 9, newRecordMemo()))
  assert.equal(back.type, MSG.SNAPSHOT)
  assert.deepEqual([back.payload.seq, back.payload.tick, back.payload.serverTime, back.payload.delta, back.payload.chartEpoch], [4, 90, 1500, 1, 9])
  assert.ok(Object.is(back.payload.players[0][2], -0), 'the negative zero was lost')
  assert.deepEqual(Array.from(back.payload.players[1][1]), [9, 9])
  assert.deepEqual(back.payload.entities, [[7, 'crate', 9]])
  assert.deepEqual(back.payload.me, { hp: 80 })
  assert.deepEqual(back.payload.dots, [10, 20])
})

gate('one record memo across 40 clients packs each unchanged player record once and shares it 39 times', () => {
  const players = Array.from({ length: 30 }, (_, i) => [i + 1, i * 1.5, 2, -i])
  const encoded = { tick: 1, serverTime: 2, players, entities: [], removed: undefined, delta: 0, dots: undefined }
  const memo = newRecordMemo()
  const before = { ...snapshotPackCounts }
  for (let client = 0; client < 40; client++) {
    const got = packSnapshotBytes(MSG.SNAPSHOT, client, encoded, { id: client }, 0, memo)
    assert.equal(hex(got), hex(wholeOf(MSG.SNAPSHOT, client, encoded, { id: client }, 0)))
  }
  assert.equal(snapshotPackCounts.recordPacks - before.recordPacks, 30)
  assert.equal(snapshotPackCounts.recordShares - before.recordShares, 30 * 39)
  assert.equal(snapshotPackCounts.splices - before.splices, 40)
})

gate('a record whose value changed under the same id is packed again, so the memo never serves stale bytes', () => {
  const memo = newRecordMemo()
  const first = { tick: 1, serverTime: 2, players: [[1, 5, 5]], entities: [], removed: undefined, delta: 0, dots: undefined }
  const second = { ...first, players: [[1, 6, 5]] }
  packSnapshotBytes(MSG.SNAPSHOT, 1, first, undefined, 0, memo)
  const got = packSnapshotBytes(MSG.SNAPSHOT, 2, second, undefined, 0, memo)
  assert.equal(hex(got), hex(wholeOf(MSG.SNAPSHOT, 2, second, undefined, 0)))
  assert.equal(unpack(got).payload.players[0][1], 6)
})

gate('a player record that holds a string or an object, players that are not an array, and a type that is neither number nor string are refused with null', () => {
  const base = { tick: 1, serverTime: 2, entities: [], removed: undefined, delta: 0, dots: undefined }
  const before = snapshotPackCounts.refusals
  assert.equal(packSnapshotBytes(MSG.SNAPSHOT, 1, { ...base, players: [[1, 'name']] }, undefined, 0, newRecordMemo()), null)
  assert.equal(packSnapshotBytes(MSG.SNAPSHOT, 1, { ...base, players: [{ id: 1 }] }, undefined, 0, newRecordMemo()), null)
  assert.equal(packSnapshotBytes(MSG.SNAPSHOT, 1, { ...base, players: 'none' }, undefined, 0, newRecordMemo()), null)
  assert.equal(packSnapshotBytes(null, 1, { ...base, players: [] }, undefined, 0, newRecordMemo()), null)
  assert.equal(packSnapshotBytes(NaN, 1, { ...base, players: [] }, undefined, 0, newRecordMemo()), null)
  assert.equal(snapshotPackCounts.refusals - before, 5)
})

gate('negative control: a splice with its bundle offset left unmoved does not read back', () => {
  const encoded = { tick: 2, serverTime: 3, players: [[1, 0.5, 2], [2, 0.25, 4]], entities: [], removed: undefined, delta: 1, dots: undefined }
  const good = Uint8Array.from(packSnapshotBytes('snapshot', 1, encoded, undefined, 0, newRecordMemo()))
  const empty = Uint8Array.from(packSnapshotBytes('snapshot', 1, { ...encoded, players: [] }, undefined, 0, newRecordMemo()))
  const stale = Uint8Array.from(good)
  stale.set(empty.subarray(3, 7), 3)
  let readBack = null
  try { readBack = unpack(stale) } catch { readBack = null }
  assert.ok(readBack === null || readBack.type !== 'snapshot', 'the unmoved offset still read back as a snapshot')
  assert.equal(unpack(good).type, 'snapshot')
})

finish()
