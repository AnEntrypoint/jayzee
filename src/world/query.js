import { rayCapsule } from './rayShapes.js'

const isVector = (value) => Array.isArray(value) && value.length === 3 && value.every((x) => typeof x === 'number' && Number.isFinite(x))

const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

const normalise = (v) => {
  const length = Math.sqrt(dot(v, v))
  return [v[0] / length, v[1] / length, v[2] / length]
}

const MISS = Object.freeze({ hit: false, kind: null, id: null, distance: Infinity, normal: null, position: null })
const NO_OPTIONS = Object.freeze({})
export const STATIC_COLLIDERS_MIGRATING = 'static-colliders-migrating'
const migrating = (maxDistance) => ({ hit: false, kind: null, id: null, distance: maxDistance, normal: null, position: null, unavailable: STATIC_COLLIDERS_MIGRATING })
const refuse = (index) => {
  const error = new Error('static collider ' + index + ' is migrating, so an answer here would miss it')
  error.code = STATIC_COLLIDERS_MIGRATING
  error.index = index
  return error
}
const POSITION_SCRATCH = [0, 0, 0]

const hitAt = (kind, id, origin, direction, distance, normal) => ({
  hit: true,
  kind,
  id,
  distance,
  normal,
  position: [origin[0] + direction[0] * distance, origin[1] + direction[1] * distance, origin[2] + direction[2] * distance],
})

const raySphere = (origin, direction, center, radius, maxDistance) => {
  const ocx = origin[0] - center[0]
  const ocy = origin[1] - center[1]
  const ocz = origin[2] - center[2]
  const b = ocx * direction[0] + ocy * direction[1] + ocz * direction[2]
  const c = (ocx * ocx + ocy * ocy + ocz * ocz) - radius * radius
  const disc = b * b - c
  if (disc < 0) return null
  const root = Math.sqrt(disc)
  const far = -b + root
  if (far < 0) return null
  const near = -b - root
  const t = near >= 0 ? near : 0
  if (t > maxDistance) return null
  const px = origin[0] + direction[0] * t - center[0]
  const py = origin[1] + direction[1] * t - center[1]
  const pz = origin[2] + direction[2] * t - center[2]
  const length = Math.sqrt(px * px + py * py + pz * pz)
  return { distance: t, normal: length > 0 ? [px / length, py / length, pz / length] : [0, 1, 0] }
}

const rayBox = (origin, direction, box, maxDistance) => {
  let near = -Infinity
  let far = Infinity
  let axis = -1
  for (let a = 0; a < 3; a++) {
    const lo = box[a]
    const hi = box[a + 3]
    if (direction[a] === 0) {
      if (origin[a] < lo || origin[a] > hi) return null
      continue
    }
    let t1 = (lo - origin[a]) / direction[a]
    let t2 = (hi - origin[a]) / direction[a]
    if (t1 > t2) [t1, t2] = [t2, t1]
    if (t1 > near) {
      near = t1
      axis = a
    }
    if (t2 < far) far = t2
    if (near > far) return null
  }
  if (far < 0) return null
  if (near > maxDistance) return null
  if (near < 0) return { distance: 0, normal: [0, 0, 0] }
  const normal = [0, 0, 0]
  normal[axis] = direction[axis] > 0 ? -1 : 1
  return { distance: near, normal }
}

const checkBox = (box, index) => {
  if (!Array.isArray(box) || box.length !== 6 || !box.every((x) => typeof x === 'number' && Number.isFinite(x))) {
    throw new TypeError('box ' + index + ' must hold six finite numbers')
  }
  if (box[0] > box[3] || box[1] > box[4] || box[2] > box[5]) throw new RangeError('box ' + index + ' has min above max')
}

const checkCapsule = (capsule, index) => {
  if (!capsule || !isVector(capsule.a) || !isVector(capsule.b) || !(typeof capsule.radius === 'number' && capsule.radius > 0)) {
    throw new TypeError('capsule ' + index + ' needs finite end points a and b and a positive radius')
  }
}

const checkMesh = (mesh, index) => {
  if (!mesh || typeof mesh.raycast !== 'function') throw new TypeError('mesh ' + index + ' must be a triangle mesh with raycast')
}

