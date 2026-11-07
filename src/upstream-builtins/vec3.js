const DEG = Math.PI / 180
const AXES = Object.freeze({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1], '-x': [-1, 0, 0], '-y': [0, -1, 0], '-z': [0, 0, -1] })

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

export const toVec = (v) => {
  const arr = Array.isArray(v) ? v : v && typeof v === 'object' ? [v.x, v.y, v.z] : null
  if (!arr || arr.length !== 3 || !arr.every(isFiniteNumber)) throw new TypeError('a vector is {x, y, z} or [x, y, z] with finite numbers')
  return [arr[0], arr[1], arr[2]]
}

export const add = (a, b) => {
  const [ax, ay, az] = toVec(a)
  const [bx, by, bz] = toVec(b)
  return [ax + bx, ay + by, az + bz]
}

export const sub = (a, b) => {
  const [ax, ay, az] = toVec(a)
  const [bx, by, bz] = toVec(b)
  return [ax - bx, ay - by, az - bz]
}

export const scale = (v, s) => {
  if (!isFiniteNumber(s)) throw new TypeError('scale takes a finite number')
  const [x, y, z] = toVec(v)
  return [x * s, y * s, z * s]
}

export const dot = (a, b) => {
  const [ax, ay, az] = toVec(a)
  const [bx, by, bz] = toVec(b)
  return ax * bx + ay * by + az * bz
}

export const length = (v) => Math.sqrt(dot(v, v))

export const normalize = (v) => {
  const len = length(v)
  if (len === 0) throw new RangeError('cannot normalize the zero vector')
  return scale(v, 1 / len)
}

export const distance = (a, b) => length(sub(a, b))

export const cross = (a, b) => {
  const [ax, ay, az] = toVec(a)
  const [bx, by, bz] = toVec(b)
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx]
}

const quatFromAxisAngle = (axis, angle) => {
  const s = Math.sin(angle / 2)
  return { x: axis[0] * s, y: axis[1] * s, z: axis[2] * s, w: Math.cos(angle / 2) }
}

const quatMul = (a, b) => ({
  x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
  y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
  z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
  w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
})

const quatNormalize = (q) => {
  const len = Math.sqrt(q.x * q.x + q.y * q.y + q.z * q.z + q.w * q.w)
  return { x: q.x / len, y: q.y / len, z: q.z / len, w: q.w / len }
}

const isQuat = (value) => value && typeof value === 'object' && ['x', 'y', 'z', 'w'].every((k) => isFiniteNumber(value[k]))

const eulerOf = (value) => {
  if (isFiniteNumber(value)) return { yaw: value, pitch: 0, roll: 0 }
  if (value && typeof value === 'object') {
    const yaw = value.yaw ?? 0
    const pitch = value.pitch ?? 0
    const roll = value.roll ?? 0
    if (![yaw, pitch, roll].every(isFiniteNumber)) throw new TypeError('euler angles must be finite degrees')
    return { yaw, pitch, roll }
  }
  throw new TypeError('rotation is degrees, {yaw, pitch, roll} or a quaternion')
}

export const rotationFromEuler = (euler) => {
  const { yaw, pitch, roll } = eulerOf(euler)
  const qy = quatFromAxisAngle([0, 1, 0], yaw * DEG)
  const qx = quatFromAxisAngle([1, 0, 0], pitch * DEG)
  const qz = quatFromAxisAngle([0, 0, 1], roll * DEG)
  return quatNormalize(quatMul(quatMul(qy, qx), qz))
}

const applyQuat = (q, v) => {
  const [vx, vy, vz] = toVec(v)
  const ux = q.x
  const uy = q.y
  const uz = q.z
  const s = q.w
  const cx = uy * vz - uz * vy
  const cy = uz * vx - ux * vz
  const cz = ux * vy - uy * vx
  const dx = uy * cz - uz * cy
  const dy = uz * cx - ux * cz
  const dz = ux * cy - uy * cx
  return [vx + 2 * (s * cx + dx), vy + 2 * (s * cy + dy), vz + 2 * (s * cz + dz)]
}

export const rotate = (rotation, v) => {
  const q = isQuat(rotation) ? quatNormalize(rotation) : rotationFromEuler(rotation)
  return applyQuat(q, v)
}

export const directionFromYawPitch = (yaw, pitch = 0) => {
  if (!isFiniteNumber(yaw) || !isFiniteNumber(pitch)) throw new TypeError('yaw and pitch are finite degrees')
  return rotate({ yaw, pitch }, [0, 0, -1])
}

export const rotationFromDirection = (direction, axis = '-z') => {
  if (!Object.prototype.hasOwnProperty.call(AXES, axis)) throw new RangeError('axis must be one of x, y, z, -x, -y, -z')
  const from = AXES[axis]
  const to = normalize(direction)
  const d = dot(from, to)
  if (d < -1 + 1e-12) {
    const perpendicular = Math.abs(from[0]) > 0.5 ? [0, 1, 0] : [1, 0, 0]
    const onAxis = cross(from, perpendicular)
    return quatNormalize({ x: onAxis[0], y: onAxis[1], z: onAxis[2], w: 0 })
  }
  const c = cross(from, to)
  return quatNormalize({ x: c[0], y: c[1], z: c[2], w: 1 + d })
}

export const eulerFromRotation = (q) => {
  if (!isQuat(q)) throw new TypeError('eulerFromRotation takes a quaternion {x, y, z, w}')
  const n = quatNormalize(q)
  const m12 = 2 * (n.y * n.z - n.w * n.x)
  const m02 = 2 * (n.x * n.z + n.w * n.y)
  const m22 = 1 - 2 * (n.x * n.x + n.y * n.y)
  const m10 = 2 * (n.x * n.y + n.w * n.z)
  const m11 = 1 - 2 * (n.x * n.x + n.z * n.z)
  const pitch = Math.asin(Math.max(-1, Math.min(1, -m12)))
  const yaw = Math.atan2(m02, m22)
  const roll = Math.atan2(m10, m11)
  return { yaw: yaw / DEG, pitch: pitch / DEG, roll: roll / DEG }
}

export const VEC3_NAMES = Object.freeze(['add', 'sub', 'scale', 'dot', 'length', 'normalize', 'distance', 'cross', 'directionFromYawPitch', 'rotate', 'rotationFromDirection', 'rotationFromEuler', 'eulerFromRotation'])
