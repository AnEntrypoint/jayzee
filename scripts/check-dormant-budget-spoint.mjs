import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { DORMANT_BUDGET_LABELS, makeCountedClock, runDormantBudgetScenario } from './lib/dormantBudgetScenario.mjs'
import { createJoltHost, loadJolt } from '../src/collision/joltHost.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/dormant-budget.json', import.meta.url), 'utf8'))
const J = await loadJolt()
const parse = (row) => JSON.parse(row.replace(/([:\[,])[snb]:/g, '$1').replace(/([:\[,])n:/g, '$1'))

const host = await createJoltHost({ gravity: [0, -9.81, 0] })
const adapter = {
  addStatic: (position) => host.addBody(new J.BoxShape(new J.Vec3(0.5, 0.5, 0.5), 0.05, null), position, J.EMotionType_Static, 0),
  park: (entries) => host.dormantStatics.park(entries),
  drain: (budgetMs, movers, clock) => host.dormantStatics.drain(budgetMs, movers, clock.now),
  pending: () => host.dormantStatics.pendingCount,
  destroy: () => host.destroy(),
}
const got = runDormantBudgetScenario(adapter).rows

gate('the fixture was generated from spoint src/physics/DormantStatics.js and World.js with jolt-physics 1.1.0', () => {
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['src/physics/DormantStatics.js', 'src/physics/World.js'])
  assert.equal(fixture.source.joltPhysics, '1.1.0')
})

gate('the fixture covers every budget case in order', () => {
  assert.deepEqual(fixture.labels, DORMANT_BUDGET_LABELS)
  assert.equal(fixture.rows.length, DORMANT_BUDGET_LABELS.length)
})

gate('the wired drain reads the clock it is given on every budget case, so a drain on wall time would show', () => {
  for (const row of got.slice(1)) assert.ok(parse(row).value.reads > 0, row)
})

gate('the drain with a counted 5 ms budget equals spoint, read for read and statics for statics', () => {
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('a counted budget of 5 ms drains exactly three batches of 32 and stops with 72 statics parked', () => {
  const row = parse(got[2]).value
  assert.equal(row.drained, 96)
  assert.equal(row.pending, 72)
})

gate('a zero budget drains exactly one batch, and the unlimited budget drains everything left', () => {
  assert.equal(parse(got[1]).value.drained, 32)
  assert.equal(parse(got[3]).value.drained, 32)
  assert.equal(parse(got[4]).value.drained, 40)
  assert.equal(parse(got[4]).value.pending, 0)
})

finish()
