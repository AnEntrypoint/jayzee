import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { coverSteps, stubPhysics, analyticHeight, RESOLUTION, EXTENT } from './streamer-spoint-p99.mjs'

const N = Math.round(EXTENT / RESOLUTION)
const logBefore = console.log

gate('one point builds one field whose samples are finite and sampled from the height function', async () => {
  const run = await coverSteps([[0, 0, 0]])
  assert.equal(run.builds, 1)
  assert.equal(run.bodiesAtEnd, 1)
  const [body] = run.physics.bodies.values()
  assert.equal(body.N, N + (N % 2))
  assert.equal(body.samples.length, body.N * body.N)
  assert.ok(Array.from(body.samples).every(Number.isFinite), 'every sample is finite')
  assert.ok(Math.abs(body.samples[0] - analyticHeight(body.origin[0], body.origin[2])) < 1e-3, 'sample 0 is the height at the field corner')
})

gate('a point inside an existing field builds nothing, and a far point builds a second field', async () => {
  const run = await coverSteps([[0, 0, 0], [1, 0, 1], [1000, 0, 0]])
  assert.equal(run.builds, 2)
  assert.equal(run.bodiesAtEnd, 2)
})

gate('a wasm heap with no free room refuses every build without an error', async () => {
  const run = await coverSteps([[0, 0, 0], [1000, 0, 0]], { physics: stubPhysics({ heapFreeBytes: 0 }) })
  assert.equal(run.builds, 0)
  assert.equal(run.bodiesAtEnd, 0)
  assert.equal(run.lastError, null)
})

gate('one step is timed per path point, and each is finite and not negative', async () => {
  const path = [[0, 0, 0], [1, 0, 1], [1000, 0, 0], [1005, 0, 5]]
  const run = await coverSteps(path)
  assert.equal(run.steps.length, path.length)
  for (const ms of run.steps) assert.ok(Number.isFinite(ms) && ms >= 0, 'step ' + ms)
})

gate('the streamer console output is counted and console is restored afterwards', async () => {
  const run = await coverSteps([[0, 0, 0], [1000, 0, 0]])
  assert.ok(run.consoleLines.log >= run.builds, 'one log line per build at least')
  assert.equal(console.log, logBefore)
})

finish()
