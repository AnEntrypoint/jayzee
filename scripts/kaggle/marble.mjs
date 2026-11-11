import { availableParallelism } from 'node:os'
import { createTickTimer, summariseTicks, FRAME_BUDGET_MS, SPIKE_MS } from '../lib/tickTrace.mjs'
import { SCENARIO_TIERS } from '../lib/scenarioTiers.mjs'
import { MARBLE_BOWL, buildMarbleBowl } from '../lib/scenarioWorlds.mjs'

const RUNS = 2
const tier = SCENARIO_TIERS[Number(process.argv[2])]

const timedRun = async () => {
  const { world } = await buildMarbleBowl(tier)
  const timer = createTickTimer()
  for (let t = 0; t < MARBLE_BOWL.ticks; t++) {
    timer.start()
    world.step()
    timer.stop()
  }
  return summariseTicks(timer.tickMs)
}

const runs = []
for (let r = 0; r < RUNS; r++) runs.push(await timedRun())
const round = (ms) => Number(ms.toFixed(3))
console.log('RESULT ' + JSON.stringify({
  kind: 'marble-bowl',
  tier: tier.label,
  glue: tier.glue.split('/').pop(),
  workers: tier.workers,
  bodies: MARBLE_BOWL.bodies,
  ticks: MARBLE_BOWL.ticks,
  runs: RUNS,
  budgetMs: FRAME_BUDGET_MS,
  spikeMs: SPIKE_MS,
  cpus: availableParallelism(),
  p99Ms: round(Math.max(...runs.map((run) => run.p99Ms))),
  maxMs: round(Math.max(...runs.map((run) => run.maxMs))),
  overBudget: runs.reduce((n, run) => n + run.overBudget + (run.noValidWindow ? 0 : run.hostThrottledOverBudget), 0),
  over25: runs.reduce((n, run) => n + run.over25, 0),
  hostThrottledOverBudget: runs.reduce((n, run) => n + run.hostThrottledOverBudget, 0),
  overBudgetTicks: runs.flatMap((run, r) => run.overBudgetTicks.map((t) => ({ run: r, tick: t.tick, ms: t.ms }))).slice(0, 24),
}))
