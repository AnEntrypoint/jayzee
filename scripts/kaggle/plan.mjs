const MIB = 1024 * 1024

export const KERNEL_REF = 'heclgang/jayzee-physics-goalpost'
export const DATASET_REF = 'heclgang/jayzee-physics-bench'
export const BUDGET_MS = 16.7
export const TICKS = 900
export const ARENA_BUDGET_BYTES = 1024 * MIB
export const BODY_COUNTS = Object.freeze([4096, 8192, 10240])
export const WORKER_COUNTS = Object.freeze([1, 2, 3, 4, 6, 8])
export const TICK_GLUES = Object.freeze(['engine/out/engine-core-1024mib-threads.mjs', 'engine/out/engine-core-1024mib-threads-simd.mjs'])
export const MARBLE_TIERS = 4
export const PROBE = Object.freeze({ glue: TICK_GLUES[1], bodies: 10240, workers: 3 })
export const PROBE_NODE_FLAGS = Object.freeze([['--no-wasm-lazy-compilation'], ['--no-wasm-lazy-compilation', '--no-liftoff']])
export const PROBE_ITERATIONS = Object.freeze([1, 2])
export const GOALPOST_BODIES = Object.freeze([8192, 10240])
export const GOALPOST_WORKERS = 4
export const GOALPOST_REPEATS = 3

const tick = (glue, bodies, workers, extra = {}) => ({ script: 'scripts/kaggle/bench.mjs', nodeFlags: extra.nodeFlags ?? [], args: [glue, String(bodies), String(workers), String(TICKS), String(ARENA_BUDGET_BYTES), String(extra.iterations ?? 'default'), extra.scene ?? 'planet', extra.warm === false ? 'cold' : 'warm'], glueArg: 0, probe: extra.probe === true })

export const buildPlan = () => {
  const runs = []
  for (const warm of [true, false]) for (const glue of TICK_GLUES) for (const bodies of BODY_COUNTS) for (const workers of WORKER_COUNTS) runs.push(tick(glue, bodies, workers, { warm }))
  for (const nodeFlags of PROBE_NODE_FLAGS) runs.push(tick(PROBE.glue, PROBE.bodies, PROBE.workers, { nodeFlags, warm: false, probe: true }))
  for (const iterations of PROBE_ITERATIONS) runs.push(tick(PROBE.glue, PROBE.bodies, PROBE.workers, { iterations, probe: true }))
  runs.push(tick(PROBE.glue, PROBE.bodies, PROBE.workers, { scene: 'flat', probe: true }))
  for (let repeat = 0; repeat < GOALPOST_REPEATS; repeat++) for (const bodies of GOALPOST_BODIES) runs.push(tick(PROBE.glue, bodies, GOALPOST_WORKERS, { probe: true }))
  for (let tier = 0; tier < MARBLE_TIERS; tier++) runs.push({ script: 'scripts/kaggle/marble.mjs', nodeFlags: [], args: [String(tier)], glueArg: -1, probe: false })
  return { budgetMs: BUDGET_MS, ticks: TICKS, arenaBudgetBytes: ARENA_BUDGET_BYTES, runs }
}
