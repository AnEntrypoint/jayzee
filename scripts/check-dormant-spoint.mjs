import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { DORMANT_CASE_LABELS, COUNT, runDormantScenario } from './lib/dormantScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/dormant.json', import.meta.url), 'utf8'))
const J = await loadJolt()
const host = await createJoltHost({ gravity: [0, -9.81, 0] })

const adapter = {
  addStatic: (position) => host.addBody(new J.BoxShape(new J.Vec3(0.5, 0.5, 0.5), 0.05, null), position, J.EMotionType_Static, 0),
  park: (entries) => host.dormantStatics.park(entries),
  drain: (budgetMs, movers) => host.dormantStatics.drain(budgetMs, movers),
  has: (id) => host.dormantStatics.has(id),
  pending: () => host.dormantStatics.pendingCount,
  destroy: () => host.destroy(),
}
const { rows: got } = runDormantScenario(adapter)

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, k) => from + k)
const parsed = fixture.rows.map((row) => JSON.parse(row.replace(/"?n:/g, '').replace(/"?s:/g, '')))
const row = (i) => parsed[i]

gate('the fixture was generated from spoint src/physics/DormantStatics.js and World.js with jolt-physics 1.1.0', () => {
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['src/physics/DormantStatics.js', 'src/physics/World.js'])
  assert.equal(fixture.source.joltPhysics, '1.1.0')
})

gate('the fixture covers every dormant case in order', () => {
  assert.deepEqual(fixture.labels, DORMANT_CASE_LABELS)
  assert.equal(fixture.rows.length, DORMANT_CASE_LABELS.length)
})

gate('park, drain with budget and movers, unlimited drain and empty drain equal spoint on every case', () => {
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('a zero budget with no movers drains exactly one batch of 32, in park order from the far end', () => {
  assert.equal(row(1).value.drained, 32)
  assert.deepEqual(row(1).value.stillParked, range(0, COUNT - 33))
})

gate('a zero budget with the origin as mover reinserts the 32 nearest statics first', () => {
  assert.equal(row(2).value.drained, 32)
  assert.deepEqual(row(2).value.stillParked, range(32, 87))
})

gate('a mover 476 m away reorders the pending statics and reinserts the 32 nearest to it', () => {
  assert.equal(row(3).value.drained, 32)
  assert.deepEqual(row(3).value.stillParked, range(32, 55))
})

gate('an unlimited budget drains the remaining statics and leaves nothing parked', () => {
  assert.equal(row(4).value.drained, 24)
  assert.equal(row(4).value.pending, 0)
})

gate('the fixture reports the statics it drained, so a drain that always returns 0 would show', () => {
  assert.equal(row(1).value.drained + row(2).value.drained + row(3).value.drained + row(4).value.drained, COUNT)
})

finish()
