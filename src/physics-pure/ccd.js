export const sweepSphereOverBox = (from, to, radius, box) => {
  let enter = -Infinity
  let exit = Infinity
  let axis = -1
  let sign = 0
  for (let a = 0; a < 3; a++) {
    const lo = box.min[a] - radius
    const hi = box.max[a] + radius
    const d = to[a] - from[a]
    if (d === 0) {
      if (from[a] < lo || from[a] > hi) return null
      continue
    }
    const tLo = (lo - from[a]) / d
    const tHi = (hi - from[a]) / d
    const tNear = d > 0 ? tLo : tHi
    const tFar = d > 0 ? tHi : tLo
    if (tNear > enter) {
      enter = tNear
      axis = a
      sign = d > 0 ? -1 : 1
    }
    if (tFar < exit) exit = tFar
    if (enter > exit) return null
  }
  if (!(enter >= 0 && enter <= 1)) return null
  return { t: enter, axis, sign }
}

const strictlyInside = (point, box, radius) => [0, 1, 2].every((a) => point[a] > box.min[a] - radius && point[a] < box.max[a] + radius)

const escapeFace = (point, box, radius, velocity) => {
  let best = null
  for (let a = 0; a < 3; a++) {
    for (const [target, sign] of [[box.min[a] - radius, -1], [box.max[a] + radius, 1]]) {
      const depth = Math.abs(point[a] - target)
      if (best === null || depth < best.depth) best = { depth, axis: a, target, sign }
    }
  }
  const position = [point[0], point[1], point[2]]
  position[best.axis] = best.target
  const normal = [0, 0, 0]
  normal[best.axis] = best.sign
  const into = velocity[0] * normal[0] + velocity[1] * normal[1] + velocity[2] * normal[2]
  const next = [0, 1, 2].map((a) => (into < 0 ? velocity[a] - into * normal[a] : velocity[a]))
  return { t: 0, position, velocity: next }
}

export const stopAtBox = (from, to, radius, box, velocity) => {
  if (strictlyInside(from, box, radius)) return escapeFace(from, box, radius, velocity)
  const hit = sweepSphereOverBox(from, to, radius, box)
  if (hit === null) return null
  const position = [0, 1, 2].map((a) => from[a] + hit.t * (to[a] - from[a]))
  const normal = [0, 0, 0]
  normal[hit.axis] = hit.sign
  const into = velocity[0] * normal[0] + velocity[1] * normal[1] + velocity[2] * normal[2]
  const next = [0, 1, 2].map((a) => (into < 0 ? velocity[a] - into * normal[a] : velocity[a]))
  return { t: hit.t, position, velocity: next }
}

export const sweepSphereOverSphere = (fromA, toA, fromB, toB, reach) => {
  const px = fromB[0] - fromA[0]
  const py = fromB[1] - fromA[1]
  const pz = fromB[2] - fromA[2]
  const dx = toB[0] - toA[0] - px
  const dy = toB[1] - toA[1] - py
  const dz = toB[2] - toA[2] - pz
  const c = px * px + py * py + pz * pz - reach * reach
  if (c <= 0) return null
  const a = dx * dx + dy * dy + dz * dz
  const b = px * dx + py * dy + pz * dz
  if (a === 0 || b >= 0) return null
  const disc = b * b - a * c
  if (disc < 0) return null
  const t = (-b - Math.sqrt(disc)) / a
  if (!(t >= 0 && t <= 1)) return null
  return { t, nx: (px + t * dx) / reach, ny: (py + t * dy) / reach, nz: (pz + t * dz) / reach }
}

export const createBodySweep = (count, radius) => {
  if (!Number.isInteger(count) || count < 0) throw new RangeError('count must be a non-negative integer')
  if (!(typeof radius === 'number' && radius > 0)) throw new RangeError('radius must be a positive number')
  const reach = 2 * radius
  const bestT = new Float64Array(count)
  const partner = new Int32Array(count)
  const done = new Uint8Array(count)
  const a0 = [0, 0, 0]
  const a1 = [0, 0, 0]
  const b0 = [0, 0, 0]
  const b1 = [0, 0, 0]
  let stops = 0

  const load = (out, buffer, i) => {
    const o = i * 3
    out[0] = buffer[o]
    out[1] = buffer[o + 1]
    out[2] = buffer[o + 2]
  }

  const resolve = (from, to, vel) => {
    let applied = 0
    done.fill(0)
    for (let round = 0; round < count; round++) {
      bestT.fill(Infinity)
      partner.fill(-1)
      for (let i = 0; i < count; i++) {
        if (done[i]) continue
        load(a0, from, i)
        load(a1, to, i)
        for (let j = i + 1; j < count; j++) {
          if (done[j]) continue
          load(b0, from, j)
          load(b1, to, j)
          const hit = sweepSphereOverSphere(a0, a1, b0, b1, reach)
          if (hit === null) continue
          if (hit.t < bestT[i]) {
            bestT[i] = hit.t
            partner[i] = j
          }
          if (hit.t < bestT[j]) {
            bestT[j] = hit.t
            partner[j] = i
          }
        }
      }
      let any = false
      for (let i = 0; i < count; i++) {
        const j = partner[i]
        if (j <= i || partner[j] !== i) continue
        load(a0, from, i)
        load(a1, to, i)
        load(b0, from, j)
        load(b1, to, j)
        const hit = sweepSphereOverSphere(a0, a1, b0, b1, reach)
        if (hit === null) continue
        const oi = i * 3
        const oj = j * 3
        for (let k = 0; k < 3; k++) {
          to[oi + k] = a0[k] + hit.t * (a1[k] - a0[k])
          to[oj + k] = b0[k] + hit.t * (b1[k] - b0[k])
        }
        const vn = (vel[oj] - vel[oi]) * hit.nx + (vel[oj + 1] - vel[oi + 1]) * hit.ny + (vel[oj + 2] - vel[oi + 2]) * hit.nz
        if (vn < 0) {
          const half = vn / 2
          vel[oi] += half * hit.nx
          vel[oi + 1] += half * hit.ny
          vel[oi + 2] += half * hit.nz
          vel[oj] -= half * hit.nx
          vel[oj + 1] -= half * hit.ny
          vel[oj + 2] -= half * hit.nz
        }
        done[i] = 1
        done[j] = 1
        applied += 1
        any = true
      }
      if (!any) break
    }
    stops += applied
    return applied
  }

  return {
    resolve,
    stopped: (i) => done[i] === 1,
    get stops() {
      return stops
    },
  }
}
