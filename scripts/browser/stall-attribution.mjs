import { readFileSync } from 'node:fs'

export function parseThrottleLog(text) {
  return String(text).split('\n').filter((line) => line !== '').map((line) => {
    const [t, throttledUs, usageUs, someUs, fullUs] = line.split(' ').map(Number)
    if (![t, throttledUs, usageUs, someUs, fullUs].every(Number.isFinite)) throw new TypeError('throttle line is not five numbers: ' + line)
    return { t, throttledUs, usageUs, someUs, fullUs }
  })
}

function usAt(samples, key, t) {
  let lo = 0
  let hi = samples.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (samples[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = samples[lo]
  const b = samples[hi]
  if (b.t === a.t) return a[key]
  return a[key] + ((t - a.t) / (b.t - a.t)) * (b[key] - a[key])
}

export function pressureMsBetween(samples, key, startMs, endMs) {
  if (samples.length < 2 || !(endMs > startMs)) return null
  if (startMs < samples[0].t || endMs > samples[samples.length - 1].t) return null
  return (usAt(samples, key, endMs) - usAt(samples, key, startMs)) / 1000
}

export function starvedMs(samples, startMs, endMs) {
  return pressureMsBetween(samples, 'fullUs', startMs, endMs)
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function attributeStalls(frames, samples, { factor = 1.5, share = 0.5, baseMs = null } = {}) {
  const base = baseMs ?? median(frames.map((f) => f.totalMs))
  const stalls = []
  for (const f of frames) {
    if (!(f.totalMs > factor * base)) continue
    const excessMs = f.totalMs - base
    const starved = starvedMs(samples, f.startMs, f.startMs + f.totalMs)
    const verdict = starved === null ? 'uncovered' : starved >= share * excessMs ? 'starved' : 'unexplained'
    stalls.push({ frame: f.frame, startMs: f.startMs, totalMs: f.totalMs, excessMs, starvedMs: starved, verdict })
  }
  const normal = frames.filter((f) => !(f.totalMs > factor * base))
  const normalStarved = normal.map((f) => starvedMs(samples, f.startMs, f.startMs + f.totalMs)).filter((v) => v !== null)
  const counts = { starved: 0, unexplained: 0, uncovered: 0 }
  for (const s of stalls) counts[s.verdict] += 1
  return {
    medianMs: base,
    stallCount: stalls.length,
    counts,
    normalStarvedMeanMs: normalStarved.length ? normalStarved.reduce((a, b) => a + b, 0) / normalStarved.length : null,
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
