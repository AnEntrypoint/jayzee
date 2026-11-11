import { availableParallelism } from 'node:os'
import { closeSync, openSync, readdirSync, readFileSync, readSync } from 'node:fs'
import { PerformanceObserver } from 'node:perf_hooks'
import { loadEngineModule, resolvePlan } from '../../src/engine/EngineWorld.js'
import { readLayout } from '../../src/engine/bridge.js'
import { BODY_SPACING_M, GROUND, PLANET_RADIUS_M, TIER_1024 } from '../../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../../src/engine/planetStream.js'
import { attachPoseRegion, poseRegionBuffers } from '../../src/engine/poseRegion.js'
import { createPoseStepper } from '../../src/engine/poseHandoffCore.js'
import { warmEngine } from '../../src/engine/warmEngine.js'

const BUDGET_MS = 16.7
const BOOT_TICKS = 2
const SETTLE_END = 300
const TRACE_TICKS = 900
const DEFAULT_POINT_SLEEP_SPEED = 0.03
const PLAYERS = 1024

const [glue, bodiesArg, workersArg, ticksArg, budgetArg, iterationsArg = 'default', scene = 'planet', warmArg = 'cold', warmSpecArg = 'default', knobsArg = 'none'] = process.argv.slice(2)
const knobs = Object.fromEntries(knobsArg === 'none' ? [] : knobsArg.split(',').map((pair) => pair.split('=')))
const bodies = Number(bodiesArg)
const workers = Number(workersArg)
const ticks = Number(ticksArg)
const budgetBytes = Number(budgetArg)
const iterations = iterationsArg === 'default' ? solverIterationsFor(PLAYERS) : Number(iterationsArg)
const onPlanet = scene === 'planet'
const baseY = onPlanet ? PLANET_RADIUS_M : 0
const FLAT_SPOT = Float64Array.of(0, 25, 60)
const warm = warmArg === 'warm'
const base = { kind: 'tick', scene, warm, warmSpec: warmSpecArg, knobs: knobsArg, awakeBudget: knobs.awake !== undefined ? Number(knobs.awake) : TIER_1024.awakeBudget, variant: glue.includes('/variants/') ? glue.split('/').at(-2) : glue.includes('/reference/') ? 'reference' : 'base', glue: glue.split('/').pop(), bodies, workers, iterations, budgetMs: BUDGET_MS, budgetBytes, ticks, cpus: availableParallelism(), execArgv: process.execArgv }

const emit = (result) => {
  console.log('RESULT ' + JSON.stringify(result))
  process.exit(0)
}
const round = (ms, digits) => Number(ms.toFixed(digits))
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const over = (values) => values.reduce((n, ms) => n + (ms > BUDGET_MS ? 1 : 0), 0)

const warmSpec = warmSpecArg === 'default' ? {} : { bodies: Number(warmSpecArg.split('x')[0]), ticks: Number(warmSpecArg.split('x')[1]) }
const warmed = warm ? await warmEngine(glue, warmSpec) : null
const loadStarted = performance.now()
let module
try {
  module = await loadEngineModule(glue, resolvePlan({ players: PLAYERS, workers, budgetBytes }))
} catch (error) {
  emit({ ...base, refused: error.code ?? error.name, message: String(error.message).slice(0, 200) })
}
if (warmed) warmed.release()
const loadMs = performance.now() - loadStarted

