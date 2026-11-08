import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const spointRoot = resolve(process.argv[2] ?? '/workspace/spoint')
const outDir = join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint')
const load = (relative) => import(pathToFileURL(join(spointRoot, relative)).href)

const msgpack = await load('src/protocol/msgpack.js')
await msgpack.ensurePacked
const packer = await load('src/netcode/SnapshotPacker.js')

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const tag = (value) => {
  if (value instanceof Uint8Array) return { $bin: hex(value) }
  if (Array.isArray(value)) return value.map(tag)
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, tag(v)]))
  return value
}

const encodedOf = ({ players = [], entities = [], removed = undefined, delta = 1, dots = undefined, tick = 2, serverTime = 3 } = {}) => ({ players, entities, removed, delta, dots, tick, serverTime })

const fullOf = (type, seq, encoded, me, chartEpoch) => ({ type, payload: { seq, tick: encoded.tick, serverTime: encoded.serverTime, players: encoded.players, entities: encoded.entities, removed: encoded.removed, delta: encoded.delta, dots: encoded.dots, me, chartEpoch } })

const many = Array.from({ length: 300 }, (_, i) => [i, i * 2, i === 0 ? 0 : -i, i % 7, 1])

const cases = [
  { name: 'no players', type: 'snapshot', seq: 1, encoded: encodedOf(), me: undefined, chartEpoch: 0 },
  { name: 'two scalar players', type: 'snapshot', seq: 2, encoded: encodedOf({ players: [[1, 2, 3, 4, 0], [5, -6, 7, 8, 1]] }), me: undefined, chartEpoch: 0 },
  { name: 'player with a binary field', type: 'snapshot', seq: 3, encoded: encodedOf({ players: [[9, Uint8Array.of(1, 2, 3), 1], [5, -6, 7, 8, 1]] }), me: undefined, chartEpoch: 0 },
  { name: 'entities, removed, dots, me and chart epoch', type: 'snapshot', seq: 4, encoded: encodedOf({ players: [[1, 2, 3, 4, 0]], entities: [[7, 8, 9]], removed: [4, 5], dots: [1.5], delta: 0, tick: 40, serverTime: 1700000000 }), me: { id: 2 }, chartEpoch: 9 },
  { name: 'array of 300 players (array16 header)', type: 'snapshot', seq: 5, encoded: encodedOf({ players: many }), me: undefined, chartEpoch: 0 },
  { name: 'a player that is not an array is refused', type: 'snapshot', seq: 6, encoded: encodedOf({ players: [{ id: 1 }] }), me: undefined, chartEpoch: 0 },
  { name: 'players not an array is refused', type: 'snapshot', seq: 7, encoded: encodedOf({ players: 'none' }), me: undefined, chartEpoch: 0 }
]

const out = cases.map((c) => {
  const memo = packer.newRecordMemo()
  const spliced = packer.packSnapshotBytes(c.type, c.seq, c.encoded, c.me, c.chartEpoch, memo)
  const full = msgpack.pack(fullOf(c.type, c.seq, c.encoded, c.me, c.chartEpoch))
  return {
    name: c.name,
    type: c.type,
    seq: c.seq,
    encoded: tag(c.encoded),
    me: tag(c.me),
    chartEpoch: c.chartEpoch,
    spliced: spliced === null ? null : hex(Buffer.from(spliced)),
    full: hex(full)
  }
})

const shared = newSharedCase(packer, msgpack)
function newSharedCase (packer, msgpack) {
  const memo = packer.newRecordMemo()
  const bytesOf = (value) => (value === null ? null : hex(Buffer.from(value)))
  const first = packer.packSnapshotBytes('snapshot', 10, encodedOf({ players: [[1, 2, 3, 4, 0], [5, -6, 7, 8, 1]] }), undefined, 0, memo)
  const second = packer.packSnapshotBytes('snapshot', 11, encodedOf({ players: [[1, 2, 3, 4, 0], [5, -6, 7, 8, 1]] }), undefined, 0, memo)
  return { name: 'two calls sharing one record memo', first: bytesOf(first), second: bytesOf(second), secondFull: hex(msgpack.pack(fullOf('snapshot', 11, encodedOf({ players: [[1, 2, 3, 4, 0], [5, -6, 7, 8, 1]] }), undefined, 0))) }
}

const sha256 = createHash('sha256').update(JSON.stringify(out)).digest('hex')
mkdirSync(outDir, { recursive: true })
writeFileSync(join(outDir, 'snapshot-packer.json'), JSON.stringify({ generatedFrom: 'spoint src/netcode/SnapshotPacker.js packSnapshotBytes, and spoint src/protocol/msgpack.js pack of the full message', sha256, cases: out, shared }, null, 2) + '\n')
console.log('wrote ' + out.length + ' snapshot packer cases; shared memo case written')
