import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { offCpuForStalls, summariseOffCpu } from './browser/stall-off-cpu.mjs'
import { categoryOfWchan, gapCauses, offCpuWindow, parsePressureTotal, parseSchedLog, parseSchedStat, parseTicksLog, parseStat, pressureMsBetweenTicks } from './browser/thread-sampling.mjs'

const schedRows = parseSchedLog([
  '0 9 0 0 0 0 0 0',
  '50 9 30000000 5000000 4 10 0 futex_do_wait',
  '100 9 35000000 5000000 5 10 2 futex_do_wait',
  '100 8 1 1 1 1 1 do_epoll_wait',
].join('\n') + '\n')

gate('parseSchedStat reads run, wait and slice counts and refuses a short or non-numeric line', () => {
  assert.deepEqual(parseSchedStat('1000 200 5\n'), { runNs: 1000, waitNs: 200, slices: 5 })
  assert.throws(() => parseSchedStat('1000 200\n'), TypeError)
  assert.throws(() => parseSchedStat('x 200 5'), TypeError)
})

gate('parsePressureTotal reads the some total and refuses a file with no some line', () => {
  assert.equal(parsePressureTotal('some avg10=0.00 avg60=0.47 avg300=9.79 total=11119965137\nfull avg10=0.00 total=4883413009\n'), 11119965137)
  assert.throws(() => parsePressureTotal('full avg10=0.00 total=5\n'), TypeError)
})

gate('parseStat reads the minor and major fault counts of the thread next to utime and stime', () => {
  const fields = ['S', 1, 1, 1, 1, 1, 1, 42, 1, 7, 1, 11, 3, 0].join(' ')
  const parsed = parseStat('42 (Chrome (x) render) ' + fields)
  assert.equal(parsed.jiffies, 14)
  assert.equal(parsed.minflt, 42)
  assert.equal(parsed.majflt, 7)
})

gate('offCpuWindow reports faults as null when the sampler did not read them, and keeps the wait categories', () => {
  const unread = parseSchedLog(['0 9 0 0 0 -1 -1 0', '50 9 30000000 5000000 4 -1 -1 futex_do_wait', '100 9 35000000 5000000 5 -1 -1 futex_do_wait'].join('\n') + '\n')
  const window = offCpuWindow({ schedRows: unread, pid: 9, startMs: 50, endMs: 100 })
  assert.equal(window.majflt, null)
  assert.equal(window.minflt, null)
  assert.deepEqual(window.waits, { futex: 2 })
})

gate('categoryOfWchan names the kernel wait: futex, epoll, page io, reclaim, sleep, socket, running, other', () => {
  assert.equal(categoryOfWchan('futex_do_wait'), 'futex')
  assert.equal(categoryOfWchan('do_epoll_wait'), 'epoll')
  assert.equal(categoryOfWchan('ep_poll'), 'epoll')
  assert.equal(categoryOfWchan('io_schedule'), 'page-io')
  assert.equal(categoryOfWchan('shrink_inactive_list'), 'reclaim')
  assert.equal(categoryOfWchan('hrtimer_nanosleep'), 'sleep-or-poll')
  assert.equal(categoryOfWchan('unix_stream_read_generic'), 'socket')
  assert.equal(categoryOfWchan('0'), 'running')
  assert.equal(categoryOfWchan('some_odd_symbol'), 'other')
})

gate('parseSchedLog reads eight fields per line and refuses any other count or a non-numeric field', () => {
  assert.deepEqual(schedRows[1], { t: 50, pid: 9, runNs: 30000000, waitNs: 5000000, slices: 4, minflt: 10, majflt: 0, wchan: 'futex_do_wait' })
  assert.throws(() => parseSchedLog('50 9 1 1 1 1 1\n'), TypeError)
  assert.throws(() => parseSchedLog('x 9 1 1 1 1 1 0\n'), TypeError)
})

gate('parseTicksLog reads six fields per line and refuses any other count', () => {
  assert.deepEqual(parseTicksLog('100 50000 -1 7 8 3\n')[0], { t: 100, memSomeUs: 50000, ioSomeUs: -1, selfRunNs: 7, selfWaitNs: 8, workMs: 3 })
  assert.throws(() => parseTicksLog('100 50000 -1 7 8\n'), TypeError)
})

