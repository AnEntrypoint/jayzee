export const PLACEMENT_JOLT_HEIGHTFIELD = 'jolt-heightfield'
export const PLACEMENT_GROUND_QUERY = 'ground-query'
export const PLACEMENT_GPU_QUERY = 'gpu-query'
export const PLACEMENT_OPTIONS = Object.freeze([PLACEMENT_GROUND_QUERY, PLACEMENT_JOLT_HEIGHTFIELD, PLACEMENT_GPU_QUERY])

const need = (name, fn, label) => {
  if (typeof fn !== 'function') throw new TypeError(name + ' needs ' + label + ' as a function')
  return fn
}

const measured = (now, samples) => (run) => {
  const t0 = now()
  const out = run()
  samples.push(now() - t0)
  return out
}

const summarise = (samples) => {
  if (samples.length === 0) return { count: 0, p50Ms: null, p99Ms: null, maxMs: null }
  const sorted = samples.slice().sort((a, b) => a - b)
  const at = (q) => sorted[Math.min(sorted.length - 1, Math.ceil(q * sorted.length) - 1)]
  return { count: sorted.length, p50Ms: at(0.5), p99Ms: at(0.99), maxMs: sorted[sorted.length - 1] }
}

export const createGroundQueryPlacement = ({ sampleHeight, now }) => {
  const sample = need(PLACEMENT_GROUND_QUERY, sampleHeight, 'sampleHeight(x, y, z)')
  const clock = need(PLACEMENT_GROUND_QUERY, now, 'now()')
  const timings = []
  const timed = measured(clock, timings)
  return {
    name: PLACEMENT_GROUND_QUERY,
    build() { return null },
    query(x, y, z) { return timed(() => sample(x, y, z)) },
    measure() { return summarise(timings) },
  }
}

export const createJoltHeightfieldPlacement = ({ buildHeightfield, raycastDown, now }) => {
  const build = need(PLACEMENT_JOLT_HEIGHTFIELD, buildHeightfield, 'buildHeightfield(samples, cellM)')
  const cast = need(PLACEMENT_JOLT_HEIGHTFIELD, raycastDown, 'raycastDown(x, z) returning a height or null')
  const clock = need(PLACEMENT_JOLT_HEIGHTFIELD, now, 'now()')
  const timings = []
  const timed = measured(clock, timings)
  let body = null
  return {
    name: PLACEMENT_JOLT_HEIGHTFIELD,
    build(samples, cellM) {
      body = build(samples, cellM)
      return body
    },
    query(x, z) { return timed(() => cast(x, z)) },
    measure() { return summarise(timings) },
  }
}

export const createGpuQueryPlacement = ({ dispatch, now }) => {
  const run = need(PLACEMENT_GPU_QUERY, dispatch, 'dispatch(positions) returning heights')
  const clock = need(PLACEMENT_GPU_QUERY, now, 'now()')
  const timings = []
  const timed = measured(clock, timings)
  return {
    name: PLACEMENT_GPU_QUERY,
    build() { return null },
    query(positions) { return timed(() => run(positions)) },
    measure() { return summarise(timings) },
  }
}

export const chooseByMeasurement = (results, { maxErrorM, metric = 'p99Ms' }) => {
  if (!Number.isFinite(maxErrorM) || maxErrorM < 0) throw new RangeError('maxErrorM must be a finite number at or above zero')
  if (metric !== 'p99Ms' && metric !== 'p50Ms' && metric !== 'maxMs') throw new RangeError('unknown metric: ' + metric)
  const usable = results.filter((r) => r.measure && r.measure.count > 0 && r.errorM !== null && r.errorM !== undefined)
  if (usable.length === 0) return { name: null, reason: 'no option has a measurement' }
  const within = usable.filter((r) => r.errorM <= maxErrorM)
  if (within.length === 0) return { name: null, reason: 'no measured option is within ' + maxErrorM + ' m' }
  within.sort((a, b) => (a.measure[metric] - b.measure[metric]) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0))
  return { name: within[0].name, reason: 'lowest ' + metric + ' among options within ' + maxErrorM + ' m' }
}
