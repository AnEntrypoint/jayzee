import { readFileSync } from 'node:fs'
import { referenceGlue } from './reference.mjs'

const MIB = 1024 * 1024

export const BASELINE = JSON.parse(readFileSync(new URL('./baseline.json', import.meta.url), 'utf8'))

export const KERNEL_REF = 'heclgang/jayzee-physics-goalpost'
export const DATASET_REF = 'heclgang/jayzee-physics-bench'
export const BUDGET_MS = 16.7
export const TICKS = 900
export const ARENA_BUDGET_BYTES = 1024 * MIB
export const TOP_TIER_BODIES = 131072
export const COMPACT_BODIES = 12288
export const HEADROOM_BODIES = Object.freeze([49152, 65536])
export const HEADROOM_WORKERS = Object.freeze([3, 4, 6])
export const HEADROOM_GLUE = 'build/variants/cap65536/engine-core-1024mib-threads-simd.mjs'
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

export const DRY_BODIES = 4096
export const DRY_TICKS = 40
export const DRY_BUDGET_KNOB = 'budget=0.01'
export const DRY_CANARY_SECONDS = 2
export const CANARY_SECONDS = 45
export const CANARY_END_SECONDS = 25

const calibrate = () => ({ script: 'scripts/kaggle/calibrate.mjs', nodeFlags: [], args: [], dryArgs: [], glueArg: -1, probe: false })
const tickArgs = (glue, bodies, workers, ticks, extra, knobs) => [glue, String(bodies), String(workers), String(ticks), String(ARENA_BUDGET_BYTES), String(extra.iterations ?? 'default'), extra.scene ?? 'planet', extra.warm === false ? 'cold' : 'warm', extra.warmSpec ?? 'default', knobs]
const tick = (glue, bodies, workers, extra = {}) => ({
  script: 'scripts/kaggle/bench.mjs',
  nodeFlags: extra.nodeFlags ?? [],
  args: tickArgs(glue, bodies, workers, extra.ticks ?? TICKS, extra, extra.knobs ?? 'none'),
  dryArgs: tickArgs(glue, Math.min(bodies, DRY_BODIES), workers, DRY_TICKS, extra, extra.knobs ? extra.knobs + ',' + DRY_BUDGET_KNOB : DRY_BUDGET_KNOB),
  glueArg: 0,
  probe: extra.probe === true,
  role: extra.role ?? (extra.probe === true ? 'probe' : 'matrix'),
})
const marble = (tier, runs = MARBLE_RUNS, warmRuns = 0) => ({ script: 'scripts/kaggle/marble.mjs', nodeFlags: [], args: [String(tier), String(runs), String(warmRuns)], dryArgs: [String(tier), '1', '0'], glueArg: -1, probe: false })
export const PIPE_PROBE_BYTES = 300000
const pipeProbe = () => ({ script: 'scripts/kaggle/pipeProbe.mjs', nodeFlags: [], args: [String(PIPE_PROBE_BYTES)], dryArgs: [String(PIPE_PROBE_BYTES)], glueArg: -1, probe: true, role: 'pipe-probe', dryOnly: true })
const canary = (threads, seconds = CANARY_SECONDS) => ({ script: 'scripts/kaggle/canary.mjs', nodeFlags: [], args: [String(seconds), String(threads)], dryArgs: [String(DRY_CANARY_SECONDS), String(threads)], glueArg: -1, probe: true, role: 'canary' })

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

export const RECORD_WORKERS = Object.freeze([1, 2, 3, 6])
export const PROFILE_VARIANT = 'profile'
export const PROFILE_REPEATS = 6
export const PROFILE_UNRECLAIMED_REPEATS = 0
export const CANARY_THREADS = Object.freeze([1, 4])
export const TUNE_DEFAULT = 12
export const RELEASE_ORDER_REPEATS = 8
export const SETTLE_REPEATS = 5
export const PROFILE_COMPACT_REPEATS = 3
export const RECLAIM_OFF = 'reclaim=off'
export const SETTLE_TICKS = 3000
export const VIEW_BODIES = 40960
export const TUNE_DEFAULT_BY_SLOT = 28
export const VIEW_KNOBS = Object.freeze(['none', 'tune=' + TUNE_DEFAULT_BY_SLOT, 'still=1', 'still=1,tune=' + TUNE_DEFAULT_BY_SLOT])

