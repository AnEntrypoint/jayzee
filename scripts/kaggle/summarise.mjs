import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const sourceOf = (row) => (row.variant === 'base' ? 'candidate' : row.variant === 'reference' ? 'reference ' + String(row.args?.[0] ?? '').split('/')[2] : row.variant)

export const configurations = (results) => {
  const groups = new Map()
  for (const row of results.configs) {
    const key = JSON.stringify([row.script, row.args, row.nodeFlags])
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }
  return [...groups.values()].map((rows) => {
    const ticks = rows.filter((row) => row.kind === 'tick' && !row.refused && !row.error)
    if (ticks.length === 0) return { kind: rows[0].kind ?? 'failed', repeats: rows.length, script: rows[0].script, args: rows[0].args, results: rows.map((row) => row.refused ?? row.error ?? row.tier ?? row.kind) }
    const first = ticks[0]
    const unmarked = ticks.flatMap((row) => (row.overTicks ?? []).filter((tick) => tick.host === false))
    return {
      kind: 'tick',
      source: sourceOf(first),
      role: first.role ?? (first.probe ? 'probe' : 'matrix'),
      bodies: first.bodies,
      workers: first.workers,
      warm: first.warm,
      knobs: first.knobs,
      awakeBudget: first.awakeBudget ?? null,
      nodeFlags: first.nodeFlags ?? [],
      repeats: ticks.length,
      activeMeanMedianMs: median(ticks.map((row) => row.activeMeanMs ?? 0)),
      p99MedianMs: median(ticks.map((row) => row.p99Ms)),
      p99WorstMs: Math.max(...ticks.map((row) => row.p99Ms)),
      p99QuietMedianMs: ticks.every((row) => Number.isFinite(row.p99QuietMs)) ? median(ticks.map((row) => row.p99QuietMs)) : null,
      maxWorstMs: Math.max(...ticks.map((row) => row.maxMs)),
      headroomAtWorstTickMs: Number((first.budgetMs - Math.max(...ticks.map((row) => row.maxMs))).toFixed(3)),
      overBudgetEach: ticks.map((row) => row.overBudget),
      overBudgetHostEach: ticks.map((row) => row.overBudgetHost ?? null),
      unmarkedOverTicks: unmarked.length,
      peakAwake: Math.max(...ticks.map((row) => row.peakActive ?? 0)),
      peakAirborne: Math.max(...ticks.map((row) => row.peakAirborne ?? 0)),
      lastAwakeTick: Math.max(...ticks.map((row) => row.lastActiveTick ?? -1)),
      visualSettleTick: Math.max(...ticks.map((row) => row.visualSettleTick ?? -1)),
      unsettledViewBodyTicks: Math.max(...ticks.map((row) => row.unsettledViewBodyTicks ?? 0)),
      viewer: first.viewer ?? null,
      ticks: first.ticks,
      heldAtEnd: Math.max(...ticks.map((row) => row.heldAtEnd ?? 0)),
      arenaBytes: first.arenaBytes,
      arenaUsedBytes: Math.max(...ticks.map((row) => row.arenaUsedBytes ?? 0)),
      tempPeakBytes: Math.max(...ticks.map((row) => row.tempPeakBytes ?? 0)),
      updateErrors: Math.max(...ticks.map((row) => row.updateErrors ?? 0)),
      awakeLimit: first.awakeLimit ?? null,
      minorFaultsMax: Math.max(...ticks.map((row) => row.minorFaultsMax ?? 0)),
      arenaGrowthTicks: Math.max(...ticks.map((row) => row.arenaGrowthTicks ?? 0)),
    }
  })
}

export const unmarkedOverTicks = (results) => results.configs.flatMap((row) => (row.overTicks ?? []).filter((tick) => tick.host === false).map((tick) => ({ bodies: row.bodies, knobs: row.knobs, source: sourceOf(row), ...tick })))

export const profiledSlowTicks = (results) => results.configs.flatMap((row, run) => (row.profile?.slow ?? []).map((slow) => {
  const counters = (row.overTicks ?? []).find((tick) => tick.tick === slow.tick) ?? null
  return { run, bodies: row.bodies, host: counters ? counters.host : null, waitMaxMs: counters ? counters.waitMaxMs : null, involuntarySwitches: counters ? counters.involuntarySwitches : null, engineRunMs: counters ? counters.engineRunMs : null, awake: counters ? counters.awake : null, ...slow }
}))

export const profiledQuiet = (results) => {
  const row = results.configs.find((config) => config.profile)
  return row ? { quietTicks: row.profile.quietTicks, scopes: row.profile.quiet } : null
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))
  if (paths.length === 0) throw new TypeError('usage: summarise.mjs <results.json> [--unmarked] [--profile]')
  for (const path of paths) {
    const results = JSON.parse(readFileSync(resolve(path), 'utf8'))
    console.log('MACHINE ' + JSON.stringify({ class: results.machine?.class ?? null, model: results.machine?.modelName ?? results.cpuModel, runS: results.totalS, configs: results.configs.length }))
    for (const line of configurations(results)) console.log('CONFIG ' + JSON.stringify(line))
    if (process.argv.includes('--unmarked')) for (const tick of unmarkedOverTicks(results)) console.log('UNMARKED ' + JSON.stringify(tick))
    if (process.argv.includes('--profile')) {
      const quiet = profiledQuiet(results)
      if (quiet) console.log('QUIET ' + JSON.stringify(quiet))
      for (const tick of profiledSlowTicks(results)) console.log('PROFILE ' + JSON.stringify(tick))
    }
  }
}
