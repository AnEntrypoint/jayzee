import {
  IDENTITY_QUAT, add3Into, addScaled3Into, angleTo3, applyQuat3Into, copy3, copy4, divide3, finiteTuple, finiteTupleInto, length3,
  lengthSq3, lerp3Into, normalize3Into, quatConjugateInto, quatFromUnitVectorsInto, quatMultiplyInto, quatSlerpInto, scale3Into,
  sub3, sub3Into,
} from './rigMath.js'

export const GRAVITY_MS2 = 9.81
export const SPRING_RATE_PER_S2 = 40
export const MAX_STEP_S = 1 / 30
export const RETAIN_AT_BOUNCE_0 = 0.85
export const RETAIN_AT_BOUNCE_1 = 0.995
const DEG = Math.PI / 180
const OWNER = 'SpringBones'

const held = {
  accel: [0, 0, 0],
  wind: [0, 0, 0],
  velocity: [0, 0, 0],
  moved: [0, 0, 0],
  target: [0, 0, 0],
  center: [0, 0, 0],
  offset: [0, 0, 0],
  rest: [0, 0, 0],
  dir: [0, 0, 0],
  swing: [0, 0, 0, 1],
  clamp: [0, 0, 0, 1],
  total: [0, 0, 0, 1],
  world: [0, 0, 0, 1],
  parentWorld: [0, 0, 0, 1],
  conjugate: [0, 0, 0, 1],
  local: [0, 0, 0, 1],
}

const fractionOf = (value, fallback, name) => {
  const v = value === undefined ? fallback : value
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1) {
    throw new Error('[SpringBones] ' + name + ' needs a number from 0 to 1; got ' + String(v))
  }
  return v
}

const limitOf = (value) => {
  if (value === undefined) return 180
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 180) {
    throw new Error('[SpringBones] limit needs degrees from over 0 to 180; got ' + String(value))
  }
  return value
}

export class SpringBoneChain {
  constructor(worldPositions, worldQuats, parentWorldQuat = IDENTITY_QUAT, options = {}) {
    if (!Array.isArray(worldPositions) || worldPositions.length < 2) {
      throw new Error('[SpringBones] a chain needs at least two bones, each with a world position')
    }
    if (!Array.isArray(worldQuats) || worldQuats.length !== worldPositions.length) {
      throw new Error('[SpringBones] a chain needs one world quaternion per bone')
    }
    this.boneCount = worldPositions.length
    this.amount = fractionOf(options.amount, 0.5, 'amount')
    this.bounce = fractionOf(options.bounce, 0.5, 'bounce')
    this.gravity = fractionOf(options.gravity, 0, 'gravity')
    this.windForce = options.wind?.force ?? 0
    if (typeof this.windForce !== 'number' || !Number.isFinite(this.windForce) || this.windForce < 0) {
      throw new Error('[SpringBones] wind.force needs a finite number of at least 0; got ' + String(this.windForce))
    }
    this.limitRad = limitOf(options.limit) * DEG
    this.colliders = (options.colliders ?? []).map((c) => this._colliderOf(c))

    this.parentQuat = finiteTuple(parentWorldQuat, 4, 'parent world quaternion', OWNER)
    this.points = worldPositions.map((p, k) => finiteTuple(p, 3, 'world position ' + k, OWNER))
    this.prev = this.points.map((p) => p.slice())
    this.restQuat = worldQuats.map((q, k) => finiteTuple(q, 4, 'world quaternion ' + k, OWNER))
    this.lengths = []
    this.restDirs = []
    for (let k = 0; k < this.boneCount - 1; k += 1) {
      const dir = sub3(this.points[k + 1], this.points[k])
      const length = length3(dir)
      if (!(length > 0)) throw new Error('[SpringBones] bone ' + k + ' sits on bone ' + (k + 1))
      this.lengths.push(length)
      this.restDirs.push(divide3(dir, length))
    }
    this.rest = this.restDirs.map((d) => d.slice())
  }

