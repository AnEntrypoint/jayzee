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
  if (!(enter > 0 && enter <= 1)) return null
  return { t: enter, axis, sign }
}

export const stopAtBox = (from, to, radius, box, velocity) => {
  const hit = sweepSphereOverBox(from, to, radius, box)
  if (hit === null) return null
  const position = [0, 1, 2].map((a) => from[a] + hit.t * (to[a] - from[a]))
  const normal = [0, 0, 0]
  normal[hit.axis] = hit.sign
  const into = velocity[0] * normal[0] + velocity[1] * normal[1] + velocity[2] * normal[2]
  const next = [0, 1, 2].map((a) => (into < 0 ? velocity[a] - into * normal[a] : velocity[a]))
  return { t: hit.t, position, velocity: next }
}
