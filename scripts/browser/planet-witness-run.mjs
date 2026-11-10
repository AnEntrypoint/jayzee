import { mkdirSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { cpus, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { PLANET_RUNS, planetQuery, planetVerdict } from '../../src/engine/planetWitness.js'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outDir = resolve(root, process.argv[2] ?? 'build/diag/planet')
const port = Number(process.argv[3] ?? '8847')
const frames = Number(process.argv[4] ?? '900')
if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames must be a whole number at least 1')
mkdirSync(outDir, { recursive: true })

const topProcesses = () => execFileSync('ps', ['-eo', 'pid,pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' }).trim().split('\n').slice(1, 4).map((line) => line.trim())

const summary = []
let failed = 0
for (const config of PLANET_RUNS) {
  const label = config.tier + '-' + config.backend
  const started = Date.now()
  const load1Before = loadavg()[0]
  const run = await runRenderWitness({ root, port, query: planetQuery(config, frames) })
  const wallMs = Date.now() - started
  const load = { cpus: cpus().length, load1Before, load1After: loadavg()[0], topProcesses: topProcesses() }
  const verdict = run.error || !run.result ? { ok: false, failures: ['run failed: ' + (run.error ?? 'no result')] } : planetVerdict(run.result, config)
  if (!verdict.ok) failed += 1
  writeFileSync(resolve(outDir, label + '.json'), JSON.stringify({ label, wallMs, load, verdict, result: run.result ?? null }, null, 1) + '\n')
  summary.push({ label, wallMs, ok: verdict.ok, p99Ms: verdict.p99Ms, maxMs: verdict.maxMs, load, failures: verdict.failures })
}

console.log(JSON.stringify({ outDir, budgetMs: 16.7, runs: summary }, null, 1))
if (failed > 0) {
  console.error('planet witness: ' + failed + ' of ' + PLANET_RUNS.length + ' runs missed the budget or a requirement')
  process.exitCode = 1
}
