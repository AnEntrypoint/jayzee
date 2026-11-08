import { canon } from './canon.mjs'

export const BUDGET_COUNT = 200
const SPACING = 4

export const DORMANT_BUDGET_LABELS = [
  'park 200 statics in ascending order',
  'a zero budget reinserts one batch of 32',
  'a counted budget of 5 ms drains three batches of 32',
  'a zero budget after that reinserts one batch of 32',
  'an unlimited budget drains the rest',
]

export function makeCountedClock() {
  let t = 0
  let reads = 0
  return {
    now: () => { reads += 1; t += 1; return t },
    reads: () => reads,
  }
}

export function runDormantBudgetScenario(adapter) {
  const rows = []
  const positionOf = (i) => [SPACING * i, 0.5, 0]
  const ids = Array.from({ length: BUDGET_COUNT }, (_, i) => adapter.addStatic(positionOf(i)))
  const entries = ids.map((bodyId, i) => ({ bodyId, owner: { position: positionOf(i), rotation: [0, 0, 0, 1] } }))
  rows.push(canon({ label: DORMANT_BUDGET_LABELS[0], value: { returned: adapter.park(entries), pending: adapter.pending() } }))
  const step = (label, budgetMs) => {
    const clock = makeCountedClock()
    const drained = adapter.drain(budgetMs, [], clock)
    rows.push(canon({ label, value: { drained, pending: adapter.pending(), reads: clock.reads() } }))
  }
  step(DORMANT_BUDGET_LABELS[1], 0)
  step(DORMANT_BUDGET_LABELS[2], 5)
  step(DORMANT_BUDGET_LABELS[3], 0)
  step(DORMANT_BUDGET_LABELS[4], Infinity)
  adapter.destroy()
  return { rows }
}
