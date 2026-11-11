import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFile, execFileSync, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { cpus, loadavg } from 'node:os'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { PLANET_FRAME_BUDGET_MS, PLANET_MISSED_FRAME_MS, PLANET_RUNS, planetQuery, planetVerdict } from '../../src/engine/planetWitness.js'

const execFileAsync = promisify(execFile)
const SAMPLE_MS = 500
const RUN_TIMEOUT_MS = 240000

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outDir = resolve(root, process.argv[2] ?? 'build/diag/planet')
const port = Number(process.argv[3] ?? '8847')
const frames = Number(process.argv[4] ?? '900')
if (!Number.isInteger(frames) || frames < 1) throw new RangeError('frames must be a whole number at least 1')
mkdirSync(outDir, { recursive: true })

const topProcesses = () => execFileSync('ps', ['-eo', 'pid,pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' }).trim().split('\n').slice(1, 4).map((line) => line.trim())

const CLOCK_TICK_MS = 10

const readCgroupCpu = () => {
  const stat = Object.fromEntries(readFileSync('/sys/fs/cgroup/cpu.stat', 'utf8').trim().split('\n').map((line) => line.split(' ')).map(([key, value]) => [key, Number(value)]))
  return { usageUsec: stat.usage_usec, nrThrottled: stat.nr_throttled, throttledUsec: stat.throttled_usec }
}

const readProcMs = (pid) => {
  try {
    const text = readFileSync('/proc/' + pid + '/stat', 'utf8')
    const fields = text.slice(text.lastIndexOf(')') + 2).split(' ')
    return (Number(fields[11]) + Number(fields[12])) * CLOCK_TICK_MS
  } catch {
    return null
  }
}

const GPU_WINDOW_MS = 1500

const sampleGpu = (rows) => {
  let child = null
  try {
    child = spawn('nvidia-smi', ['pmon', '-d', '1'], { stdio: ['ignore', 'pipe', 'ignore'] })
  } catch {
    return () => {}
  }
  let rest = ''
  child.on('error', () => {})
  child.stdout.on('data', (chunk) => {
    const lines = (rest + chunk.toString('utf8')).split('\n')
    rest = lines.pop()
    const at = Date.now()
    for (const line of lines) {
      if (line.startsWith('#')) continue
      const [, pid, type, sm, mem, , , , , ...name] = line.trim().split(/\s+/)
      if (!/^\d+$/.test(pid ?? '')) continue
      rows.push({ epochMs: at, pid: Number(pid), type, smPct: sm === '-' ? 0 : Number(sm), memPct: mem === '-' ? 0 : Number(mem), command: name.join(' ') })
    }
  })
  return () => child.kill('SIGTERM')
}

const gpuNear = (rows, epochMs) => {
  const near = rows.filter((row) => Math.abs(row.epochMs - epochMs) <= GPU_WINDOW_MS)
  const byPid = new Map()
  for (const row of near) {
    const entry = byPid.get(row.pid) ?? { pid: row.pid, command: row.command, maxSmPct: 0, samples: 0 }
    entry.maxSmPct = Math.max(entry.maxSmPct, row.smPct)
    entry.samples += 1
    byPid.set(row.pid, entry)
  }
  return [...byPid.values()].sort((a, b) => b.maxSmPct - a.maxSmPct)
}

const sampleHost = async (samples, stop) => {
  while (!stop.done) {
    const at = Date.now()
    const { stdout } = await execFileAsync('ps', ['-eo', 'pid,pcpu,comm', '--sort=-pcpu'], { encoding: 'utf8' })
    const top = stdout.trim().split('\n').slice(1, 6).map((line) => {
      const [pid, pcpu, ...name] = line.trim().split(/\s+/)
      return { pid: Number(pid), pcpu: Number(pcpu), comm: name.join(' ') }
    })
    const procMs = Object.fromEntries(top.map((p) => [p.pid, readProcMs(p.pid)]).filter(([, ms]) => ms !== null))
    samples.push({ epochMs: at, load1: loadavg()[0], top, cgroup: readCgroupCpu(), procMs })
    await new Promise((resolve) => setTimeout(resolve, SAMPLE_MS))
  }
}