const setupStarted = performance.now()
const status = module._engine_world_configure(bodies, TIER_1024.tickRate, TIER_1024.gravity, TIER_1024.drag, TIER_1024.radius, TIER_1024.restitution, iterations)
if (status !== 0) emit({ ...base, refused: 'world-configure', status })
if (!onPlanet) module._engine_world_add_box(...GROUND)
const knobStatus = []
if (knobs.sleep !== undefined) knobStatus.push(module._engine_world_set_sleep(Number(knobs.sleep), DEFAULT_POINT_SLEEP_SPEED))
const budgetSetter = typeof module._engine_world_set_awake_budget === 'function'
const awakeBudget = knobs.awake !== undefined ? Number(knobs.awake) : budgetSetter ? TIER_1024.awakeBudget : 0
if (budgetSetter) knobStatus.push(module._engine_world_set_awake_budget(awakeBudget))
else if (awakeBudget !== 0) knobStatus.push(-1)
if (knobs.asleep !== undefined) knobStatus.push(module._engine_world_set_spawn_asleep(1))
if (knobs.tune !== undefined) knobStatus.push(typeof module._engine_world_set_tuning === 'function' ? module._engine_world_set_tuning(Number(knobs.tune)) : -1)
if (knobStatus.some((code) => code !== 0)) emit({ ...base, refused: 'knob', status: knobStatus })
const perRow = Math.ceil(Math.sqrt(bodies))
for (let i = 0; i < bodies; i++) {
  module._engine_spawn((i % perRow) * BODY_SPACING_M - 30, baseY + 1 + (i % 5), Math.floor(i / perRow) * BODY_SPACING_M - 30, 0, 0, 0)
}
module._engine_world_optimize()
const streamer = onPlanet ? createPlanetStreamer(module, { baseY }) : { step: () => FLAT_SPOT }
const poseBytes = module._engine_pose_bytes()
const reserve = module._engine_pose_reserve()
const region = attachPoseRegion(poseRegionBuffers({ slots: 1, poseBytes }), { owner: true })
const stepper = createPoseStepper({ module, streamer, region, reserve })
const setupMs = performance.now() - setupStarted