const regressWith = (candidate) => () => {
  const runs = []
  const { bodies, workers, repeats } = BASELINE.topTier
  runs.push(calibrate())
  for (let repeat = 0; repeat < SETTLE_REPEATS; repeat++) for (const glue of [referenceGlue(BASELINE.referenceCommit), candidate]) runs.push(tick(glue, bodies, workers, { role: 'settle' }))
  for (let repeat = 0; repeat < repeats; repeat++) for (const glue of [referenceGlue(BASELINE.referenceCommit), candidate]) runs.push(tick(glue, bodies, workers, { role: 'gate' }))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier, BASELINE.marble.runs, BASELINE.marble.warmRuns))
  for (let repeat = 0; repeat < RELEASE_ORDER_REPEATS; repeat++) {
    for (const tune of [TUNE_DEFAULT, TUNE_DEFAULT_BY_SLOT]) runs.push(tick(candidate, bodies, workers, { role: 'release order', knobs: 'tune=' + tune }))
  }
  for (const count of RECORD_WORKERS) runs.push(tick(candidate, bodies, count, { role: 'record' }))
  for (const glue of TICK_GLUES.filter((path) => path !== candidate)) runs.push(tick(glue, bodies, workers, { role: 'record' }))
  runs.push(tick(candidate, bodies, workers, { warm: false, role: 'record' }))
  runs.push(tick(candidate, COMPACT_BODIES, workers, { role: 'record' }))
  runs.push(tick(candidate, bodies, workers, { role: 'record', ticks: SETTLE_TICKS }))
  for (const knobs of VIEW_KNOBS) runs.push(tick(candidate, VIEW_BODIES, workers, { role: 'record', knobs }))
  for (let repeat = 0; repeat < PROFILE_REPEATS; repeat++) runs.push(tick(variantGlue(PROFILE_VARIANT), bodies, workers, { role: 'profile' }))
  for (let repeat = 0; repeat < PROFILE_UNRECLAIMED_REPEATS; repeat++) runs.push(tick(variantGlue(PROFILE_VARIANT), bodies, workers, { role: 'profile', knobs: RECLAIM_OFF }))
  for (let repeat = 0; repeat < PROFILE_COMPACT_REPEATS; repeat++) runs.push(tick(variantGlue(PROFILE_VARIANT), COMPACT_BODIES, workers, { role: 'profile' }))
  for (const threads of CANARY_THREADS) runs.push(canary(threads, CANARY_END_SECONDS))
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
  for (const workers of CLAIM_SCALING_WORKERS) runs.push(tick(HEADROOM_GLUE, CLAIM_BODIES[0], workers, { knobs: ALL_AWAKE, probe: true }))
  runs.push(tick(HEADROOM_GLUE, CLAIM_BODIES[1], 4, { knobs: ALL_AWAKE, probe: true }))
  runs.push(calibrate())
  return runs
}

export const CEILING_CAP = 40960
export const NEXT_CAP = 65536
export const NEXT_GLUE = 'build/variants/cap65536/engine-core-1024mib-threads-simd.mjs'
export const NEXT_BODIES = Object.freeze([49152, 65536])
export const CEILING_BODIES = Object.freeze([12288, 16384, 40960])
export const CEILING_BUDGETS = Object.freeze([6144, 8192])
export const CEILING_REPEATS = 3
export const HELD_IN_WORLD_COMMIT = '675210968a34dcddaa949615b39e55c594bd68d0'

const ceiling = () => {
  const runs = [calibrate()]
  const heldInWorld = referenceGlue(HELD_IN_WORLD_COMMIT, CEILING_CAP)
  for (let repeat = 0; repeat < CEILING_REPEATS; repeat++) {
    for (const bodies of CEILING_BODIES) runs.push(tick(SIMD_GLUE, bodies, 4))
    runs.push(tick(heldInWorld, TOP_TIER_BODIES, 4))
    for (const budget of CEILING_BUDGETS) runs.push(tick(SIMD_GLUE, TOP_TIER_BODIES, 4, { knobs: 'awake=' + budget, probe: true }))
    for (const bodies of NEXT_BODIES) runs.push(tick(NEXT_GLUE, bodies, 4, { probe: true }))
  }
  runs.push(calibrate())
  return runs
}

