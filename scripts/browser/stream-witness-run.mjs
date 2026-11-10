import { mkdirSync, writeFileSync } from 'node:fs'
import { cpus, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outDir = resolve(root, process.argv[2] ?? 'build/diag/stream')
const port = Number(process.argv[3] ?? '8847')
const frames = Number(process.argv[4] ?? '900')
const PAGE_WINDOW = 8
const PAGES_PER_FRAME = 8
const FRAME_BUDGET_MS = 16.7
const RESTAGE_BUDGET_MS = 2
const TIERS = [
  { tier: 64, threads: false },
  { tier: 128, threads: false },
  { tier: 512, threads: false },
  { tier: 1024, threads: true },
]
const BACKENDS = [
  { name: 'webgpu', phase: 10 },
  { name: 'webgl2', phase: 11 },
]
const PATHS = ['planet', 'flyover']

const queryFor = ({ tier, threads }, { phase }, path) =>
  'phase=' + phase + '&tier=' + tier + '&timed=1&path=' + path + '&window=' + PAGE_WINDOW + '&streamPerFrame=' + PAGES_PER_FRAME + '&frames=' + frames + (threads ? '&threads=1' : '')

const verdict = (result) => {
  const failures = []
  if (result.ok !== true) failures.push('page ok is not true')
  if (result.errors && result.errors.length > 0) failures.push('page errors: ' + result.errors.length)
  if (result.pagesPlaced <= 64) failures.push('only ' + result.pagesPlaced + ' pages placed; the witness must place more than 64')
  if (result.frameTimeP99Ms > FRAME_BUDGET_MS) failures.push('frame p99 ' + result.frameTimeP99Ms + ' ms is over ' + FRAME_BUDGET_MS)
  if (result.frameTimeMaxMs > FRAME_BUDGET_MS) failures.push('worst frame ' + result.frameTimeMaxMs + ' ms is over ' + FRAME_BUDGET_MS)
  if (result.restageMsMax !== undefined && result.restageMsMax > RESTAGE_BUDGET_MS) failures.push('per-frame page streaming ' + result.restageMsMax + ' ms is over ' + RESTAGE_BUDGET_MS)
  if (result.allocationsSinceWarmup !== '0' && result.allocationsSinceWarmup !== 0) failures.push('allocations after warm-up: ' + result.allocationsSinceWarmup)
  if (result.createsAfterSeal !== 0) failures.push('creates after seal: ' + result.createsAfterSeal)
  return failures
}

mkdirSync(outDir, { recursive: true })
const summary = []
for (const config of TIERS) {
  for (const backend of BACKENDS) {
    for (const path of PATHS) {
      const label = config.tier + '-' + backend.name + '-' + path
      const started = Date.now()
      const load1Before = loadavg()[0]
      const run = await runRenderWitness({ root, port, query: queryFor(config, backend, path) })
      const wallMs = Date.now() - started
      const load = { cpus: cpus().length, load1Before, load1After: loadavg()[0] }
      if (run.error || !run.result) {
        summary.push({ label, wallMs, load, error: run.error ?? 'no result', failures: ['run failed'] })
        continue
      }
      const failures = verdict(run.result)
      writeFileSync(resolve(outDir, label + '.json'), JSON.stringify({ wallMs, load, failures, result: run.result }, null, 1) + '\n')
      summary.push({
        label,
        wallMs,
        load,
        backend: run.result.backend,
        frameMedianMs: run.result.frameTimeMedianMs,
        frameP99Ms: run.result.frameTimeP99Ms,
        frameMaxMs: run.result.frameTimeMaxMs,
        restageMsMax: run.result.restageMsMax ?? null,
        pagesPlaced: run.result.pagesPlaced ?? null,
        failures,
      })
    }
  }
}
writeFileSync(resolve(outDir, 'summary.json'), JSON.stringify(summary, null, 1) + '\n')
for (const row of summary) console.log(JSON.stringify(row))
const failed = summary.filter((row) => row.failures.length > 0)
console.log(failed.length === 0 ? 'STREAM_WITNESS PASS ' + summary.length : 'STREAM_WITNESS FAIL ' + failed.length + ' of ' + summary.length)
if (failed.length > 0) process.exitCode = 1
