import assert from 'node:assert/strict'
import { attributeOverLimit, cgroupBetween, parseCgroupSamples, PERIOD_MS } from './browser/sampler-gap-check.mjs'
import { finish, gate } from './lib/gate.mjs'

const rows = [
  { t: 1000, selfRunNs: 0, selfWaitNs: 0, workMs: 0 },
  { t: 1050, selfRunNs: 50e6, selfWaitNs: 0, workMs: 0 },
  { t: 1200, selfRunNs: 52e6, selfWaitNs: 120e6, workMs: 1 },
]
const quiet = [
  { t: 1000, selfRunNs: 0, selfWaitNs: 0, workMs: 0 },
  { t: 1050, selfRunNs: 50e6, selfWaitNs: 0, workMs: 0 },
  { t: 1100, selfRunNs: 100e6, selfWaitNs: 0, workMs: 0 },
]

gate('the over-limit line stays at 100 ms', () => {
  assert.equal(2 * PERIOD_MS, 100)
})
gate('parseCgroupSamples reads five numbers per line and refuses a short line', () => {
  assert.deepEqual(parseCgroupSamples('1000 5 6 7 8\n')[0], { t: 1000, throttledUs: 5, usageUs: 6, someUs: 7, fullUs: 8 })
  assert.throws(() => parseCgroupSamples('1000 0 0 0'), TypeError)
})
gate('cgroupBetween takes the throttle delta between the last samples at or before each end', () => {
  const samples = parseCgroupSamples('1000 0 0 0 0\n1050 0 0 0 0\n1200 500000 2000 0 0\n')
  assert.equal(cgroupBetween(samples, 1050, 1200).throttleMs, 500)
  assert.equal(cgroupBetween(parseCgroupSamples('1100 0 0 0 0\n'), 1000, 1200), null)
})
gate('an over-limit gap with cgroup throttle is attributed to the host quota and keeps its numbers', () => {
  const samples = parseCgroupSamples('1000 0 0 0 0\n1050 0 0 0 0\n1200 500000 2000 0 0\n')
  const [gap] = attributeOverLimit(rows, samples)
  assert.equal(gap.cause, 'host-cfs-quota')
  assert.equal(gap.threadCause, 'run-queue-wait')
  assert.equal(gap.cgroupThrottleMs, 500)
  assert.equal(gap.gapMs, 150)
})
gate('an over-limit gap with no throttle keeps its thread cause', () => {
  const samples = parseCgroupSamples('1000 0 0 0 0\n1200 0 0 0 0\n')
  const [gap] = attributeOverLimit(rows, samples)
  assert.equal(gap.cause, 'run-queue-wait')
  assert.equal(gap.cgroupThrottleMs, 0)
})
gate('an over-limit gap with no cgroup samples reports null throttle and does not invent a cause', () => {
  const [gap] = attributeOverLimit(rows, [])
  assert.equal(gap.cgroupThrottleMs, null)
  assert.equal(gap.cause, 'run-queue-wait')
})
gate('gaps under the limit are not attributed', () => {
  assert.deepEqual(attributeOverLimit(quiet, parseCgroupSamples('1000 0 0 0 0\n')), [])
})
finish()
