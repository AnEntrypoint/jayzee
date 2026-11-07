export const TEXTURE_UNITS = Object.freeze({
  upscale: 0,
  shadow: 1,
  transmittanceLUT: 2,
  hpf: 3,
  sceneDepth: 4,
  hpf2: 5,
  surfAlb: 6,
  surfNrm: 7,
  heightPool: 8,
  sceneTex: 9,
  scatteringLUT: 10,
  sculptOverride: 11,
})

const RIGHT_FALLBACK_UP = [0, 0, 1]
const MIN_BASIS_LENGTH = 1e-4

function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

function lengthOf(v) {
  return Math.hypot(v[0], v[1], v[2])
}

function rightAxis(up, forward) {
  let right = cross(up, forward)
  if (lengthOf(right) < MIN_BASIS_LENGTH) {
    right = cross(RIGHT_FALLBACK_UP, forward)
    if (lengthOf(right) < MIN_BASIS_LENGTH) {
      right = [forward[1], -forward[0], 0]
      if (lengthOf(right) === 0) right = cross([1, 0, 0], forward)
    }
  }
  return right
}

export const Mat4 = {
  mul(a, b, out) {
    const product = out || new Float32Array(16)
    for (let c = 0; c < 4; c++) {
      for (let r = 0; r < 4; r++) {
        let sum = 0
        for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
        product[c * 4 + r] = sum
      }
    }
    return product
  },

  perspective(fovy, aspect, near, far, out) {
    const focal = 1 / Math.tan(fovy / 2)
    const rangeInverse = 1 / (near - far)
    const values = [
      focal / aspect, 0, 0, 0,
      0, focal, 0, 0,
      0, 0, (far + near) * rangeInverse, -1,
      0, 0, 2 * far * near * rangeInverse, 0,
    ]
    if (!out) return new Float32Array(values)
    out.set(values)
    return out
  },

  translate(t, out) {
    const values = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, t[0], t[1], t[2], 1]
    if (!out) return new Float32Array(values)
    out.set(values)
    return out
  },

  lookAt(eye, center, up, out) {
    const forwardRaw = [eye[0] - center[0], eye[1] - center[1], eye[2] - center[2]]
    const forwardLength = lengthOf(forwardRaw)
    const forward = forwardRaw.map((c) => c / forwardLength)
    const rightRaw = rightAxis(up, forward)
    const rightLength = lengthOf(rightRaw) || 1
    const right = rightRaw.map((c) => c / rightLength)
    const trueUp = cross(forward, right)
    const view = out || new Float32Array(16)
    view[0] = right[0]; view[1] = trueUp[0]; view[2] = forward[0]; view[3] = 0
    view[4] = right[1]; view[5] = trueUp[1]; view[6] = forward[1]; view[7] = 0
    view[8] = right[2]; view[9] = trueUp[2]; view[10] = forward[2]; view[11] = 0
    view[12] = -(right[0] * eye[0] + right[1] * eye[1] + right[2] * eye[2])
    view[13] = -(trueUp[0] * eye[0] + trueUp[1] * eye[1] + trueUp[2] * eye[2])
    view[14] = -(forward[0] * eye[0] + forward[1] * eye[1] + forward[2] * eye[2])
    view[15] = 1
    return view
  },
}
