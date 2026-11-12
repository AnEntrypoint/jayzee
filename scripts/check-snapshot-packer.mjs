import { gate, finish } from './lib/gate.mjs'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { packSnapshotBytes, newRecordMemo, snapshotPackCounts } from '../src/netcode/SnapshotPacker.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const fixtureText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'snapshot-packer.json'), 'utf8')
const fixture = JSON.parse(fixtureText)

const revive = (node) => {
  if (node === null || typeof node !== 'object') return node
  if (Array.isArray(node)) return node.map(revive)
  if ('$bin' in node) return Uint8Array.from(Buffer.from(node.$bin, 'hex'))
  return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, revive(v)]))
}

const hex = (bytes) => Buffer.from(bytes).toString('hex')
const fullOf = (type, seq, encoded, me, chartEpoch) => ({ type, payload: { seq, tick: encoded.tick, serverTime: encoded.serverTime, players: encoded.players, entities: encoded.entities, removed: encoded.removed, delta: encoded.delta, dots: encoded.dots, me, chartEpoch } })

gate('the snapshot packer fixture is the one the generator wrote', () => {
  const digest = createHash('sha256').update(JSON.stringify(fixture.cases)).digest('hex')
  assert(digest === fixture.sha256, 'fixture digest ' + digest + ' differs from ' + fixture.sha256)
  assert(fixture.cases.length === 7, 'case count ' + fixture.cases.length)
})

const REFUSED_SHAPES = ['a player that is not an array is refused', 'players not an array is refused']

for (const testCase of fixture.cases) {
  const refusedShape = REFUSED_SHAPES.includes(testCase.name)
  gate('packSnapshotBytes "' + testCase.name + '" ' + (refusedShape ? 'is refused with null, as in spoint' : 'splices to the bytes spoint packs for the whole message'), () => {
    const got = packSnapshotBytes(testCase.type, testCase.seq, revive(testCase.encoded), revive(testCase.me), testCase.chartEpoch, newRecordMemo())
    const gotHex = got === null ? null : hex(got)
    assert(gotHex === (refusedShape ? null : testCase.full), 'jayzee ' + gotHex + ' differs from ' + (refusedShape ? 'null' : 'the spoint whole-message bytes'))
  })
  gate('the whole message for "' + testCase.name + '" packs to the spoint bytes', () => {
    const message = fullOf(testCase.type, testCase.seq, revive(testCase.encoded), revive(testCase.me), testCase.chartEpoch)
    assert(hex(pack(message)) === testCase.full, 'jayzee message bytes differ from spoint')
  })
}

gate('stated difference: spoint refuses every fixture shape under msgpackr 2.0.4, and jayzee splices the five well-formed shapes and refuses the two malformed ones', () => {
  const before = { ...snapshotPackCounts }
  const memo = newRecordMemo()
  const refusedInSpoint = fixture.cases.filter((c) => c.spliced === null).length
  assert(refusedInSpoint === fixture.cases.length, 'a case spliced in spoint: the fixture no longer records a refusal for every shape')
  assert(REFUSED_SHAPES.every((name) => fixture.cases.some((c) => c.name === name)), 'a refused shape is missing from the fixture')
  for (const testCase of fixture.cases) packSnapshotBytes(testCase.type, testCase.seq, revive(testCase.encoded), revive(testCase.me), testCase.chartEpoch, memo)
  assert(snapshotPackCounts.refusals - before.refusals === REFUSED_SHAPES.length, 'refusals counted ' + (snapshotPackCounts.refusals - before.refusals))
  assert(snapshotPackCounts.splices - before.splices === fixture.cases.length - REFUSED_SHAPES.length, 'splices counted ' + (snapshotPackCounts.splices - before.splices))
})

gate('two calls that share one record memo both give the spoint whole-message bytes, and the second call shares both records', () => {
  const memo = newRecordMemo()
  const shared = fixture.shared
  const encoded = revive(fixture.cases[1].encoded)
  const sharesBefore = snapshotPackCounts.recordShares
  const first = packSnapshotBytes('snapshot', 10, encoded, undefined, 0, memo)
  const second = packSnapshotBytes('snapshot', 11, encoded, undefined, 0, memo)
  assert(shared.first === null && shared.second === null, 'spoint spliced the shared calls: the fixture changed')
  assert(hex(first) === hex(pack(fullOf('snapshot', 10, encoded, undefined, 0))), 'first call differs from the whole message')
  assert(hex(second) === shared.secondFull, 'second call differs from the spoint whole-message bytes')
  assert(snapshotPackCounts.recordShares - sharesBefore === encoded.players.length, 'records shared ' + (snapshotPackCounts.recordShares - sharesBefore))
})

gate('the whole message reads back to the same payload', () => {
  const testCase = fixture.cases[3]
  const back = unpack(Uint8Array.from(Buffer.from(testCase.full, 'hex')))
  assert(back.type === 'snapshot' && back.payload.seq === 4 && back.payload.chartEpoch === 9, 'payload fields read back as ' + JSON.stringify(back))
  assert(JSON.stringify(back.payload.entities) === JSON.stringify([[7, 8, 9]]), 'entities read back as ' + JSON.stringify(back.payload.entities))
})

gate('negative control: changing one tick changes the whole-message bytes', () => {
  const testCase = fixture.cases[1]
  const encoded = revive(testCase.encoded)
  const changed = { ...encoded, tick: encoded.tick + 1 }
  assert(hex(pack(fullOf('snapshot', testCase.seq, changed, undefined, 0))) !== testCase.full, 'a changed tick packed to the same bytes')
})

finish()
