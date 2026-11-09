import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { mergeLoad, parseLoadavg, stampLoad } from './browser/timed-result.mjs'

const SAMPLE = '0.52 0.61 0.70 3/410 12345'

gate('parseLoadavg reads the three averages, the runnable count and the thread count', () => {
  assert.deepEqual(parseLoadavg(SAMPLE), { loadavg: [0.52, 0.61, 0.7], runnable: 3, threads: 410 })
})

gate('parseLoadavg refuses a short line and a non-number field', () => {
  assert.throws(() => parseLoadavg('0.52 0.61 0.70'), TypeError)
  assert.throws(() => parseLoadavg('0.52 0.61 x 3/410 12345'), TypeError)
  assert.throws(() => parseLoadavg('0.52 0.61 0.70 three/410 12345'), TypeError)
})

gate('stampLoad takes its wall time, cpu count and load from the injected readers', () => {
  const stamp = stampLoad({ read: () => SAMPLE, now: () => 1234, cpus: 12 })
  assert.deepEqual(stamp, { wallMs: 1234, cpus: 12, loadavg: [0.52, 0.61, 0.7], runnable: 3, threads: 410 })
})

gate('stampLoad on this machine reads the kernel load file', () => {
  const stamp = stampLoad()
  assert.equal(stamp.loadavg.length, 3)
  assert.ok(stamp.loadavg.every(Number.isFinite))
  assert.ok(stamp.threads >= stamp.runnable)
  assert.ok(Number.isInteger(stamp.cpus) && stamp.cpus > 0)
})

gate('mergeLoad adds the before and after stamps and keeps every other field', () => {
  const before = { wallMs: 1, cpus: 12, loadavg: [1, 1, 1], runnable: 1, threads: 2 }
  const after = { wallMs: 9, cpus: 12, loadavg: [2, 1, 1], runnable: 2, threads: 3 }
  const result = { phase: 10, checksum: '5', ok: true }
  const merged = mergeLoad(result, before, after)
  assert.deepEqual(merged, { phase: 10, checksum: '5', ok: true, load: { before, after } })
  assert.deepEqual(result, { phase: 10, checksum: '5', ok: true })
})

gate('mergeLoad refuses a result that lacks either stamp', () => {
  const stamp = { wallMs: 1, cpus: 12, loadavg: [1, 1, 1], runnable: 1, threads: 2 }
  assert.throws(() => mergeLoad({ ok: true }, undefined, stamp), TypeError)
  assert.throws(() => mergeLoad({ ok: true }, stamp, null), TypeError)
})

finish()
