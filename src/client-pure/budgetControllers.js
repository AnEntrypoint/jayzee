const FRAME_BUDGET_144HZ_MS = 6.94
const BUDGET_FRAMES_PER_WINDOW = 45
const LOWER_ABOVE_BUDGET = 1.15
const RAISE_BELOW_BUDGET = 0.80
const DPR_MIN = 0.40
const DPR_MAX = 1.0
const DPR_STEP = 0.08
const DPR_DEVICE_CAP = 2
const VDRS_MIN = 0.5
const VDRS_MAX = 1.0
const VDRS_STEP = 0.1
const FOG_SLOW_FRAME_MS = 8.0
const FOG_FAST_FRAME_MS = 6.0
const FOG_FRAMES_PER_WINDOW = 60
const FOG_WINDOWS_BEFORE_STEP = 3
const FOG_FAR_MIN = 120
const FOG_FAR_DEFAULT = 200
const FOG_STEP = 8

export function createDprController(opts = {}) {
  const windowAvailable = opts.windowAvailable === true
  const deviceMax = windowAvailable ? Math.min(opts.devicePixelRatio || 1, DPR_DEVICE_CAP) : 1
  const read = typeof opts.read === 'function' ? opts.read : () => undefined
  let scale = 1, applied = -1, acc = 0, n = 0
  let lastStats = null

  function tick(renderer, ms) {
    if (!windowAvailable || !read('dprAuto') || read('dprOff')) return
    acc += ms
    n++
    if (n < BUDGET_FRAMES_PER_WINDOW) return
    const avg = acc / n
    acc = 0
    n = 0
    if (avg > FRAME_BUDGET_144HZ_MS * LOWER_ABOVE_BUDGET && scale > DPR_MIN) scale = Math.max(DPR_MIN, scale - DPR_STEP)
    else if (avg < FRAME_BUDGET_144HZ_MS * RAISE_BELOW_BUDGET && scale < DPR_MAX) scale = Math.min(DPR_MAX, scale + DPR_STEP)
    const want = +(deviceMax * scale).toFixed(3)
    if (want !== applied) {
      try {
        renderer.setPixelRatio(want)
        applied = want
      } catch (_) {}
    }
    lastStats = { scale: +scale.toFixed(2), applied, deviceMax, avgMs: +avg.toFixed(2) }
  }

  return { tick, stats: () => (lastStats ? { ...lastStats } : null) }
}

export function createTerrainVdrsController(opts = {}) {
  const windowAvailable = opts.windowAvailable === true
  const read = typeof opts.read === 'function' ? opts.read : () => undefined
  const sink = opts.sink || {}
  let scale = 1, appliedOn = false, appliedScale = -1, acc = 0, n = 0
  let lastStats = null

  function tick(ms) {
    if (!windowAvailable || !read('vdrsAuto') || read('vdrsOff')) return
    acc += ms
    n++
    if (n < BUDGET_FRAMES_PER_WINDOW) return
    const avg = acc / n
    acc = 0
    n = 0
    if (avg > FRAME_BUDGET_144HZ_MS * LOWER_ABOVE_BUDGET && scale > VDRS_MIN) scale = Math.max(VDRS_MIN, scale - VDRS_STEP)
    else if (avg < FRAME_BUDGET_144HZ_MS * RAISE_BELOW_BUDGET && scale < VDRS_MAX) scale = Math.min(VDRS_MAX, scale + VDRS_STEP)
    const on = scale < 0.999
    if (on !== appliedOn) {
      if (sink.setVdrs) sink.setVdrs(on)
      appliedOn = on
    }
    const wantScale = +scale.toFixed(3)
    if (on && wantScale !== appliedScale) {
      if (sink.setVdrsScale) sink.setVdrsScale(wantScale)
      appliedScale = wantScale
    }
    lastStats = { scale: +scale.toFixed(2), on, avgMs: +avg.toFixed(2) }
  }

  return { tick, stats: () => (lastStats ? { ...lastStats } : null) }
}