const WARMUP_FRAMES_IN_PAGE = 60

const mergedCover = (spans) => {
  const sorted = spans.slice().sort((a, b) => a[0] - b[0])
  let covered = 0
  let end = -Infinity
  for (const [a, b] of sorted) {
    if (b <= end) continue
    covered += b - Math.max(a, end)
    end = b
  }
  return covered
}

const traceGaps = (events, result, frames) => {
  if (!Array.isArray(events) || !result) return { error: 'no trace' }
  const callbacks = events.filter((e) => e.name === 'FireAnimationFrame' && e.ph === 'X')
  const perThread = new Map()
  for (const e of callbacks) perThread.set(e.pid + ':' + e.tid, (perThread.get(e.pid + ':' + e.tid) ?? 0) + 1)
  const [mainKey] = [...perThread].sort((a, b) => b[1] - a[1])[0] ?? []
  if (mainKey === undefined) return { error: 'no FireAnimationFrame events' }
  const [pid, tid] = mainKey.split(':').map(Number)
  const list = callbacks.filter((e) => e.pid === pid && e.tid === tid).sort((a, b) => a.ts - b.ts)
  if (list.length < frames) return { error: 'trace holds ' + list.length + ' frame callbacks for ' + frames + ' frames' }
  const aligned = list.slice(list.length - frames)
  const busy = events.filter((e) => e.pid === pid && e.tid === tid && e.ph === 'X' && e.name !== 'FireAnimationFrame')
  let intervalMismatches = 0
  const gaps = []
  for (let g = 1; g < frames; g++) {
    const from = aligned[g - 1].ts + aligned[g - 1].dur
    const to = aligned[g].ts
    const spans = busy.filter((e) => e.ts < to && e.ts + e.dur > from).map((e) => [Math.max(e.ts, from), Math.min(e.ts + e.dur, to)])
    const covered = mergedCover(spans) / 1000
    const byName = new Map()
    for (const e of busy) {
      if (!(e.ts < to && e.ts + e.dur > from)) continue
      const overlap = Math.min(e.ts + e.dur, to) - Math.max(e.ts, from)
      byName.set(e.name, (byName.get(e.name) ?? 0) + overlap / 1000)
    }
    const top = [...byName].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([name, ms]) => ({ name, ms: Math.round(ms * 100) / 100 }))
    const overlapMs = (e) => Math.min(e.ts + e.dur, to) - Math.max(e.ts, from)
    const sumOver = (list) => list.reduce((acc, e) => acc + Math.max(0, overlapMs(e)), 0) / 1000
    const gcMs = sumOver(events.filter((e) => e.ph === 'X' && (e.name === 'MinorGC' || e.name === 'MajorGC') && e.ts < to && e.ts + e.dur > from))
    const gpuMs = sumOver(events.filter((e) => e.ph === 'X' && e.name === 'GPUTask' && e.ts < to && e.ts + e.dur > from))
    const rendererOther = events.filter((e) => e.ph === 'X' && e.pid === pid && e.tid !== tid && e.ts < to && e.ts + e.dur > from)
    const rendererOtherMs = sumOver(rendererOther)
    const traceInterval = (aligned[g].ts - aligned[g - 1].ts) / 1000
    if (g >= WARMUP_FRAMES_IN_PAGE && Math.abs(traceInterval - result.wallIntervalsMs[g - WARMUP_FRAMES_IN_PAGE]) > 1) intervalMismatches += 1
    gaps.push({ frame: g, gapMs: (to - from) / 1000, coveredMs: covered, traceIntervalMs: traceInterval, top, gcMs, gpuMs, rendererOtherMs })
  }
  return { pid, tid, callbacks: list.length, aligned: frames, intervalMismatches, gaps }
}