gate('offCpuWindow takes run and wait from the interpolated counters, names the waits and counts the major faults inside the window', () => {
  const window = offCpuWindow({ schedRows, pid: 9, startMs: 50, endMs: 100 })
  assert.equal(window.runMs, 5)
  assert.equal(window.waitMs, 0)
  assert.equal(window.samples, 2)
  assert.deepEqual(window.waits, { futex: 2 })
  assert.equal(window.majflt, 2)
  assert.equal(window.minflt, 0)
})

gate('offCpuWindow interpolates inside one sample gap and names the sample before the window when the window holds none', () => {
  const window = offCpuWindow({ schedRows, pid: 9, startMs: 10, endMs: 20 })
  assert.equal(window.samples, 0)
  assert.deepEqual(window.waits, { running: 1 })
  assert.equal(window.runMs, 6)
  assert.equal(window.waitMs, 1)
  assert.throws(() => offCpuWindow({ schedRows, pid: 9, startMs: 20, endMs: 20 }), TypeError)
})

gate('offCpuForStalls gives sleep as the stall time minus run and wait, and null when the counters do not cover the window', () => {
  const ticks = parseTicksLog('0 0 0 0 0 0\n100 50000 0 0 0 0\n')
  const stalls = [{ frame: 3, verdict: 'blocked', startMs: 50, totalMs: 50 }, { frame: 4, verdict: 'blocked', startMs: 500, totalMs: 20 }]
  const out = offCpuForStalls(stalls, schedRows, ticks, 9)
  assert.equal(out[0].sleepMs, 45)
  assert.equal(out[0].memSomeMs, 25)
  assert.equal(out[1].runMs, null)
  assert.equal(out[1].sleepMs, null)
})

gate('summariseOffCpu gives count, median and sum of sleep per verdict, and merges the wait labels', () => {
  const summary = summariseOffCpu([
    { verdict: 'blocked', sleepMs: 45, majflt: 1, memSomeMs: 2, waits: { futex: 2 } },
    { verdict: 'blocked', sleepMs: 20, majflt: 0, memSomeMs: 0, waits: { futex: 1, running: 1 } },
    { verdict: 'starved', sleepMs: null, majflt: 0, memSomeMs: 0, waits: {} },
  ])
  assert.equal(summary.blocked.count, 2)
  assert.equal(summary.blocked.sleepMsMedian, 32.5)
  assert.equal(summary.blocked.sleepMsSum, 65)
  assert.deepEqual(summary.blocked.waits, { futex: 3, running: 1 })
  assert.equal(summary.blocked.majflt, 1)
  assert.equal(summary.starved.sleepMsMedian, null)
})

gate('pressureMsBetweenTicks converts the cgroup some total from microseconds and skips an unavailable file', () => {
  const ticks = parseTicksLog('0 0 0 0 0 0\n100 50000 0 0 0 0\n200 -1 0 0 0 0\n')
  assert.equal(pressureMsBetweenTicks(ticks, 'memSomeUs', 0, 100), 50)
  assert.equal(pressureMsBetweenTicks(ticks, 'memSomeUs', 150, 200), null)
})

gate('gapCauses names an over-limit gap as run-queue wait, sampler work or unattributed, and ignores gaps within twice the interval', () => {
  const waited = parseTicksLog('0 0 0 0 0 0\n150 0 0 0 102000000 1\n')
  assert.deepEqual(gapCauses(waited, 50), [{ t: 150, gapMs: 150, excessMs: 100, selfWaitMs: 102, selfRunMs: 0, workMs: 1, cause: 'run-queue-wait' }])
  assert.equal(gapCauses(parseTicksLog('0 0 0 0 0 0\n150 0 0 0 0 90\n'), 50)[0].cause, 'sampler-work')
  assert.equal(gapCauses(parseTicksLog('0 0 0 0 0 0\n150 0 0 0 0 1\n'), 50)[0].cause, 'unattributed')
  assert.deepEqual(gapCauses(parseTicksLog('0 0 0 0 0 0\n100 0 0 0 0 0\n'), 50), [])
  assert.throws(() => gapCauses(waited, 0), TypeError)
})

finish()
