import assert from 'node:assert/strict'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { busyShare, coreFlagValues, coreLayout, experimentSettings, isProfileRenderer, parseAllowedList, parseCpuList, parseFlags, parseProcStatCpu, parseProcessor, parseStatState, pinPlan, readTopology, runControlled, sameCpus } from './browser/controlled-run.mjs'
import { pinOutcome } from './browser/controlled-run.mjs'
import { analyseRunData, cpuSharingVerdict, pinningVerdict, summariseCell } from './browser/controlled-report.mjs'
import { clockDropVerdict, clockVerdict, clusterStats, frequencyChanges, parseClockLog, sharedCoreVerdict } from './browser/core-report.mjs'
import { parseThreadLog } from './browser/stall-probe.mjs'
import { parseSchedLog, parseTicksLog } from './browser/thread-sampling.mjs'
import { parseThrottleLog } from './browser/stall-attribution.mjs'

const row = (label, condition, pin, stallCount, extra = {}) => ({ label, round: 1, condition, pin, valid: true, stallCount, stallMs: stallCount * 50, measuredStallMs: stallCount * 50, waitMs: 0, medianMs: 10, p99Ms: 12, maxMs: 20, externalBusy: 0.05, ...extra })
const topology8x2 = Array.from({ length: 16 }, (_, cpu) => ({ cpu, core: cpu % 8, pkg: 0 }))

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
  assert.deepEqual(pinPlan({ ...base, condition: 'PAUSED', pin: '0-7', pauseList: [7, 9] }), { condition: 'PAUSED', pin: '0-7', pauseList: [7, 9], experiment: null, mainCpu: null, burnWorkers: 0, burnCpus: null, samplerCpus: null })
  assert.deepEqual(pinPlan({ ...base, condition: 'LIVE' }), { condition: 'LIVE', pin: null, pauseList: [], experiment: null, mainCpu: null, burnWorkers: 0, burnCpus: null, samplerCpus: null })
})

gate('pinPlan refuses a burn without CPUs, a bad main CPU, a main CPU with a full pin, an unknown experiment and a negative burn count', () => {
  const base = { selfPid: 500, parentPid: 400, condition: 'PAUSED', pauseList: [7] }
  assert.throws(() => pinPlan({ ...base, burnWorkers: 1 }), TypeError)
  assert.throws(() => pinPlan({ ...base, mainCpu: 'x' }), TypeError)
  assert.throws(() => pinPlan({ ...base, mainCpu: '0', pin: '0-7' }), TypeError)
  assert.throws(() => pinPlan({ ...base, experiment: 'core-other' }), TypeError)
  assert.throws(() => pinPlan({ ...base, burnWorkers: -1 }), TypeError)
  const plan = pinPlan({ ...base, experiment: 'core-shared', mainCpu: '0', burnWorkers: 1, burnCpus: '8', samplerCpus: '8' })
  assert.deepEqual([plan.mainCpu, plan.burnWorkers, plan.burnCpus, plan.samplerCpus, plan.experiment], ['0', 1, '8', '8', 'core-shared'])
})

gate('parseStatState reads the state after the last closing parenthesis, so a command name with brackets is safe', () => {
  assert.equal(parseStatState('12 (chrome) S 1 2'), 'S')
  assert.equal(parseStatState('12 (a) b) T 1 2'), 'T')
  assert.throws(() => parseStatState('12 chrome S'), TypeError)
  assert.throws(() => parseStatState('12 (x) 9 1'), TypeError)
})

