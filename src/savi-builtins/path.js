const OPTION_NAMES = ['closed', 'smooth', 'spacing']

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isPositive = (value) => isFiniteNumber(value) && value > 0

const toPoint = (p) => {
  if (Array.isArray(p)) {
    if (p.length === 2 && p.every(isFiniteNumber)) return { x: p[0], y: 0, z: p[1] }
    if (p.length === 3 && p.every(isFiniteNumber)) return { x: p[0], y: p[1], z: p[2] }
    throw new TypeError('a path point is [x, z], [x, y, z] or {x, y?, z} with finite numbers')
  }
  if (p && typeof p === 'object' && isFiniteNumber(p.x) && isFiniteNumber(p.z) && (p.y === undefined || isFiniteNumber(p.y))) {
    return { x: p.x, y: p.y ?? 0, z: p.z }
  }
  throw new TypeError('a path point is [x, z], [x, y, z] or {x, y?, z} with finite numbers')
}

const locate = (segments, s) => {
  const last = segments.length - 1
  let i = 0
  while (i < last && s > segments[i].end) i++
  return i
}

export const createPath = (points, opts = {}) => {
  if (!Array.isArray(points) || points.length < 2) throw new RangeError('createPath needs at least two points')
  for (const name of Object.keys(opts)) {
    if (!OPTION_NAMES.includes(name)) throw new RangeError('option ' + name + ' has no documented behaviour in savi; refused as a scoped negative')
  }
  if (opts.smooth !== undefined && opts.smooth !== false) throw new RangeError('smooth has no documented curve in savi; refused as a scoped negative')
  const closed = opts.closed ?? false
  if (typeof closed !== 'boolean') throw new TypeError('closed takes a boolean')
  const spacing = opts.spacing ?? 2
  if (!isPositive(spacing)) throw new RangeError('spacing must be a positive number of metres')

  const pts = points.map(toPoint)
  const count = pts.length
  if (closed) {
    const first = pts[0]
    const last = pts[count - 1]
    if (first.x === last.x && first.z === last.z) throw new RangeError('a closed path does not repeat its first point')
  }

  const segments = []
  let total = 0
  const pairs = closed ? count : count - 1
  for (let i = 0; i < pairs; i++) {
    const a = pts[i]
    const b = pts[(i + 1) % count]
    const dx = b.x - a.x
    const dz = b.z - a.z
    const len = Math.hypot(dx, dz)
    if (len === 0) throw new RangeError('path has a zero-length segment at point ' + i)
    segments.push({ a, b, len, start: total, end: total + len, tx: dx / len, tz: dz / len })
    total += len
  }

  const locateArc = (s) => {
    const i = locate(segments, s)
    const seg = segments[i]
    const t = Math.min(1, Math.max(0, (s - seg.start) / seg.len))
    return { seg, i, t }
  }

  const nearestOn = (x, z) => {
    if (!isFiniteNumber(x) || !isFiniteNumber(z)) throw new TypeError('x and z take finite numbers')
    let best = null
    for (let i = 0; i < segments.length; i++) {
      const seg = segments[i]
      const t = Math.min(1, Math.max(0, ((x - seg.a.x) * (seg.b.x - seg.a.x) + (z - seg.a.z) * (seg.b.z - seg.a.z)) / (seg.len * seg.len)))
      const px = seg.a.x + (seg.b.x - seg.a.x) * t
      const pz = seg.a.z + (seg.b.z - seg.a.z) * t
      const gap = Math.hypot(x - px, z - pz)
      if (best === null || gap < best.distance) {
        best = { seg, i, t, px, pz, distance: gap }
      }
    }
    return best
  }

  const checkWithin = (within) => {
    if (within === undefined) return
    if (!isFiniteNumber(within) || within < 0) throw new RangeError('within takes a non-negative number of metres')
  }

  const handle = {
    points: Object.freeze(pts.map((p) => [p.x, p.z])),
    closed,
    length: total,
    spacing,
    distance(x, z, within) {
      checkWithin(within)
      const best = nearestOn(x, z)
      if (within !== undefined && best.distance > within) return Infinity
      return best.distance
    },
    nearest(x, z, within) {
      checkWithin(within)
      const best = nearestOn(x, z)
      if (within !== undefined && best.distance > within) return null
      const { seg, i, t, px, pz, distance } = best
      return {
        x: px,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
        z: pz,
        distance,
        arcLength: seg.start + t * seg.len,
        t,
        segmentIndex: i,
        tx: seg.tx,
        tz: seg.tz,
      }
    },
    at(arcLength) {
      if (!isFiniteNumber(arcLength)) throw new TypeError('arcLength takes a finite number of metres')
      let s = arcLength
      if (closed) s = ((s % total) + total) % total
      else s = Math.min(total, Math.max(0, s))
      const { seg, t } = locateArc(s)
      return {
        x: seg.a.x + (seg.b.x - seg.a.x) * t,
        y: seg.a.y + (seg.b.y - seg.a.y) * t,
        z: seg.a.z + (seg.b.z - seg.a.z) * t,
        tx: seg.tx,
        tz: seg.tz,
      }
    },
  }
  return handle
}

export const PATH_NAMES = Object.freeze(['createPath'])
