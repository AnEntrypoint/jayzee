import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { allowedCpus, quotaCores } from './cpu-load.mjs'
import { attributeOverLimit, parseCgroupSamples, sampledRows } from './sampler-gap-check.mjs'

export const LOAD_LIMIT = 0.2
export const MODES = Object.freeze({ pinned: '15', unpinned: '' })
export const HEADROOM_CORES = 2
export const workersUnderQuota = (cores) => Math.max(1, Math.floor(cores) - HEADROOM_CORES)
export const GENERATORS = Object.freeze(['separate', 'shared'])
export const CAUSES = Object.freeze(['host-cfs-quota', 'run-queue-wait', 'sampler-work', 'unattributed'])
export const GATE_READ_MS = 5000
export const GATE_TRIES = 2880
const PAIRED = fileURLToPath(new URL('./paired-run.mjs', import.meta.url))

export const parseProcStatCpu = (text) => {
  const line = String(text).split('\n').find((row) => /^cpu\s/.test(row))
  if (!line) throw new TypeError('proc stat has no aggregate cpu line')
  const fields = line.trim().split(/\s+/).slice(1).map(Number)
  if (fields.length < 5 || !fields.every(Number.isFinite)) throw new TypeError('proc stat cpu line is not numbers: ' + line)
  return { idle: fields[3] + fields[4], total: fields.reduce((sum, value) => sum + value, 0) }
}

export const busyFraction = (before, after) => {
  const total = after.total - before.total
  if (!(total > 0)) throw new RangeError('proc stat did not advance between the two reads')
  return 1 - (after.idle - before.idle) / total
}

export const loadGate = (busy, limit = LOAD_LIMIT) => (busy <= limit
  ? { ok: true, reason: null }
  : { ok: false, reason: 'host busy ' + busy.toFixed(3) + ' is above the load limit ' + limit })

export const awaitLoadGate = async ({ read, limit = LOAD_LIMIT, tries = GATE_TRIES }) => {
  if (!(tries >= 1)) throw new RangeError('tries must be a whole number from 1: ' + tries)
  let busy = null
  for (let reads = 1; reads <= tries; reads += 1) {
    busy = await read()
    if (busy <= limit) return { ok: true, busy, reads }
  }
  return { ok: false, busy, reads: tries }
}

export const frequencyPlan = (n) => {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('n must be a whole number from 1: ' + n)
  const plan = []
  for (let index = 1; index <= n; index++) plan.push({ mode: 'pinned', index }, { mode: 'unpinned', index })
  return plan
}

export const summarizeFrequency = (results) => Object.fromEntries(Object.keys(MODES).map((mode) => {
  const rows = results.filter((row) => row.mode === mode)
  const valid = rows.filter((row) => row.status === 'valid')
  const gaps = valid.flatMap((row) => row.gaps)
  const causes = Object.fromEntries(CAUSES.map((cause) => [cause, gaps.filter((gap) => gap.cause === cause).length]))
  return [mode, {
    requested: rows.length,
    valid: valid.length,
    skipped: rows.filter((row) => row.status === 'skipped').length,
    error: rows.filter((row) => row.status === 'error').length,
    runsWithGap: valid.filter((row) => row.gaps.length > 0).length,
    gaps: gaps.length,
    maxGapMs: gaps.reduce((max, gap) => Math.max(max, gap.gapMs), 0),
    causes,
  }]
}))

