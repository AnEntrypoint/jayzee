export const FRAME_BUDGET_MS = 16.67
const DEAD_BAND_UPPER_MS = 1.0
const DEAD_BAND_LOWER_MS = 3.0
export const LOWER_ABOVE_MS = FRAME_BUDGET_MS + DEAD_BAND_UPPER_MS
export const RAISE_BELOW_MS = FRAME_BUDGET_MS - DEAD_BAND_LOWER_MS
const FRAMES_PER_WINDOW = 30
const WINDOWS_BEFORE_STEP = 2
export const MIN_STEP_INTERVAL_MS = 1000
export const RECOVER_STEP_INTERVAL_MS = 400
export const HITCH_ABOVE_MS = 2 * FRAME_BUDGET_MS
export const HITCH_STEP_INTERVAL_MS = 500
export const HITCH_RESPONSE_BOUND_FRAMES = 1
const WINDOW_P95_Q = 0.95

export const EXCURSION_ABOVE_MS = LOWER_ABOVE_MS
export const EXCURSION_WINDOW_FRAMES = 12
export const EXCURSION_TRIP_COUNT = 8

export const LEAF_OFF_UNLIMITED_M = 0

export const RESOLUTION_KEYS = new Set([
  'dprAuto', 'dprOff', 'dpr', 'vdrsAuto', 'vdrsOff', 'vdrs', 'vdrsScale',
  'terrainVdrs', 'threeVdrs', 'threeVdrsScale', 'threeVdrsAuto', 'threeVdrsOff',
  'threeVdrsState', 'threeVdrsSharpness', 'fsr1', 'fsr1Sharpness',
  'vdrsUpscaleFsr1', 'vdrsUpscaleFsr1Sharpness', 'halfResWater',
  'bloomResolutionScale',
])

export const GOVERNED_KNOBS = [
  { key: 'ssao', type: 'boolean' },
  { key: 'bloom', type: 'boolean' },
  { key: 'ssr', type: 'boolean' },
  { key: 'vegLeafOff', type: 'number' },
  { key: 'maxLevel', type: 'number' },
  { key: 'splitFactor', type: 'number' },
]

export const LEAF_OFF_MID_BAND_EDGE_M = 39.2
export const QUALITY_TIERS = [
  { maxLevel: 11, splitFactor: 0.25, vegLeafOff: 0, effectScale: 1 },
  { maxLevel: 11, splitFactor: 0.25, vegLeafOff: 0, effectScale: 1 },
  { maxLevel: 10, splitFactor: 0.20, vegLeafOff: 0, effectScale: 0.75 },
  { maxLevel: 9, splitFactor: 0.15, vegLeafOff: 45, effectScale: 0.5 },
  { maxLevel: 8, splitFactor: 0.10, vegLeafOff: 42, effectScale: 0.35 },
  { maxLevel: 7, splitFactor: 0.07, vegLeafOff: 40, effectScale: 0.25 },
]
export const MAX_TIER = QUALITY_TIERS.length - 1
const EFFECT_KEYS = ['ssao', 'bloom', 'ssr']

export const DEFAULT_CONTROLS = [
  { key: 'maxLevel', default: 11, min: 2, max: 22 },
  { key: 'splitFactor', default: 0.25, min: 0.05 },
  { key: 'vegLeafOff', default: 0, min: 0, max: 640 },
  { key: 'ssao', default: false },
  { key: 'bloom', default: false },
  { key: 'ssr', default: false },
  { key: 'qualityGovernor', default: true },
  { key: 'qualityGovernorOff', default: false },
]

export function createControlStore(controls = DEFAULT_CONTROLS) {
  const declared = new Map(controls.map(control => [control.key, control]))
  const values = new Map()
  return {
    get(key) { return values.has(key) ? values.get(key) : declared.get(key)?.default },
    set(key, value) { values.set(key, value) },
    declared(key) { return declared.get(key) || {} },
  }
}

