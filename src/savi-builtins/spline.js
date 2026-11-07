const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const toPoint = (p) => {
  const arr = Array.isArray(p) ? p : p && typeof p === 'object' ? [p.x, p.y, p.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a spline point is [x, y, z] or {x, y, z} with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

const minus = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

const length = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])

const compile = (id, definition) => {
  if (!definition || typeof definition !== 'object') throw new TypeError('spline ' + id + ' must be an object with points')
  if (definition.closed !== undefined && definition.closed !== false) throw new RangeError('closed splines have no documented behaviour in savi; refused as a scoped negative')
  if (definition.beziers !== undefined || definition.shape !== undefined) throw new RangeError('bezier and shape geometry have no documented behaviour in savi; refused as a scoped negative')
  if (!Array.isArray(definition.points) || definition.points.length < 2) throw new RangeError('spline ' + id + ' needs at least two points')
  const points = definition.points.map(toPoint)
  const segments = []
  const cumulative = [0]
  for (let i = 1; i < points.length; i++) {
    const seg = minus(points[i], points[i - 1])
    const segLength = length(seg)
    if (segLength === 0) throw new RangeError('spline ' + id + ' has a zero-length segment at point ' + i)
    segments.push({ seg, segLength })
    cumulative.push(cumulative[i - 1] + segLength)
  }
  return { points, segments, cumulative, total: cumulative[cumulative.length - 1] }
}

const sampleAt = (spline, distance) => {
  const last = spline.segments.length - 1
  let i = 0
  while (i < last && distance > spline.cumulative[i + 1]) i++
  const { seg, segLength } = spline.segments[i]
  const t = (distance - spline.cumulative[i]) / segLength
  const a = spline.points[i]
  const position = [a[0] + seg[0] * t, a[1] + seg[1] * t, a[2] + seg[2] * t]
  const tangent = [seg[0] / segLength, seg[1] / segLength, seg[2] / segLength]
  return { position, tangent, distance, progress: distance / spline.total }
}

export const createSplineSet = (definitions) => {
  if (!definitions || typeof definitions !== 'object') throw new TypeError('createSplineSet takes an object of spline definitions')
  const splines = new Map()
  for (const id of Object.keys(definitions)) splines.set(id, compile(id, definitions[id]))
  return {
    splineLength(id) {
      const spline = splines.get(id)
      return spline ? spline.total : 0
    },
    sampleSpline(id, at, opts = {}) {
      const spline = splines.get(id)
      if (!spline) return null
      if (!isFiniteNumber(at)) throw new TypeError('at takes a finite number')
      if (opts.tangentAxis !== undefined) throw new RangeError('tangentAxis has no documented convention in savi; refused as a scoped negative')
      const space = opts.space ?? 'normalized'
      if (space === 'normalized') {
        if (at < 0 || at > 1) throw new RangeError('normalized at takes a value from 0 to 1, got ' + at)
        return sampleAt(spline, at * spline.total)
      }
      if (space === 'distance') {
        if (at < 0 || at > spline.total) throw new RangeError('distance at takes a value from 0 to ' + spline.total + ', got ' + at)
        return sampleAt(spline, at)
      }
      throw new RangeError('space must be normalized or distance, got ' + space)
    },
    projectToSpline(id, point, opts = {}) {
      const spline = splines.get(id)
      if (!spline) return null
      if (typeof point === 'string') throw new RangeError('projection by object id needs a host world; refused as a scoped negative')
      if (Object.keys(opts).length > 0) throw new RangeError('projectToSpline options have no documented behaviour in savi; refused as a scoped negative')
      const p = toPoint(point)
      let best = Infinity
      let bestDistance = 0
      for (let i = 0; i < spline.segments.length; i++) {
        const { seg, segLength } = spline.segments[i]
        const offset = minus(p, spline.points[i])
        const t = Math.min(1, Math.max(0, (offset[0] * seg[0] + offset[1] * seg[1] + offset[2] * seg[2]) / (segLength * segLength)))
        const q = [spline.points[i][0] + seg[0] * t, spline.points[i][1] + seg[1] * t, spline.points[i][2] + seg[2] * t]
        const gap = length(minus(p, q))
        if (gap < best) {
          best = gap
          bestDistance = spline.cumulative[i] + t * segLength
        }
      }
      return sampleAt(spline, bestDistance)
    },
  }
}

export const SPLINE_NAMES = Object.freeze(['splineLength', 'sampleSpline', 'projectToSpline'])
