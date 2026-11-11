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

const tick = (glue, bodies, workers, extra = {}) => ({ script: 'scripts/kaggle/bench.mjs', nodeFlags: extra.nodeFlags ?? [], args: [glue, String(bodies), String(workers), String(TICKS), String(ARENA_BUDGET_BYTES), String(extra.iterations ?? 'default'), extra.scene ?? 'planet', extra.warm === false ? 'cold' : 'warm', extra.warmSpec ?? 'default'], glueArg: 0, probe: extra.probe === true })
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

const regress = () => {
  const runs = []
  const { bodies, workers, repeats } = BASELINE.topTier
  for (let repeat = 0; repeat < repeats; repeat++) for (const glue of [referenceGlue(BASELINE.referenceCommit), SIMD_GLUE]) runs.push(tick(glue, bodies, workers))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier, BASELINE.marble.runs, BASELINE.marble.warmRuns))
  return runs
}

export const PLANS = Object.freeze({ matrix, variants, regress })

export const buildPlan = (mode = 'matrix') => {
  if (!Object.hasOwn(PLANS, mode)) throw new RangeError('unknown plan ' + mode)
  return { mode, budgetMs: BUDGET_MS, ticks: TICKS, arenaBudgetBytes: ARENA_BUDGET_BYTES, runs: PLANS[mode]() }
}
