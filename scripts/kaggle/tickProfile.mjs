const SCOPE_FIELDS = 4
const LANE_FIELDS = 5
const SHOWN_SCOPES = 16
const ENGINE_SCOPE_PREFIX = 'engine '
const NOTABLE_QUIET_MAX_MS = 2
const SAMPLED_EVERY = 16
const ENGINE_ENTRY_SCOPES = Object.freeze(['engine tick batch', 'engine follow', 'engine pose export'])
const round = (value) => Number(value.toFixed(3))

const cString = (heap, at) => {
  let text = ''
  for (let i = at; heap[i] !== 0; i++) text += String.fromCharCode(heap[i])
  return text
}

export const canProfile = (module) => typeof module?._engine_profile_capture === 'function'

export const describeSlowTick = ({ ms: tickMs, table, scopes, lanes, names, quietMeanMs, quietMaxMs, quietMeanCalls }) => {
  const rows = []
  let insideEngineMs = 0
  for (let scope = 0; scope < scopes; scope++) {
    const ms = table[scope * SCOPE_FIELDS]
    if (ENGINE_ENTRY_SCOPES.includes(names[scope])) insideEngineMs += ms
    if (ms === 0 && quietMeanMs[scope] === 0) continue
    rows.push({
      scope: names[scope],
      ms: round(ms),
      calls: table[scope * SCOPE_FIELDS + 1],
      longestMs: round(table[scope * SCOPE_FIELDS + 2]),
      longestAtMs: round(table[scope * SCOPE_FIELDS + 3]),
      quietMeanMs: round(quietMeanMs[scope]),
      quietMaxMs: round(quietMaxMs[scope]),
      quietMeanCalls: round(quietMeanCalls[scope]),
      overQuietMs: round(ms - quietMeanMs[scope]),
    })
  }
  rows.sort((a, b) => b.overQuietMs - a.overQuietMs)
  const threads = []
  for (let lane = 0; lane < lanes; lane++) {
    const at = scopes * SCOPE_FIELDS + lane * LANE_FIELDS
    if (table[at] === 0) continue
    threads.push({ lane, events: table[at], widestGapMs: round(table[at + 1]), gapAtMs: round(table[at + 2]), gapEndsAt: (table[at + 4] === 1 ? 'end of ' : 'start of ') + names[table[at + 3]] })
  }
  return { outsideEngineMs: round(tickMs - insideEngineMs), scopes: rows.slice(0, SHOWN_SCOPES), threads }
}

export const createTickProfile = ({ module, budgetMs, keep = 12 }) => {
  if (!canProfile(module)) throw new TypeError('createTickProfile needs a glue built with ENGINE_TICK_PROFILE')
  const scopes = module._engine_profile_scope_count()
  const lanes = module._engine_profile_lane_count()
  const words = scopes * SCOPE_FIELDS + lanes * LANE_FIELDS
  const quietSumMs = new Float64Array(scopes)
  const quietSumCalls = new Float64Array(scopes)
  const quietMaxMs = new Float64Array(scopes)
  const slow = []
  let quietTicks = 0
  let slowTicks = 0
  return {
    start() {
      module._engine_profile_capture()
    },
    record(tick, ms) {
      const at = module._engine_profile_capture() >> 3
      const heap = module.HEAPF64
      if (ms > budgetMs) {
        slowTicks += 1
        if (slow.length < keep) {
          slow.push({ tick, ms, table: heap.slice(at, at + words) })
        } else {
          let least = 0
          for (let i = 1; i < slow.length; i++) {
            if (slow[i].ms < slow[least].ms) least = i
          }
          if (ms > slow[least].ms) slow[least] = { tick, ms, table: heap.slice(at, at + words) }
        }
        return
      }
      for (let scope = 0; scope < scopes; scope++) {
        const scopeMs = heap[at + scope * SCOPE_FIELDS]
        quietSumMs[scope] += scopeMs
        quietSumCalls[scope] += heap[at + scope * SCOPE_FIELDS + 1]
        if (scopeMs > quietMaxMs[scope]) quietMaxMs[scope] = scopeMs
      }
      quietTicks += 1
    },
    summarise() {
      const names = Array.from({ length: scopes }, (_, scope) => {
        const at = module._engine_profile_scope_name(scope)
        return at === 0 ? '' : cString(module.HEAPU8, at)
      })
      const quietMeanMs = quietSumMs.map((sum) => (quietTicks > 0 ? sum / quietTicks : 0))
      const quietMeanCalls = quietSumCalls.map((sum) => (quietTicks > 0 ? sum / quietTicks : 0))
      const quiet = []
      for (let scope = 0; scope < scopes; scope++) {
        if (quietSumMs[scope] > 0) quiet.push({ scope: names[scope], meanMs: round(quietMeanMs[scope]), maxMs: round(quietMaxMs[scope]), meanCalls: round(quietMeanCalls[scope]) })
      }
      quiet.sort((a, b) => b.meanMs - a.meanMs)
      const sampledScopes = names.filter((name, scope) => name !== '' && module._engine_profile_scope_muted(scope) === 1)
      return {
        quietTicks,
        slowTicks,
        sampledScopes,
        sampledEvery: SAMPLED_EVERY,
        quiet: quiet.filter((row, rank) => rank < SHOWN_SCOPES * 2 || row.scope.startsWith(ENGINE_SCOPE_PREFIX) || row.maxMs > NOTABLE_QUIET_MAX_MS),
        slow: slow.slice().sort((a, b) => a.tick - b.tick).map(({ tick, ms, table }) => ({ tick, ms: round(ms), ...describeSlowTick({ ms, table, scopes, lanes, names, quietMeanMs, quietMaxMs, quietMeanCalls }) })),
      }
    },
  }
}
