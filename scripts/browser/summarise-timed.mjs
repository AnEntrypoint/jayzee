import { readFileSync } from 'node:fs'
import { basename } from 'node:path'

const percentile = (values, q) => {
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}

const median = (values) => {
  const sorted = values.slice().sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

const correlation = (xs, ys) => {
  const n = xs.length
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my)
    sxx += (xs[i] - mx) ** 2
    syy += (ys[i] - my) ** 2
  }
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy)
}

export function summarise(path, result) {
  const columns = result.rowColumns
  const rows = result.rows
  const col = (name) => columns.indexOf(name)
  const physics = rows.map((row) => row[col('physics')])
  const renderPrev = rows.slice(0, -1).map((row) => row[col('renderMs')])
  const physicsNext = physics.slice(1)
  const load = result.load
  return {
    file: basename(path),
    backend: result.backend,
    median: result.frameTimeMedianMs,
    p99: result.frameTimeP99Ms,
    max: result.frameTimeMaxMs,
    tickMedian: result.tickMedianMs,
    physicsMedian: median(physics),
    physicsP99: percentile(physics, 0.99),
    planMedian: result.phaseMedianMs.plan ?? null,
    backendMedian: result.phaseMedianMs.backend ?? null,
    readbackMedian: result.phaseMedianMs.readback,
    outliers: result.outliers.length,
    apiCalls: result.apiCallsPerFrame,
    checksum: result.checksum,
    visible: result.visible.join(','),
    allocations: result.allocationsSinceWarmup,
    ok: result.ok,
    loadBefore: load ? load.before.loadavg[0] : null,
    loadAfter: load ? load.after.loadavg[0] : null,
    runnableBefore: load ? load.before.runnable : null,
    runnableAfter: load ? load.after.runnable : null,
    corrPhysicsVsPrevRender: correlation(physicsNext, renderPrev),
  }
}

if (process.argv[1] && process.argv[1].endsWith('summarise-timed.mjs')) {
  const files = process.argv.slice(2)
  const summaries = files.map((file) => summarise(file, JSON.parse(readFileSync(file, 'utf8'))))
  console.log(JSON.stringify(summaries, null, 2))
}
