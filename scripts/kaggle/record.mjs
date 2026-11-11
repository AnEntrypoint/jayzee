import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_REF } from './plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const [resultsPath, pushedAt, version] = process.argv.slice(2)
if (!resultsPath || !pushedAt || !version) throw new TypeError('usage: record.mjs <results.json> <pushed-at ISO time> <kernel version>')
const results = JSON.parse(readFileSync(resolve(resultsPath), 'utf8'))
const pushedEpochS = Date.parse(pushedAt) / 1000
if (!Number.isFinite(pushedEpochS)) throw new RangeError('pushed-at is not a time: ' + pushedAt)

const ticks = results.configs.filter((c) => c.kind === 'tick')
const refused = results.configs.filter((c) => c.refused)
const failed = results.configs.filter((c) => c.error)
const marbles = results.configs.filter((c) => c.kind === 'marble-bowl')
const matrix = ticks.filter((c) => c.nodeFlags.length === 0 && c.args.length === 5)
const probes = ticks.filter((c) => !matrix.includes(c))
const holds = (c) => c.p99Ms <= results.budgetMs && c.overBudget === 0
const cell = (value) => (value === null || value === undefined ? '' : String(value))

const goalpost = (glue) => {
  const holding = matrix.filter((c) => c.glue === glue && holds(c))
  if (holding.length === 0) return null
  const bodies = Math.max(...holding.map((c) => c.bodies))
  return { bodies, workers: holding.filter((c) => c.bodies === bodies).map((c) => c.workers) }
}
const steadyGoalpost = (glue) => {
  const holding = matrix.filter((c) => c.glue === glue && c.steadyP99Ms <= results.budgetMs && c.steadyOverBudget === 0)
  if (holding.length === 0) return null
  const bodies = Math.max(...holding.map((c) => c.bodies))
  return { bodies, workers: holding.filter((c) => c.bodies === bodies).map((c) => c.workers) }
}

const tickRow = (c) => '| ' + [c.glue.replace('engine-core-', '').replace('.mjs', '') + (c.scene === 'planet' ? '' : ', ' + c.scene + ' scene'), c.bodies, c.workers, c.iterations, c.nodeFlags.join(' '), c.medianMs, c.p99Ms, c.maxMs, c.overBudget, c.bootTicksMs.join(' / '), c.settleP99Ms, c.settleMaxMs, c.settleOverBudget, c.steadyMedianMs, c.steadyP99Ms, c.steadyOverBudget, c.arenaUsedBytes, c.arenaBytes, c.runS].map(cell).join(' | ') + ' |'
const tickHead = ['| glue | bodies | workers | solver iterations | node flags | median ms | p99 ms | max ms | ticks over budget | ticks 0 and 1 ms | settle p99 ms | settle max ms | settle over budget | steady median ms | steady p99 ms | steady over budget | arena used bytes | arena bytes | run s |', '|' + '---|'.repeat(19)]

const glues = [...new Set(matrix.map((c) => c.glue))]
const lines = [
  '## Kaggle physics run',
  '',
  'Written by `node scripts/kaggle/record.mjs` from one `kaggle kernels output` read of `' + KERNEL_REF + '` version ' + version + '. One JSON result per configuration; the table is that file.',
  '',
  '- Budget: ' + results.budgetMs + ' ms per tick, ' + results.ticks + ' ticks per configuration. Ticks 0 and 1 are the boot ticks, ticks 2 to 299 the settle window, and ticks from 300 the steady window. The timed call is the whole worker tick: page streaming, follow, `engine_tick` and the pose export.',
  '- Arena plan: 1024 players under a ' + results.arenaBudgetBytes + ' byte budget.',
  '- Machine: ' + results.cpuModel + ', ' + results.nproc + ' CPUs, Node ' + results.node + '.',
  '- Pushed ' + pushedAt + '. Queue wait ' + (results.startedAtEpochS - pushedEpochS).toFixed(0) + ' s from the push to the first line of the script. Run time ' + results.totalS + ' s for ' + results.configs.length + ' of ' + results.plannedRuns + ' planned runs.',
  ...glues.map((glue) => {
    const whole = goalpost(glue)
    const steady = steadyGoalpost(glue)
    return '- ' + glue + ': ' + (whole ? whole.bodies + ' bodies hold the budget at p99 with zero ticks over budget (workers ' + whole.workers.join(', ') + ')' : 'no body count holds the budget at p99 with zero ticks over budget') + '; in the steady window alone ' + (steady ? steady.bodies + ' bodies hold it (workers ' + steady.workers.join(', ') + ')' : 'none holds it') + '.'
  }),
  '- Refused by the arena plan: ' + (refused.length ? [...new Set(refused.map((c) => c.workers + ' workers (' + c.refused + ')'))].join(', ') : 'none') + '.',
  '- Runs that gave no result: ' + (failed.length ? failed.map((c) => c.args.join(' ') + ' (' + c.error + ')').join('; ') : 'none') + '.',
  '',
  ...tickHead,
  ...matrix.filter((c) => !c.refused).map(tickRow),
  '',
  'Probes on one configuration:',
  '',
  ...tickHead,
  ...probes.filter((c) => !c.refused).map(tickRow),
  '',
  'Marble bowl (' + cell(marbles[0]?.bodies) + ' marbles, ' + cell(marbles[0]?.ticks) + ' ticks, ' + cell(marbles[0]?.runs) + ' runs per tier), the timing claim that left `check:scenario-marble-bowl`:',
  '',
  '| tier | workers | p99 ms | max ms | ticks over ' + results.budgetMs + ' ms | ticks over 25 ms | run s |',
  '|---|---|---|---|---|---|---|',
  ...marbles.map((c) => '| ' + [c.tier, c.workers, c.p99Ms, c.maxMs, c.overBudget, c.over25, c.runS].map(cell).join(' | ') + ' |'),
]
writeFileSync(join(here, 'record.md'), lines.join('\n') + '\n')
console.log(lines.slice(4, 12 + glues.length).join('\n'))
