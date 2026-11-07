const CHANNEL_COUNT = 4
const FACE_COUNT = 6
const TAP_KEYS = ['x0', 'x1', 'y0', 'y1']

export const HPF_CHANNELS = CHANNEL_COUNT
export const HPF_FACES = FACE_COUNT

export const hpfLatticeDenom = (res) => res - 1

export const hpfQuintic = (t) => t * t * t * (t * (t * 6 - 15) + 10)

export const hpfPoolFloats = (res) => FACE_COUNT * res * res * CHANNEL_COUNT

export function assertHpfRes(res) {
  if (!Number.isInteger(res) || res < 2) throw new RangeError(`hpfLattice: res must be an integer >= 2, got ${res}`)
  return res
}

export function assertHpfPool(pool, res) {
  const expected = hpfPoolFloats(res)
  if (!pool || pool.length !== expected) throw new RangeError(`hpfLattice: pool must hold ${expected} floats for res ${res}, got ${pool ? pool.length : pool}`)
  return pool
}

export function assertHpfTap(tap, res) {
  const highest = hpfLatticeDenom(res)
  for (const key of TAP_KEYS) {
    const node = tap[key]
    if (!Number.isInteger(node) || node < 0 || node > highest) throw new RangeError(`hpfLattice: tap ${key} must be an integer in 0..${highest} for res ${res}, got ${node}`)
  }
  if (!(tap.wx >= 0 && tap.wx <= 1)) throw new RangeError(`hpfLattice: tap wx must be in 0..1, got ${tap.wx}`)
  if (!(tap.wy >= 0 && tap.wy <= 1)) throw new RangeError(`hpfLattice: tap wy must be in 0..1, got ${tap.wy}`)
  return tap
}

export function hpfLattice(res) {
  assertHpfRes(res)
  const denom = hpfLatticeDenom(res)
  return (u, v) => {
    const tx = u * denom
    const ty = v * denom
    const fx = Math.floor(tx)
    const fy = Math.floor(ty)
    const x0 = fx < 0 ? 0 : fx > denom ? denom : fx
    const y0 = fy < 0 ? 0 : fy > denom ? denom : fy
    return {
      x0,
      y0,
      x1: x0 < denom ? x0 + 1 : denom,
      y1: y0 < denom ? y0 + 1 : denom,
      wx: hpfQuintic(tx - fx),
      wy: hpfQuintic(ty - fy),
    }
  }
}

function sampleFace(buffer, base, res, tap, out) {
  const topLeft = base + (tap.y0 * res + tap.x0) * CHANNEL_COUNT
  const topRight = base + (tap.y0 * res + tap.x1) * CHANNEL_COUNT
  const bottomLeft = base + (tap.y1 * res + tap.x0) * CHANNEL_COUNT
  const bottomRight = base + (tap.y1 * res + tap.x1) * CHANNEL_COUNT
  for (let c = 0; c < CHANNEL_COUNT; c++) {
    const upper = buffer[topLeft + c] + tap.wx * (buffer[topRight + c] - buffer[topLeft + c])
    const lower = buffer[bottomLeft + c] + tap.wx * (buffer[bottomRight + c] - buffer[bottomLeft + c])
    out[c] = upper + tap.wy * (lower - upper)
  }
  return out
}

export function hpfFaceSampler(buffer, res) {
  const expected = res * res * CHANNEL_COUNT
  if (!buffer || buffer.length !== expected) throw new RangeError(`hpfFaceSampler: face buffer must hold ${expected} floats for res ${res}, got ${buffer ? buffer.length : buffer}`)
  const tap = hpfLattice(res)
  return (fu, fv, out) => sampleFace(buffer, 0, res, tap(fu, fv), out)
}

export function hpfPoolSampler(pool, res) {
  assertHpfRes(res)
  assertHpfPool(pool, res)
  const tap = hpfLattice(res)
  const faceFloats = res * res * CHANNEL_COUNT
  return (face, fu, fv, out) => {
    if (!Number.isInteger(face) || face < 0 || face >= FACE_COUNT) throw new RangeError(`hpfLattice: face must be an integer in 0..${FACE_COUNT - 1}, got ${face}`)
    return sampleFace(pool, face * faceFloats, res, assertHpfTap(tap(fu, fv), res), out)
  }
}
