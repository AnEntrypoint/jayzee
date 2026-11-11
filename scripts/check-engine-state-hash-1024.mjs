import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { FIXED_GLUE, STATE_KEY, THREADED_GLUE, THREADED_WORKERS, THREAD_COUNTS } from './lib/stateHash1024.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const pins = JSON.parse(readFileSync(join(root, 'engine/state-hashes.json'), 'utf8'))

const child = join(root, 'scripts/lib/stateHashChild.mjs')
const execFileAsync = promisify(execFile)
const runIsolated = async (glue, workers) => JSON.parse((await execFileAsync(process.execPath, [child, glueUrl(glue), String(workers)], { encoding: 'utf8', maxBuffer: 1 << 20 })).stdout)
const [fixedRun, ...threadedRuns] = await Promise.all([runIsolated(FIXED_GLUE, 1), ...THREAD_COUNTS.map((workers) => runIsolated(THREADED_GLUE, workers))])
const countRuns = new Map(THREAD_COUNTS.map((workers, at) => [workers, threadedRuns[at]]))
const threadedRun = countRuns.get(THREADED_WORKERS) ?? await runIsolated(THREADED_GLUE, THREADED_WORKERS)
const fixed = fixedRun.hash

gate('the 1024-tier scenario moves bodies, so the hash is not of a still world', () => {
  assert.equal(fixedRun.count, 10240 * 3)
  assert.notDeepEqual(fixedRun.first, [0, 0, 0])
})

gate('the fixed and threaded builds agree on the 1024-tier state, bit for bit', () => {
  assert.equal(threadedRun.hash, fixed)
})

gate('the threaded build agrees with the fixed build at 2 and 4 workers, bit for bit', () => {
  for (const workers of [2, 4]) assert.equal(countRuns.get(workers).hash, fixed, 'workers ' + workers)
})

gate('7 workers at 512 MiB is refused with the typed workers-do-not-fit error, not an abort', () => {
  const run = countRuns.get(7)
  assert.equal(run.refused, 'workers-do-not-fit')
  assert.equal(run.status, -8)
  assert.equal(run.workers, 7)
  assert.equal(run.players, 1024)
})

gate('8 workers at 512 MiB is refused with the typed workers-do-not-fit error, not an abort', () => {
  const run = countRuns.get(8)
  assert.equal(run.refused, 'workers-do-not-fit')
  assert.equal(run.status, -8)
  assert.equal(run.workers, 8)
  assert.equal(run.players, 1024)
})

gate('the 1024-tier state hash equals its pin in engine/state-hashes.json', () => {
  assert.ok(typeof pins[STATE_KEY] === 'string' && /^[0-9a-f]{8}$/.test(pins[STATE_KEY]), 'no pin for ' + STATE_KEY + '; run gen-engine-state-hash-1024')
  assert.equal(fixed, pins[STATE_KEY])
})

finish()
