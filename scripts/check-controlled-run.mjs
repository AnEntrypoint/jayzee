import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { busyShare, isProfileRenderer, parseAllowedList, parseCpuList, parseFlags, parseProcStatCpu, parseStatState, pinPlan, runControlled, sameCpus } from './browser/controlled-run.mjs'
import { analyseRunData, cpuSharingVerdict, pinningVerdict, summariseCell } from './browser/controlled-report.mjs'
import { parseThreadLog } from './browser/stall-probe.mjs'
import { parseSchedLog, parseTicksLog } from './browser/thread-sampling.mjs'
import { parseThrottleLog } from './browser/stall-attribution.mjs'

const row = (label, condition, pin, stallCount, extra = {}) => ({ label, round: 1, condition, pin, valid: true, stallCount, stallMs: stallCount * 50, measuredStallMs: stallCount * 50, waitMs: 0, medianMs: 10, p99Ms: 12, maxMs: 20, externalBusy: 0.05, ...extra })

gate('parseCpuList reads ranges and lists, and refuses backwards, malformed and empty input', () => {
  assert.deepEqual(parseCpuList('0-3,8'), [0, 1, 2, 3, 8])
  assert.equal(parseCpuList('0-7').length, 8)
  assert.deepEqual(parseCpuList('5,5'), [5])
  for (const bad of ['3-1', 'a', '', '0-', ' 1', '1,,2']) assert.throws(() => parseCpuList(bad), TypeError)
})

gate('sameCpus compares two CPU lists as sets of numbers, not as text', () => {
  assert.equal(sameCpus('0-7', '0-7'), true)
  assert.equal(sameCpus('0,1,2,3,4,5,6,7', '0-7'), true)
  assert.equal(sameCpus('0-3', '0-7'), false)
})

gate('pinPlan refuses a pause of this job, of its parent, of a duplicate, and a PAUSED or LIVE plan with the wrong pids', () => {
  const base = { selfPid: 500, parentPid: 400 }
  assert.throws(() => pinPlan({ ...base, condition: 'PAUSED', pauseList: [500] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'PAUSED', pauseList: [400] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'PAUSED', pauseList: [7, 7] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'PAUSED', pauseList: [] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'LIVE', pauseList: [7] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'SOLO', pauseList: [] }), TypeError)
  assert.throws(() => pinPlan({ ...base, condition: 'LIVE', pin: '3-1', pauseList: [] }), TypeError)
  assert.deepEqual(pinPlan({ ...base, condition: 'PAUSED', pin: '0-7', pauseList: [7, 9] }), { condition: 'PAUSED', pin: '0-7', pauseList: [7, 9] })
  assert.deepEqual(pinPlan({ ...base, condition: 'LIVE' }), { condition: 'LIVE', pin: null, pauseList: [] })
})

gate('parseStatState reads the state after the last closing parenthesis, so a command name with brackets is safe', () => {
  assert.equal(parseStatState('12 (chrome) S 1 2'), 'S')
  assert.equal(parseStatState('12 (a) b) T 1 2'), 'T')
  assert.throws(() => parseStatState('12 chrome S'), TypeError)
  assert.throws(() => parseStatState('12 (x) 9 1'), TypeError)
})

gate('parseAllowedList reads the kernel line and refuses a status with none', () => {
  assert.equal(parseAllowedList('Name:\tx\nCpus_allowed_list:\t0-15\n'), '0-15')
  assert.throws(() => parseAllowedList('Name:\tx\n'), TypeError)
})

gate('isProfileRenderer needs the renderer type and the project profile, and refuses another profile', () => {
  assert.equal(isProfileRenderer('chrome --type=renderer --user-data-dir=/p', '/p'), true)
  assert.equal(isProfileRenderer('chrome --user-data-dir=/p', '/p'), false)
  assert.equal(isProfileRenderer('chrome --type=renderer --user-data-dir=/q', '/p'), false)
})

gate('parseProcStatCpu and busyShare give the busy share of all CPU time between two reads', () => {
  const before = parseProcStatCpu('cpu  100 0 100 700 100 0 0 0 0 0\ncpu0 1 1 1 1\n')
  const after = parseProcStatCpu('cpu  200 0 200 1400 200 0 0 0 0 0\n')
  assert.deepEqual(before, { busy: 200, total: 1000 })
  assert.equal(busyShare(before, after), 0.2)
  assert.throws(() => parseProcStatCpu('cpu0 1 1\n'), TypeError)
  assert.throws(() => busyShare(before, before), RangeError)
})

