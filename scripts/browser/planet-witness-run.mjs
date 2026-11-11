import { mkdirSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync } from 'node:child_process'
import { promisify } from 'node:util'
import { cpus, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { PLANET_FRAME_BUDGET_MS, PLANET_MISSED_FRAME_MS, PLANET_RUNS, planetQuery, planetVerdict } from '../../src/engine/planetWitness.js'

const execFileAsync = promisify(execFile)
const SAMPLE_MS = 250

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outDir = resolve(root, process.argv[2] ?? 'build/diag/planet')
const port = Number(process.argv[3] ?? '8847')
const frames = Number(process.argv[4] ?? '900')
if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames must be a whole number at least 1')
mkdirSync(outDir, { recursive: true })

const topProcesses = () => execFileSync('ps', ['-eo', 'pid,pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' }).trim().split('\n').slice(1, 4).map((line) => line.trim())

const sampleHost = async (samples, stop) => {
  while (!stop.done) {
    const at = Date.now()
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' })
    const top = stdout.trim().split('\n').slice(1, 6).map((line) => {
      const [pid, pcpu, ...name] = line.trim().split(/\s+/)
      return { pid: Number(pid), pcpu: Number(pcpu), comm: name.join(' ') }
    })
    samples.push({ epochMs: at, load1: loadavg()[0], top })
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
  }
}

const frameCases = (result, samples) => {
  if (!result || !Array.isArray(result.wallIntervalsMs) || !Array.isArray(result.frameStartsMs)) return []
  const cases = []
  result.wallIntervalsMs.forEach((interval, frame) => {
    if (interval <= PLANET_MISSED_FRAME_MS) return
    const start = result.timeOriginMs + result.frameStartsMs[frame]
    const work = result.frameTimesMs[frame]
    const window = samples.filter((sample) => sample.epochMs >= start - interval && sample.epochMs <= start + work)
    cases.push({
      frame,
      intervalMs: interval,
      workMs: work,
      startEpochMs: Math.round(start),
      classification: work > PLANET_FRAME_BUDGET_MS ? 'code-defect: in-callback work over budget' : 'outside-callback: work under budget, gap is in the browser or the host',
      samples: window.length,
      maxLoad1: window.length ? Math.max(...window.map((sample) => sample.load1)) : null,
      topInWindow: window.length ? window.flatMap((sample) => sample.top).sort((a, b) => b.pcpu - a.pcpu).slice(0, 3) : [],
    })
  })
  return cases
}

const summary = []
let failed = 0
for (const config of PLANET_RUNS) {
  const label = config.tier + '-' + config.backend
  const started = Date.now()
  const load1Before = loadavg()[0]
  const samples = []
  const stop = { done: false }
  const sampling = sampleHost(samples, stop)
  const run = await runRenderWitness({ root, port, query: planetQuery(config, frames) })
  stop.done = true
  await sampling
  const wallMs = Date.now() - started
  const load = { cpus: cpus().length, load1Before, load1After: loadavg()[0], topProcesses: topProcesses() }
  const verdict = run.error || !run.result ? { ok: false, failures: ['run failed: ' + (run.error ?? 'no result')] } : planetVerdict(run.result, config)
  if (!verdict.ok) failed += 1
  const cases = frameCases(run.result, samples)
  writeFileSync(resolve(outDir, label + '.json'), JSON.stringify({ label, wallMs, load, verdict, frameCases: cases, hostSamples: samples, result: run.result ?? null }, null, 1) + '\n')
  const wallMaxMs = run.result ? run.result.wallIntervalMaxMs : null
  summary.push({ label, wallMs, ok: verdict.ok, workMaxMs: verdict.maxMs, workP99Ms: verdict.p99Ms, wallMaxMs, missedFrames: cases.length, frameCases: cases.map((c) => ({ frame: c.frame, intervalMs: c.intervalMs, workMs: c.workMs, classification: c.classification, maxLoad1: c.maxLoad1, topInWindow: c.topInWindow })), load, failures: verdict.failures })
}

console.log(JSON.stringify({ outDir, budgetMs: 16.7, runs: summary }, null, 1))
if (failed > 0) {
  console.error('planet witness: ' + failed + ' of ' + PLANET_RUNS.length + ' runs missed the budget or a requirement')
  process.exitCode = 1
}