export function effectScaleForTier(i, tiers = QUALITY_TIERS) {
  return tiers[Math.max(0, Math.min(tiers.length - 1, i | 0))].effectScale
}

export function effectCountBudget(baseCount, effectScale) {
  if (!Number.isFinite(baseCount) || baseCount < 0) throw new Error(`[quality-governor] effect base count must be a non-negative finite number, got ${baseCount}`)
  if (!Number.isFinite(effectScale) || effectScale <= 0 || effectScale > 1) throw new Error(`[quality-governor] effect scale must be in (0, 1], got ${effectScale}`)
  return Math.floor(baseCount * effectScale)
}

export function leafCutoffM(v) {
  if (typeof v !== 'number') return LEAF_OFF_UNLIMITED_M
  if (!Number.isFinite(v) || v <= 0) return LEAF_OFF_UNLIMITED_M
  return v
}

export function leafGateM(v, midBandEdgeM = LEAF_OFF_MID_BAND_EDGE_M) {
  const c = leafCutoffM(v)
  if (c <= 0) return LEAF_OFF_UNLIMITED_M
  const floor = Number.isFinite(midBandEdgeM) && midBandEdgeM > 0 ? midBandEdgeM : LEAF_OFF_MID_BAND_EDGE_M
  return Math.max(c, floor)
}

function cutoffMin(a, b) {
  if (a > 0 && b > 0) return Math.min(a, b)
  return a > 0 ? a : b
}

function finiteOr(v, fallback) { return Number.isFinite(v) ? v : fallback }

function windowPercentile(buf, n, q) {
  const view = buf.subarray(0, n)
  view.sort()
  return view[Math.min(n - 1, Math.max(0, Math.ceil(q * n) - 1))]
}