export function createFogController(opts = {}) {
  const windowAvailable = opts.windowAvailable === true
  const isAdaptOff = typeof opts.isAdaptOff === 'function' ? opts.isAdaptOff : () => false
  const configuredFar = typeof opts.configuredFar === 'function' ? opts.configuredFar : () => undefined
  const report = typeof opts.report === 'function' ? opts.report : (...args) => console.error(...args)

  let accumulatedMs = 0, framesInWindow = 0, slowStreak = 0, fastStreak = 0
  let trackedFog = null, nearToFarRatio = 0, perfFar = Infinity
  const ceilingMultipliers = new Map()
  let mirror = { near: 0, far: 0, ceil: 0, baseCeil: 0, mult: 1, perfFar: 0, avgMs: 0 }

  function setCeilMultiplier(source, factor) {
    if (typeof source !== 'string' || !source) return
    if (!Number.isFinite(factor) || factor <= 0) {
      ceilingMultipliers.delete(source)
      return
    }
    ceilingMultipliers.set(source, Math.min(1, factor))
  }

  function combinedMultiplier() {
    let m = 1
    for (const f of ceilingMultipliers.values()) m *= f
    return m
  }

  function configFar() {
    const far = configuredFar()
    return windowAvailable && Number.isFinite(far) ? far : FOG_FAR_DEFAULT
  }

  function adoptFog(fog) {
    trackedFog = fog
    const ratio = fog.near / fog.far
    const bandIsValid = ratio >= 0 && ratio < 1
    if (!bandIsValid) report('[fog] configured near', fog.near, 'is not below far', fog.far, '-- linear fog would paint every object in the fog colour; starting fog at the camera instead')
    nearToFarRatio = bandIsValid ? ratio : 0
    perfFar = Infinity
  }

  function applyBand(fog, far) {
    fog.far = far
    fog.near = far * nearToFarRatio
  }

  function publishMirror(fog, ceil, baseCeil, mult, avgMs) {
    mirror = { near: fog.near, far: fog.far, ceil, baseCeil, mult, perfFar, avgMs }
  }

  function tick(scene, ms) {
    if (!windowAvailable || isAdaptOff()) return
    const fog = scene && scene.fog
    if (!fog || fog.isFog !== true) return
    if (fog !== trackedFog) adoptFog(fog)
    const baseCeil = configFar()
    const mult = combinedMultiplier()
    const ceil = Math.max(FOG_FAR_MIN, baseCeil * mult)
    perfFar = Math.min(Math.max(perfFar, FOG_FAR_MIN), Math.max(FOG_FAR_MIN, baseCeil))
    applyBand(fog, Math.min(perfFar, ceil))
    accumulatedMs += ms
    framesInWindow++
    if (framesInWindow < FOG_FRAMES_PER_WINDOW) {
      publishMirror(fog, ceil, baseCeil, mult, accumulatedMs / framesInWindow)
      return
    }
    const avg = accumulatedMs / framesInWindow
    accumulatedMs = 0
    framesInWindow = 0
    if (avg > FOG_SLOW_FRAME_MS) {
      slowStreak++
      fastStreak = 0
      if (slowStreak >= FOG_WINDOWS_BEFORE_STEP) {
        perfFar = Math.max(FOG_FAR_MIN, fog.far - FOG_STEP)
        slowStreak = 0
      }
    } else if (avg < FOG_FAST_FRAME_MS) {
      fastStreak++
      slowStreak = 0
      if (fastStreak >= FOG_WINDOWS_BEFORE_STEP) {
        perfFar = Math.min(baseCeil, perfFar + FOG_STEP)
        fastStreak = 0
      }
    } else {
      slowStreak = 0
      fastStreak = 0
    }
    applyBand(fog, Math.min(perfFar, ceil))
    publishMirror(fog, ceil, baseCeil, mult, avg)
  }

  return { tick, setCeilMultiplier, mirror: () => ({ ...mirror }) }
}