gate('parseProcessor reads field 39 of the stat line, the CPU the thread last ran on, and refuses a line without it', () => {
  const full = Array.from({ length: 50 }, (_, i) => (i === 0 ? 'S' : i === 36 ? '7' : '0'))
  assert.equal(parseProcessor('12 (chrome render) ' + full.join(' ')), 7)
  assert.throws(() => parseProcessor('12 (x) S 1 2'), TypeError)
  assert.throws(() => parseProcessor('12 chrome S'), TypeError)
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

gate('coreLayout picks the SMT sibling of the main CPU, a CPU on another physical core, and a third physical core, and refuses a missing sibling, a single core or fewer than three cores', () => {
  const layout = coreLayout(topology8x2, 0)
  assert.deepEqual([layout.main, layout.sameCore, layout.separateCore, layout.thirdCore], [0, 8, 1, 2])
  assert.throws(() => coreLayout(topology8x2, 99), TypeError)
  assert.throws(() => coreLayout(Array.from({ length: 4 }, (_, cpu) => ({ cpu, core: cpu, pkg: 0 })), 0), RangeError)
  assert.throws(() => coreLayout(Array.from({ length: 2 }, (_, cpu) => ({ cpu, core: 0, pkg: 0 })), 0), RangeError)
  assert.throws(() => coreLayout(Array.from({ length: 4 }, (_, cpu) => ({ cpu, core: cpu >> 1, pkg: 0 })), 0), RangeError)
})

gate('experimentSettings puts the shared arm on the renderer sibling, the separate arm on two other cores, and the control with no burn', () => {
  const layout = coreLayout(topology8x2, 0)
  assert.deepEqual(experimentSettings('core-shared', layout), { mainCpu: '0', burnWorkers: 1, burnCpus: '8', samplerCpus: '8' })
  assert.deepEqual(experimentSettings('core-separate', layout), { mainCpu: '0', burnWorkers: 1, burnCpus: '2', samplerCpus: '1' })
  assert.deepEqual(experimentSettings('core-none', layout), { mainCpu: '0', burnWorkers: 0, burnCpus: '', samplerCpus: '1' })
  assert.deepEqual(experimentSettings(null, null), { mainCpu: '', burnWorkers: 0, burnCpus: '', samplerCpus: '' })
  assert.throws(() => experimentSettings('core-x', layout), TypeError)
  assert.throws(() => experimentSettings('core-x', null), TypeError)
})

gate('readTopology reads this host with a core and a package id for every CPU', () => {
  const cpus = readTopology()
  assert.ok(cpus.length >= 1)
  assert.ok(cpus.every((entry) => Number.isInteger(entry.core) && Number.isInteger(entry.pkg) && Number.isInteger(entry.cpu)))
})

gate('coreFlagValues reads the experiment flag and defaults the main CPU to 0', () => {
  assert.deepEqual(coreFlagValues({}), { experiment: null, main: '0' })
  assert.deepEqual(coreFlagValues({ experiment: 'core-shared', main: '2' }), { experiment: 'core-shared', main: '2' })
})

gate('parseClockLog reads four fields per line and refuses any other count', () => {
  assert.deepEqual(parseClockLog('100 9 3 2000000\n')[0], { t: 100, pid: 9, cpu: 3, kHz: 2000000 })
  assert.throws(() => parseClockLog('100 9 3\n'), TypeError)
})

gate('frequencyChanges reports the times a renderer frequency differs from its previous sample, ignoring other pids and unreadable samples', () => {
  const rows = parseClockLog(['0 9 3 1000000', '20 9 3 1000000', '40 9 3 2000000', '60 9 3 2000000', '80 9 3 1000000', '90 8 1 5000000', '100 9 3 -1'].join('\n'))
  assert.deepEqual(frequencyChanges(rows, 9), [40, 80])
  assert.deepEqual(frequencyChanges(rows, 8), [])
})

gate('clusterStats counts the stall frames and the frames with a frequency change within 100 ms of them', () => {
  const stats = clusterStats({ stallWindows: [{ frame: 30, startMs: 1000, totalMs: 60 }], frameWindows: [{ startMs: 1000, totalMs: 60 }, { startMs: 0, totalMs: 10 }, { startMs: 5000, totalMs: 10 }], changes: [1040] })
  assert.equal(stats.stalls, 1)
  assert.equal(stats.stallsNear, 1)
  assert.equal(stats.framesNear, 1)
  assert.equal(stats.frames, 3)
  assert.equal(stats.ratio, 3)
})

gate('clockVerdict needs three stall frames, then names clustering, no clustering, or an in-between ratio', () => {
  const run = (stalls, stallsNear, frames, framesNear) => ({ stalls, stallsNear, frames, framesNear })
  assert.match(clockVerdict([run(2, 2, 10, 1)]), /^insufficient/)
  assert.equal(clockVerdict([run(3, 3, 10, 1)]), 'clusters on frequency changes')
  assert.equal(clockVerdict([run(6, 1, 10, 5)]), 'does not cluster on frequency changes')
  assert.match(clockVerdict([run(6, 2, 10, 2)]), /^inconclusive/)
})

gate('clockDropVerdict needs three runs with stalls, then names a lower clock in two runs of three', () => {
  assert.match(clockDropVerdict([{ stalls: 2, lower: true }, { stalls: 2, lower: true }]), /^insufficient/)
  assert.equal(clockDropVerdict([{ stalls: 2, lower: true }, { stalls: 2, lower: true }, { stalls: 2, lower: false }]), 'stalls sit at a lower clock in most runs')
  assert.equal(clockDropVerdict([{ stalls: 2, lower: false }, { stalls: 2, lower: false }, { stalls: 2, lower: true }]), 'stalls do not sit at a lower clock in most runs')
})

gate('sharedCoreVerdict is supported only when the shared arm exceeds the separate arm in total and in two rounds of three', () => {
  const arm = (experiment, counts) => counts.map((stallCount, i) => ({ experiment, round: i + 1, valid: true, stallCount }))
  assert.equal(sharedCoreVerdict([...arm('core-shared', [3, 2, 1]), ...arm('core-separate', [0, 1, 0])]), 'supported: shared-core stall frames exceed separate-core in 3 of 3 rounds')
  assert.match(sharedCoreVerdict([...arm('core-shared', [0, 0, 0]), ...arm('core-separate', [1, 1, 1])]), /^not supported/)
  assert.match(sharedCoreVerdict([...arm('core-shared', [0, 3, 0]), ...arm('core-separate', [1, 0, 1])]), /^inconclusive/)
  assert.match(sharedCoreVerdict([...arm('core-shared', [1, 1])]), /^insufficient/)
})

gate('analyseRunData counts the one stall, its run-queue wait, its sleep and its window from synthetic counters', () => {
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
  assert.equal(analysis.experiment, null)
  assert.equal(analysis.frames, 41)
  assert.equal(analysis.medianMs, 10)
  assert.equal(analysis.stallCount, 1)
  assert.equal(analysis.stallWindows.length, 1)
  assert.equal(analysis.stallWindows[0].startMs, 2000)
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
  rmSync(out, { recursive: true, force: true })
  await assert.rejects(runControlled({ label: 'a/b', round: 1, condition: 'PAUSED', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 0, condition: 'PAUSED', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'PAUSED', pauseList: [process.pid], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'LIVE', pauseList: [7], out }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'LIVE', out: '' }), TypeError)
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'PAUSED', pauseList: [7], out, experiment: 'core-other' }), TypeError)
  assert.equal(existsSync(out), false)
})

