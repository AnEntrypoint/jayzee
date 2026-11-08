import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { pack } from '../src/protocol/msgpack.js'
import { packReducedPlayerPose } from '../src/snapshot-lod-pure/records.js'
import { isReducedPlayerPose, makeReducedPlayerPose, unpackReducedPlayerPose } from '../src/client/SnapshotProcessor.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'reduced-pose.json'), 'utf8'))
const hexOf = (value) => Buffer.from(pack(value)).toString('hex')

gate('the spoint fixture holds five reduced poses and three inputs spoint refuses', () => {
  assert.equal(fixture.cases.length, 5)
  assert.deepEqual(fixture.errors.map((item) => item.error), ['RangeError', 'RangeError', 'RangeError'])
})

fixture.cases.forEach((item, index) => {
  const { id, x, z, yawN } = item.input
  gate('reduced pose ' + index + ': the module packs the tuple spoint packs', () => {
    assert.deepEqual(packReducedPlayerPose(id, x, z, yawN), item.tuple)
  })
  gate('reduced pose ' + index + ': the msgpack bytes match the bytes spoint writes', () => {
    assert.equal(hexOf(packReducedPlayerPose(id, x, z, yawN)), item.hex)
  })
  gate('reduced pose ' + index + ': the module decodes the tuple as spoint decodes it', () => {
    const out = unpackReducedPlayerPose(item.tuple, makeReducedPlayerPose())
    assert.deepEqual({ id: out.id, x: out.x, z: out.z, yawN: out.yawN, tier: out.tier }, item.decoded)
  })
})

fixture.errors.forEach((item, index) => {
  gate('refused input ' + index + ': packing throws the RangeError spoint throws', () => {
    assert.throws(() => packReducedPlayerPose(item.input.id, Number(item.input.x), Number(item.input.z), item.input.yawN), RangeError)
  })
})

gate('a reduced pose is five fields with tier 1 last, and nothing else is reduced', () => {
  assert.equal(isReducedPlayerPose([1, 2, 3, 4, 1]), true)
  assert.equal(isReducedPlayerPose([1, 2, 3, 4, 0]), false)
  assert.equal(isReducedPlayerPose([1, 2, 3, 4]), false)
})

finish()
