import { mkdirSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const FRAME_BUDGET_MS = 16.7
export const SPIKE_MS = 25

const TRACE_DIR = new URL('../../build/diag/scenarios/', import.meta.url)

export const summariseTicks = (tickMs) => {
  const sorted = Float64Array.from(tickMs).sort()
  return {
    ticks: tickMs.length,
    maxMs: sorted[sorted.length - 1],
    p99Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99))],
    overBudget: tickMs.filter((ms) => ms > FRAME_BUDGET_MS).length,
    over25: tickMs.filter((ms) => ms > SPIKE_MS).length,
  }
}

export const writeTickTrace = (scenario, label, runs) => {
  mkdirSync(TRACE_DIR, { recursive: true })
  const summaries = runs.map((tickMs) => summariseTicks(tickMs))
  const file = fileURLToPath(new URL(`${scenario}-${label.replace(/[^a-z0-9]+/gi, '-')}.json`, TRACE_DIR))
  writeFileSync(file, JSON.stringify({ scenario, label, budgetMs: FRAME_BUDGET_MS, spikeMs: SPIKE_MS, runs: runs.map((tickMs, i) => ({ ...summaries[i], tickMs: Array.from(tickMs, (ms) => Math.round(ms * 1000) / 1000) })) }) + '\n')
  return {
    overBudget: summaries.reduce((n, s) => n + s.overBudget, 0),
    over25: summaries.reduce((n, s) => n + s.over25, 0),
    maxMs: Math.max(...summaries.map((s) => s.maxMs)),
    file,
  }
}
