import { availableParallelism } from 'node:os'
import { PerformanceObserver } from 'node:perf_hooks'
import { loadEngineModule, resolvePlan } from '../../src/engine/EngineWorld.js'
import { BRIDGE, readLayout } from '../../src/engine/bridge.js'
import { BODY_SPACING_M, GROUND, PLANET_RADIUS_M, TIER_1024 } from '../../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../../src/engine/planetStream.js'
import { attachPoseRegion, poseRegionBuffers } from '../../src/engine/poseRegion.js'
import { createPoseStepper } from '../../src/engine/poseHandoffCore.js'
import { warmEngine } from '../../src/engine/warmEngine.js'
import { createTickProbe } from './tickProbe.mjs'

const BUDGET_MS = 16.7
const BOOT_TICKS = 2
const SETTLE_END = 300
const TRACE_TICKS = 900
const SHOWN_OVER_TICKS = 40
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
const variantOf = (path) => (path.includes('/variants/') ? path.split('/').at(-2) : path.includes('/reference/') ? 'reference' : 'base')
const base = { kind: 'tick', scene, warm, warmSpec: warmSpecArg, knobs: knobsArg, variant: variantOf(glue), glue: glue.split('/').pop(), bodies, workers, iterations, budgetMs: BUDGET_MS, budgetBytes, ticks, cpus: availableParallelism(), execArgv: process.execArgv }

const emit = (result) => {
  console.log('RESULT ' + JSON.stringify(result))
  process.exit(0)
}
const round = (ms, digits) => Number(ms.toFixed(digits))
const quantile = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))]
const over = (values) => values.reduce((n, ms) => n + (ms > BUDGET_MS ? 1 : 0), 0)
const exported = (name) => (typeof module[name] === 'function' ? module[name] : null)

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
if (status !== 0) emit({ ...base, refused: 'world-configure', status, planBodies: readLayout(module).bodies })
if (!onPlanet) module._engine_world_add_box(...GROUND)
const knobStatus = []
const setBudget = exported('_engine_world_set_awake_budget')
const setTuning = exported('_engine_world_set_tuning')
const awakeBudget = knobs.awake !== undefined ? Number(knobs.awake) : setBudget ? TIER_1024.awakeBudget : 0
if (knobs.sleep !== undefined) knobStatus.push(module._engine_world_set_sleep(Number(knobs.sleep), DEFAULT_POINT_SLEEP_SPEED))
if (setBudget) knobStatus.push(setBudget(awakeBudget))
else if (awakeBudget !== 0) knobStatus.push(-1)
if (knobs.asleep !== undefined) knobStatus.push(module._engine_world_set_spawn_asleep(1))
if (knobs.tune !== undefined) knobStatus.push(setTuning ? setTuning(Number(knobs.tune)) : -1)
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

const activeOf = exported('_engine_world_active_bodies')
const heldOf = exported('_engine_world_held_bodies')
const unsettledOf = exported('_engine_world_unsettled_in_view')
const airborneOf = exported('_engine_world_airborne_bodies')
const active = new Int32Array(ticks)
const held = new Int32Array(ticks + 1)
const unsettled = new Int32Array(ticks)
const airborne = new Int32Array(ticks)
const probe = createTickProbe({ module, ticks, budgetMs: BUDGET_MS, layoutUsedWord: BRIDGE.LAYOUT.WORDS.USED_BYTES })
const collections = []
const gcObserver = new PerformanceObserver((list) => collections.push(...list.getEntries()))
gcObserver.observe({ entryTypes: ['gc'] })
const loopStarted = performance.now()
const times = new Float64Array(ticks)
held[0] = heldOf ? heldOf() : 0
probe.start()
for (let f = 0; f < ticks; f++) {
  region.setFrame(0, f)
  const at = performance.now()
  stepper(0)
  times[f] = performance.now() - at
  if (activeOf) active[f] = activeOf()
  if (heldOf) held[f + 1] = heldOf()
  if (unsettledOf) unsettled[f] = unsettledOf()
  if (airborneOf) airborne[f] = airborneOf()
  probe.record(f)
}
probe.close()
collections.push(...gcObserver.takeRecords())
gcObserver.disconnect()

const overTicks = []
times.forEach((ms, tick) => {
  if (ms <= BUDGET_MS) return
  overTicks.push({ ...probe.describe(tick, ms), awake: activeOf ? active[tick] : null, released: heldOf ? held[tick] - held[tick + 1] : null, airborne: airborneOf ? airborne[tick] : null })
})
const lastTickWith = (counts) => {
  let last = -1
  counts.forEach((count, tick) => {
    if (count > 0) last = tick
  })
  return last
}
const lastActiveTick = activeOf ? lastTickWith(active) : -1
const activeEnd = lastActiveTick >= BOOT_TICKS ? lastActiveTick + 1 : ticks
let activeSumMs = 0
for (let tick = BOOT_TICKS; tick < activeEnd; tick++) activeSumMs += times[tick]
const layout = readLayout(module)
const sorted = Float64Array.from(times).sort()
const settle = times.subarray(Math.min(ticks, BOOT_TICKS), Math.min(ticks, SETTLE_END))
const steady = times.subarray(Math.min(ticks, SETTLE_END))
const settleSorted = Float64Array.from(settle).sort()
const steadySorted = Float64Array.from(steady).sort()
const termCount = exported('_engine_plan_term_count')
emit({
  ...base,
  awakeBudget,
  tuning: knobs.tune !== undefined ? Number(knobs.tune) : null,
  warmMs: warmed ? round(warmed.ms, 1) : null,
  warmed: warmed ? warmed.warmed : null,
  loadMs: round(loadMs, 1),
  setupMs: round(setupMs, 1),
  medianMs: round(quantile(sorted, 0.5), 3),
  p99Ms: round(quantile(sorted, 0.99), 3),
  maxMs: round(sorted[sorted.length - 1], 3),
  overBudget: over(times),
  activeMeanMs: activeEnd > BOOT_TICKS ? round(activeSumMs / (activeEnd - BOOT_TICKS), 3) : null,
  activeTicks: activeEnd - BOOT_TICKS,
  ...probe.summarise(times, quantile),
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
  planTermBytes: termCount ? Array.from({ length: termCount() }, (_, term) => module._engine_plan_term_bytes(term)) : null,
  tempPeakBytes: exported('_engine_world_temp_peak_bytes') ? module._engine_world_temp_peak_bytes() : null,
  overTicks: overTicks.slice(0, SHOWN_OVER_TICKS),
  peakActive: activeOf ? Math.max(...active) : null,
  lastActiveTick: activeOf ? lastActiveTick : null,
  visualSettleTick: unsettledOf ? lastTickWith(unsettled) + 1 : null,
  heldAtEnd: heldOf ? held[ticks] : null,
  peakAirborne: airborneOf ? Math.max(...airborne) : null,
  gcCount: collections.length,
  gcMs: round(collections.reduce((sum, entry) => sum + entry.duration, 0), 2),
  gcAtMs: collections.slice(0, 8).map((entry) => round(entry.startTime - loopStarted, 0)),
  traceMs: Array.from(times.subarray(0, Math.min(ticks, TRACE_TICKS)), (ms) => round(ms, 1)),
  activeTrace: activeOf ? Array.from(active.subarray(0, Math.min(ticks, TRACE_TICKS))) : null,
})
