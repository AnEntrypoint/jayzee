import { readFileSync } from 'node:fs'
import { referenceGlue } from './reference.mjs'

const MIB = 1024 * 1024

export const BASELINE = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'))

export const KERNEL_REF = 'heclgang/jayzee-physics-goalpost'
export const DATASET_REF = 'heclgang/jayzee-physics-bench'
export const BUDGET_MS = 16.7
export const TICKS = 900
export const ARENA_BUDGET_BYTES = 1024 * MIB
export const TOP_TIER_BODIES = 12288
export const HEADROOM_BODIES = Object.freeze([16384, 20480])
export const HEADROOM_WORKERS = Object.freeze([3, 4, 6])
export const HEADROOM_GLUE = 'build/variants/cap20480/engine-core-1024mib-threads-simd.mjs'
export const WARM_SPECS = Object.freeze(['1024x150', '512x90'])
export const WARM_SPEC_REPEATS = 2
export const WORKER_COUNTS = Object.freeze([1, 2, 3, 4, 6, 8])
export const SCALAR_GLUE = 'engine/out/engine-core-1024mib-threads.mjs'
export const SIMD_GLUE = 'engine/out/engine-core-1024mib-threads-simd.mjs'
export const TICK_GLUES = Object.freeze([SCALAR_GLUE, SIMD_GLUE])
export const MARBLE_TIERS = 4
export const MARBLE_RUNS = 5
export const VARIANTS = Object.freeze(['o3', 'lto', 'o3lto', 'layers4', 'rows', 'all'])
export const VARIANT_BODIES = Object.freeze([10240, 12288, 16384])
export const VARIANT_WORKERS = 4
export const VARIANT_REPEATS = 3
export const variantGlue = (name) => 'build/variants/' + name + '/engine-core-1024mib-threads-simd.mjs'

const calibrate = () => ({ script: 'scripts/kaggle/calibrate.mjs', nodeFlags: [], args: [], glueArg: -1, probe: false })
const tick = (glue, bodies, workers, extra = {}) => ({ script: 'scripts/kaggle/bench.mjs', nodeFlags: extra.nodeFlags ?? [], args: [glue, String(bodies), String(workers), String(TICKS), String(ARENA_BUDGET_BYTES), String(extra.iterations ?? 'default'), extra.scene ?? 'planet', extra.warm === false ? 'cold' : 'warm', extra.warmSpec ?? 'default', extra.knobs ?? 'none'], glueArg: 0, probe: extra.probe === true })
const marble = (tier, runs = MARBLE_RUNS, warmRuns = 0) => ({ script: 'scripts/kaggle/marble.mjs', nodeFlags: [], args: [String(tier), String(runs), String(warmRuns)], glueArg: -1, probe: false })

const matrix = () => {
  const runs = []
  for (const warm of [true, false]) for (const glue of TICK_GLUES) for (const workers of WORKER_COUNTS) runs.push(tick(glue, TOP_TIER_BODIES, workers, { warm }))
  for (const bodies of HEADROOM_BODIES) for (const workers of HEADROOM_WORKERS) runs.push(tick(HEADROOM_GLUE, bodies, workers))
  for (const bodies of HEADROOM_BODIES) runs.push(tick(HEADROOM_GLUE, bodies, 4, { warm: false }))
  for (let repeat = 0; repeat < WARM_SPEC_REPEATS; repeat++) for (const warmSpec of ['default', ...WARM_SPECS]) runs.push(tick(SIMD_GLUE, TOP_TIER_BODIES, 4, { warmSpec, probe: true }))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier, BASELINE.marble.runs, BASELINE.marble.warmRuns))
  return runs
}

const variants = () => {
  const runs = []
  for (let repeat = 0; repeat < VARIANT_REPEATS; repeat++) for (const bodies of VARIANT_BODIES) for (const glue of [SIMD_GLUE, ...VARIANTS.map(variantGlue)]) runs.push(tick(glue, bodies, VARIANT_WORKERS))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier))
  return runs
}

