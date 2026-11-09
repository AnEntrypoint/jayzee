import { readFileSync } from 'node:fs'

export function parseThrottleLog(text) {
  return String(text).split('\n').filter((line) => line !== '').map((line) => {
    const [t, throttledUs, usageUs] = line.split(' ').map(Number)
    if (![t, throttledUs, usageUs].every(Number.isFinite)) throw new TypeError('throttle line is not three numbers: ' + line)
    return { t, throttledUs, usageUs }
  })
}

function throttledUsAt(samples, t) {
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  if (b.t === a.t) return a.throttledUs
  return a.throttledUs + ((t - a.t) / (b.t - a.t)) * (b.throttledUs - a.throttledUs)
}

export function throttledMs(samples, startMs, endMs) {
  if (samples.length < 2 || !(endMs > startMs)) return null
  if (startMs < samples[0].t || endMs > samples[samples.length - 1].t) return null
  return (throttledUsAt(samples, endMs) - throttledUsAt(samples, startMs)) / 1000
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function attributeStalls(frames, samples, { factor = 1.5, share = 0.5 } = {}) {
  const base = median(frames.map((f) => f.totalMs))
  const stalls = []
  for (const f of frames) {
    if (!(f.totalMs > factor * base)) continue
    const excessMs = f.totalMs - base
    const throttled = throttledMs(samples, f.startMs, f.startMs + f.totalMs)
    const verdict = throttled === null ? 'uncovered' : throttled >= share * excessMs ? 'throttled' : 'unexplained'
    stalls.push({ frame: f.frame, startMs: f.startMs, totalMs: f.totalMs, excessMs, throttledMs: throttled, verdict })
  }
  const normal = frames.filter((f) => !(f.totalMs > factor * base))
  const normalThrottled = normal.map((f) => throttledMs(samples, f.startMs, f.startMs + f.totalMs)).filter((v) => v !== null)
  const counts = { throttled: 0, unexplained: 0, uncovered: 0 }
  for (const s of stalls) counts[s.verdict] += 1
  return {
    medianMs: base,
    stallCount: stalls.length,
    counts,
    normalThrottledMeanMs: normalThrottled.length ? normalThrottled.reduce((a, b) => a + b, 0) / normalThrottled.length : null,
    stalls,
  }
}

export function framesFromResult(result) {
  const columns = result.rowColumns
  const at = (name) => columns.indexOf(name)
  return result.rows.map((row) => {
    const tick = row[at('tickMs')]
    const render = row[at('renderMs')]
    return { frame: row[at('frame')], startMs: row[at('startMs')], totalMs: tick + render }
  })
}

if (process.argv[1] && process.argv[1].endsWith('/browser/stall-attribution.mjs')) {
  const [resultFile, throttleFile] = process.argv.slice(2)
  const result = JSON.parse(readFileSync(resultFile, 'utf8'))
  const samples = parseThrottleLog(readFileSync(throttleFile, 'utf8'))
  console.log(JSON.stringify(attributeStalls(framesFromResult(result), samples), null, 2))
}
