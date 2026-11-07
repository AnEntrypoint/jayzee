const QUANTUM_SCALE = 511.0 * Math.SQRT2
const HALF_SQRT2 = Math.SQRT1_2
const COMPONENT_BITS = 10
const COMPONENT_MASK = 0x3ff
const MAX_QUANTUM = 1022
const SKIPPED_COMPONENT_INDICES = [[1, 2, 3], [0, 2, 3], [0, 1, 3], [0, 1, 2]]

function largestMagnitudeIndex(rx, ry, rz, rw) {
  const ax = Math.abs(rx)
  const ay = Math.abs(ry)
  const az = Math.abs(rz)
  const aw = Math.abs(rw)
  if (ay > ax) {
    if (az > ay) return aw > az ? 3 : 2
    return aw > ay ? 3 : 1
  }
  if (az > ax) return aw > az ? 3 : 2
  return aw > ax ? 3 : 0
}

function quantizeComponent(scaled) {
  const floored = Number.isNaN(scaled) ? 0 : Math.max(scaled, 0)
  return Math.min(floored, MAX_QUANTUM)
}

function requireLength(values, length, name) {
  if (!values || values.length < length) {
    throw new RangeError(`${name} takes ${length} numbers, got ${values ? values.length : 'none'}`)
  }
}

export function packQuat(rx, ry, rz, rw) {
  const components = [rx, ry, rz, rw]
  const maxIndex = largestMagnitudeIndex(rx, ry, rz, rw)
  const sign = components[maxIndex] < 0 ? -1 : 1
  let packed = maxIndex
  for (let i = 0; i < 4; i++) {
    if (i === maxIndex) continue
    const quantum = Math.round(quantizeComponent((components[i] * sign + HALF_SQRT2) * QUANTUM_SCALE))
    packed = ((packed << COMPONENT_BITS) | (quantum & COMPONENT_MASK)) >>> 0
  }
  return packed
}

export function unpackQuat(packed) {
  const word = packed >>> 0
  const maxIndex = (word >>> 30) & 0x3
  const c2 = (word & COMPONENT_MASK) / QUANTUM_SCALE - HALF_SQRT2
  const c1 = ((word >>> COMPONENT_BITS) & COMPONENT_MASK) / QUANTUM_SCALE - HALF_SQRT2
  const c0 = ((word >>> (2 * COMPONENT_BITS)) & COMPONENT_MASK) / QUANTUM_SCALE - HALF_SQRT2
  const sumSquares = c0 * c0 + c1 * c1 + c2 * c2
  const largest = Math.sqrt(Math.max(1.0 - sumSquares, 0.0))
  const out = [0, 0, 0, 0]
  const [first, second, third] = SKIPPED_COMPONENT_INDICES[maxIndex]
  out[maxIndex] = largest
  out[first] = c0
  out[second] = c1
  out[third] = c2
  return out
}

export function mulQuat(a, b) {
  requireLength(a, 4, 'mulQuat')
  requireLength(b, 4, 'mulQuat')
  const [ax, ay, az, aw] = a
  const [bx, by, bz, bw] = b
  return [
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
    aw * bw - ax * bx - ay * by - az * bz,
  ]
}

export function rotVec(v, q) {
  requireLength(v, 3, 'rotVec')
  requireLength(q, 4, 'rotVec')
  const [vx, vy, vz] = v
  const [qx, qy, qz, qw] = q
  const ix = qw * vx + qy * vz - qz * vy
  const iy = qw * vy + qz * vx - qx * vz
  const iz = qw * vz + qx * vy - qy * vx
  const iw = -qx * vx - qy * vy - qz * vz
  return [
    ix * qw + iw * -qx + iy * -qz - iz * -qy,
    iy * qw + iw * -qy + iz * -qx - ix * -qz,
    iz * qw + iw * -qz + ix * -qy - iy * -qx,
  ]
}
