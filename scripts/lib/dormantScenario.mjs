import { canon } from './canon.mjs'

export const COUNT = 120
export const SPACING = 4
export const DORMANT_CASE_LABELS = [
  'park 120 statics farthest first',
  'zero budget and no movers reinserts one batch of 32 in park order',
  'zero budget with the origin as mover reinserts the 32 nearest first',
  'a mover 476 m along x reorders the pending set and reinserts its 32 nearest',
  'unlimited budget drains the remaining statics',
  'drain on an empty set returns 0',
]

const positionOf = (i) => [SPACING * i, 0.5, 0]

export function runDormantScenario(adapter) {
  const rows = []
  const record = (label, value) => rows.push(canon({ label, value }))
  const ids = Array.from({ length: COUNT }, (_, i) => adapter.addStatic(positionOf(i)))
  const indexOf = new Map(ids.map((id, i) => [id, i]))
  const stillParked = () => ids.map((id, i) => (adapter.has(id) ? i : -1)).filter((i) => i >= 0)
  const entries = []
  for (let i = COUNT - 1; i >= 0; i--) entries.push({ bodyId: ids[i], owner: { position: positionOf(i), rotation: [0, 0, 0, 1] } })

  record(DORMANT_CASE_LABELS[0], { returned: adapter.park(entries), pending: adapter.pending() })
  record(DORMANT_CASE_LABELS[1], { drained: adapter.drain(0, []), stillParked: stillParked() })
  record(DORMANT_CASE_LABELS[2], { drained: adapter.drain(0, [[0, 0.5, 0]]), stillParked: stillParked() })
  record(DORMANT_CASE_LABELS[3], { drained: adapter.drain(0, [[476, 0.5, 0]]), stillParked: stillParked() })
  record(DORMANT_CASE_LABELS[4], { drained: adapter.drain(Infinity, [[476, 0.5, 0]]), pending: adapter.pending() })
  record(DORMANT_CASE_LABELS[5], { drained: adapter.drain(0, []) })

  adapter.destroy()
  return { rows, indexOf }
}
