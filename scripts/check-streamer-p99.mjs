import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { flightPath, percentile, streamerSteps } from './streamer-p99.mjs'

gate('percentile returns the nearest-rank value and refuses an empty list or a q outside 0 to 1', () => {
  const hundred = Array.from({ length: 100 }, (_, i) => i + 1)
  assert.equal(percentile(hundred, 0.99), 99)
  assert.equal(percentile(hundred, 0.5), 50)
  assert.equal(percentile(hundred, 1), 100)
  assert.equal(percentile([7], 0.99), 7)
  assert.throws(() => percentile([], 0.5), RangeError)
  assert.throws(() => percentile([1, 2], 1.5), RangeError)
})

gate('the flight path is the same on every build: two 200-tick flights give identical positions', async () => {
  const a = await flightPath(200)
  const b = await flightPath(200)
  assert.equal(a.length, 200)
  assert.deepEqual(a, b)
})

gate('the streamer step runs once per path point and every step time is finite and not negative', async () => {
  const path = await flightPath(300)
  const { steps } = await streamerSteps(path)
  assert.equal(steps.length, path.length)
  assert.ok(steps.every((s) => Number.isFinite(s) && s >= 0))
})

finish()
