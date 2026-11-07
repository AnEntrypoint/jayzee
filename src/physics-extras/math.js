export function refusal(scope, code, message) {
  const err = new TypeError(`[${scope}] ${code}: ${message}`)
  err.reasonCode = code
  return err
}

export function checkVec3(value, name, code, scope = 'vec3') {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)) {
    throw refusal(scope, code, `${name} must be an array of three finite numbers`)
  }
  return value
}

export function readVec3(value, name = 'value') {
  return checkVec3(value, name, 'vec3-invalid')
}

export function readQuat(value, name = 'value') {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(Number.isFinite)) {
    throw refusal('quat', 'quat-invalid', `${name} must be an array of four finite numbers`)
  }
  return value
}

export function cross(a, b) {
  readVec3(a, 'a')
  readVec3(b, 'b')
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

export function normalizeQuat(q) {
  readQuat(q, 'q')
  const length = Math.hypot(...q)
  if (length === 0) throw refusal('quat', 'quat-zero-length', 'cannot normalize a zero quaternion')
  return q.map((component) => component / length)
}

export function rotate(q, v) {
  const [qx, qy, qz, qw] = normalizeQuat(readQuat(q, 'q'))
  const [vx, vy, vz] = readVec3(v, 'v')
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ]
}

export function fromAxisAngle(axis, angle) {
  readVec3(axis, 'axis')
  if (!Number.isFinite(angle)) throw refusal('quat', 'quat-angle-invalid', 'angle must be finite')
  const length = Math.hypot(...axis)
  if (length === 0) throw refusal('quat', 'quat-axis-zero', 'axis must not be zero')
  const half = angle / 2
  const scale = Math.sin(half) / length
  return [axis[0] * scale, axis[1] * scale, axis[2] * scale, Math.cos(half)]
}

export function addVec3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
