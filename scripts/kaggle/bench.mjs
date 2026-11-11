import { availableParallelism } from 'node:os'
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
const TRACE_TICKS = 320
const PLAYERS = 1024

const [glue, bodiesArg, workersArg, ticksArg, budgetArg, iterationsArg = 'default', scene = 'planet', warmArg = 'cold', warmSpecArg = 'default'] = process.argv.slice(2)
const bodies = Number(bodiesArg)
const workers = Number(workersArg)
const ticks = Number(ticksArg)
const budgetBytes = Number(budgetArg)
const iterations = iterationsArg === 'default' ? solverIterationsFor(PLAYERS) : Number(iterationsArg)
const onPlanet = scene === 'planet'
const baseY = onPlanet ? PLANET_RADIUS_M : 0
const FLAT_SPOT = Float64Array.of(0, 25, 60)
const warm = warmArg === 'warm'
const base = { kind: 'tick', scene, warm, warmSpec: warmSpecArg, variant: glue.includes('/variants/') ? glue.split('/').at(-2) : glue.includes('/reference/') ? 'reference' : 'base', glue: glue.split('/').pop(), bodies, workers, iterations, budgetMs: BUDGET_MS, budgetBytes, ticks, cpus: availableParallelism(), execArgv: process.execArgv }

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

const times = new Float64Array(ticks)
for (let f = 0; f < ticks; f++) {
  region.setFrame(0, f)
  const at = performance.now()
  stepper(0)
  times[f] = performance.now() - at
}

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
  traceMs: Array.from(times.subarray(0, Math.min(ticks, TRACE_TICKS)), (ms) => round(ms, 1)),
})
