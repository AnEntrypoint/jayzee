import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { burn } from './cpu-load.mjs'
import { flightPath, newStreamerState, percentile, planetWorld, streamerPass } from '../streamer-p99.mjs'

export const CONDITIONS = ['G0', 'G1']
const SAMPLER = new URL('./cgroup-sampler.mjs', import.meta.url).pathname

function checkWindow(window, name) {
  if (!window || !Number.isFinite(window.startMs) || !Number.isFinite(window.endMs) || !(window.endMs > window.startMs)) {
    throw new TypeError(name + ' needs a window with startMs before endMs')
  }
}

export function runRecord({ label, condition, round, sampler, generator = null, streamer }) {
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
  return {
    label,
    condition,
    round,
    sampler: { file: sampler.file, startMs: sampler.startMs, endMs: sampler.endMs },
    generator: generator ? { workers: generator.workers, requestedDurationMs: generator.requestedDurationMs, startMs: generator.startMs, endMs: generator.endMs } : null,
    streamer: { startMs: streamer.startMs, endMs: streamer.endMs, samples: streamer.samples, p50Ms: streamer.p50Ms, p99Ms: streamer.p99Ms, maxMs: streamer.maxMs },
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
  const [label, condition, roundArg, outDir, durationArg, workersArg = '0', ticksArg = '6000'] = process.argv.slice(2)
  const durationMs = Number(durationArg)
  const workers = Number(workersArg)
  const round = Number(roundArg)
  mkdirSync(outDir, { recursive: true })
  const samplerFile = join(outDir, label + '.sampler.txt')
  const path = await flightPath(Number(ticksArg))

  const samplerStart = Date.now()
  const sampler = spawn(process.execPath, [SAMPLER, samplerFile, String(durationMs), '2'], { stdio: 'ignore' })
  const samplerDone = exited(sampler)
  const generatorDone = condition === 'G1' && workers > 0 ? burn({ workers, durationMs }) : Promise.resolve(null)
  const streamer = await measureStreamerUntil(path, samplerStart + durationMs)
  await samplerDone
  const generator = await generatorDone
  const samplerEnd = Date.now()

  const record = runRecord({
    label,
    condition,
    round,
    sampler: { file: samplerFile, startMs: samplerStart, endMs: samplerEnd },
    generator,
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
