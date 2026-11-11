import { PLANET_ENTITY_COUNT } from './planetScene.js'

export const PLANET_FRAME_BUDGET_MS = 16.7
export const PLANET_MIN_FRAMES = 600
export const PLANET_MISSED_FRAME_MS = 25
export const PLANET_VEGETATION_OUTSIDE_SHARE = 0.01

export const PLANET_RUNS = Object.freeze([
  Object.freeze({ tier: 1024, threads: true, backend: 'webgpu', phase: 10 }),
  Object.freeze({ tier: 1024, threads: true, backend: 'webgl2', phase: 11 }),
  Object.freeze({ tier: 64, threads: false, backend: 'webgpu', phase: 10 }),
  Object.freeze({ tier: 64, threads: false, backend: 'webgl2', phase: 11 }),
])

export const planetQuery = ({ tier, threads, phase }, frames) =>
  'phase=' + phase + '&tier=' + tier + '&timed=1&path=planet&window=8&streamPerFrame=8&frames=' + frames + (threads ? '&threads=1' : '')

export const quantile = (values, q) => {
  if (!Array.isArray(values) || values.length === 0) throw new RangeError('quantile needs a non-empty array')
  const sorted = values.slice().sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
}

export const planetVerdict = (result, expected) => {
  if (!result || typeof result !== 'object') return { ok: false, failures: ['no result'], longFrames: [], p99Ms: null, maxMs: null, budgetMs: PLANET_FRAME_BUDGET_MS }
  const failures = []
  if (result.ok !== true) failures.push('page ok is not true')
  if (Array.isArray(result.errors) && result.errors.length > 0) failures.push('page errors: ' + result.errors.length)
  if (result.backend !== expected.backend) failures.push('backend ' + result.backend + ' is not ' + expected.backend)
  if (result.tier !== expected.tier) failures.push('tier ' + result.tier + ' is not ' + expected.tier)
  const adapter = result.adapter
  if (!adapter || adapter.adapter === null) failures.push('no GPU adapter was returned')
  else if (expected.backend === 'webgpu' && adapter.isFallbackAdapter !== false) failures.push('WebGPU adapter is a fallback or its fallback flag is unknown')
  if (expected.tier === 1024 && result.players !== PLANET_ENTITY_COUNT) failures.push('players ' + result.players + ' is not ' + PLANET_ENTITY_COUNT)

  const work = result.frameTimesMs
  const wall = result.wallIntervalsMs
  let p99Ms = null
  let maxMs = null
  let longFrames = []
  if (!Array.isArray(work) || work.length < PLANET_MIN_FRAMES) {
    failures.push('frame times: ' + (Array.isArray(work) ? work.length : 'missing') + ' frames, at least ' + PLANET_MIN_FRAMES + ' are required')
  } else if (!Array.isArray(wall) || wall.length !== work.length) {
    failures.push('wall-clock intervals: ' + (Array.isArray(wall) ? wall.length : 'missing') + ' for ' + work.length + ' frames')
  } else {
    p99Ms = quantile(work, 0.99)
    maxMs = Math.max(...work)
    longFrames = work.map((ms, frame) => ({ frame, ms })).filter((f) => f.ms > PLANET_FRAME_BUDGET_MS)
    if (p99Ms > PLANET_FRAME_BUDGET_MS) failures.push('p99 work ' + p99Ms + ' ms is over the ' + PLANET_FRAME_BUDGET_MS + ' ms budget')
    if (maxMs > PLANET_FRAME_BUDGET_MS) failures.push('worst work ' + maxMs + ' ms is over the ' + PLANET_FRAME_BUDGET_MS + ' ms budget (' + longFrames.length + ' frames over budget)')
    const missed = wall.map((ms, frame) => ({ frame, ms })).filter((f) => f.ms > PLANET_MISSED_FRAME_MS)
    if (missed.length > 0) failures.push('missed frames: ' + missed.length + ' rAF intervals over ' + PLANET_MISSED_FRAME_MS + ' ms, first at frame ' + missed[0].frame + ' (' + missed[0].ms + ' ms)')
  }
  if (result.allocationsSinceWarmup !== '0' && result.allocationsSinceWarmup !== 0) failures.push('allocations after warm-up: ' + result.allocationsSinceWarmup)
  if (result.createsAfterSeal !== 0) failures.push('creates after seal: ' + result.createsAfterSeal)

  if (expected.tier === 1024) {
    const scene = result.scene
    if (!scene) failures.push('no planet scene report')
    else {
      if (scene.entities !== PLANET_ENTITY_COUNT) failures.push('scene entities ' + scene.entities + ' is not ' + PLANET_ENTITY_COUNT)
      if (!scene.colliderCounts || scene.colliderCounts.dynamic !== PLANET_ENTITY_COUNT) failures.push('dynamic colliders are not ' + PLANET_ENTITY_COUNT)
      if (scene.vegetationBound !== true) failures.push('vegetation is not bound to the draw path')
      if (typeof scene.generateHeightCallsOutsidePages !== 'number') failures.push('the scene does not report how many vegetation heights fell outside the loaded pages')
      else if (scene.generateHeightCallsOutsidePages > scene.generatedInstances * PLANET_VEGETATION_OUTSIDE_SHARE) failures.push('vegetation heights outside the loaded pages: ' + scene.generateHeightCallsOutsidePages + ' of ' + scene.generatedInstances)
    }
  }
  const missedFrames = Array.isArray(wall) ? wall.filter((ms) => ms > PLANET_MISSED_FRAME_MS).length : null
  return { ok: failures.length === 0, failures, longFrames, p99Ms, maxMs, missedFrames, budgetMs: PLANET_FRAME_BUDGET_MS }
}

