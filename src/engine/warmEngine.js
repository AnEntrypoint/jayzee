import { loadEngineModule, releaseEngineModule, resolvePlan } from './EngineWorld.js'
import { isReservationFailure } from './glueTier.js'
import { BODY_POOL_CAPACITY } from './poolPlan.js'
import { BODY_SPACING_M, PLANET_RADIUS_M, TIER_1024 } from './sceneSetup.js'
import { solverIterationsFor } from './solverIterations.js'
import { createPlanetStreamer } from './planetStream.js'
import { attachPoseRegion, poseRegionBuffers } from './poseRegion.js'
import { createPoseStepper } from './poseHandoffCore.js'

const MIB = 1024 * 1024

export const WARM_DEFAULTS = Object.freeze({ players: 64, budgetBytes: 64 * MIB, bodies: BODY_POOL_CAPACITY.standard, ticks: 300 })

const checkCount = (value, name, least) => {
  if (!Number.isInteger(value) || value < least) throw new RangeError(name + ' must be a whole number at least ' + least)
  return value
}

const runScene = (module, bodies, ticks) => {
  const status = module._engine_world_configure(bodies, TIER_1024.tickRate, TIER_1024.gravity, TIER_1024.drag, TIER_1024.radius, TIER_1024.restitution, solverIterationsFor(1024))
  if (status !== 0) throw new Error('warm world configure status ' + status)
  const perRow = Math.ceil(Math.sqrt(bodies))
  for (let i = 0; i < bodies; i++) module._engine_spawn((i % perRow) * BODY_SPACING_M, PLANET_RADIUS_M + 1 + (i % 5), Math.floor(i / perRow) * BODY_SPACING_M, 0, 0, 0)
  module._engine_world_optimize()
  const streamer = createPlanetStreamer(module, { baseY: PLANET_RADIUS_M })
  const poseBytes = module._engine_pose_bytes()
  const region = attachPoseRegion(poseRegionBuffers({ slots: 1, poseBytes }), { owner: true })
  const step = createPoseStepper({ module, streamer, region, reserve: module._engine_pose_reserve() })
  for (let frame = 0; frame < ticks; frame++) {
    region.setFrame(0, frame)
    step(0)
  }
}

export const warmEngine = async (glue, spec = {}) => {
  const players = checkCount(spec.players ?? WARM_DEFAULTS.players, 'players', 1)
  const bodies = checkCount(spec.bodies ?? WARM_DEFAULTS.bodies, 'bodies', 1)
  const ticks = checkCount(spec.ticks ?? WARM_DEFAULTS.ticks, 'ticks', 1)
  const budgetBytes = spec.budgetBytes ?? WARM_DEFAULTS.budgetBytes
  const now = spec.now ?? (() => performance.now())
  const started = now()
  let module
  try {
    module = await loadEngineModule(glue, resolvePlan({ players, workers: 1, budgetBytes }))
  } catch (error) {
    if (!isReservationFailure(error)) throw error
    return Object.freeze({ warmed: false, reason: 'the warm instance could not reserve its memory: ' + error.message, bodies: 0, ticks: 0, ms: now() - started, release: () => {} })
  }
  runScene(module, bodies, ticks)
  const release = () => {
    if (module === null) return
    releaseEngineModule(module)
    module = null
  }
  return Object.freeze({ warmed: true, reason: null, bodies, ticks, ms: now() - started, release })
}