const windowCpu = (samples, start, end) => {
  const before = samples.filter((sample) => sample.epochMs <= start && sample.cgroup).pop()
  const after = samples.find((sample) => sample.epochMs >= end && sample.cgroup)
  if (!before || !after) return null
  const wallMs = after.epochMs - before.epochMs
  const cgroupCpuMs = (after.cgroup.usageUsec - before.cgroup.usageUsec) / 1000
  const processes = Object.keys(after.procMs)
    .filter((pid) => before.procMs[pid] !== undefined)
    .map((pid) => ({ pid: Number(pid), comm: after.top.find((p) => p.pid === Number(pid))?.comm ?? null, cpuMs: after.procMs[pid] - before.procMs[pid] }))
    .sort((a, b) => b.cpuMs - a.cpuMs)
    .slice(0, 5)
  return {
    sampleWallMs: wallMs,
    cgroupCpuMs,
    cgroupCores: wallMs > 0 ? Math.round((cgroupCpuMs / wallMs) * 100) / 100 : null,
    throttledPeriods: after.cgroup.nrThrottled - before.cgroup.nrThrottled,
    throttledMs: (after.cgroup.throttledUsec - before.cgroup.throttledUsec) / 1000,
    processes,
  }
}

const hiddenSpans = (result) => {
  const visibility = result.visibility
  if (!visibility) return []
  const spans = []
  let hiddenFrom = visibility.initial === 'visible' ? null : 0
  for (const change of visibility.changes) {
    if (change.state === 'visible' && hiddenFrom !== null) {
      spans.push([hiddenFrom, change.atMs])
      hiddenFrom = null
    } else if (change.state !== 'visible' && hiddenFrom === null) hiddenFrom = change.atMs
  }
  if (hiddenFrom !== null) spans.push([hiddenFrom, Infinity])
  return spans
}

const frameCases = (result, samples, gapInfo, gpuRows = []) => {
  if (!result || !Array.isArray(result.wallIntervalsMs) || !Array.isArray(result.frameStartsMs)) return []
  const physicsColumn = Array.isArray(result.rowColumns) ? result.rowColumns.indexOf('physics') : -1
  const cases = []
  result.wallIntervalsMs.forEach((interval, frame) => {
    if (interval <= PLANET_MISSED_FRAME_MS && result.frameTimesMs[frame] <= PLANET_FRAME_BUDGET_MS) return
    const start = result.timeOriginMs + result.frameStartsMs[frame]
    const work = result.frameTimesMs[frame]
    const window = samples.filter((sample) => sample.epochMs >= start - interval && sample.epochMs <= start + work)
    const nearest = samples.length ? samples.reduce((best, sample) => (Math.abs(sample.epochMs - start) < Math.abs(best.epochMs - start) ? sample : best)) : null
    const row = Array.isArray(result.rows) && physicsColumn >= 0 ? result.rows.find((r) => r[0] === frame + WARMUP_FRAMES_IN_PAGE) : null
    const joltStepMs = row ? row[physicsColumn] : null
    const tickMs = row ? row[2] : null
    const gap = gapInfo && gapInfo.gaps ? gapInfo.gaps.find((x) => x.frame === frame + WARMUP_FRAMES_IN_PAGE) : null
    const busyShare = gap && gap.gapMs > 0 ? gap.coveredMs / gap.gapMs : null
    const hiddenInGap = hiddenSpans(result).some(([from, to]) => from < start && to > start - interval)
    const classification = hiddenInGap
      ? 'page-hidden-in-gap: another page was in front, so the browser held this page back'
      : work > PLANET_FRAME_BUDGET_MS
      ? 'code-defect: in-callback work over budget'
      : busyShare !== null && busyShare >= 0.5
        ? 'page-main-thread-busy-in-gap: ' + gap.top.map((t) => t.name).join(', ')
        : 'renderer-main-thread-idle-in-gap: the wait is outside the page main thread (browser, GPU or host)'
    cases.push({
      gapMs: gap ? Math.round(gap.gapMs * 100) / 100 : null,
      mainThreadBusyMs: gap ? Math.round(gap.coveredMs * 100) / 100 : null,
      mainThreadTop: gap ? gap.top : null,
      intervalMs: interval,
      workMs: work,
      startEpochMs: Math.round(start),
      classification,
      samples: window.length,
      maxLoad1: window.length ? Math.max(...window.map((sample) => sample.load1)) : null,
      topInWindow: window.length ? window.flatMap((sample) => sample.top).sort((a, b) => b.pcpu - a.pcpu).slice(0, 3) : [],
      loadAtFrameStart: nearest ? nearest.load1 : null,
      topAtFrameStart: nearest ? nearest.top.slice(0, 3) : [],
      gcMs: gap ? Math.round(gap.gcMs * 100) / 100 : null,
      gpuTaskMs: gap ? Math.round(gap.gpuMs * 100) / 100 : null,
      rendererOtherThreadMs: gap ? Math.round(gap.rendererOtherMs * 100) / 100 : null,
      pageHiddenInGap: hiddenInGap,
      gpuProcessesNearFrame: gpuNear(gpuRows, start),
      joltStepMs,
      tickOutsideJoltMs: tickMs !== null && joltStepMs !== null ? Math.round((tickMs - joltStepMs) * 100) / 100 : null,
      hostCpuInFrame: windowCpu(samples, start, start + work),
      frameIndex: frame + WARMUP_FRAMES_IN_PAGE,
    })
  })
  return cases
}