gate('analyseRunData counts the one stall, its run-queue wait and its sleep from synthetic counters', () => {
  const frames = []
  for (let i = 0; i < 30; i += 1) frames.push([i, 1000 + i * 25, 9, 1])
  frames.push([30, 2000, 59, 1])
  for (let i = 31; i <= 40; i += 1) frames.push([i, 2100 + (i - 31) * 25, 9, 1])
  const page = { rowColumns: ['frame', 'startMs', 'tickMs', 'renderMs'], rows: frames }
  const threadLines = []
  const schedLines = []
  const ticksLines = []
  for (let t = 1000; t <= 2400; t += 50) {
    threadLines.push(t + ' 9 renderer 9 ' + (t - 1000) / 20 + ' chrome')
    const runNs = (t - 1000) * 0.5e6
    const waitNs = t > 2000 ? (t - 2000) * 0.5e6 : 0
    schedLines.push(t + ' 9 ' + runNs + ' ' + waitNs + ' 1 0 0 0')
    ticksLines.push(t + ' 0 0 0 0 0')
  }
  const samples = []
  for (let t = 900; t <= 2500; t += 10) samples.push(t + ' 0 0 0 0')
  const analysis = analyseRunData({
    run: { label: 'x', round: 1, condition: 'PAUSED', pin: null, externalBusy: { share: 0.05 } },
    page,
    samples: parseThrottleLog(samples.join('\n')),
    threadRows: parseThreadLog(threadLines.join('\n')),
    schedRows: parseSchedLog(schedLines.join('\n')),
    ticksRows: parseTicksLog(ticksLines.join('\n')),
  })
  assert.equal(analysis.valid, true)
  assert.equal(analysis.frames, 41)
  assert.equal(analysis.medianMs, 10)
  assert.equal(analysis.stallCount, 1)
  assert.ok(Math.abs(analysis.waitMs - 30) < 1e-6)
  assert.ok(Math.abs(analysis.measuredStallMs - 60) < 1e-6)
  assert.ok(Math.abs(analysis.waitShare - 0.5) < 1e-9)
  assert.equal(analysis.unmeasuredStalls, 0)
})

gate('analyseRunData refuses to count a run whose page reported an error, and says why', () => {
  const analysis = analyseRunData({ run: { label: 'y', round: 2, condition: 'LIVE', pin: null, externalBusy: { share: 0.3 } }, page: { error: 'no adapter' }, samples: [], threadRows: [], schedRows: [], ticksRows: [] })
  assert.deepEqual([analysis.valid, analysis.reason], [false, 'no adapter'])
})

gate('summariseCell sums only valid runs and gives the wait share of the stall time', () => {
  const rows = [row('a', 'PAUSED', null, 2, { waitMs: 10, measuredStallMs: 100 }), row('b', 'PAUSED', null, 0, { waitMs: 0, measuredStallMs: 0 }), row('c', 'PAUSED', null, 4, { valid: false, reason: 'x' })]
  const cell = summariseCell(rows)
  assert.equal(cell.runs, 3)
  assert.equal(cell.valid, 2)
  assert.equal(cell.totalStalls, 2)
  assert.equal(cell.waitShare, 0.1)
  assert.equal(cell.medianStallsPerRun, 1)
})

gate('pinningVerdict needs three valid runs per cell, then names whether pinning reduces, adds or leaves the stall frames', () => {
  const three = (stalls) => summariseCell(stalls.map((count, i) => row('r' + i, 'PAUSED', null, count)))
  assert.match(pinningVerdict(three([1, 1]), three([0, 0, 0])), /^insufficient/)
  assert.equal(pinningVerdict(three([2, 1, 0]), three([0, 0, 1])), 'pinning reduces stall frames')
  assert.equal(pinningVerdict(three([0, 0, 1]), three([1, 1, 0])), 'pinning adds stall frames')
  assert.equal(pinningVerdict(three([0, 0, 0]), three([0, 0, 0])), 'no difference in stall frames')
})

gate('cpuSharingVerdict is supported only when live stalls rise and their time is mostly run-queue wait', () => {
  const cell = (stalls, waitMs, measured) => summariseCell(stalls.map((count, i) => row('r' + i, 'LIVE', null, count, { waitMs: waitMs / stalls.length, measuredStallMs: measured / stalls.length })))
  const paused = summariseCell([0, 0, 0].map((count, i) => row('p' + i, 'PAUSED', null, count)))
  assert.equal(cpuSharingVerdict(paused, cell([3, 2, 4], 60, 100)), 'supported: stalls rise with co-tenant load and their time is run-queue wait')
  assert.equal(cpuSharingVerdict(paused, cell([3, 2, 4], 10, 100)), 'partly: stalls rise with co-tenant load, but their time is not mostly run-queue wait')
  assert.equal(cpuSharingVerdict(paused, cell([0, 0, 0], 0, 0)), 'not supported: stalls do not rise with co-tenant load')
})

gate('runControlled refuses bad input before it creates a directory or pauses a pid', async () => {
  const out = join(tmpdir(), 'controlled-run-gate-never-created')
  await assert.rejects(runControlled({ label: 'a/b', round: 1, condition: 'PAUSED', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 0, condition: 'PAUSED', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'PAUSED', pauseList: [process.pid], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'LIVE', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'LIVE', out: '' }), TypeError)
})

gate('parseFlags reads --name=value pairs and refuses a bare word', () => {
  assert.deepEqual(parseFlags(['--label=a', '--pin=0-7']), { label: 'a', pin: '0-7' })
  assert.throws(() => parseFlags(['label']), TypeError)
})

finish()
