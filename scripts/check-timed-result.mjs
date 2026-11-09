import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gate, finish } from './lib/gate.mjs'
import { mergeLoad, parseCpuFreqKhz, parseLoadavg, parseNvidiaSmi, readCpuFreqKhz, readGpu, stampLoad } from './browser/timed-result.mjs'

const SAMPLE = '0.52 0.61 0.70 3/410 12345'

gate('parseLoadavg reads the three averages, the runnable count and the thread count', () => {
  assert.deepEqual(parseLoadavg(SAMPLE), { loadavg: [0.52, 0.61, 0.7], runnable: 3, threads: 410 })
})

gate('parseLoadavg refuses a short line and a non-number field', () => {
  assert.throws(() => parseLoadavg('0.52 0.61 0.70'), TypeError)
  assert.throws(() => parseLoadavg('0.52 0.61 x 3/410 12345'), TypeError)
  assert.throws(() => parseLoadavg('0.52 0.61 0.70 three/410 12345'), TypeError)
})

gate('parseCpuFreqKhz averages the per-cpu frequencies and refuses an empty or non-positive list', () => {
  assert.equal(parseCpuFreqKhz(['2000000\n', '3000000\n']), 2500000)
  assert.equal(parseCpuFreqKhz([]), null)
  assert.equal(parseCpuFreqKhz(['0', '3000000']), null)
  assert.equal(parseCpuFreqKhz(['fast']), null)
})

gate('readCpuFreqKhz reads scaling_cur_freq from each cpu directory and returns null when the tree is missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'cpufreq-gate-'))
  try {
    for (const [cpu, khz] of [['cpu0', '2000000'], ['cpu1', '4000000'], ['cpufreq', 'x']]) {
      mkdirSync(join(dir, cpu, 'cpufreq'), { recursive: true })
      writeFileSync(join(dir, cpu, 'cpufreq', 'scaling_cur_freq'), khz + '\n')
    }
    assert.equal(readCpuFreqKhz(dir), 3000000)
    assert.equal(readCpuFreqKhz(join(dir, 'absent')), null)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

gate('parseNvidiaSmi reads utilisation, power, SM clock and temperature, and refuses any other shape', () => {
  assert.deepEqual(parseNvidiaSmi('0, 9.48, 210, 58\n'), { utilizationPct: 0, powerW: 9.48, smMHz: 210, tempC: 58 })
  assert.equal(parseNvidiaSmi('0, 9.48, 210'), null)
  assert.equal(parseNvidiaSmi('0, 9.48, 210, [N/A]'), null)
})

gate('readGpu returns null when the query fails', () => {
  assert.equal(readGpu(() => { throw new Error('no driver') }), null)
  assert.deepEqual(readGpu(() => '1, 80, 1500, 60'), { utilizationPct: 1, powerW: 80, smMHz: 1500, tempC: 60 })
})

gate('stampLoad takes its wall time, cpu count, load, frequency and gpu state from the injected readers', () => {
  const stamp = stampLoad({ read: () => SAMPLE, now: () => 1234, cpus: 12, cpuFreq: () => 2500000, gpu: () => ({ utilizationPct: 0, powerW: 9.5, smMHz: 210, tempC: 58 }) })
  assert.deepEqual(stamp, { wallMs: 1234, cpus: 12, loadavg: [0.52, 0.61, 0.7], runnable: 3, threads: 410, cpuFreqKhz: 2500000, gpu: { utilizationPct: 0, powerW: 9.5, smMHz: 210, tempC: 58 } })
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