export function createQualityGovernor(opts = {}) {
  const controls = opts.controls || DEFAULT_CONTROLS
  const tiers = opts.tiers || QUALITY_TIERS
  const maxTier = tiers.length - 1
  const store = createControlStore(controls)
  const write = typeof opts.write === 'function' ? opts.write : (k, v) => store.set(k, v)
  const read = typeof opts.read === 'function' ? opts.read : k => store.get(k)
  const clock = typeof opts.now === 'function' ? opts.now : () => (typeof performance !== 'undefined' ? performance.now() : Date.now())
  const enabled = typeof opts.enabled === 'function' ? opts.enabled
    : () => read('qualityGovernor') === true && read('qualityGovernorOff') !== true

  const declaredDefault = k => { const d = store.declared(k).default; return typeof d === 'number' ? d : 0 }
  const inDeclaredRange = (k, v) => {
    const c = store.declared(k)
    return Math.max(c.min == null ? -Infinity : c.min, Math.min(c.max == null ? Infinity : c.max, v))
  }

  for (const t of tiers) {
    for (const k of Object.keys(t)) {
      if (RESOLUTION_KEYS.has(k)) throw new Error(`[quality-governor] tier table drives resolution key '${k}' -- refused`)
    }
  }
  for (const k of EFFECT_KEYS) {
    if (RESOLUTION_KEYS.has(k)) throw new Error(`[quality-governor] effect key '${k}' is a resolution key -- refused`)
  }

  let base = null
  let tier = 0
  let acc = 0, n = 0
  const windowMs = new Float64Array(FRAMES_PER_WINDOW)
  let slowStreak = 0, fastStreak = 0
  let lastStepMs = clock() - MIN_STEP_INTERVAL_MS
  let steps = 0
  let avgMs = 0
  let winMaxMs = 0
  let winOverruns = 0
  let lastWinMaxMs = 0, lastWinP95Ms = 0
  let overrunMs = 0
  let framesSinceOverrun = HITCH_RESPONSE_BOUND_FRAMES
  const excursionRing = new Uint8Array(EXCURSION_WINDOW_FRAMES)
  let excursionAt = 0
  let excursions = 0
  let shedCause = 'none'
  let shedExcursions = 0
  const applied = {}

  function captureBase() {
    base = {
      maxLevel: inDeclaredRange('maxLevel', finiteOr(read('maxLevel'), declaredDefault('maxLevel'))),
      splitFactor: inDeclaredRange('splitFactor', finiteOr(read('splitFactor'), declaredDefault('splitFactor'))),
      vegLeafOff: leafCutoffM(read('vegLeafOff')),
      ssao: read('ssao') === true,
      bloom: read('bloom') === true,
      ssr: read('ssr') === true,
    }
  }

  function effectScaleOf(i) {
    return tiers[Math.max(0, Math.min(maxTier, i | 0))].effectScale
  }

  function resolveTier(i) {
    if (!base) captureBase()
    if (i <= 0) return { maxLevel: base.maxLevel, splitFactor: base.splitFactor, vegLeafOff: base.vegLeafOff, ssao: base.ssao, bloom: base.bloom, ssr: base.ssr }
    const t = tiers[Math.min(maxTier, i)]
    const out = {
      maxLevel: inDeclaredRange('maxLevel', Math.min(base.maxLevel, t.maxLevel)),
      splitFactor: inDeclaredRange('splitFactor', Math.min(base.splitFactor, t.splitFactor)),
      vegLeafOff: cutoffMin(base.vegLeafOff, leafCutoffM(t.vegLeafOff)),
    }
    for (const k of EFFECT_KEYS) out[k] = false
    return out
  }

  function apply(i) {
    const want = resolveTier(i)
    for (const k of Object.keys(want)) {
      if (RESOLUTION_KEYS.has(k)) throw new Error(`[quality-governor] refused to write resolution key '${k}'`)
      applied[k] = want[k]
      write(k, want[k])
    }
    tier = Math.max(0, Math.min(maxTier, i))
    return want
  }

  const state = { tier: 0, maxTier, effectScale: 1, avgMs: 0, winMaxMs: 0, winP95Ms: 0, overrunMs: 0, excursions: 0, excursionWindowFrames: EXCURSION_WINDOW_FRAMES, excursionTripCount: EXCURSION_TRIP_COUNT, excursionAboveMs: EXCURSION_ABOVE_MS, shedCause: 'none', shedExcursions: 0, budgetMs: FRAME_BUDGET_MS, lowerAboveMs: LOWER_ABOVE_MS, raiseBelowMs: RAISE_BELOW_MS, hitchAboveMs: HITCH_ABOVE_MS, hitchStepIntervalMs: HITCH_STEP_INTERVAL_MS, recoverStepIntervalMs: RECOVER_STEP_INTERVAL_MS, minStepIntervalMs: MIN_STEP_INTERVAL_MS, responseBoundFrames: HITCH_RESPONSE_BOUND_FRAMES, steps: 0, lastStepMs: 0, inBand: false, atCeiling: true, atFloor: false, leafOffM: 0, knobs: null }

  function publish() {
    state.tier = tier
    state.effectScale = effectScaleOf(tier)
    state.avgMs = +avgMs.toFixed(3)
    state.winMaxMs = +lastWinMaxMs.toFixed(3)
    state.winP95Ms = +lastWinP95Ms.toFixed(3)
    state.overrunMs = +overrunMs.toFixed(3)
    state.excursions = excursions
    state.shedCause = shedCause
    state.shedExcursions = shedExcursions
    state.steps = steps
    state.lastStepMs = lastStepMs
    state.inBand = n === 0 && avgMs > 0 ? avgMs >= RAISE_BELOW_MS && avgMs <= LOWER_ABOVE_MS && lastWinP95Ms <= LOWER_ABOVE_MS : false
    state.atCeiling = tier === 0
    state.atFloor = tier === maxTier
    state.leafOffM = leafCutoffM(applied.vegLeafOff)
    state.knobs = { ...applied }
    write('qualityGovernorState', state)
    return state
  }

  function step(dir, nowMs) {
    const next = Math.max(0, Math.min(maxTier, tier + dir))
    if (next === tier) return false
    apply(next)
    lastStepMs = nowMs
    steps++
    return true
  }

  function tick(ms) {
    if (!enabled()) return tier
    if (!Number.isFinite(ms) || ms < 0) return tier
    if (!base) { captureBase(); apply(0) }
    const nowMs = clock()

    const excursion = ms > EXCURSION_ABOVE_MS ? 1 : 0
    excursions += excursion - excursionRing[excursionAt]
    excursionRing[excursionAt] = excursion
    excursionAt = (excursionAt + 1) % EXCURSION_WINDOW_FRAMES

    if (ms > HITCH_ABOVE_MS) { overrunMs = ms; winOverruns++; framesSinceOverrun = 0 }
    else if (framesSinceOverrun < HITCH_RESPONSE_BOUND_FRAMES) {
      framesSinceOverrun++
      if (framesSinceOverrun >= HITCH_RESPONSE_BOUND_FRAMES) overrunMs = 0
    }
    windowMs[n] = ms
    if (ms > winMaxMs) winMaxMs = ms
    acc += ms; n++

    if ((framesSinceOverrun < HITCH_RESPONSE_BOUND_FRAMES || excursions >= EXCURSION_TRIP_COUNT)
      && nowMs - lastStepMs >= HITCH_STEP_INTERVAL_MS) {
      const byHitch = framesSinceOverrun < HITCH_RESPONSE_BOUND_FRAMES
      if (step(+1, nowMs)) {
        shedCause = byHitch ? 'hitch' : 'excursion'
        shedExcursions = byHitch ? 0 : excursions
        overrunMs = 0
        framesSinceOverrun = HITCH_RESPONSE_BOUND_FRAMES
        excursionRing.fill(0)
        excursionAt = 0
        excursions = 0
        slowStreak = 0
        fastStreak = 0
      }
    }

    if (n < FRAMES_PER_WINDOW) return tier
    avgMs = acc / n
    lastWinMaxMs = winMaxMs
    lastWinP95Ms = windowPercentile(windowMs, n, WINDOW_P95_Q)
    const overruns = winOverruns
    acc = 0; n = 0; winMaxMs = 0; winOverruns = 0

    if (avgMs > LOWER_ABOVE_MS || lastWinP95Ms > LOWER_ABOVE_MS) { slowStreak++; fastStreak = 0 }
    else if (avgMs < RAISE_BELOW_MS && lastWinP95Ms < RAISE_BELOW_MS && overruns === 0) { fastStreak++; slowStreak = 0 }
    else { slowStreak = 0; fastStreak = 0 }
    if (slowStreak >= WINDOWS_BEFORE_STEP) {
      if (nowMs - lastStepMs >= MIN_STEP_INTERVAL_MS && step(+1, nowMs)) { shedCause = 'window'; shedExcursions = 0; slowStreak = 0 }
    } else if (fastStreak >= WINDOWS_BEFORE_STEP) {
      if (nowMs - lastStepMs >= RECOVER_STEP_INTERVAL_MS && step(-1, nowMs)) { shedCause = 'none'; shedExcursions = 0; fastStreak = 0 }
    }
    publish()
    return tier
  }

  function setTier(i) { if (base) apply(Math.max(0, Math.min(maxTier, i | 0))); publish(); return tier }

  function reset() {
    base = null; tier = 0; acc = 0; n = 0
    slowStreak = 0; fastStreak = 0; steps = 0; avgMs = 0
    winMaxMs = 0; winOverruns = 0; lastWinMaxMs = 0; lastWinP95Ms = 0
    overrunMs = 0; framesSinceOverrun = HITCH_RESPONSE_BOUND_FRAMES
    excursionRing.fill(0); excursionAt = 0; excursions = 0
    shedCause = 'none'; shedExcursions = 0
    lastStepMs = clock() - MIN_STEP_INTERVAL_MS
  }

  function snapshot() { return publish() }

  return {
    tick, setTier, reset, state: snapshot, base: () => (base ? { ...base } : null),
    effectBudget: baseCount => effectCountBudget(baseCount, effectScaleOf(tier)),
    get tier() { return tier },
  }
}