  _colliderOf(spec) {
    const index = spec ? spec.index : undefined
    if (!Number.isInteger(index) || index < 0 || index >= this.boneCount) {
      throw new Error('[SpringBones] a collider bone must be one of the chain bones')
    }
    if (typeof spec.radius !== 'number' || !Number.isFinite(spec.radius) || spec.radius <= 0) {
      throw new Error('[SpringBones] collider radius needs a number greater than 0; got ' + String(spec.radius))
    }
    const offset = spec.offset ? finiteTuple(spec.offset, 3, 'collider offset', OWNER) : [0, 0, 0]
    return { index, offset, radius: spec.radius }
  }

  update(dt, rootWorld, windDir = null, out = null) {
    if (!(dt > 0)) return null
    const step = Math.min(dt, MAX_STEP_S)
    const step2 = step * step
    const last = this.boneCount - 1
    const retain = RETAIN_AT_BOUNCE_0 + (RETAIN_AT_BOUNCE_1 - RETAIN_AT_BOUNCE_0) * this.bounce
    const pull = Math.min(1, this.amount * SPRING_RATE_PER_S2 * step2)
    const accel = held.accel
    accel[0] = 0
    accel[1] = -GRAVITY_MS2 * this.gravity
    accel[2] = 0
    if (windDir) addScaled3Into(accel, accel, finiteTupleInto(held.wind, windDir, 3, 'wind direction', OWNER), this.windForce)

    finiteTupleInto(this.points[0], rootWorld, 3, 'root world position', OWNER)
    copy3(this.prev[0], this.points[0])

    for (let k = 1; k <= last; k += 1) {
      const p = this.points[k]
      const velocity = scale3Into(held.velocity, sub3Into(held.velocity, p, this.prev[k]), retain)
      copy3(this.prev[k], p)
      const moved = addScaled3Into(held.moved, add3Into(held.moved, p, velocity), accel, step2)
      const target = addScaled3Into(held.target, this.points[k - 1], this.rest[k - 1], this.lengths[k - 1])
      lerp3Into(p, moved, target, pull)
    }

    for (const c of this.colliders) {
      const center = add3Into(held.center, this.points[c.index], c.offset)
      for (let k = 1; k <= last; k += 1) {
        if (k === c.index) continue
        const d = sub3Into(held.offset, this.points[k], center)
        const dist = length3(d)
        if (dist > 0 && dist < c.radius) {
          addScaled3Into(center, center, d, c.radius / dist)
          copy3(this.points[k], center)
        }
      }
    }

    const localQuats = out === null ? [] : out
    const total = copy4(held.total, IDENTITY_QUAT)
    const parentWorld = copy4(held.parentWorld, this.parentQuat)
    for (let k = 0; k < last; k += 1) {
      const rest = applyQuat3Into(held.rest, this.restDirs[k], total)
      copy3(this.rest[k], rest)
      const dir = sub3Into(held.dir, this.points[k + 1], this.points[k])
      if (lengthSq3(dir) > 0) normalize3Into(dir, dir)
      else copy3(dir, rest)
      const bend = angleTo3(rest, dir)
      if (bend > this.limitRad) {
        const clamp = quatSlerpInto(held.clamp, quatFromUnitVectorsInto(held.swing, rest, dir), IDENTITY_QUAT, 1 - this.limitRad / bend)
        applyQuat3Into(dir, rest, clamp)
      }
      addScaled3Into(this.points[k + 1], this.points[k], dir, this.lengths[k])
      quatMultiplyInto(total, quatFromUnitVectorsInto(held.swing, rest, dir), total)
      const world = quatMultiplyInto(held.world, total, this.restQuat[k])
      const local = quatMultiplyInto(held.local, quatConjugateInto(held.conjugate, parentWorld), world)
      if (out === null) localQuats.push([local[0], local[1], local[2], local[3]])
      else if (k < localQuats.length) copy4(localQuats[k], local)
      else localQuats.push([local[0], local[1], local[2], local[3]])
      copy4(parentWorld, world)
    }
    if (localQuats.length !== last) localQuats.length = last
    return localQuats
  }
}