const summary = []
let failed = 0
const only = process.env.PLANET_ONLY
for (const config of PLANET_RUNS.filter((run) => !only || only === run.tier + '-' + run.backend)) {
  const label = config.tier + '-' + config.backend
  const started = Date.now()
  const load1Before = loadavg()[0]
  const samples = []
  const stop = { done: false }
  const sampling = sampleHost(samples, stop)
  const gpuRows = []
  const stopGpu = sampleGpu(gpuRows)
  const run = await runRenderWitness({ root, port, query: planetQuery(config, frames), trace: true, gpuTrace: true, timeoutMs: RUN_TIMEOUT_MS })
  stop.done = true
  await sampling
  stopGpu()
  const wallMs = Date.now() - started
  const load = { cpus: cpus().length, load1Before, load1After: loadavg()[0], topProcesses: topProcesses() }
  const verdict = run.error || !run.result ? { ok: false, failures: ['run failed: ' + (run.error ?? 'no result')] } : planetVerdict(run.result, config)
  if (!verdict.ok) failed += 1
  const gapInfo = traceGaps(run.trace, run.result, frames)
  const cases = frameCases(run.result, samples, gapInfo, gpuRows)
  mkdirSync(resolve(outDir, 'traces'), { recursive: true })
  if (cases.length > 0) {
    mkdirSync(resolve(outDir, 'dumps'), { recursive: true })
    const dumpName = label + '-frame' + cases[0].frameIndex + '.trace.json'
    writeFileSync(resolve(outDir, 'dumps', dumpName), JSON.stringify({ label, trigger: 'long-frame', frameCases: cases, firstCallMs: run.result?.firstCallMs ?? null, traceEvents: run.trace ?? [] }) + '\n')
  }
  writeFileSync(resolve(outDir, label + '.json'), JSON.stringify({ label, wallMs, load, verdict, frameCases: cases, traceGapSummary: { pid: gapInfo.pid, tid: gapInfo.tid, callbacks: gapInfo.callbacks, aligned: gapInfo.aligned, intervalMismatches: gapInfo.intervalMismatches, error: gapInfo.error ?? null }, hostSamples: samples, gpuSamples: gpuRows, result: run.result ?? null }, null, 1) + '\n')
  const wallMaxMs = run.result ? run.result.wallIntervalMaxMs : null
  summary.push({ label, wallMs, ok: verdict.ok, workMaxMs: verdict.maxMs, workP99Ms: verdict.p99Ms, wallMaxMs, workerTick: run.result?.workerTick ?? null, missedFrames: cases.length, frameCases: cases.map((c) => ({ frame: c.frame, intervalMs: c.intervalMs, workMs: c.workMs, classification: c.classification, maxLoad1: c.maxLoad1, gapMs: c.gapMs, mainThreadBusyMs: c.mainThreadBusyMs, topInWindow: c.topInWindow })), load, failures: verdict.failures })
}

console.log(JSON.stringify({ outDir, budgetMs: 16.7, runs: summary }, null, 1))
if (failed > 0) {
  console.error('planet witness: ' + failed + ' of ' + PLANET_RUNS.length + ' runs missed the budget or a requirement')
  process.exitCode = 1
}
