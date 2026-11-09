import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { classifyLongFrames, cgroupOver, frameCauses, mainThreadPid, pageFrames, parseCgroupSamples } from './browser/frame-stall-cause.mjs'

const COLUMNS = ['frame', 'startMs', 'tickMs', 'renderMs', 'gapMs', 'active', 'pages', 'inputs', 'physics', 'readback', 'plan', 'backend', 'acquire', 'upload', 'submit']

const pageWith = (frames) => ({
  rowColumns: COLUMNS,
  rows: frames.map((f) => [f.frame, f.startMs, f.tickMs, 1, 0, 10240, 0, 0, f.tickMs, 0, 0, 0, 0, 0, 0]),
})

const frames = [
  { frame: 0, startMs: 0, tickMs: 5 },
  { frame: 1, startMs: 100, tickMs: 5 },
  { frame: 2, startMs: 200, tickMs: 5 },
  { frame: 3, startMs: 300, tickMs: 80 },
  { frame: 4, startMs: 400, tickMs: 80 },
  { frame: 5, startMs: 500, tickMs: 80 },
]

const cgroupAt = ({ coresPerMs = 0, throttlePerMs = 0 }) => Array.from({ length: 701 }, (_, t) => ({
  t,
  throttledUs: Math.round(throttlePerMs * t * 1000),
  usageUs: Math.round(coresPerMs * t * 1000),
  someUs: 0,
  fullUs: 0,
}))

const schedAt = ({ pid = 7, runRate, waitRate }) => Array.from({ length: 701 }, (_, t) => ({
  t,
  pid,
  runNs: Math.round(runRate * t * 1e6),
  waitNs: Math.round(waitRate * t * 1e6),
  slices: 1,
  minflt: -1,
  majflt: -1,
  wchan: 'futex_do_wait',
}))

gate('parseCgroupSamples reads five numeric fields per line and refuses any other count', () => {
  assert.deepEqual(parseCgroupSamples('100 5 7 8 9\n'), [{ t: 100, throttledUs: 5, usageUs: 7, someUs: 8, fullUs: 9 }])
  assert.throws(() => parseCgroupSamples('100 5 7 8\n'), TypeError)
  assert.throws(() => parseCgroupSamples('100 x 7 8 9\n'), TypeError)
})

gate('pageFrames ends each frame at its start plus tick and render time, and refuses a page with no columns', () => {
  const [first] = pageFrames(pageWith([{ frame: 0, startMs: 1000, tickMs: 5 }]))
  assert.equal(first.endMs, 1006)
  assert.equal(first.tickMs, 5)
  assert.throws(() => pageFrames({ rows: [] }), TypeError)
})

gate('mainThreadPid picks the thread that gained the most run time, and refuses an empty list', () => {
  const rows = [
    { t: 0, pid: 3, runNs: 0, waitNs: 0 },
    { t: 0, pid: 9, runNs: 0, waitNs: 0 },
    { t: 100, pid: 3, runNs: 5e6, waitNs: 0 },
    { t: 100, pid: 9, runNs: 50e6, waitNs: 0 },
  ]
  assert.equal(mainThreadPid(rows), 9)
  assert.throws(() => mainThreadPid([]), TypeError)
})

gate('cgroupOver sums throttled time, cores and pressure across the window, and is null outside the samples', () => {
  const samples = [
    { t: 0, throttledUs: 0, usageUs: 0, someUs: 0, fullUs: 0 },
    { t: 100, throttledUs: 400000, usageUs: 1200000, someUs: 50000, fullUs: 0 },
  ]
  const over = cgroupOver(samples, 0, 100)
  assert.equal(over.throttledMs, 400)
  assert.equal(over.cpuCores, 12)
  assert.equal(over.someMs, 50)
  assert.equal(cgroupOver(samples, 0, 200), null)
})

gate('frameCauses names long frames as runnable wait when the main thread waits for a CPU', () => {
  const result = frameCauses({ page: pageWith(frames), cgroupSamples: cgroupAt({ coresPerMs: 10 }), schedRows: schedAt({ runRate: 0.2, waitRate: 0.5 }) })
  assert.equal(result.long.n, 3)
  assert.equal(result.normal.n, 3)
  assert.equal(result.cause, 'runnable-wait')
})

gate('frameCauses names long frames as CPU work when the main thread runs most of the frame', () => {
  const result = frameCauses({ page: pageWith(frames), cgroupSamples: cgroupAt({ coresPerMs: 10 }), schedRows: schedAt({ runRate: 0.6, waitRate: 0.1 }) })
  assert.equal(result.cause, 'cpu-work')
})

gate('frameCauses names long frames as both CPU work and runnable wait when neither share alone dominates', () => {
  const result = frameCauses({ page: pageWith(frames), cgroupSamples: cgroupAt({ coresPerMs: 10 }), schedRows: schedAt({ runRate: 0.4, waitRate: 0.4 }) })
  assert.equal(result.cause, 'cpu-and-runnable-wait')
})

gate('frameCauses names long frames as off the CPU when neither run nor wait covers the frame', () => {
  const result = frameCauses({ page: pageWith(frames), cgroupSamples: cgroupAt({ coresPerMs: 10 }), schedRows: schedAt({ runRate: 0.05, waitRate: 0.05 }) })
  assert.equal(result.cause, 'off-cpu')
})

gate('frameCauses names long frames as quota-saturated from the cgroup alone when cores are at the quota and throttling runs', () => {
  const result = frameCauses({ page: pageWith(frames), cgroupSamples: cgroupAt({ coresPerMs: 12, throttlePerMs: 3 }), schedRows: null, quotaCores: 12 })
  assert.equal(result.mainPid, null)
  assert.equal(result.cause, 'quota-saturated')
  assert.equal(classifyLongFrames({ n: 0 }, 12), 'no-long-frames')
})

finish()
