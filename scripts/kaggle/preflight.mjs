import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPlan } from './plan.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const PREFLIGHT_DIR = 'build/kaggle/preflight'
export const PREFLIGHT_LIMIT_MS = 1200000
export const MOST_RESULT_BYTES = 4 * 1024 * 1024
export const PIPE_BYTES = 65536

const REQUIRED = Object.freeze({
  tick: ['p99Ms', 'maxMs', 'overBudget', 'activeMeanMs', 'p99QuietMs', 'loopStartedEpochMs', 'arenaBytes'],
  'marble-bowl': ['cpuP99Ms', 'cpuMaxMs', 'perRun'],
  calibrate: ['singleMs'],
  canary: ['gapCount', 'over5Ms', 'startedEpochMs'],
  'pipe-probe': ['bytes', 'filler'],
})

export const distinctDryRows = (plan) => {
  const seen = new Map()
  for (const run of plan.runs) {
    const key = JSON.stringify([run.script, run.dryArgs, run.nodeFlags])
    if (!seen.has(key)) seen.set(key, run)
  }
  return [...seen.values()]
}

export const judgePreflight = (results, plan) => {
  const failures = []
  const expected = distinctDryRows(plan)
  if (!results || results.dry !== true) return { failures: ['the kernel did not run dry'], rows: 0, mostResultBytes: 0 }
  if (results.configs.length !== expected.length) failures.push('the kernel ran ' + results.configs.length + ' rows of ' + expected.length)
  let mostResultBytes = 0
  results.configs.forEach((row, index) => {
    const name = row.script + ' ' + JSON.stringify(row.args)
    if (row.error || row.refused) {
      failures.push(name + ': ' + (row.error ?? 'refused ' + row.refused) + (row.stderr ? ' | ' + String(row.stderr).slice(-300) : ''))
      return
    }
    const needed = REQUIRED[row.kind]
    if (!needed) {
      failures.push(name + ': unknown result kind ' + row.kind)
      return
    }
    for (const field of needed) {
      if (row[field] === undefined || row[field] === null) failures.push(name + ': the result has no ' + field)
    }
    if (!Number.isInteger(row.resultBytes) || row.resultBytes > MOST_RESULT_BYTES) failures.push(name + ': result line of ' + row.resultBytes + ' bytes')
    else mostResultBytes = Math.max(mostResultBytes, row.resultBytes)
    if (row.kind === 'tick') {
      if (!Array.isArray(row.overTicks) || row.overTicks.length === 0) failures.push(name + ': the dry budget marked no tick as over, so the largest result line was not exercised')
      else if (!row.overTicks.every((tick) => Number.isFinite(tick.epochMs))) failures.push(name + ': an over-budget tick has no clock stamp')
      if (expected[index] && expected[index].role === 'profile' && !(row.profile && row.profile.slow.length > 0)) failures.push(name + ': the profile build kept no slow tick')
    }
    if (!Number.isFinite(row.startedAtEpochS) || !Number.isFinite(row.endedAtEpochS)) failures.push(name + ': the row has no clock stamps')
  })
  if (failures.length === 0 && mostResultBytes <= PIPE_BYTES) failures.push('no result line was over the ' + PIPE_BYTES + ' bytes of a pipe, so a cut line would not have been seen')
  return { failures, rows: results.configs.length, mostResultBytes }
}

export const preflight = (mode) => {
  const started = Date.now()
  const dir = join(root, PREFLIGHT_DIR)
  rmSync(dir, { recursive: true, force: true })
  execFileSync(process.execPath, [join(root, 'scripts/kaggle/pack.mjs'), mode, PREFLIGHT_DIR], { cwd: root, encoding: 'utf8' })
  const resultsPath = join(dir, 'results.json')
  const ran = spawnSync('python3', [join(dir, 'kernel/kernel.py')], {
    cwd: root,
    encoding: 'utf8',
    timeout: PREFLIGHT_LIMIT_MS,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, JAYZEE_BENCH_INPUT: join(dir, 'dataset'), JAYZEE_BENCH_WORK: join(dir, 'work'), JAYZEE_BENCH_RESULTS: resultsPath, JAYZEE_BENCH_DRY: '1', JAYZEE_BENCH_NODE: process.execPath },
  })
  const seconds = Number(((Date.now() - started) / 1000).toFixed(1))
  if (ran.status !== 0 || !existsSync(resultsPath)) return { mode, seconds, rows: 0, mostResultBytes: 0, failures: ['the kernel script ended with status ' + ran.status + ': ' + String(ran.stderr ?? '').slice(-600)] }
  const judged = judgePreflight(JSON.parse(readFileSync(resultsPath, 'utf8')), buildPlan(mode))
  rmSync(join(dir, 'work'), { recursive: true, force: true })
  return { mode, seconds, ...judged }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const outcome = preflight(process.argv[2] ?? 'regress')
  console.log(JSON.stringify(outcome))
  if (outcome.failures.length > 0) process.exitCode = 1
}
