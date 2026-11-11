const MIB = 1024 * 1024

export const KERNEL_REF = 'heclgang/jayzee-physics-goalpost'
export const DATASET_REF = 'heclgang/jayzee-physics-bench'
export const BUDGET_MS = 16.7
export const TICKS = 900
export const ARENA_BUDGET_BYTES = 1024 * MIB
export const BODY_COUNTS = Object.freeze([10240, 12288, 16384, 20480])
export const WORKER_COUNTS = Object.freeze([1, 2, 3, 4, 6, 8])
export const SCALAR_GLUE = 'engine/out/engine-core-1024mib-threads.mjs'
export const SIMD_GLUE = 'engine/out/engine-core-1024mib-threads-simd.mjs'
export const TICK_GLUES = Object.freeze([SCALAR_GLUE, SIMD_GLUE])
export const MARBLE_TIERS = 4
export const MARBLE_RUNS = 5

const tick = (glue, bodies, workers, extra = {}) => ({ script: 'scripts/kaggle/bench.mjs', nodeFlags: extra.nodeFlags ?? [], args: [glue, String(bodies), String(workers), String(TICKS), String(ARENA_BUDGET_BYTES), String(extra.iterations ?? 'default'), extra.scene ?? 'planet', extra.warm === false ? 'cold' : 'warm'], glueArg: 0, probe: extra.probe === true })
const marble = (tier) => ({ script: 'scripts/kaggle/marble.mjs', nodeFlags: [], args: [String(tier), String(MARBLE_RUNS)], glueArg: -1, probe: false })

const matrix = () => {
  const runs = []
  for (const warm of [true, false]) for (const glue of TICK_GLUES) for (const bodies of BODY_COUNTS) for (const workers of WORKER_COUNTS) runs.push(tick(glue, bodies, workers, { warm }))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push(marble(tier))
  return runs
}

export const PLANS = Object.freeze({ matrix })

export const buildPlan = (mode = 'matrix') => {
  if (!Object.hasOwn(PLANS, mode)) throw new RangeError('unknown plan ' + mode)
  return { mode, budgetMs: BUDGET_MS, ticks: TICKS, arenaBudgetBytes: ARENA_BUDGET_BYTES, runs: PLANS[mode]() }
}
