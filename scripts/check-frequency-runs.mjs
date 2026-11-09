import assert from 'node:assert/strict'
import { awaitLoadGate, busyFraction, CAUSES, formatTable, frequencyPlan, loadGate, LOAD_LIMIT, MODES, parseProcStatCpu, summarizeFrequency } from './browser/frequency-runs.mjs'
import { finish, gate } from './lib/gate.mjs'

const stat = (idle, iowait, busy) => 'cpu  ' + busy + ' 0 0 ' + idle + ' ' + iowait + ' 0 0 0 0 0\ncpu0 1 0 0 1 0 0 0 0 0 0\n'

gate('parseProcStatCpu reads the aggregate cpu line and counts idle plus iowait as idle', () => {
  assert.deepEqual(parseProcStatCpu(stat(300, 100, 600)), { idle: 400, total: 1000 })
})
gate('parseProcStatCpu refuses a text with no aggregate cpu line or a short line', () => {
  assert.throws(() => parseProcStatCpu('cpu0 1 2 3 4 5\n'), TypeError)
  assert.throws(() => parseProcStatCpu('cpu 1 2 3\n'), TypeError)
})
gate('busyFraction is the non-idle share of the ticks between two reads', () => {
  const before = parseProcStatCpu(stat(300, 100, 600))
  const after = parseProcStatCpu(stat(350, 100, 650))
  assert.equal(busyFraction(before, after), 1 - 50 / 100)
})
gate('busyFraction refuses two reads with no tick between them', () => {
  const same = parseProcStatCpu(stat(300, 100, 600))
  assert.throws(() => busyFraction(same, same), RangeError)
})
gate('loadGate passes at the limit and refuses above it, with the busy value in the reason', () => {
  assert.equal(loadGate(LOAD_LIMIT).ok, true)
  const refused = loadGate(0.5)
  assert.equal(refused.ok, false)
  assert.ok(refused.reason.includes('0.500'))
})
gate('frequencyPlan alternates pinned and unpinned, n of each, and refuses a bad n', () => {
  const plan = frequencyPlan(2)
  assert.deepEqual(plan.map((row) => row.mode), ['pinned', 'unpinned', 'pinned', 'unpinned'])
  assert.deepEqual(plan.map((row) => row.index), [1, 1, 2, 2])
  assert.throws(() => frequencyPlan(0), RangeError)
  assert.throws(() => frequencyPlan(1.5), RangeError)
})
gate('the modes pin the sampler to CPU 15 or leave it unpinned', () => {
  assert.deepEqual(MODES, { pinned: '15', unpinned: '' })
})
gate('a skipped run is never counted as valid and does not add gaps', () => {
  const table = summarizeFrequency([
    { mode: 'pinned', status: 'skipped', gaps: [] },
    { mode: 'pinned', status: 'valid', gaps: [] },
    { mode: 'unpinned', status: 'valid', gaps: [{ gapMs: 130, cause: 'run-queue-wait' }] },
  ])
  assert.deepEqual([table.pinned.requested, table.pinned.valid, table.pinned.skipped, table.pinned.gaps], [2, 1, 1, 0])
  assert.equal(table.unpinned.gaps, 1)
  assert.equal(table.unpinned.maxGapMs, 130)
})
gate('the summary counts gaps by cause and an error run is not valid', () => {
  const table = summarizeFrequency([
    { mode: 'pinned', status: 'valid', gaps: [{ gapMs: 150, cause: 'host-cfs-quota' }, { gapMs: 110, cause: 'run-queue-wait' }] },
    { mode: 'pinned', status: 'error', gaps: [] },
  ])
  assert.equal(table.pinned.runsWithGap, 1)
  assert.equal(table.pinned.error, 1)
  assert.equal(table.pinned.causes['host-cfs-quota'], 1)
  assert.equal(table.pinned.causes['run-queue-wait'], 1)
  assert.equal(table.pinned.causes['sampler-work'], 0)
  assert.equal(table.pinned.causes['unattributed'], 0)
  assert.deepEqual(Object.keys(table.pinned.causes), [...CAUSES])
})
gate('an empty run list gives zero counts, so no pinned gap can be claimed from nothing', () => {
  const table = summarizeFrequency([])
  assert.equal(table.pinned.valid, 0)
  assert.equal(table.pinned.gaps, 0)
})
gate('formatTable prints a header and one row per mode', () => {
  const lines = formatTable(summarizeFrequency([{ mode: 'pinned', status: 'valid', gaps: [] }])).split('\n')
  assert.equal(lines.length, 3)
  assert.ok(lines[0].startsWith('mode | requested'))
  assert.ok(lines[1].startsWith('pinned | 1 | 1'))
})

gate('awaitLoadGate waits through readings above the limit and passes on the first reading at or below it', async () => {
  const readings = [0.6, 0.4, 0.19, 0.05]
  const gate = await awaitLoadGate({ read: async () => readings.shift(), limit: LOAD_LIMIT, tries: 10 })
  assert.deepEqual(gate, { ok: true, busy: 0.19, reads: 3 })
})
gate('awaitLoadGate refuses after its tries are used up, with the last reading', async () => {
  const readings = [0.5, 0.45]
  const gate = await awaitLoadGate({ read: async () => readings.shift(), limit: LOAD_LIMIT, tries: 2 })
  assert.deepEqual(gate, { ok: false, busy: 0.45, reads: 2 })
})
gate('awaitLoadGate refuses a tries count below one', async () => {
  await assert.rejects(awaitLoadGate({ read: async () => 0, tries: 0 }), RangeError)
})

finish()
