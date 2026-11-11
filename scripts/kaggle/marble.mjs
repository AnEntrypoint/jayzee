import { availableParallelism } from 'node:os'
import { createTickTimer, summariseTicks, FRAME_BUDGET_MS, SPIKE_MS } from '../lib/tickTrace.mjs'
import { SCENARIO_TIERS } from '../lib/scenarioTiers.mjs'
import { MARBLE_BOWL, buildMarbleBowl } from '../lib/scenarioWorlds.mjs'

const tier = SCENARIO_TIERS[Number(process.argv[2])]
const RUNS = Number(process.argv[3])
const WARM_RUNS = Number(process.argv[4] ?? '0')

const run = async (timed) => {
  const { world } = await buildMarbleBowl(tier)
  const timer = createTickTimer()
  for (let t = 0; t < MARBLE_BOWL.ticks; t++) {
    timer.start()
    world.step()
    timer.stop()
  }
  return timed ? timer.tickMs : null
}

const round = (ms) => Number(ms.toFixed(3))
for (let r = 0; r < WARM_RUNS; r++) await run(false)
const perRun = []
for (let r = 0; r < RUNS; r++) {
  const tickMs = await run(true)
  const summary = summariseTicks(tickMs)
  const sorted = Float64Array.from(tickMs).sort()
  const overTicks = []
  tickMs.forEach((ms, tick) => {
    if (ms > FRAME_BUDGET_MS) overTicks.push([tick, round(ms)])
  })
  perRun.push({ medianMs: round(sorted[Math.floor(sorted.length / 2)]), p99Ms: round(summary.p99Ms), maxMs: round(summary.maxMs), overBudget: overTicks.length, over25: overTicks.filter((t) => t[1] > SPIKE_MS).length, overTicks: overTicks.slice(0, 12) })
}
console.log('RESULT ' + JSON.stringify({
  kind: 'marble-bowl',
  tier: tier.label,
  glue: tier.glue.split('/').pop(),
  workers: tier.workers,
  bodies: MARBLE_BOWL.bodies,
  ticks: MARBLE_BOWL.ticks,
  runs: RUNS,
  warmRuns: WARM_RUNS,
  budgetMs: FRAME_BUDGET_MS,
  spikeMs: SPIKE_MS,
  cpus: availableParallelism(),
  p99Ms: Math.max(...perRun.map((r) => r.p99Ms)),
  maxMs: Math.max(...perRun.map((r) => r.maxMs)),
  overBudget: perRun.reduce((n, r) => n + r.overBudget, 0),
  over25: perRun.reduce((n, r) => n + r.over25, 0),
  perRun,
}))
