export const GRASS_GUST_NOISE_SCALE = 0.06
export const GRASS_GUST_ADVECT = 0.35
export const GRASS_GUST_PHASE_GAIN = 5.5
export const GRASS_WAVE1_K = 0.075
export const GRASS_WAVE1_SPEED = 1.4
export const GRASS_WAVE2_KX = -0.11
export const GRASS_WAVE2_KZ = 0.09
export const GRASS_WAVE2_SPEED = 2.3
export const GRASS_WAVE2_GAIN = 0.5
export const GRASS_SWAY_BASE = 0.2
export const GRASS_SWAY_FLOW = 0.25
export const GRASS_FLUTTER_X = 0.25
export const GRASS_FLUTTER_Z = 0.25
export const GRASS_FLUTTER_SPEED = 2.2
export const GRASS_FLUTTER_K = 0.22
export const GRASS_FLUTTER_Z_RATE = 0.7

function hash2i(ix, iz) {
  let h = Math.imul(ix | 0, 0x1f1f1f1f) ^ Math.imul(iz | 0, 0x85ebca6b)
  h = Math.imul(h ^ (h >>> 15), 0x2545f491)
  h ^= h >>> 13
  return (h >>> 0) / 4294967296
}

function valueNoise2(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z)
  const fx = x - ix, fz = z - iz
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz)
  const a = hash2i(ix, iz), b = hash2i(ix + 1, iz)
  const c = hash2i(ix, iz + 1), d = hash2i(ix + 1, iz + 1)
  const lo = a + (b - a) * ux
  const hi = c + (d - c) * ux
  return lo + (hi - lo) * uz
}

export function grassWindGust(out, x, z, t, dirX, dirZ, m = Math) {
  const gx = x * GRASS_GUST_NOISE_SCALE + dirX * t * GRASS_GUST_ADVECT
  const gz = z * GRASS_GUST_NOISE_SCALE + dirZ * t * GRASS_GUST_ADVECT
  const gust = valueNoise2(gx, gz)
  const along = x * dirX + z * dirZ
  const wave = m.sin(along * GRASS_WAVE1_K + gust * GRASS_GUST_PHASE_GAIN + t * GRASS_WAVE1_SPEED)
  const cross = m.sin(x * GRASS_WAVE2_KX + z * GRASS_WAVE2_KZ + t * GRASS_WAVE2_SPEED)
  const a = along * GRASS_FLUTTER_K + t * GRASS_FLUTTER_SPEED
  out[0] = wave + cross * GRASS_WAVE2_GAIN
  out[1] = m.sin(a)
  out[2] = m.cos(a * GRASS_FLUTTER_Z_RATE)
  return out
}