export const createQueries = (world, { radius, boxes = [], capsules = [], meshes = [] }) => {
  if (!(typeof radius === 'number' && radius > 0)) throw new RangeError('radius must be a positive number, the body radius')
  boxes.forEach(checkBox)
  capsules.forEach(checkCapsule)
  meshes.forEach(checkMesh)
  const admits = (id, options) => {
    if (options.exclude && options.exclude.includes(id)) return false
    if (options.filter && !options.filter(id)) return false
    return true
  }
  const bodyPosition = (id) => world.position(id, POSITION_SCRATCH)
  const count = () => world.count
  const parked = new Set()
  const checkIndex = (index) => {
    if (!Number.isInteger(index) || !(index in boxes)) throw new RangeError('static collider ' + index + ' is not in the index')
  }
  const park = (index) => {
    checkIndex(index)
    if (parked.has(index)) return false
    parked.add(index)
    return true
  }
  const restore = (index) => {
    checkIndex(index)
    return parked.delete(index)
  }
  const gap2 = (box, point) => {
    const dx = point[0] - Math.min(Math.max(point[0], box[0]), box[3])
    const dy = point[1] - Math.min(Math.max(point[1], box[1]), box[4])
    const dz = point[2] - Math.min(Math.max(point[2], box[2]), box[5])
    return dx * dx + dy * dy + dz * dz
  }
  const drain = (limit, movers = []) => {
    if (!(Number.isInteger(limit) && limit >= 0)) throw new RangeError('limit must be a whole number of colliders, zero or above')
    if (!Array.isArray(movers) || !movers.every(isVector)) throw new TypeError('movers must be a list of finite [x, y, z] triples')
    const order = [...parked].map((index) => {
      let nearest = movers.length === 0 ? 0 : Infinity
      for (const mover of movers) nearest = Math.min(nearest, gap2(boxes[index], mover))
      return { index, nearest }
    }).sort((a, b) => a.nearest - b.nearest || a.index - b.index)
    const restored = []
    for (let i = 0; i < order.length && restored.length < limit; i++) {
      parked.delete(order[i].index)
      restored.push(order[i].index)
    }
    return restored
  }
  const touches = (box, min, max) => box[0] <= max[0] && box[3] >= min[0] && box[1] <= max[1] && box[4] >= min[1] && box[2] <= max[2] && box[5] >= min[2]

  const raycast = (origin, direction, maxDistance = Infinity, options = NO_OPTIONS) => {
    if (!isVector(origin)) throw new TypeError('origin must be a finite [x, y, z] triple')
    if (!isVector(direction) || dot(direction, direction) === 0) throw new RangeError('direction must be a finite, nonzero [x, y, z] triple')
    if (!(maxDistance > 0)) throw new RangeError('maxDistance must be above zero')
    const unit = normalise(direction)
    let best = MISS
    for (let id = 0; id < count(); id++) {
      if (!admits(id, options)) continue
      const hit = raySphere(origin, unit, bodyPosition(id), radius, maxDistance)
      if (hit && hit.distance < best.distance) best = hitAt('body', id, origin, unit, hit.distance, hit.normal)
    }
    if (options.boxes !== false) {
      let hidden = Infinity
      for (let index = 0; index < boxes.length; index++) {
        if (!(index in boxes)) continue
        const hit = rayBox(origin, unit, boxes[index], maxDistance)
        if (!hit) continue
        if (parked.has(index)) {
          if (hit.distance < hidden) hidden = hit.distance
          continue
        }
        if (hit.distance < best.distance) best = hitAt('box', index, origin, unit, hit.distance, hit.normal)
      }
      if (hidden < best.distance) return migrating(maxDistance)
    }
    if (options.capsules !== false) {
      for (let index = 0; index < capsules.length; index++) {
        const capsule = capsules[index]
        const hit = rayCapsule(origin, unit, capsule.a, capsule.b, capsule.radius, maxDistance)
        if (hit && hit.distance < best.distance) best = hitAt('capsule', index, origin, unit, hit.distance, hit.normal)
      }
    }
    if (options.meshes !== false) {
      for (let index = 0; index < meshes.length; index++) {
        const hit = meshes[index].raycast(origin, unit, Math.min(maxDistance, best.distance), options.backFaces !== false)
        if (!hit || !(hit.distance < best.distance)) continue
        best = hitAt('mesh', index, origin, unit, hit.distance, [hit.normal[0], hit.normal[1], hit.normal[2]])
        best.triangle = hit.triangle
      }
    }
    return best
  }

  const overlapStatics = (min, max) => {
    if (!isVector(min) || !isVector(max) || min.some((x, a) => x > max[a])) throw new RangeError('min must hold no coordinate above max')
    const indexes = []
    for (let index = 0; index < boxes.length; index++) {
      if (!(index in boxes) || !touches(boxes[index], min, max)) continue
      if (parked.has(index)) throw refuse(index)
      indexes.push(index)
    }
    return indexes
  }

  const overlapSphere = (center, reach, options = NO_OPTIONS) => {
    if (!isVector(center)) throw new TypeError('center must be a finite [x, y, z] triple')
    if (!(reach >= 0)) throw new RangeError('reach must be zero or above')
    const limit = (reach + radius) * (reach + radius)
    const ids = []
    for (let id = 0; id < count(); id++) {
      if (!admits(id, options)) continue
      const p = bodyPosition(id)
      const dx = p[0] - center[0]
      const dy = p[1] - center[1]
      const dz = p[2] - center[2]
      if (dx * dx + dy * dy + dz * dz <= limit) ids.push(id)
    }
    return ids
  }

  const overlapBox = (min, max, options = NO_OPTIONS) => {
    if (!isVector(min) || !isVector(max) || min.some((x, a) => x > max[a])) throw new RangeError('min must hold no coordinate above max')
    const ids = []
    for (let id = 0; id < count(); id++) {
      if (!admits(id, options)) continue
      const p = bodyPosition(id)
      const qx = Math.min(Math.max(p[0], min[0]), max[0])
      const qy = Math.min(Math.max(p[1], min[1]), max[1])
      const qz = Math.min(Math.max(p[2], min[2]), max[2])
      const dx = p[0] - qx
      const dy = p[1] - qy
      const dz = p[2] - qz
      if (dx * dx + dy * dy + dz * dz <= radius * radius) ids.push(id)
    }
    return ids
  }

  return {
    raycast,
    overlapSphere,
    overlapBox,
    overlapStatics,
    park,
    restore,
    drain,
    isPending: (index) => parked.has(index),
    get pendingCount() { return parked.size },
  }
}