const openCounter = (path) => {
  try {
    return openSync(path, 'r')
  } catch {
    return -1
  }
}
const counterBytes = Buffer.alloc(4096)
const NEWLINE = 10
const SPACE = 32
const numberAfter = (bytes, length, label, skipFields) => {
  const at = bytes.indexOf(label)
  if (at < 0 || at >= length) return -1
  let i = at + label.length
  for (let skipped = 0; skipped <= skipFields; skipped++) {
    while (i < length && bytes[i] === SPACE) i += 1
    if (skipped === skipFields) break
    while (i < length && bytes[i] !== SPACE && bytes[i] !== NEWLINE) i += 1
  }
  let value = 0
  while (i < length && bytes[i] >= 48 && bytes[i] <= 57) {
    value = value * 10 + bytes[i] - 48
    i += 1
  }
  return value
}
const THROTTLED_LABEL = Buffer.from('nr_throttled ')
const THROTTLED_USEC_LABEL = Buffer.from('throttled_usec ')
const STAT_LABEL = Buffer.from('cpu ')
const STEAL_FIELD = 7
const cgroupFd = openCounter('/sys/fs/cgroup/cpu.stat')
const statFd = openCounter('/proc/stat')
const throttledAt = new Float64Array(ticks + 1).fill(-1)
const throttledUsecAt = new Float64Array(ticks + 1).fill(-1)
const stealAt = new Float64Array(ticks + 1).fill(-1)
const readCounters = (at) => {
  if (cgroupFd >= 0) {
    const length = readSync(cgroupFd, counterBytes, 0, counterBytes.length, 0)
    throttledAt[at] = numberAfter(counterBytes, length, THROTTLED_LABEL, 0)
    throttledUsecAt[at] = numberAfter(counterBytes, length, THROTTLED_USEC_LABEL, 0)
  }
  if (statFd >= 0) {
    const length = readSync(statFd, counterBytes, 0, 512, 0)
    stealAt[at] = numberAfter(counterBytes, length, STAT_LABEL, STEAL_FIELD)
  }
}
const NS_PER_MS = 1e6
const fieldAt = (bytes, length, index) => {
  let i = 0
  for (let skipped = 0; skipped < index; skipped++) {
    while (i < length && bytes[i] !== SPACE) i += 1
    i += 1
  }
  let value = 0
  while (i < length && bytes[i] >= 48 && bytes[i] <= 57) {
    value = value * 10 + bytes[i] - 48
    i += 1
  }
  return value
}
const listThreads = () => {
  try {
    return readdirSync('/proc/self/task').map((tid) => ({ tid: Number(tid), fd: openCounter('/proc/self/task/' + tid + '/schedstat'), name: readFileSync('/proc/self/task/' + tid + '/comm', 'utf8').trim() })).filter((thread) => thread.fd >= 0)
  } catch {
    return []
  }
}
const threads = listThreads()
const ENGINE_POOL_THREADS = 3
const isEngineThread = (index) => index === 0 || index >= threads.length - ENGINE_POOL_THREADS
const threadWaitNs = new Float64Array(threads.length)
const threadRunNs = new Float64Array(threads.length)
const helperRunMs = new Float64Array(ticks)
const waitMaxMs = new Float64Array(ticks)
const waitSumMs = new Float64Array(ticks)
const waitThread = new Int32Array(ticks).fill(-1)
const readThreadWaits = (tick) => {
  let worst = 0
  let sum = 0
  let who = -1
  let helpers = 0
  for (let t = 0; t < threads.length; t++) {
    const length = readSync(threads[t].fd, counterBytes, 0, 128, 0)
    const waited = fieldAt(counterBytes, length, 1)
    const ran = fieldAt(counterBytes, length, 0)
    const delta = waited - threadWaitNs[t]
    if (!isEngineThread(t)) helpers += ran - threadRunNs[t]
    threadWaitNs[t] = waited
    threadRunNs[t] = ran
    if (tick < 0) continue
    sum += delta
    if (delta > worst) {
      worst = delta
      who = t
    }
  }
  if (tick < 0) return
  waitMaxMs[tick] = worst / NS_PER_MS
  waitSumMs[tick] = sum / NS_PER_MS
  waitThread[tick] = who
  helperRunMs[tick] = helpers / NS_PER_MS
}
const activeOf = typeof module._engine_world_active_bodies === 'function' ? module._engine_world_active_bodies : null
const active = new Int32Array(ticks)
const collections = []
const gcObserver = new PerformanceObserver((list) => collections.push(...list.getEntries()))
gcObserver.observe({ entryTypes: ['gc'] })
const loopStarted = performance.now()
const times = new Float64Array(ticks)
readCounters(0)
readThreadWaits(-1)
for (let f = 0; f < ticks; f++) {
  region.setFrame(0, f)
  const at = performance.now()
  stepper(0)
  times[f] = performance.now() - at
  if (activeOf) active[f] = activeOf()
  readCounters(f + 1)
  readThreadWaits(f)
}
for (const thread of threads) closeSync(thread.fd)
if (cgroupFd >= 0) closeSync(cgroupFd)
if (statFd >= 0) closeSync(statFd)
const hostCounters = throttledAt[0] >= 0 && stealAt[0] >= 0
const throttledIn = (tick) => throttledAt[tick + 1] - throttledAt[tick]
const throttledUsecIn = (tick) => throttledUsecAt[tick + 1] - throttledUsecAt[tick]
const stealIn = (tick) => stealAt[tick + 1] - stealAt[tick]
const RUNQUEUE_WAIT_MS = 5
const HELPER_IDLE_MS = 1
const throttledAround = (tick) => hostCounters && throttledIn(tick) > 0
const stolenAround = (tick) => hostCounters && stealIn(tick) > 0
const preemptedAround = (tick) => waitThread[tick] >= 0 && isEngineThread(waitThread[tick]) && waitMaxMs[tick] >= RUNQUEUE_WAIT_MS && helperRunMs[tick] < HELPER_IDLE_MS
collections.push(...gcObserver.takeRecords())
gcObserver.disconnect()
const overTicks = []
times.forEach((ms, tick) => {
  if (ms > BUDGET_MS) overTicks.push([tick, round(ms, 2), activeOf ? active[tick] : null, hostCounters ? throttledIn(tick) : null, hostCounters ? round(throttledUsecIn(tick) / 1000, 2) : null, hostCounters ? stealIn(tick) : null, threads.length ? round(waitMaxMs[tick], 2) : null, waitThread[tick] >= 0 ? (isEngineThread(waitThread[tick]) ? 'engine thread ' : 'helper thread ') + waitThread[tick] : null, threads.length ? round(waitSumMs[tick], 2) : null, threads.length ? round(helperRunMs[tick], 2) : null])
})
const sortedWaits = Float64Array.from(waitMaxMs).sort()
const sortedHelperRuns = Float64Array.from(helperRunMs).sort()
let helperRunTotalMs = 0
for (let tick = 0; tick < ticks; tick++) helperRunTotalMs += helperRunMs[tick]
const hostOver = { throttled: 0, stolen: 0, preempted: 0, any: 0 }
times.forEach((ms, tick) => {
  if (ms <= BUDGET_MS) return
  const throttled = throttledAround(tick)
  const stolen = stolenAround(tick)
  const preempted = preemptedAround(tick)
  if (throttled) hostOver.throttled += 1
  if (stolen) hostOver.stolen += 1
  if (preempted) hostOver.preempted += 1
  if (throttled || stolen || preempted) hostOver.any += 1
})
let lastActiveTick = -1
if (activeOf) active.forEach((count, tick) => {
  if (count > 0) lastActiveTick = tick
})