const regressWith = (candidate) => () => {
  const runs = []
  const { bodies, workers, repeats } = BASELINE.topTier
  runs.push(calibrate())
  for (let repeat = 0; repeat < repeats; repeat++) for (const glue of [referenceGlue(BASELINE.referenceCommit), candidate]) runs.push(tick(glue, bodies, workers))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier, BASELINE.marble.runs, BASELINE.marble.warmRuns))
  runs.push(calibrate())
  return runs
}

export const CLAIM_CAP = 20480
export const CLAIM_BODIES = Object.freeze([12288, 16384])
export const CLAIM_NEXT_BODIES = 20480
export const CLAIM_REPEATS = 3
export const CLAIM_SCALING_WORKERS = Object.freeze([1, 2, 4])
export const UNBUDGETED_COMMIT = 'de44d1f9addb5193ff617350bc6e75b2306c8923'
export const ALL_AWAKE = 'awake=0'
export const CLAIM_BUDGETS = Object.freeze([5120, 6144])

const claim = () => {
  const runs = [calibrate()]
  const unbudgeted = referenceGlue(UNBUDGETED_COMMIT, CLAIM_CAP)
  for (let repeat = 0; repeat < CLAIM_REPEATS; repeat++) {
    for (const bodies of CLAIM_BODIES) {
      runs.push(tick(unbudgeted, bodies, 4))
      runs.push(tick(HEADROOM_GLUE, bodies, 4))
      for (const budget of CLAIM_BUDGETS) runs.push(tick(HEADROOM_GLUE, bodies, 4, { knobs: 'awake=' + budget, probe: true }))
    }
    runs.push(tick(HEADROOM_GLUE, CLAIM_NEXT_BODIES, 4))
  }
  for (const workers of CLAIM_SCALING_WORKERS) runs.push(tick(HEADROOM_GLUE, TOP_TIER_BODIES, workers, { knobs: ALL_AWAKE, probe: true }))
  runs.push(tick(HEADROOM_GLUE, CLAIM_BODIES[1], 4, { knobs: ALL_AWAKE, probe: true }))
  runs.push(calibrate())
  return runs
}

export const CEILING_CAP = 40960
export const CEILING_GLUE = 'build/variants/cap40960/engine-core-1024mib-threads-simd.mjs'
export const CEILING_BODIES = Object.freeze([12288, 16384, 20480, 24576, 32768, 40960])
export const CEILING_HELD_IN_WORLD_BODIES = Object.freeze([20480, 24576, 32768, 40960])
export const CEILING_REPEATS = 3
export const HELD_IN_WORLD_COMMIT = '675210968a34dcddaa949615b39e55c594bd68d0'
export const TUNINGS = Object.freeze([0, 1, 2, 4, 7])

const ceiling = () => {
  const runs = [calibrate()]
  const unbudgeted = referenceGlue(UNBUDGETED_COMMIT, CEILING_CAP)
  const heldInWorld = referenceGlue(HELD_IN_WORLD_COMMIT, CEILING_CAP)
  for (let repeat = 0; repeat < CEILING_REPEATS; repeat++) {
    runs.push(tick(unbudgeted, TOP_TIER_BODIES, 4))
    for (const bodies of CEILING_BODIES) runs.push(tick(CEILING_GLUE, bodies, 4))
    for (const bodies of CEILING_HELD_IN_WORLD_BODIES) runs.push(tick(heldInWorld, bodies, 4))
    for (const tune of TUNINGS) runs.push(tick(CEILING_GLUE, TOP_TIER_BODIES, 4, { knobs: ALL_AWAKE + ',tune=' + tune, probe: true }))
  }
  runs.push(calibrate())
  return runs
}

export const PLANS = Object.freeze({ ceiling, claim, matrix, variants, regress: regressWith(SIMD_GLUE), control: regressWith(SCALAR_GLUE) })

export const buildPlan = (mode = 'matrix') => {
  if (!Object.hasOwn(PLANS, mode)) throw new RangeError('unknown plan ' + mode)
  return { mode, budgetMs: BUDGET_MS, ticks: TICKS, arenaBudgetBytes: ARENA_BUDGET_BYTES, runs: PLANS[mode]() }
}
