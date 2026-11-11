import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { KERNEL_REF } from './plan.mjs'

const here = dirname(fileURLToPath(import.meta.url))

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const knobsOf = (c) => Object.fromEntries(!c.knobs || c.knobs === 'none' ? [] : c.knobs.split(',').map((pair) => pair.split('=')))
const budgetOf = (c) => Number(knobsOf(c).awake ?? c.awakeBudget ?? 0)
const otherKnobs = (c) => Object.entries(knobsOf(c)).filter(([key]) => key !== 'awake').map(([key, value]) => ', ' + key + ' ' + value).join('')
const buildOf = (c) => (c.variant === 'reference' ? 'unbudgeted reference' : (budgetOf(c) === 0 ? 'candidate, every body awake' : 'candidate, awake budget ' + budgetOf(c)) + otherKnobs(c))

export const summarise = (runs, budgetMs) => {
  const classes = new Map()
  for (const { version, results } of runs) {
    const machine = results.machine
    if (!machine || !machine.class) throw new Error('run ' + version + ' has no machine class')
    const entry = classes.get(machine.class) ?? { class: machine.class, machine, versions: [], singleMs: [], memoryMs: [], laneSlowdown: [], rows: new Map() }
    classes.set(machine.class, entry)
    entry.versions.push(version)
    for (const c of results.configs) {
      if (c.kind === 'calibrate' && !c.error) {
        entry.singleMs.push(c.singleMs)
        entry.memoryMs.push(c.memoryMs)
        entry.laneSlowdown.push(c.laneSlowdown)
      }
      if (c.kind !== 'tick' || c.refused || c.error || c.warm !== true) continue
      const key = [buildOf(c), c.bodies, c.workers].join('|')
      const row = entry.rows.get(key) ?? { build: buildOf(c), bodies: c.bodies, workers: c.workers, p99: [], max: [], over: [], peakActive: [], lastActiveTick: [] }
      entry.rows.set(key, row)
      row.p99.push(c.p99Ms)
      row.max.push(c.maxMs)
      row.over.push(c.overBudget)
      row.peakActive.push(c.peakActive)
      row.lastActiveTick.push(c.lastActiveTick)
    }
  }
  return [...classes.values()].map((entry) => ({
    class: entry.class,
    machine: entry.machine,
    versions: entry.versions,
    singleMs: entry.singleMs.length ? Math.min(...entry.singleMs) : null,
    memoryMs: entry.memoryMs.length ? Math.min(...entry.memoryMs) : null,
    laneSlowdown: entry.laneSlowdown.length ? Math.max(...entry.laneSlowdown) : null,
    rows: [...entry.rows.values()].map((row) => ({ build: row.build, bodies: row.bodies, workers: row.workers, repeats: row.p99.length, medianP99Ms: median(row.p99), worstP99Ms: Math.max(...row.p99), worstMaxMs: Math.max(...row.max), overEach: row.over, repeatsHolding: row.over.filter((n, i) => n === 0 && row.p99[i] <= budgetMs).length, peakActive: Math.max(...row.peakActive), lastActiveTick: Math.max(...row.lastActiveTick), holds: row.over.every((n) => n === 0) && Math.max(...row.p99) <= budgetMs })).sort((a, b) => a.bodies - b.bodies || a.build.localeCompare(b.build) || a.workers - b.workers),
  }))
}

export const render = (classes, budgetMs) => {
  const lines = ['## Physics claim per Kaggle machine class', '', 'Written by \`node scripts/kaggle/claims.mjs\` from the result files of \`' + KERNEL_REF + '\` named below. A row holds when every repeat has zero ticks over ' + budgetMs + ' ms and a p99 at or under it, warmed, 900 ticks, the whole worker tick timed. The unbudgeted reference is the build before the awake budget, with every body awake from tick 0. The class is vendor, family, model and stepping from /proc/cpuinfo.', '']
  for (const c of classes) {
    const m = c.machine
    const lscpu = m.lscpu ?? {}
    lines.push('### ' + c.class + ' (' + m.modelName + ')', '', '- Kernel versions: ' + c.versions.join(', ') + '. ' + m.cores + ' cores, ' + m.siblings + ' threads, ' + m.mhz + ' MHz, L2 ' + (lscpu['L2 cache'] ?? m.cache) + ', L3 ' + (lscpu['L3 cache'] ?? 'not reported') + ', avx512 ' + (m.avx512f ? 'yes' : 'no') + ', cgroup cpu.max ' + m.cgroupCpuMax + '.', '- Calibration: single thread ' + c.singleMs + ' ms, memory chase ' + c.memoryMs + ' ms, four lanes at once cost ' + c.laneSlowdown + ' times one lane.', '', '| bodies | build | workers | repeats | median p99 ms | worst p99 ms | worst max ms | ticks over budget per repeat | repeats with none over | peak awake | last awake tick | holds in every repeat |', '|' + '---|'.repeat(12))
    for (const row of c.rows) lines.push('| ' + [row.bodies, row.build, row.workers, row.repeats, row.medianP99Ms, row.worstP99Ms, row.worstMaxMs, row.overEach.join(', '), row.repeatsHolding + ' of ' + row.repeats, row.peakActive, row.lastActiveTick, row.holds ? 'yes' : 'no'].join(' | ') + ' |')
    lines.push('')
  }
  return lines
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const paths = process.argv.slice(2)
  if (paths.length === 0) throw new TypeError('usage: claims.mjs <results.json> [<results.json> ...]')
  const runs = paths.map((path) => ({ version: Number((/out-v(\d+)/.exec(path) ?? [])[1]), results: JSON.parse(readFileSync(resolve(path), 'utf8')) }))
  const budgets = new Set(runs.map((run) => run.results.budgetMs))
  if (budgets.size !== 1) throw new Error('the runs do not share one budget')
  const lines = render(summarise(runs, [...budgets][0]), [...budgets][0])
  writeFileSync(join(here, 'claims.md'), lines.join('\n') + '\n')
  console.log(lines.join('\n'))
}