export const COMPARISON_INPUTS = Object.freeze(['radiusM', 'seed', 'capRad', 'entities', 'trees', 'tier', 'frames', 'budgetMs'])

const medianOf = (values) => quantile(values, 0.5)

export const comparePlanetRuns = (engine, spoint) => {
  if (!engine || !spoint || !Array.isArray(engine.frameTimesMs) || !Array.isArray(spoint.frameTimesMs)) throw new TypeError('comparison needs frameTimesMs on both runs')
  for (const key of COMPARISON_INPUTS) {
    if (!engine.inputs || !spoint.inputs || engine.inputs[key] !== spoint.inputs[key]) throw new RangeError('comparison inputs differ at ' + key)
  }
  return [
    { metric: 'frame median ms', budgetMs: PLANET_FRAME_BUDGET_MS, engine: medianOf(engine.frameTimesMs), spoint: medianOf(spoint.frameTimesMs) },
    { metric: 'frame p99 ms', budgetMs: PLANET_FRAME_BUDGET_MS, engine: quantile(engine.frameTimesMs, 0.99), spoint: quantile(spoint.frameTimesMs, 0.99) },
    { metric: 'worst frame ms', budgetMs: PLANET_FRAME_BUDGET_MS, engine: Math.max(...engine.frameTimesMs), spoint: Math.max(...spoint.frameTimesMs) },
  ]
}

export const PLANET_TABLE_COLUMNS = Object.freeze(['metric', 'budget ms', 'engine WebGPU', 'engine WebGL2', 'spoint', 'inputs'])

export const OPEN_ITEMS = Object.freeze([
  Object.freeze({
    id: '362.9-ms-outlier',
    cause: 'one WebGL2 1024-tier frame of 362.9 ms in an earlier single run; the page result was read and not saved, so no frame record exists',
    hook: 'planetVerdict longFrames and the frameTimesMs export from engine-render-browser.js',
    gate: 'scripts/check-planet-witness.mjs',
  }),
  Object.freeze({
    id: 'launcher-null-adapter',
    cause: 'after a browser restart the launcher reached no WebGPU adapter (result.adapter null); not reproduced since, and the harness retries three times',
    hook: 'planetVerdict fails on a missing adapter and on a fallback adapter (scripts/browser/chromium-webgpu.sh is the launcher)',
    gate: 'scripts/check-planet-witness.mjs',
  }),
  Object.freeze({
    id: 'tier-64-untimed',
    cause: 'the 64-tier rows of the earlier set were recorded untimed (no timed flag), so the 0.04 ms backend residual was never measured',
    hook: 'PLANET_RUNS includes the 64 tier with timed=1 on both backends, and planetQuery sets timed=1',
    gate: 'scripts/check-planet-witness.mjs',
  }),
  Object.freeze({
    id: 'spoint-planet-frame-harness',
    cause: 'spoint has no frame-time planet path harness: scripts/planet-multiplayer-harness.mjs in spoint is a netcode harness',
    hook: 'comparePlanetRuns refuses runs whose inputs differ; the spoint run must write frameTimesMs and the same inputs',
    gate: 'scripts/check-planet-witness.mjs',
  }),
])
