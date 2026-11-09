import { readFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'

export const GROWTH_LIMIT_BYTES = 64 * 1024
export const MIN_FRAMES = 600
export const CODE_GROWTH_LIMIT_BYTES = 64 * 1024
export const MIN_CODE_TAIL_FRAMES = 3000

export const judgeHeap = (witness) => {
  assert.equal(witness.warmed, true, 'the heap window must start after warm-up')
  assert.equal(witness.forcedGc, true, 'the heap samples must follow a forced garbage collection')
  assert.ok(witness.frames >= MIN_FRAMES, 'the window covers ' + witness.frames + ' frames, below ' + MIN_FRAMES)
  assert.ok(witness.retained && witness.retained.before && witness.retained.after, 'the window needs live object snapshots at both ends')
  const growth = witness.retained.after.bytes - witness.retained.before.bytes
  assert.ok(growth <= GROWTH_LIMIT_BYTES, 'live JS object bytes grew ' + growth + ' over the window, above ' + GROWTH_LIMIT_BYTES)
  return growth
}

export const judgeCode = (witness) => {
  const points = witness.checkpoints
  assert.ok(Array.isArray(points) && points.length >= 3, 'the code bound needs at least three checkpoints')
  assert.ok(points.every((point) => Number.isFinite(point.frames) && Number.isFinite(point.codeBytes)), 'every checkpoint needs frames and codeBytes')
  const last = points[points.length - 1]
  const tailStart = points.slice(0, -1).reverse().find((point) => last.frames - point.frames >= MIN_CODE_TAIL_FRAMES)
  assert.ok(tailStart, 'no checkpoint lies ' + MIN_CODE_TAIL_FRAMES + ' frames before the last one at frame ' + last.frames)
  const growth = last.codeBytes - tailStart.codeBytes
  assert.ok(growth <= CODE_GROWTH_LIMIT_BYTES, 'compiled code grew ' + growth + ' bytes from frame ' + tailStart.frames + ' to frame ' + last.frames + ', above ' + CODE_GROWTH_LIMIT_BYTES)
  return growth
}

const codeWitness = (points) => ({ checkpoints: points.map(([frames, codeBytes]) => ({ frames, codeBytes })) })

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
gate('compiled code that stops growing over the last 3000 frames passes, whatever it grew before', () => {
  assert.equal(judgeCode(codeWitness([[0, 2000000], [600, 2300000], [3000, 2310000], [6000, 2312000]])), 2000)
})
gate('compiled code that keeps growing over the last 3000 frames fails', () => {
  assert.throws(() => judgeCode(codeWitness([[0, 2000000], [600, 2300000], [3000, 2600000], [6000, 2900000]])), /compiled code grew 300000/)
})
gate('a code window with no checkpoint 3000 frames before its end is refused', () => {
  assert.throws(() => judgeCode(codeWitness([[0, 1], [300, 1], [600, 1]])), /3000 frames before/)
})
gate('a code window with fewer than three checkpoints or a missing codeBytes is refused', () => {
  assert.throws(() => judgeCode(codeWitness([[0, 1], [6000, 1]])), /three checkpoints/)
  assert.throws(() => judgeCode({ checkpoints: [{ frames: 0 }, { frames: 3000 }, { frames: 6000 }] }), /frames and codeBytes/)
})
process.argv.slice(2).forEach((path) => {
  gate('witness ' + path + ' keeps live JS object bytes flat', () => {
    judgeHeap(JSON.parse(readFileSync(path, 'utf8')))
  })
  if (JSON.parse(readFileSync(path, 'utf8')).checkpoints) {
    gate('witness ' + path + ' keeps compiled code bounded over its last ' + MIN_CODE_TAIL_FRAMES + ' frames', () => {
      judgeCode(JSON.parse(readFileSync(path, 'utf8')))
    })
  }
})
finish()
