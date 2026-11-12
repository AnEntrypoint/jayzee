import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { ensurePacked, isPacked, lazyPack, lazyPackCounts, pack, unpack } from '../src/protocol/msgpack.js'

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const MESSAGE = { type: 'snapshot', payload: { seq: 4, tick: 90, serverTime: 1500, players: [[1, 0.5, -0, 2]], entities: [], removed: undefined, delta: 1, dots: undefined, me: undefined, chartEpoch: 3 } }

gate('the spoint lazy packer surface is kept: isPacked is true as soon as the module loads and ensurePacked resolves to a packer that packs the same bytes', async () => {
  assert.equal(isPacked(), true)
  const packer = await ensurePacked
  const plain = { type: 'snapshot', payload: { seq: 4, tick: 90, serverTime: 1500, players: [[1, 0.5, 2]], entities: ['crate'], removed: undefined, delta: 1, dots: undefined, me: undefined, chartEpoch: 3 } }
  assert.equal(hex(new Uint8Array(packer.pack(plain))), hex(pack(plain)))
  assert.equal(hex(pack({ type: 3, payload: null })), hex(new Uint8Array(packer.pack({ type: 3, payload: null }))))
})

gate('stated difference: spoint resolves msgpackr through a dynamic import and pack throws until it has; jayzee imports it statically, so pack works in the first statement of a module', () => {
  assert.equal(unpack(pack({ type: 3, payload: null })).type, 3)
})

gate('a lazy packer that is never read never packs', () => {
  const before = { ...lazyPackCounts }
  const lazy = lazyPack(MESSAGE)
  assert.equal(lazy.packed, false)
  assert.deepEqual([lazyPackCounts.created - before.created, lazyPackCounts.packed - before.packed, lazyPackCounts.reads - before.reads], [1, 0, 0])
})

gate('the first read packs to the same bytes as pack, negative zero included, and later reads return the same array', () => {
  const before = lazyPackCounts.packed
  const lazy = lazyPack(MESSAGE)
  const first = lazy.bytes
  assert.equal(hex(first), hex(pack(MESSAGE)))
  assert.equal(lazy.packed, true)
  assert.equal(lazy.bytes, first)
  assert.equal(lazy.bytes, first)
  assert.equal(lazyPackCounts.packed - before, 1)
  assert.ok(Object.is(unpack(first).payload.players[0][2], -0), 'the negative zero was lost')
})

gate('a broadcast to 50 sockets of which 3 are open packs once, and a broadcast to none packs nothing', () => {
  const send = (sockets, message) => {
    const lazy = lazyPack(message)
    let delivered = 0
    for (const socket of sockets) if (socket.isOpen) { socket.inbox.push(lazy.bytes); delivered++ }
    return delivered
  }
  const sockets = Array.from({ length: 50 }, (_, i) => ({ isOpen: i % 20 === 0, inbox: [] }))
  const before = lazyPackCounts.packed
  assert.equal(send(sockets, MESSAGE), 3)
  assert.equal(lazyPackCounts.packed - before, 1)
  const open = sockets.filter((socket) => socket.isOpen)
  assert.ok(open.every((socket) => socket.inbox[0] === open[0].inbox[0]), 'the open sockets were handed different arrays')
  assert.deepEqual(unpack(open[2].inbox[0]).payload.seq, 4)
  for (const socket of sockets) socket.isOpen = false
  assert.equal(send(sockets, MESSAGE), 0)
  assert.equal(lazyPackCounts.packed - before, 1)
})

gate('the bytes are those of the value at the first read: a later change to the value does not change them', () => {
  const value = { type: 'state', payload: { n: 1 } }
  const lazy = lazyPack(value)
  value.payload.n = 2
  const bytes = lazy.bytes
  value.payload.n = 3
  assert.equal(unpack(lazy.bytes).payload.n, 2)
  assert.equal(lazy.bytes, bytes)
})

gate('a value that cannot be encoded is refused when the lazy packer is made, not at the first read', () => {
  const before = lazyPackCounts.created
  assert.throws(() => lazyPack({ type: 'x', payload: { run() {} } }), /cannot encode a value of type function/)
  assert.equal(lazyPackCounts.created, before)
})

gate('negative control: packing eagerly for the same broadcast to no open socket packs once where the lazy packer packs nothing', () => {
  let eagerPacks = 0
  const eager = (message) => { eagerPacks++; return pack(message) }
  const before = lazyPackCounts.packed
  const bytes = eager(MESSAGE)
  const lazy = lazyPack(MESSAGE)
  const sockets = [{ isOpen: false }, { isOpen: false }]
  for (const socket of sockets) if (socket.isOpen) socket.last = [bytes, lazy.bytes]
  assert.deepEqual([eagerPacks, lazyPackCounts.packed - before], [1, 0])
})

finish()
