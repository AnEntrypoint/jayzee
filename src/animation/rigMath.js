export const IDENTITY_QUAT = Object.freeze([0, 0, 0, 1])

export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

export const lengthSq3 = (v) => v[0] * v[0] + v[1] * v[1] + v[2] * v[2]

export const length3 = (v) => Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2])

export const distance3 = (a, b) => {
  const dx = a[0] - b[0]
  const dy = a[1] - b[1]
  const dz = a[2] - b[2]
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

export const add3 = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]

export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]

export const scale3 = (v, s) => [v[0] * s, v[1] * s, v[2] * s]

export const divide3 = (v, s) => scale3(v, 1 / s)

export const addScaled3 = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s]

export const normalize3 = (v) => divide3(v, length3(v) || 1)

export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]

export const lerp3 = (a, b, t) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
]

export const angleTo3 = (a, b) => {
  const denominator = Math.sqrt(lengthSq3(a) * lengthSq3(b))
  if (denominator === 0) return Math.PI / 2
  return Math.acos(Math.min(1, Math.max(-1, dot3(a, b) / denominator)))
}

export const applyQuat3 = (v, q) => {
  const [vx, vy, vz] = v
  const [qx, qy, qz, qw] = q
  const tx = 2 * (qy * vz - qz * vy)
  const ty = 2 * (qz * vx - qx * vz)
  const tz = 2 * (qx * vy - qy * vx)
  return [
    vx + qw * tx + qy * tz - qz * ty,
    vy + qw * ty + qz * tx - qx * tz,
    vz + qw * tz + qx * ty - qy * tx,
  ]
}

export const applyMatrix4Point = (m, v) => {
  const [x, y, z] = v
  const w = 1 / (m[3] * x + m[7] * y + m[11] * z + m[15])
  return [
    (m[0] * x + m[4] * y + m[8] * z + m[12]) * w,
    (m[1] * x + m[5] * y + m[9] * z + m[13]) * w,
    (m[2] * x + m[6] * y + m[10] * z + m[14]) * w,
  ]
}

export const applyMatrix4Linear = (m, v) => {
  const [x, y, z] = v
  return [
    m[0] * x + m[4] * y + m[8] * z,
    m[1] * x + m[5] * y + m[9] * z,
    m[2] * x + m[6] * y + m[10] * z,
  ]
}

export const invertMatrix4 = (m) => {
  const n11 = m[0], n21 = m[1], n31 = m[2], n41 = m[3]
  const n12 = m[4], n22 = m[5], n32 = m[6], n42 = m[7]
  const n13 = m[8], n23 = m[9], n33 = m[10], n43 = m[11]
  const n14 = m[12], n24 = m[13], n34 = m[14], n44 = m[15]
  const t1 = n11 * n22 - n21 * n12
  const t2 = n11 * n32 - n31 * n12
  const t3 = n11 * n42 - n41 * n12
  const t4 = n21 * n32 - n31 * n22
  const t5 = n21 * n42 - n41 * n22
  const t6 = n31 * n42 - n41 * n32
  const t7 = n13 * n24 - n23 * n14
  const t8 = n13 * n34 - n33 * n14
  const t9 = n13 * n44 - n43 * n14
  const t10 = n23 * n34 - n33 * n24
  const t11 = n23 * n44 - n43 * n24
  const t12 = n33 * n44 - n43 * n34
  const det = t1 * t12 - t2 * t11 + t3 * t10 + t4 * t9 - t5 * t8 + t6 * t7
  if (det === 0) return new Array(16).fill(0)
  const detInv = 1 / det
  return [
    (n22 * t12 - n32 * t11 + n42 * t10) * detInv,
    (n31 * t11 - n21 * t12 - n41 * t10) * detInv,
    (n24 * t6 - n34 * t5 + n44 * t4) * detInv,
    (n33 * t5 - n23 * t6 - n43 * t4) * detInv,
    (n32 * t9 - n12 * t12 - n42 * t8) * detInv,
    (n11 * t12 - n31 * t9 + n41 * t8) * detInv,
    (n34 * t3 - n14 * t6 - n44 * t2) * detInv,
    (n13 * t6 - n33 * t3 + n43 * t2) * detInv,
    (n12 * t11 - n22 * t9 + n42 * t7) * detInv,
    (n21 * t9 - n11 * t11 - n41 * t7) * detInv,
    (n14 * t5 - n24 * t3 + n44 * t1) * detInv,
    (n23 * t3 - n13 * t5 - n43 * t1) * detInv,
    (n22 * t8 - n12 * t10 - n32 * t7) * detInv,
    (n11 * t10 - n21 * t8 + n31 * t7) * detInv,
    (n24 * t2 - n14 * t4 - n34 * t1) * detInv,
    (n13 * t4 - n23 * t2 + n33 * t1) * detInv,
  ]
}

export const quatDot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3]

export const quatLength = (q) => Math.sqrt(q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3])

export const quatNormalize = (q) => {
  const l = quatLength(q)
  if (l === 0) return [0, 0, 0, 1]
  const inverse = 1 / l
  return [q[0] * inverse, q[1] * inverse, q[2] * inverse, q[3] * inverse]
}

export const quatConjugate = (q) => [-q[0], -q[1], -q[2], q[3]]

export const quatMultiply = (a, b) => {
  const [qax, qay, qaz, qaw] = a
  const [qbx, qby, qbz, qbw] = b
  return [
    qax * qbw + qaw * qbx + qay * qbz - qaz * qby,
    qay * qbw + qaw * qby + qaz * qbx - qax * qbz,
    qaz * qbw + qaw * qbz + qax * qby - qay * qbx,
    qaw * qbw - qax * qbx - qay * qby - qaz * qbz,
  ]
}

export const quatFromUnitVectors = (from, to) => {
  let r = dot3(from, to) + 1
  if (r < 1e-8) {
    r = 0
    if (Math.abs(from[0]) > Math.abs(from[2])) return quatNormalize([-from[1], from[0], 0, r])
    return quatNormalize([0, -from[2], from[1], r])
  }
  return quatNormalize([
    from[1] * to[2] - from[2] * to[1],
    from[2] * to[0] - from[0] * to[2],
    from[0] * to[1] - from[1] * to[0],
    r,
  ])
}

export const quatSlerp = (a, b, t) => {
  let [x, y, z, w] = b
  let dot = quatDot(a, b)
  if (dot < 0) {
    x = -x
    y = -y
    z = -z
    w = -w
    dot = -dot
  }
  let s = 1 - t
  if (dot < 0.9995) {
    const theta = Math.acos(dot)
    const sin = Math.sin(theta)
    s = Math.sin(s * theta) / sin
    const u = Math.sin(t * theta) / sin
    return [a[0] * s + x * u, a[1] * s + y * u, a[2] * s + z * u, a[3] * s + w * u]
  }
  return quatNormalize([a[0] * s + x * t, a[1] * s + y * t, a[2] * s + z * t, a[3] * s + w * t])
}

const describe = (value) => (value === null ? 'null' : typeof value === 'number' ? String(value) : typeof value)

export const finiteTuple = (value, size, name, owner) => {
  const ok = value != null && typeof value === 'object' && value.length === size
    && Array.prototype.every.call(value, (component) => typeof component === 'number' && Number.isFinite(component))
  if (!ok) throw new Error('[' + owner + '] ' + name + ' needs ' + size + ' finite numbers; got ' + describe(value))
  return Array.from(value)
}

export const describeValue = describe
