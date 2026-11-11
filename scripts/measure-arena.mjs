import { loadEngineModule, releaseEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { BODY_SPACING_M, PLANET_RADIUS_M, TIER_1024 } from '../src/engine/sceneSetup.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { createPlanetStreamer } from '../src/engine/planetStream.js'
import { attachPoseRegion, poseRegionBuffers } from '../src/engine/poseRegion.js'
import { createPoseStepper } from '../src/engine/poseHandoffCore.js'

export const PLAN_TERMS = Object.freeze(['body rows', 'jolt bodies', 'jolt statics', 'contacts', 'body pairs', 'temp', 'jolt fixed', 'pool primed', 'quad nodes', 'pages', 'vegetation', 'materials', 'render', 'models', 'host', 'bridge', 'interest', 'codec', 'workers', 'slack'])

const MIB = 1024 * 1024
const [glue, budgetMibArg = '1024', workersArg = '4', ticksArg = '200', awakeArg = '0', bodiesArg = 'plan'] = process.argv.slice(2)
if (!glue) throw new TypeError('usage: measure-arena.mjs <glue url or path> [budget MiB] [workers] [ticks] [awake budget] [bodies]')
const module = await loadEngineModule(glue.startsWith('file:') ? glue : new URL(glue, 'file://' + process.cwd() + '/').href, resolvePlan({ players: 1024, workers: Number(workersArg), budgetBytes: Number(budgetMibArg) * MIB }))
const used = () => readLayout(module).usedBytes
const layout = readLayout(module)
const bodies = bodiesArg === 'plan' ? layout.bodies : Number(bodiesArg)
const terms = Array.from({ length: module._engine_plan_term_count() }, (_, term) => module._engine_plan_term_bytes(term))
if (terms.length !== PLAN_TERMS.length) throw new Error('the engine reports ' + terms.length + ' plan terms and this script names ' + PLAN_TERMS.length)
const stages = [['after init', used()]]
const status = module._engine_world_configure(bodies, TIER_1024.tickRate, TIER_1024.gravity, TIER_1024.drag, TIER_1024.radius, TIER_1024.restitution, solverIterationsFor(1024))
if (status !== 0) throw new Error('world configure status ' + status)
stages.push(['after configure', used()])
if (module._engine_world_set_awake_budget(Number(awakeArg)) !== 0) throw new Error('awake budget refused')
const perRow = Math.ceil(Math.sqrt(bodies))
for (let i = 0; i < bodies; i++) module._engine_spawn((i % perRow) * BODY_SPACING_M - 30, PLANET_RADIUS_M + 1 + (i % 5), Math.floor(i / perRow) * BODY_SPACING_M - 30, 0, 0, 0)
module._engine_world_optimize()
stages.push(['after spawn', used()])
const streamer = createPlanetStreamer(module, { baseY: PLANET_RADIUS_M })
const poseBytes = module._engine_pose_bytes()
const region = attachPoseRegion(poseRegionBuffers({ slots: 1, poseBytes }), { owner: true })
const stepper = createPoseStepper({ module, streamer, region, reserve: module._engine_pose_reserve() })
stages.push(['after streamer and pose reserve', used()])
for (let frame = 0; frame < Number(ticksArg); frame++) {
  region.setFrame(0, frame)
  stepper(0)
}
stages.push(['after ' + ticksArg + ' ticks', used()])
const total = terms.reduce((sum, bytes) => sum + bytes, 0)
const perBody = (bytes) => Number((bytes / bodies).toFixed(1))
console.log(JSON.stringify({
  glue: glue.split('/').pop(),
  budgetMib: Number(budgetMibArg),
  bodies,
  planBodies: layout.bodies,
  awakeBudget: Number(awakeArg),
  arenaBytes: layout.arenaBytes,
  planTotalBytes: total,
  planBytesPerBody: perBody(total),
  plan: Object.fromEntries(PLAN_TERMS.map((name, term) => [name, { bytes: terms[term], perBody: perBody(terms[term]) }])),
  usedBytes: Object.fromEntries(stages),
  usedPerBodyAtEnd: perBody(stages.at(-1)[1]),
  configureBytesPerBody: perBody(stages[1][1] - stages[0][1]),
  tempPeakBytes: module._engine_world_temp_peak_bytes(),
  tempPeakPerBody: perBody(module._engine_world_temp_peak_bytes()),
  tempPlanBytes: terms[PLAN_TERMS.indexOf('temp')],
  wasmMemoryBytes: Number(module._engine_memory_bytes()),
}, null, 1))
await releaseEngineModule(module)
