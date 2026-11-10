import { spawn } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { burn, cpusExcept } from './cpu-load.mjs'
import { runRenderWitness } from './render-witness.mjs'
import { attributeOverLimit, parseCgroupSamples, sampledRows } from './sampler-gap-check.mjs'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const SAMPLER = fileURLToPath(new URL('./cgroup-sampler.mjs', import.meta.url))
const THREAD_SAMPLER = fileURLToPath(new URL('./thread-cpu-sampler.mjs', import.meta.url))
const CPU_STAT = '/sys/fs/cgroup/cpu.stat'
const SAMPLER_CPU = '15'
const PAGE_PORT = 8847
const STALL_MS = 20
const args = Object.fromEntries(process.argv.slice(2).map((arg) => {
  const match = /^--([\w-]+)=(.*)$/.exec(arg)
  if (!match) throw new TypeError('usage: node scripts/browser/quota-gap-probe.mjs --workers=12 --duration=120000 --out=DIR --label=NAME: ' + arg)
  return [match[1], match[2]]
}))
const workers = Number(args.workers ?? 12)
const durationMs = Number(args.duration ?? 120000)
const outDir = args.out ?? join(ROOT, 'build', 'diag', 'quota-gap')
const label = args.label ?? 'workers-' + workers

const exited = (child) => new Promise((resolve) => child.once('exit', resolve))
const pinned = (script, scriptArgs) => spawn('taskset', ['-c', SAMPLER_CPU, process.execPath, script, ...scriptArgs], { stdio: 'ignore' })
const cpuStat = () => Object.fromEntries(readFileSync(CPU_STAT, 'utf8').trim().split('\n').map((line) => {
  const [key, value] = line.split(' ')
  return [key, Number(value)]
}))

mkdirSync(outDir, { recursive: true })
const samplerFile = join(outDir, label + '.sampler.txt')
const threadsFile = join(outDir, label + '.threads.txt')
const before = cpuStat()
const startMs = Date.now()
const sampler = pinned(SAMPLER, [samplerFile, String(durationMs), '2'])
const samplerDone = exited(sampler)
const threadSampler = pinned(THREAD_SAMPLER, [threadsFile, '50', join(ROOT, '.playwriter', 'browser-profile')])
const threadDone = exited(threadSampler)
const page = runRenderWitness({ root: ROOT, port: PAGE_PORT, pageUrl: 'http://127.0.0.1:' + PAGE_PORT + '/scripts/browser/engine-render.html?phase=10&tier=1024&timed=1', live: [] })
const generator = workers > 0 ? await burn({ workers, durationMs, cpus: cpusExcept(SAMPLER_CPU) }) : null
await samplerDone
threadSampler.kill('SIGTERM')
await threadDone
const endMs = Date.now()
const after = cpuStat()
const rendered = await page

const cgroup = parseCgroupSamples(readFileSync(samplerFile, 'utf8'))
const rows = sampledRows(readFileSync(threadsFile + '.ticks', 'utf8'), { startMs, endMs })
const gaps = attributeOverLimit(rows, cgroup)
const stalls = []
for (let i = 1; i < cgroup.length; i += 1) {
  const stallMs = cgroup[i].t - cgroup[i - 1].t
  if (stallMs > STALL_MS) stalls.push({ stallMs, throttleMs: (cgroup[i].throttledUs - cgroup[i - 1].throttledUs) / 1000 })
}
const record = {
  label,
  workers,
  durationMs,
  generatorCpus: generator ? generator.cpus : null,
  cpuMax: readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim(),
  periods: after.nr_periods - before.nr_periods,
  throttledPeriods: after.nr_throttled - before.nr_throttled,
  throttledMs: (after.throttled_usec - before.throttled_usec) / 1000,
  usageCores: (after.usage_usec - before.usage_usec) / 1000 / (endMs - startMs),
  threadSamplerTicks: rows.length,
  gapsOver100Ms: gaps.map((gap) => ({ gapMs: gap.gapMs, cause: gap.cause, threadCause: gap.threadCause, selfWaitMs: gap.selfWaitMs, cgroupThrottleMs: gap.cgroupThrottleMs })),
  cgroupSamplerStalls: { over20Ms: stalls.length, withThrottle: stalls.filter((stall) => stall.throttleMs > 0).length, maxMs: stalls.reduce((max, stall) => Math.max(max, stall.stallMs), 0) },
  page: rendered.result ? { checksum: rendered.result.checksum, adapter: rendered.result.adapter ? rendered.result.adapter.description : null } : { error: rendered.error },
}
writeFileSync(join(outDir, label + '.probe.json'), JSON.stringify(record, null, 1) + '\n')
console.log(JSON.stringify(record))