export const formatTable = (table) => {
  const head = ['mode', 'requested', 'valid', 'skipped', 'error', 'runs with gap', 'gaps', 'max gap ms', ...CAUSES].join(' | ')
  const rows = Object.entries(table).map(([mode, row]) => [mode, row.requested, row.valid, row.skipped, row.error, row.runsWithGap, row.gaps, row.maxGapMs, ...CAUSES.map((cause) => row.causes[cause])].join(' | '))
  return [head, ...rows].join('\n')
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const readStat = () => readFileSync('/proc/stat', 'utf8')

const measureBusy = async () => {
  const before = parseProcStatCpu(readStat())
  await sleep(GATE_READ_MS)
  return busyFraction(before, parseProcStatCpu(readStat()))
}

export const generatorEnv = (generator) => {
  if (!GENERATORS.includes(generator)) throw new TypeError('generator must be separate or shared: ' + generator)
  return generator === 'shared' ? { GENERATOR_CPUS: '' } : {}
}

const runPaired = (label, mode, index, outDir, durationMs, workers, ticks, generator) => new Promise((resolve, reject) => {
  const env = { ...process.env, SAMPLER_CPUS: MODES[mode], ...generatorEnv(generator) }
  const child = spawn(process.execPath, [PAIRED, label, 'G1', String(index), outDir, String(durationMs), String(workers), String(ticks), '0'], { env, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  let err = ''
  child.stdout.on('data', (chunk) => { out += chunk })
  child.stderr.on('data', (chunk) => { err += chunk })
  child.once('error', reject)
  child.once('exit', (code) => resolve({ code, out, err }))
})

const gapsOf = (record, ticksText, cgroupText) => attributeOverLimit(sampledRows(ticksText, record.sampler), parseCgroupSamples(cgroupText))

const runSlot = async ({ label, mode, index, outDir, durationMs, workers, ticks, loadLimit, gateTries, read, generator }) => {
  const gate = await awaitLoadGate({ read, limit: loadLimit, tries: gateTries })
  if (!gate.ok) {
    return { label, mode, index, status: 'skipped', reason: 'host busy stayed above ' + loadLimit + ' for ' + gate.reads + ' reads (last ' + gate.busy.toFixed(3) + ')', loadBefore: gate.busy, gaps: [], maxGapMs: 0 }
  }
  const run = await runPaired(label, mode, index, outDir, durationMs, workers, ticks, generator)
  if (run.code !== 0) {
    return { label, mode, index, status: 'error', reason: 'paired-run exit ' + run.code + ': ' + run.err.slice(-300), loadBefore: gate.busy, gaps: [], maxGapMs: 0 }
  }
  const runPath = join(outDir, label + '.run.json')
  const record = JSON.parse(readFileSync(runPath, 'utf8'))
  const samplerPath = existsSync(record.sampler.file) ? record.sampler.file : join(outDir, basename(record.sampler.file))
  const gaps = gapsOf(record, readFileSync(join(outDir, label + '.threads.txt.ticks'), 'utf8'), readFileSync(samplerPath, 'utf8'))
  return {
    label,
    mode,
    index,
    status: 'valid',
    reason: null,
    generator,
    generatorCpus: record.host ? record.host.generatorCpus ?? null : null,
    loadBefore: gate.busy,
    gateReads: gate.reads,
    gaps: gaps.map((gap) => ({ t0: gap.t0, gapMs: gap.gapMs, cause: gap.cause, threadCause: gap.threadCause, cgroupThrottleMs: gap.cgroupThrottleMs, selfWaitMs: gap.selfWaitMs })),
    maxGapMs: gaps.reduce((max, gap) => Math.max(max, gap.gapMs), 0),
    runJson: runPath,
  }
}

export const runFrequency = async ({ n, outDir, durationMs, workers, ticks, loadLimit = LOAD_LIMIT, gateTries = GATE_TRIES, maxSlots = 2 * n, log = console.log, read = measureBusy, generator = 'separate' }) => {
  generatorEnv(generator)
  mkdirSync(outDir, { recursive: true })
  const modes = Object.keys(MODES)
  const results = []
  const valid = Object.fromEntries(modes.map((mode) => [mode, 0]))
  const slots = Object.fromEntries(modes.map((mode) => [mode, 0]))
  while (modes.some((mode) => valid[mode] < n && slots[mode] < maxSlots)) {
    for (const mode of modes) {
      if (valid[mode] >= n || slots[mode] >= maxSlots) continue
      slots[mode] += 1
      const index = slots[mode]
      const label = 'freq-' + mode + '-' + index
      const result = await runSlot({ label, mode, index, outDir, durationMs, workers, ticks, loadLimit, gateTries, read, generator })
      writeFileSync(join(outDir, label + '.result.json'), JSON.stringify(result, null, 1) + '\n')
      results.push(result)
      if (result.status === 'valid') valid[mode] += 1
      log(label + ' ' + result.status + (result.reason ? ' (' + result.reason + ')' : '') + ' gaps=' + result.gaps.length)
    }
  }
  const table = summarizeFrequency(results)
  const text = formatTable(table)
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify({ generator, table, results }, null, 1) + '\n')
  writeFileSync(join(outDir, 'summary.md'), '```\n' + text + '\n```\n')
  log(text)
  return { table, results }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
    const match = /^--([\w-]+)=(.*)$/.exec(arg)
    if (!match) throw new TypeError('usage: node scripts/browser/frequency-runs.mjs --n=5 --out=DIR [--duration=240000 --workers=<quota cores minus 2> --ticks=6000 --load-limit=0.2 --max-wait-ms=14400000 --generator=separate|shared]: ' + arg)
    return [match[1], match[2]]
  }))
  const n = Number(args.n ?? 5)
  await runFrequency({
    n,
    outDir: args.out ?? 'build/diag/paired-G/freq',
    durationMs: Number(args.duration ?? 240000),
    workers: Number(args.workers ?? workersUnderQuota(quotaCores(readFileSync('/sys/fs/cgroup/cpu.max', 'utf8'), allowedCpus().length))),
    ticks: Number(args.ticks ?? 6000),
    loadLimit: Number(args['load-limit'] ?? LOAD_LIMIT),
    generator: args.generator ?? 'separate',
    gateTries: Math.max(1, Math.ceil(Number(args['max-wait-ms'] ?? GATE_TRIES * GATE_READ_MS) / GATE_READ_MS)),
  })
}
