import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { gapsOverLimit, parseStat, processType, samplingGaps } from './browser/thread-sampling.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const sampler = join(here, 'browser', 'thread-cpu-sampler.mjs')
const PERIOD_MS = 50
const RUN_MS = 2000

gate('processType reads the Chromium --type flag and defaults to browser', () => {
  assert.equal(processType('chrome --user-data-dir=/p --type=renderer --x'), 'renderer')
  assert.equal(processType('chrome --user-data-dir=/p'), 'browser')
})

gate('parseStat reads utime plus stime and keeps a comm with brackets and spaces', () => {
  const fields = ['S', ...Array(10).fill(1), 7, 3, 0].join(' ')
  assert.deepEqual(parseStat('42 (Chrome (x) render) ' + fields), { comm: 'Chrome (x) render', jiffies: 10 })
})

gate('samplingGaps gives the gap between consecutive stamps and none for a single stamp', () => {
  assert.deepEqual(samplingGaps([0, 50, 100, 400]), [50, 50, 300])
  assert.deepEqual(samplingGaps([0]), [])
})

gate('gapsOverLimit names only the gaps above twice the interval', () => {
  assert.deepEqual(gapsOverLimit([0, 50, 100, 400], 50), [300])
  assert.deepEqual(gapsOverLimit([0, 100, 200], 50), [])
  assert.deepEqual(gapsOverLimit([0, 101], 50), [101])
})

gate('the sampler ticks at least every twice its interval while a renderer process runs', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'thread-sampler-'))
  try {
    const profile = join(dir, 'profile')
    const outFile = join(dir, 'threads.txt')
    const fake = join(dir, 'fake-renderer.mjs')
    writeFileSync(fake, 'setInterval(() => {}, 1000)\n')
    const renderer = spawn(process.execPath, [fake, '--user-data-dir=' + profile, '--type=renderer'], { stdio: 'ignore' })
    const run = spawn(process.execPath, [sampler, outFile, String(PERIOD_MS), profile], { stdio: 'ignore' })
    const exited = new Promise((resolve) => run.once('exit', resolve))
    await new Promise((resolve) => setTimeout(resolve, RUN_MS))
    run.kill('SIGTERM')
    renderer.kill('SIGTERM')
    await exited
    const stamps = readFileSync(outFile + '.ticks', 'utf8').split('\n').filter((line) => line !== '').map(Number)
    assert.ok(stamps.length >= 10, 'the sampler wrote ' + stamps.length + ' ticks in ' + RUN_MS + ' ms')
    const late = gapsOverLimit(stamps, PERIOD_MS)
    assert.deepEqual(late, [], 'sampling gaps over ' + 2 * PERIOD_MS + ' ms: ' + late.join(', '))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

finish()