gate('runControlled refuses a caller pause list, so PAUSED stops only the children the run starts', async () => {
  const out = join(tmpdir(), 'controlled-run-gate-own-pause')
  await assert.rejects(runControlled({ label: 'ok', round: 1, condition: 'PAUSED', pauseList: [7], out }), TypeError)
  assert.equal(existsSync(out), false)
  const source = readFileSync(new URL('./browser/controlled-run.mjs', import.meta.url), 'utf8')
  assert.ok(source.includes("spawn(process.execPath, ['-e', 'while (true);']"), 'PAUSED does not spawn its own children')
  assert.ok(source.includes('pauseList: pauseChildren.map((child) => child.pid)'), 'the plan does not take its pids from its own children')
})

gate('pinOutcome reads the readback of renderers still alive at the end, and ignores one that exited', () => {
  assert.equal(pinOutcome([{ exitStatus: 0, afterPin: ['0'], atEnd: ['0'] }, { exitStatus: 0, afterPin: ['0'], atEnd: [] }], '0'), true)
  assert.equal(pinOutcome([{ exitStatus: 0, afterPin: ['0'], atEnd: ['0-3'] }], '0'), false)
  assert.equal(pinOutcome([{ exitStatus: 0, afterPin: ['0'], atEnd: [] }], '0'), false)
  assert.equal(pinOutcome([], '0'), false)
  assert.equal(pinOutcome([], null), null)
})

gate('parseFlags reads --name=value pairs and refuses a bare word', () => {
  assert.deepEqual(parseFlags(['--label=a', '--pin=0-7']), { label: 'a', pin: '0-7' })
  assert.throws(() => parseFlags(['label']), TypeError)
})

finish()