const layout = readLayout(module)
const sorted = Float64Array.from(times).sort()
const settle = times.subarray(Math.min(ticks, BOOT_TICKS), Math.min(ticks, SETTLE_END))
const steady = times.subarray(Math.min(ticks, SETTLE_END))
const settleSorted = Float64Array.from(settle).sort()
const steadySorted = Float64Array.from(steady).sort()
emit({
  ...base,
  warmMs: warmed ? round(warmed.ms, 1) : null,
  warmed: warmed ? warmed.warmed : null,
  loadMs: round(loadMs, 1),
  setupMs: round(setupMs, 1),
  medianMs: round(quantile(sorted, 0.5), 3),
  p99Ms: round(quantile(sorted, 0.99), 3),
  maxMs: round(sorted[sorted.length - 1], 3),
  overBudget: over(times),
  overBudgetHost: hostOver.any,
  overBudgetHostThrottled: hostOver.throttled,
  overBudgetHostStolen: hostOver.stolen,
  overBudgetHostPreempted: hostOver.preempted,
  hostRule: 'a tick over budget is the host when the cgroup throttle counter moved in it, or steal time moved in it, or an engine thread waited ' + RUNQUEUE_WAIT_MS + ' ms or more on the run queue in it while the helper threads of the process ran under ' + HELPER_IDLE_MS + ' ms',
  hostCounters,
  threadsWatched: threads.map((thread) => thread.name),
  waitMaxMedianMs: threads.length ? round(quantile(sortedWaits, 0.5), 3) : null,
  waitMaxP99Ms: threads.length ? round(quantile(sortedWaits, 0.99), 3) : null,
  helperRunMedianMs: threads.length ? round(quantile(sortedHelperRuns, 0.5), 3) : null,
  helperRunP99Ms: threads.length ? round(quantile(sortedHelperRuns, 0.99), 3) : null,
  helperRunTotalMs: threads.length ? round(helperRunTotalMs, 1) : null,
  throttledPeriods: hostCounters ? throttledAt[ticks] - throttledAt[0] : null,
  throttledMs: hostCounters ? round((throttledUsecAt[ticks] - throttledUsecAt[0]) / 1000, 1) : null,
  stealJiffies: hostCounters ? stealAt[ticks] - stealAt[0] : null,
  bootTicksMs: Array.from(times.subarray(0, BOOT_TICKS), (ms) => round(ms, 2)),
  settleTicks: settle.length,
  settleMedianMs: settle.length ? round(quantile(settleSorted, 0.5), 3) : null,
  settleP99Ms: settle.length ? round(quantile(settleSorted, 0.99), 3) : null,
  settleMaxMs: settle.length ? round(settleSorted[settleSorted.length - 1], 3) : null,
  settleOverBudget: over(settle),
  steadyTicks: steady.length,
  steadyMedianMs: steady.length ? round(quantile(steadySorted, 0.5), 3) : null,
  steadyP99Ms: steady.length ? round(quantile(steadySorted, 0.99), 3) : null,
  steadyMaxMs: steady.length ? round(steadySorted[steadySorted.length - 1], 3) : null,
  steadyOverBudget: over(steady),
  arenaBytes: layout.arenaBytes,
  arenaUsedBytes: layout.usedBytes,
  wasmMemoryBytes: Number(module._engine_memory_bytes()),
  planBodies: layout.bodies,
  overTicks: overTicks.slice(0, 40),
  peakActive: activeOf ? Math.max(...active) : null,
  lastActiveTick: activeOf ? lastActiveTick : null,
  gcCount: collections.length,
  gcMs: round(collections.reduce((sum, entry) => sum + entry.duration, 0), 2),
  gcAtMs: collections.slice(0, 8).map((entry) => round(entry.startTime - loopStarted, 0)),
  traceMs: Array.from(times.subarray(0, Math.min(ticks, TRACE_TICKS)), (ms) => round(ms, 1)),
  activeTrace: activeOf ? Array.from(active.subarray(0, Math.min(ticks, TRACE_TICKS))) : null,
})