export const STALL_REPEATS = 8
export const STALL_ROWS_PER_REPEAT = 4

const stall = () => {
  const runs = [calibrate()]
  for (let repeat = 0; repeat < STALL_REPEATS; repeat++) {
    for (let again = 0; again < STALL_ROWS_PER_REPEAT; again++) runs.push(tick(SIMD_GLUE, TOP_TIER_BODIES, 4))
  }
  runs.push(calibrate())
  return runs
}

export const STRETCH_CAP = 131072
export const STRETCH_GLUE = 'build/variants/cap131072/engine-core-1024mib-threads-simd.mjs'
export const STRETCH_TIER_TICKS = 3000
export const STRETCH_REPEATS = 3
export const STRETCH_TUNINGS = Object.freeze([0, 4, 8, 12])
export const STRETCH_BUDGETS = Object.freeze([6144, 8192, 12288, 16384])
export const STRETCH_TIERS = Object.freeze([65536, 81920, 98304, 131072])
export const TUNE_BOTH = 12
export const TUNE_RELEASE_BY_SLOT = 16
export const PREVIOUS_TIER_COMMIT = 'f4e63b04bc2c41e9c5cb1c08066154f99d9ed12d'
export const PREVIOUS_TIER_BODIES = 40960

const stretch = () => {
  const runs = [calibrate()]
  const previous = referenceGlue(PREVIOUS_TIER_COMMIT)
  for (let repeat = 0; repeat < STRETCH_REPEATS; repeat++) {
    runs.push(tick(previous, PREVIOUS_TIER_BODIES, 4, { role: 'reference' }))
    for (const tune of STRETCH_TUNINGS) runs.push(tick(STRETCH_GLUE, COMPACT_BODIES, 4, { knobs: ALL_AWAKE + ',tune=' + tune, role: 'all awake' }))
    for (const tune of STRETCH_TUNINGS) runs.push(tick(STRETCH_GLUE, PREVIOUS_TIER_BODIES, 4, { knobs: ALL_AWAKE + ',tune=' + tune, role: 'all awake' }))
    for (const tune of STRETCH_TUNINGS) runs.push(tick(STRETCH_GLUE, PREVIOUS_TIER_BODIES, 4, { knobs: 'tune=' + tune, role: 'tuning' }))
    runs.push(tick(STRETCH_GLUE, PREVIOUS_TIER_BODIES, 4, { knobs: 'tune=' + TUNE_RELEASE_BY_SLOT, role: 'slot order' }))
    for (const budget of STRETCH_BUDGETS) runs.push(tick(STRETCH_GLUE, PREVIOUS_TIER_BODIES, 4, { knobs: 'awake=' + budget + ',tune=' + TUNE_BOTH, role: 'budget' }))
    for (const bodies of STRETCH_TIERS) {
      runs.push(tick(STRETCH_GLUE, bodies, 4, { knobs: 'tune=0', role: 'tier', ticks: STRETCH_TIER_TICKS }))
      runs.push(tick(STRETCH_GLUE, bodies, 4, { knobs: 'tune=' + TUNE_BOTH, role: 'tier', ticks: STRETCH_TIER_TICKS }))
    }
  }
  runs.push(calibrate())
  return runs
}

export const PLANS = Object.freeze({ stretch, ceiling, claim, stall, matrix, variants, regress: regressWith(SIMD_GLUE), control: regressWith(SCALAR_GLUE) })

export const buildPlan = (mode = 'matrix') => {
  if (!Object.hasOwn(PLANS, mode)) throw new RangeError('unknown plan ' + mode)
  return { mode, budgetMs: BUDGET_MS, ticks: TICKS, arenaBudgetBytes: ARENA_BUDGET_BYTES, runs: [...PLANS[mode](), pipeProbe()] }
}
