import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

export const GROWTH_LIMIT_BYTES = 64 * 1024
export const MIN_FRAMES = 600

export const judgeHeap = (witness) => {
  assert.equal(witness.warmed, true, 'the heap window must start after warm-up')
  assert.equal(witness.forcedGc, true, 'the heap samples must follow a forced garbage collection')
  assert.ok(witness.frames >= MIN_FRAMES, 'the window covers ' + witness.frames + ' frames, below ' + MIN_FRAMES)
  assert.ok(witness.retained && witness.retained.before && witness.retained.after, 'the window needs live object snapshots at both ends')
  const growth = witness.retained.after.bytes - witness.retained.before.bytes
  assert.ok(growth <= GROWTH_LIMIT_BYTES, 'live JS object bytes grew ' + growth + ' over the window, above ' + GROWTH_LIMIT_BYTES)
  return growth
}

const witnessWith = ({ before, after, frames = 600, warmed = true, forcedGc = true }) => ({
  warmed,
  forcedGc,
  frames,
  retained: { before: { bytes: before }, after: { bytes: after } },
  samples: [],
})

gate('flat live JS object bytes across 600 frames pass', () => {
  assert.equal(judgeHeap(witnessWith({ before: 1000000, after: 1005000 })), 5000)
})
gate('live JS object bytes that grow past the limit fail', () => {
  assert.throws(() => judgeHeap(witnessWith({ before: 1000000, after: 1000000 + GROWTH_LIMIT_BYTES + 1 })), /object bytes grew/)
})
gate('a window without a forced garbage collection is refused', () => {
  assert.throws(() => judgeHeap(witnessWith({ before: 1, after: 1, forcedGc: false })), /forced garbage collection/)
})
gate('a window that starts before warm-up is refused', () => {
  assert.throws(() => judgeHeap(witnessWith({ before: 1, after: 1, warmed: false })), /after warm-up/)
})
gate('a window shorter than 600 frames is refused', () => {
  assert.throws(() => judgeHeap(witnessWith({ before: 1, after: 1, frames: 599 })), /below 600/)
})
gate('a window without object snapshots is refused', () => {
  assert.throws(() => judgeHeap({ warmed: true, forcedGc: true, frames: 600, samples: [] }), /object snapshots/)
})
process.argv.slice(2).forEach((path) => {
  gate('witness ' + path + ' keeps live JS object bytes flat', () => {
    judgeHeap(JSON.parse(readFileSync(path, 'utf8')))
  })
})
finish()
