import { closeSync, openSync, readSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { Worker, isMainThread, parentPort, workerData } from 'node:worker_threads'
import { fileURLToPath } from 'node:url'
import { emitResult } from './emit.mjs'

const GAP_MS = 1.5
const REFRESH_MS = 50
const MOST_GAPS = 4000
const FIELDS = 5
const SHOWN_GAPS = 600
const round = (value) => Number(value.toFixed(3))

const spin = (seconds) => {
  const fd = openSync('/proc/thread-self/schedstat', 'r')
  const bytes = Buffer.alloc(128)
  const stat = new Float64Array(2)
  const readStat = () => {
    const length = readSync(fd, bytes, 0, bytes.length, 0)
    let field = 0
    let value = 0
    for (let i = 0; i < length && field < 2; i++) {
      const code = bytes[i]
      if (code >= 48 && code <= 57) {
        value = value * 10 + (code - 48)
      } else {
        stat[field] = value
        field += 1
        value = 0
      }
    }
  }
  const gaps = new Float64Array(MOST_GAPS * FIELDS)
  let count = 0
  let widestMs = 0
  readStat()
  let runNs = stat[0]
  let waitNs = stat[1]
  const origin = performance.timeOrigin
  const started = performance.now()
  const until = started + seconds * 1000
  let last = started
  let refreshAt = started + REFRESH_MS
  for (;;) {
    const now = performance.now()
    if (now >= until) break
    const gap = now - last
    if (gap > GAP_MS) {
      readStat()
      if (count < MOST_GAPS) {
        const at = count * FIELDS
        gaps[at] = origin + last
        gaps[at + 1] = gap
        gaps[at + 2] = (stat[1] - waitNs) / 1e6
        gaps[at + 3] = (stat[0] - runNs) / 1e6
        gaps[at + 4] = now - (refreshAt - REFRESH_MS)
      }
      count += 1
      if (gap > widestMs) widestMs = gap
      runNs = stat[0]
      waitNs = stat[1]
      refreshAt = performance.now() + REFRESH_MS
      last = performance.now()
      continue
    }
    if (now >= refreshAt) {
      readStat()
      runNs = stat[0]
      waitNs = stat[1]
      refreshAt = now + REFRESH_MS
      last = performance.now()
      continue
    }
    last = now
  }
  closeSync(fd)
  const kept = Math.min(count, MOST_GAPS)
  return { count, widestMs, rows: Array.from({ length: kept }, (_, i) => Array.from(gaps.subarray(i * FIELDS, i * FIELDS + FIELDS))) }
}

if (!isMainThread) {
  parentPort.postMessage(spin(workerData.seconds))
} else {
  const [secondsArg = '45', threadsArg = '1'] = process.argv.slice(2)
  const seconds = Number(secondsArg)
  const threads = Number(threadsArg)
  if (!(seconds > 0) || !Number.isInteger(threads) || threads < 1) throw new RangeError('usage: canary.mjs <seconds> <threads>')
  const startedEpochMs = Date.now()
  const lanes = await Promise.all(Array.from({ length: threads }, () => new Promise((done, fail) => {
    const worker = new Worker(fileURLToPath(import.meta.url), { workerData: { seconds } })
    worker.once('message', done)
    worker.once('error', fail)
  })))
  const gaps = lanes.flatMap((lane, thread) => lane.rows.map(([epochMs, gapMs, runQueueMs, ranMs, windowMs]) => ({ thread, epochMs: Math.round(epochMs), gapMs: round(gapMs), runQueueMs: round(runQueueMs), ranMs: round(ranMs), windowMs: round(windowMs) }))).sort((a, b) => a.epochMs - b.epochMs)
  const widest = gaps.slice().sort((a, b) => b.gapMs - a.gapMs).slice(0, SHOWN_GAPS).sort((a, b) => a.epochMs - b.epochMs)
  const result = {
    kind: 'canary',
    threads,
    seconds,
    cpus: availableParallelism(),
    startedEpochMs,
    gapMs: GAP_MS,
    gapCount: lanes.reduce((sum, lane) => sum + lane.count, 0),
    over5Ms: gaps.filter((gap) => gap.gapMs > 5).length,
    over5MsUnseen: gaps.filter((gap) => gap.gapMs > 5 && gap.runQueueMs < 1).length,
    widestMs: round(Math.max(0, ...lanes.map((lane) => lane.widestMs))),
    gaps: widest,
  }
  emitResult(result)
}
