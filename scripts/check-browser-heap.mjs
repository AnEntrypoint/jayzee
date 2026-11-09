import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

export const GROWTH_LIMIT_BYTES = 64 * 1024
export const MIN_FRAMES = 600

export const judgeHeap = (witness) => {
  assert.equal(witness.warmed, true, 'the heap window must start after warm-up')
  assert.equal(witness.forcedGc, true, 'the heap samples must follow a forced garbage collection')
  assert.ok(witness.frames >= MIN_FRAMES, 'the window covers ' + witness.frames + ' frames, below ' + MIN_FRAMES)
  assert.ok(Array.isArray(witness.samples) && witness.samples.length >= 3, 'at least three heap samples are needed')
  const first = witness.samples[0].usedBytes
  const last = witness.samples[witness.samples.length - 1].usedBytes
  const growth = last - first
  assert.ok(growth <= GROWTH_LIMIT_BYTES, 'JS heap grew ' + growth + ' bytes over the window, above ' + GROWTH_LIMIT_BYTES)
  return growth
}

gate('a flat JS heap across 600 frames passes', () => {
  const samples = [{ usedBytes: 1000000 }, { usedBytes: 1010000 }, { usedBytes: 1005000 }]
  assert.equal(judgeHeap({ warmed: true, forcedGc: true, frames: 600, samples }), 5000)
})
gate('a JS heap that grows past the limit fails', () => {
  const samples = [{ usedBytes: 1000000 }, { usedBytes: 1000000 + GROWTH_LIMIT_BYTES + 1 }, { usedBytes: 1000000 + 2 * GROWTH_LIMIT_BYTES }]
  assert.throws(() => judgeHeap({ warmed: true, forcedGc: true, frames: 600, samples }), /heap grew/)
})
gate('samples without a forced garbage collection are refused', () => {
  const samples = [{ usedBytes: 1 }, { usedBytes: 1 }, { usedBytes: 1 }]
  assert.throws(() => judgeHeap({ warmed: true, forcedGc: false, frames: 600, samples }), /forced garbage collection/)
})
gate('a window that starts before warm-up is refused', () => {
  const samples = [{ usedBytes: 1 }, { usedBytes: 1 }, { usedBytes: 1 }]
  assert.throws(() => judgeHeap({ warmed: false, forcedGc: true, frames: 600, samples }), /after warm-up/)
})
gate('a window shorter than 600 frames is refused', () => {
  const samples = [{ usedBytes: 1 }, { usedBytes: 1 }, { usedBytes: 1 }]
  assert.throws(() => judgeHeap({ warmed: true, forcedGc: true, frames: 599, samples }), /below 600/)
})
process.argv.slice(2).forEach((path) => {
  gate('witness ' + path + ' keeps the JS heap flat', () => {
    judgeHeap(JSON.parse(readFileSync(path, 'utf8')))
  })
})
finish()
