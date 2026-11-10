import { PLANET_RADIUS_M, frameOnSurface, normalise, wrapAngle } from './sphere.js'

export const CAP_AREA_KM2_PER_UNIT = 1e-6

export const mulberry32 = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const capAreaKm2 = (capRad, radiusM = PLANET_RADIUS_M) => 2 * Math.PI * radiusM * radiusM * (1 - Math.cos(capRad)) * CAP_AREA_KM2_PER_UNIT

export const placePopulation = ({ seed, densityPerKm2, centreLatRad = 0, centreLonRad = 0, capRad, radiusM = PLANET_RADIUS_M, heightAt = () => 0 }) => {
  if (!Number.isInteger(seed)) throw new TypeError('seed must be an integer')
  if (!(densityPerKm2 >= 0) || !Number.isFinite(densityPerKm2)) throw new RangeError('densityPerKm2 must be a finite number at or above zero')
  if (!(capRad > 0 && capRad < Math.PI)) throw new RangeError('capRad must be in (0, pi)')
  const count = Math.round(densityPerKm2 * capAreaKm2(capRad, radiusM))
  const random = mulberry32(seed)
  const centre = [Math.cos(centreLatRad) * Math.sin(centreLonRad), Math.sin(centreLatRad), Math.cos(centreLatRad) * Math.cos(centreLonRad)]
  const positions = new Float64Array(count * 3)
  const normals = new Float64Array(count * 3)
  const yaws = new Float64Array(count)
  const minCos = Math.cos(capRad)
  const axis = orthonormalAround(centre)
  for (let i = 0; i < count; i++) {
    const cosTheta = 1 - random() * (1 - minCos)
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta))
    const phi = random() * 2 * Math.PI
    const dir = [
      cosTheta * centre[0] + sinTheta * (Math.cos(phi) * axis.a[0] + Math.sin(phi) * axis.b[0]),
      cosTheta * centre[1] + sinTheta * (Math.cos(phi) * axis.a[1] + Math.sin(phi) * axis.b[1]),
      cosTheta * centre[2] + sinTheta * (Math.cos(phi) * axis.a[2] + Math.sin(phi) * axis.b[2]),
    ]
    const n = normalise(dir)
    const h = heightAt(n)
    positions[i * 3] = (radiusM + h) * n[0]
    positions[i * 3 + 1] = (radiusM + h) * n[1]
    positions[i * 3 + 2] = (radiusM + h) * n[2]
    normals[i * 3] = n[0]
    normals[i * 3 + 1] = n[1]
    normals[i * 3 + 2] = n[2]
    yaws[i] = wrapAngle(random() * 2 * Math.PI)
  }
  return { count, positions, normals, yaws, areaKm2: capAreaKm2(capRad, radiusM), frameOf: (i) => frameOnSurface([normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]], yaws[i]) }
}

const orthonormalAround = (c) => {
  const reference = Math.abs(c[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
  const a = normalise([reference[1] * c[2] - reference[2] * c[1], reference[2] * c[0] - reference[0] * c[2], reference[0] * c[1] - reference[1] * c[0]])
  const b = [c[1] * a[2] - c[2] * a[1], c[2] * a[0] - c[0] * a[2], c[0] * a[1] - c[1] * a[0]]
  return { a, b }
}
