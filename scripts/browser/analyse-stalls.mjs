import { readFileSync } from 'node:fs'

const [resultFile, logFile] = process.argv.slice(2)
const run = JSON.parse(readFileSync(resultFile, 'utf8'))
const CLOCK_TICK_MS = 10
const events = []
const last = new Map()

for (const line of readFileSync(logFile, 'utf8').split('\n')) {
  if (line === '') continue
  const parts = line.split(' ')
  const ts = Number(parts[0])
  const type = parts[2]
  const tid = parts[3]
  const jiffies = Number(parts[4])
  const comm = parts.slice(5).join(' ')
  const prev = last.get(tid)
  last.set(tid, jiffies)
  if (prev === undefined || jiffies <= prev) continue
  events.push({ ts, key: type + ':' + comm, ms: (jiffies - prev) * CLOCK_TICK_MS })
}

const top = (sums, count) => [...sums].sort((a, b) => b[1] - a[1]).slice(0, count).map(([key, ms]) => ({ key, cpuMs: Math.round(ms) }))
const runSums = new Map()
for (const e of events) runSums.set(e.key, (runSums.get(e.key) ?? 0) + e.ms)

const cpuWithin = (startMs, endMs) => {
  const sums = new Map()
  for (const e of events) {
    if (e.ts > startMs && e.ts <= endMs) sums.set(e.key, (sums.get(e.key) ?? 0) + e.ms)
  }
  return top(sums, 8)
}

const outliers = (run.outliers ?? []).map((o) => ({
  frame: o.frame,
  wallMs: o.wallMs,
  totalMs: o.totalMs,
  tickMs: o.tickMs,
  renderMs: o.renderMs,
  gapMs: o.gapMs,
  phasesMs: o.phasesMs,
  cpuInFrame: cpuWithin(o.wallMs, o.wallMs + o.totalMs),
}))

console.log(JSON.stringify({
  backend: run.backend,
  adapter: run.adapter,
  frameMedianMs: run.frameTimeMedianMs,
  frameP99Ms: run.frameTimeP99Ms,
  frameMaxMs: run.frameTimeMaxMs,
  outlierThresholdMs: run.outlierThresholdMs,
  tickMedianMs: run.tickMedianMs,
  phaseMedianMs: run.phaseMedianMs,
  phaseMaxMs: run.phaseMaxMs,
  outlierCount: outliers.length,
  cpuTopRun: top(runSums, 12),
  outliers,
}, null, 1))
