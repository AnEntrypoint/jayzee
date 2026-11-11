import { availableParallelism } from 'node:os'
import { createTickTimer, summariseTicks, FRAME_BUDGET_MS, SPIKE_MS, TICK_CLOCK_SOURCE } from '../lib/tickTrace.mjs'
import { SCENARIO_TIERS } from '../lib/scenarioTiers.mjs'
import { MARBLE_BOWL, buildMarbleBowl } from '../lib/scenarioWorlds.mjs'
import { repeatedSpikes } from './spikes.mjs'

const tier = SCENARIO_TIERS[Number(process.argv[2])]
const RUNS = Number(process.argv[3])
const WARM_RUNS = Number(process.argv[4] ?? '0')
const SHOWN_TICKS = 12

const round = (ms) => Number(ms.toFixed(3))
const timedRun = async () => {
  const { world } = await buildMarbleBowl(tier)
  const timer = createTickTimer()
  for (let t = 0; t < MARBLE_BOWL.ticks; t++) {
    timer.start()
    world.step()
    timer.stop()
  }
  const wall = timer.tickMs
  const summary = summariseTicks(wall)
  const wallOverTicks = []
  wall.forEach((ms, tick) => {
    if (ms > FRAME_BUDGET_MS) wallOverTicks.push({ tick, wallMs: round(ms), cpuMs: wall.cpuMs ? round(wall.cpuMs[tick]) : null, waitMs: wall.waitMs ? round(wall.waitMs[tick]) : null })
  })
  const spikesOf = (values) => Array.from(values, (ms, tick) => (ms > SPIKE_MS ? tick : -1)).filter((tick) => tick >= 0)
  return {
    cpuSpikeTicks: spikesOf(wall.cpuMs ?? wall),
    wallSpikeTicks: spikesOf(wall),
    clock: summary.clock,
    cpuP99Ms: round(summary.p99Ms),
    cpuMaxMs: round(summary.maxMs),
    cpuOverBudget: summary.overBudget + (summary.noValidWindow ? 0 : summary.hostThrottledOverBudget),
    cpuOver25: summary.over25,
    wallP99Ms: round(summary.wallP99Ms),
    wallMaxMs: round(summary.wallMaxMs),
    wallOverBudget: summary.wallOverBudget,
    wallOver25: wall.reduce((n, ms) => n + (ms > SPIKE_MS ? 1 : 0), 0),
    waitTotalMs: summary.waitTotalMs === null ? null : round(summary.waitTotalMs),
    wallOverTicks: wallOverTicks.slice(0, SHOWN_TICKS),
  }
}

for (let r = 0; r < WARM_RUNS; r++) await timedRun()
const perRun = []
for (let r = 0; r < RUNS; r++) perRun.push(await timedRun())
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
  clockSource: TICK_CLOCK_SOURCE,
  cpus: availableParallelism(),
  cpuP99Ms: Math.max(...perRun.map((r) => r.cpuP99Ms)),
  cpuMaxMs: Math.max(...perRun.map((r) => r.cpuMaxMs)),
  cpuOverBudget: perRun.reduce((n, r) => n + r.cpuOverBudget, 0),
  cpuOver25: perRun.reduce((n, r) => n + r.cpuOver25, 0),
  cpuOver25Repeated: repeatedSpikes(perRun.map((r) => r.cpuSpikeTicks)).length,
  wallOver25Repeated: repeatedSpikes(perRun.map((r) => r.wallSpikeTicks)).length,
  wallP99Ms: Math.max(...perRun.map((r) => r.wallP99Ms)),
  wallMaxMs: Math.max(...perRun.map((r) => r.wallMaxMs)),
  wallOverBudget: perRun.reduce((n, r) => n + r.wallOverBudget, 0),
  wallOver25: perRun.reduce((n, r) => n + r.wallOver25, 0),
  perRun,
}))
