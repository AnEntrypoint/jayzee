import { loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { configureWorld } from '../src/engine/sceneSetup.js'
import { readLayout } from '../src/engine/bridge.js'

const PHASES = ['pages', 'inputs', 'physics', 'readback', 'plan', 'backend', 'acquire', 'upload', 'submit', 'encode', 'uploadVegetation', 'uploadProps', 'uploadPages']
const [glue, ticksArg = "300", workersArg = "4", budgetArg = String(512 * 1024 * 1024), warmArg = "60", iterArg] = process.argv.slice(2)
const ticks = Number(ticksArg)
const warm = Number(warmArg)

const module = await loadEngineModule(glue, resolvePlan({ players: 1024, workers: Number(workersArg), budgetBytes: Number(budgetArg) }))
const layout = readLayout(module)
configureWorld(module, iterArg === undefined ? undefined : Number(iterArg), 0)

const phaseCount = module._engine_phase_count ? module._engine_phase_count() : 0
const before = new Float64Array(phaseCount)
const after = new Float64Array(phaseCount)
const readPhases = (out) => {
  for (let i = 0; i < phaseCount; i++) out[i] = module._engine_phase_total_ms(i)
}

for (let i = 0; i < warm; i++) module._engine_tick(1)

const wall = new Float64Array(ticks)
readPhases(before)
for (let i = 0; i < ticks; i++) {
  const at = performance.now()
  module._engine_tick(1)
  wall[i] = performance.now() - at
}
readPhases(after)

const sorted = Float64Array.from(wall).sort()
const pick = (q) => sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]
const perTick = (i) => (after[i] - before[i]) / ticks
const stages = {}
for (let i = 0; i < phaseCount; i++) stages[PHASES[i] ?? 'phase' + i] = Number(perTick(i).toFixed(3))

console.log(JSON.stringify({
  glue,
  players: layout.players,
  bodies: layout.bodies,
  workers: Number(workersArg),
  ticks,
  tickMs: { median: Number(pick(0.5).toFixed(3)), p90: Number(pick(0.9).toFixed(3)), p99: Number(pick(0.99).toFixed(3)), max: Number(sorted[sorted.length - 1].toFixed(3)) },
  meanPhaseMsPerTick: stages,
}, null, 1))
