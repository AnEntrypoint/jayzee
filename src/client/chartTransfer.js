const rotationToQuat = (m) => {
  const trace = m[0] + m[4] + m[8]
  let x, y, z, w
  if (trace > 0) {
    const s = Math.sqrt(trace + 1) * 2
    w = 0.25 * s
    x = (m[7] - m[5]) / s
    y = (m[2] - m[6]) / s
    z = (m[3] - m[1]) / s
  } else if (m[0] > m[4] && m[0] > m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2
    w = (m[7] - m[5]) / s
    x = 0.25 * s
    y = (m[1] + m[3]) / s
    z = (m[2] + m[6]) / s
  } else if (m[4] > m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2
    w = (m[2] - m[6]) / s
    x = (m[1] + m[3]) / s
    y = 0.25 * s
    z = (m[5] + m[7]) / s
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2
    w = (m[3] - m[1]) / s
    x = (m[2] + m[6]) / s
    y = (m[5] + m[7]) / s
    z = 0.25 * s
  }
  const length = Math.hypot(x, y, z, w) || 1
  return [x / length, y / length, z / length, w / length]
}

const quatMultiply = (a, b) => [
  a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
  a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
  a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
  a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
]

export function createChartTransfer(from, to) {
  const fromAxes = [from.east, from.up, from.north]
  const toAxes = [to.east, to.up, to.north]
  const m = new Array(9)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      m[row * 3 + col] = toAxes[row][0] * fromAxes[col][0] + toAxes[row][1] * fromAxes[col][1] + toAxes[row][2] * fromAxes[col][2]
    }
  }
  const fromLift = from.radius + from.anchorHeight - from.offsetY
  const toLift = to.radius + to.anchorHeight - to.offsetY
  const qM = rotationToQuat(m)

  function vec(v, out = [0, 0, 0]) {
    const a = v[0], b = v[1], c = v[2]
    out[0] = m[0] * a + m[1] * b + m[2] * c
    out[1] = m[3] * a + m[4] * b + m[5] * c
    out[2] = m[6] * a + m[7] * b + m[8] * c
    return out
  }

  function point(p, out = [0, 0, 0]) {
    const a = p[0], b = p[1] + fromLift, c = p[2]
    out[0] = m[0] * a + m[1] * b + m[2] * c
    out[1] = m[3] * a + m[4] * b + m[5] * c - toLift
    out[2] = m[6] * a + m[7] * b + m[8] * c
    return out
  }

  function quat(q, out = [0, 0, 0, 1]) {
    const r = quatMultiply(qM, q)
    const length = Math.hypot(r[0], r[1], r[2], r[3]) || 1
    out[0] = r[0] / length
    out[1] = r[1] / length
    out[2] = r[2] / length
    out[3] = r[3] / length
    return out
  }

  function look(psi, pitch) {
    const cosPitch = Math.cos(pitch)
    const fx = Math.sin(psi) * cosPitch, fy = Math.sin(pitch), fz = Math.cos(psi) * cosPitch
    const y = m[3] * fx + m[4] * fy + m[5] * fz
    return {
      yaw: Math.atan2(m[0] * fx + m[1] * fy + m[2] * fz, m[6] * fx + m[7] * fy + m[8] * fz),
      pitch: Math.asin(Math.max(-1, Math.min(1, y))),
    }
  }

  return { m, qM, vec, point, quat, look, tiltRad: Math.acos(Math.max(-1, Math.min(1, m[4]))) }
}
