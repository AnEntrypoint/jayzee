import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { burn } from './cpu-load.mjs'
import { runRenderWitness } from './render-witness.mjs'
import { flightPath, newStreamerState, percentile, planetWorld, streamerPass } from '../streamer-p99.mjs'

export const CONDITIONS = ['G0', 'G1']
const SAMPLER = new URL('./cgroup-sampler.mjs', import.meta.url).pathname
const THREAD_SAMPLER = new URL('./thread-cpu-sampler.mjs', import.meta.url).pathname
const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const CPU_MAX = '/sys/fs/cgroup/cpu.max'
const PAGE_PORT = 8843
const PAGE_DEBUG_PORT = 9843
const PAGE_QUERY = 'phase=10&tier=1024&timed=1'
const SAMPLER_CPUS = process.env.SAMPLER_CPUS ?? '15'

function spawnSampler(args) {
  if (SAMPLER_CPUS === '') return spawn(process.execPath, args, { stdio: 'ignore' })
  return spawn('taskset', ['-c', SAMPLER_CPUS, process.execPath, ...args], { stdio: 'ignore' })
}

function checkWindow(window, name) {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || !(window.endMs > window.startMs)) {
    throw new TypeError(name + ' needs a window with startMs before endMs')
  }
}

export function hostRecord(readText = (path) => readFileSync(path, 'utf8'), nproc = availableParallelism()) {
  let cpuMax = null
  try {
    cpuMax = readText(CPU_MAX).trim()
  } catch {
    cpuMax = null
  }
  return { cpuMax, nproc, samplerCpus: SAMPLER_CPUS === '' ? null : SAMPLER_CPUS }
}

export function runRecord({ label, condition, round, sampler, generator = null, streamer, host = null, page = null }) {
  if (typeof label !== 'string' || label === '') throw new TypeError('label must be a non-empty string')
  if (!CONDITIONS.includes(condition)) throw new TypeError('condition must be G0 or G1: ' + condition)
  if (!Number.isInteger(round) || round < 1) throw new TypeError('round must be a whole number from 1: ' + round)
  checkWindow(sampler, 'sampler')
  if (typeof sampler.file !== 'string' || sampler.file === '') throw new TypeError('sampler needs a file')
  if (condition === 'G1') {
    if (!generator || !(generator.workers >= 1)) throw new TypeError('G1 needs a generator record with at least one worker')
    checkWindow(generator, 'generator')
  } else if (generator) {
    throw new TypeError('G0 takes no generator record')
  }
  checkWindow(streamer, 'streamer')
  for (const key of ['samples', 'p50Ms', 'p99Ms', 'maxMs']) {
    if (!Number.isFinite(streamer[key])) throw new TypeError('streamer.' + key + ' must be finite')
  }
  if (page !== null && (typeof page.file !== 'string' || page.file === '')) throw new TypeError('page needs a file')
  return {
    label,
    condition,
    round,
    sampler: { file: sampler.file, startMs: sampler.startMs, endMs: sampler.endMs },
    generator: generator ? { workers: generator.workers, requestedDurationMs: generator.requestedDurationMs, startMs: generator.startMs, endMs: generator.endMs } : null,
    streamer: { startMs: streamer.startMs, endMs: streamer.endMs, samples: streamer.samples, p50Ms: streamer.p50Ms, p99Ms: streamer.p99Ms, maxMs: streamer.maxMs },
    host: host ? { cpuMax: host.cpuMax ?? null, nproc: host.nproc ?? null, samplerCpus: host.samplerCpus ?? null } : null,
    page: page ? { file: page.file, error: page.error ?? null } : null,
  }
}

function exited(child) {
  return new Promise((resolve) => child.once('exit', resolve))
}

async function measureStreamerUntil(path, untilMs) {
  const world = await planetWorld()
  const state = newStreamerState()
  const startMs = Date.now()
  const passes = []
  let count = 0
  while (Date.now() < untilMs) {
    const pass = streamerPass(world, path, state)
    passes.push(Float64Array.from(pass))
    count += pass.length
  }
  const steps = new Float64Array(count)
  let offset = 0
  for (const pass of passes) {
    steps.set(pass, offset)
    offset += pass.length
  }
  return { startMs, endMs: Date.now(), steps }
}

if (process.argv[1] && process.argv[1].endsWith('/browser/paired-run.mjs')) {
  const [label, condition, roundArg, outDir, durationArg, workersArg = '0', ticksArg = '6000', pageArg = '0'] = process.argv.slice(2)
  const durationMs = Number(durationArg)
  const workers = Number(workersArg)
  const round = Number(roundArg)
  const withPage = pageArg === '1'
  const playwrightCore = process.env.PLAYWRIGHT_CORE
  if (withPage && !playwrightCore) throw new TypeError('PLAYWRIGHT_CORE must name the playwright-core index.mjs to take the page witness')
  mkdirSync(outDir, { recursive: true })
  const host = hostRecord()
  const samplerFile = join(outDir, label + '.sampler.txt')
  const path = await flightPath(Number(ticksArg))

  const samplerStart = Date.now()
  const sampler = spawnSampler([SAMPLER, samplerFile, String(durationMs), '2'])
  const samplerDone = exited(sampler)
  const threadSampler = spawnSampler([THREAD_SAMPLER, join(outDir, label + '.threads.txt'), '50', join(ROOT, '.playwriter', 'browser-profile')])
  const threadDone = exited(threadSampler)
  const generatorDone = condition === 'G1' && workers > 0 ? burn({ workers, durationMs }) : Promise.resolve(null)
  const streamer = await measureStreamerUntil(path, samplerStart + durationMs)
  await samplerDone
  threadSampler.kill('SIGTERM')
  await threadDone
  const generator = await generatorDone
  const samplerEnd = Date.now()

  let page = null
  if (withPage) {
    const pageFile = join(outDir, label + '.page.json')
    const witness = await runRenderWitness({ root: ROOT, port: PAGE_PORT, debugPort: PAGE_DEBUG_PORT, profile: join(ROOT, '.playwriter', 'browser-profile'), pageUrl: 'http://127.0.0.1:' + PAGE_PORT + '/scripts/browser/engine-render.html?' + PAGE_QUERY, playwrightCore, live: [] })
    writeFileSync(pageFile, JSON.stringify(witness.result ?? { error: witness.error }, null, 1) + '\n')
    page = { file: pageFile, error: witness.error ?? null }
  }

  const record = runRecord({
    label,
    condition,
    round,
    sampler: { file: samplerFile, startMs: samplerStart, endMs: samplerEnd },
    generator,
    host,
    page,
    streamer: {
      startMs: streamer.startMs,
      endMs: streamer.endMs,
      samples: streamer.steps.length,
      p50Ms: percentile(streamer.steps, 0.5),
      p99Ms: percentile(streamer.steps, 0.99),
      maxMs: streamer.steps.reduce((m, v) => (v > m ? v : m), -Infinity),
    },
  })
  writeFileSync(join(outDir, label + '.run.json'), JSON.stringify(record, null, 2) + '\n')
  console.log(JSON.stringify(record))
}
