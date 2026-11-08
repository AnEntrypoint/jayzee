export const FACE_FRAME = [
  { c: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0] },
  { c: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0] },
  { c: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1] },
  { c: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  { c: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
  { c: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0] },
]

export function hash3(a, b, c) {
  let h = (a | 0) * 374761393 + (b | 0) * 668265263 + (c | 0) * 2246822519
  h = (h ^ (h >>> 13)) >>> 0
  h = (h * 1274126177) >>> 0
  h = (h ^ (h >>> 16)) >>> 0
  return h / 4294967296
}

const quintic = (t) => t * t * t * (t * (t * 6 - 15) + 10)

export function vnoise(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y)
  const u = quintic(x - xi), v = quintic(y - yi)
  const h00 = hash3(xi, yi, seed)
  const h10 = hash3(xi + 1, yi, seed)
  const h01 = hash3(xi, yi + 1, seed)
  const h11 = hash3(xi + 1, yi + 1, seed)
  const a = h00 + u * (h10 - h00)
  const b = h01 + u * (h11 - h01)
  return (a + v * (b - a)) * 2.0 - 1.0
}

const OCTAVE_SEED_STEP = 1013

const ridge = (n) => {
  const r = 1.0 - Math.abs(n)
  return r * r
}

const finishFractal = (sum, norm, ridged) => {
  const r = sum / Math.max(norm, 1e-6)
  return ridged ? r * 2.0 - 1.0 : r
}

export function fractal(x, y, seed, oct, lacunarity, gain, ridged) {
  let amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0
  for (let o = 0; o < oct; o++) {
    const raw = vnoise(x * freq, y * freq, seed + o * OCTAVE_SEED_STEP)
    sum += (ridged ? ridge(raw) : raw) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return finishFractal(sum, norm, ridged)
}

const latticeHash = (a, b, c, seed) => hash3(a, b, (c * 2654435761 ^ seed) | 0)

export function vnoise3(x, y, z, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z)
  const u = quintic(x - xi), v = quintic(y - yi), w = quintic(z - zi)
  const c000 = latticeHash(xi, yi, zi, seed), c100 = latticeHash(xi + 1, yi, zi, seed)
  const c010 = latticeHash(xi, yi + 1, zi, seed), c110 = latticeHash(xi + 1, yi + 1, zi, seed)
  const c001 = latticeHash(xi, yi, zi + 1, seed), c101 = latticeHash(xi + 1, yi, zi + 1, seed)
  const c011 = latticeHash(xi, yi + 1, zi + 1, seed), c111 = latticeHash(xi + 1, yi + 1, zi + 1, seed)
  const x00 = c000 + u * (c100 - c000), x10 = c010 + u * (c110 - c010)
  const x01 = c001 + u * (c101 - c001), x11 = c011 + u * (c111 - c011)
  const y0 = x00 + v * (x10 - x00), y1 = x01 + v * (x11 - x01)
  return (y0 + w * (y1 - y0)) * 2.0 - 1.0
}

export function fractal3(x, y, z, seed, oct, lacunarity, gain, ridged) {
  let amp = 1.0, freq = 1.0, sum = 0.0, norm = 0.0
  for (let o = 0; o < oct; o++) {
    const raw = vnoise3(x * freq, y * freq, z * freq, seed + o * OCTAVE_SEED_STEP)
    sum += (ridged ? ridge(raw) : raw) * amp
    norm += amp
    amp *= gain
    freq *= lacunarity
  }
  return finishFractal(sum, norm, ridged)
}

const RAD_TO_DEG = 57.29577951
const RIDGED_MASK_SKEW_OFFSET = 0.13
const WARP_STRENGTH = 0.6

const warpedRidged = (seedOffset) => (x, y, s) => {
  const wx = x + WARP_STRENGTH * fractal(x, y, s + 7, 2, 2.0, 0.5, false)
  const wy = y + WARP_STRENGTH * fractal(x, y, s + 9, 2, 2.0, 0.5, false)
  return fractal(wx, wy, s + seedOffset, 4, 2.0, 0.55, true)
}

const warpedRidged3 = (seedOffset) => (x, y, z, s) => {
  const wx = x + WARP_STRENGTH * fractal3(x, y, z, s + 7, 2, 2.0, 0.5, false)
  const wy = y + WARP_STRENGTH * fractal3(x, y, z, s + 9, 2, 2.0, 0.5, false)
  const wz = z + WARP_STRENGTH * fractal3(x, y, z, s + 13, 2, 2.0, 0.5, false)
  return fractal3(wx, wy, wz, s + seedOffset, 4, 2.0, 0.55, true)
}

const clamp01 = (x) => Math.max(0, Math.min(1, x))

const gaussian = (x, centre, width) => Math.exp(-((x - centre) * (x - centre)) / (2 * width * width))

function regionalParams(f, lat = 0, fx = 0, fy = 0) {
  const belt = fractal(f * 3.0, f * 3.0, 31, 3, 2.0, 0.5, true)
  const latBase = Math.pow(Math.max(0, Math.cos(lat)), 1.1)
  const tNoise = fractal(fx * 2.2 + 11.0, fy * 2.2 - 7.0, 9211, 4, 2.0, 0.55, false)
  const hNoise = fractal(fx * 2.2 - 5.0, fy * 2.2 + 13.0, 9307, 4, 2.0, 0.55, false)
  const inland = clamp01(f * 0.5 + 0.5)
  const temp = clamp01(Math.pow(latBase, 1.4) * 1.05 + 0.28 * tNoise - 0.10 * inland - 0.04)
  const latDeg = Math.abs(lat) * RAD_TO_DEG
  const equatorialWetBulge = 0.20 * Math.exp(-(latDeg * latDeg) / (2 * 11 * 11))
  const subtropicalDryTrough = 0.24 * gaussian(latDeg, 25, 8)
  const temperateHumidRecovery = 0.12 * gaussian(latDeg, 52, 14)
  const latHumid = equatorialWetBulge - subtropicalDryTrough + temperateHumidRecovery
  const rainShadow = 0.22 * Math.max(0, belt)
  const humidity = clamp01(0.62 + 0.52 * hNoise - 0.40 * inland + latHumid - rainShadow)
  return {
    seaBias: f * 1600.0,
    elevAmp: 1.0 + 0.8 * Math.max(0, belt),
    temp,
    humidity,
    erosion: 0.3 + 0.4 * Math.max(0, belt),
    roughness: 0.0,
  }
}

export const BANDS = [
  {
    name: 'continental', level: 3,
    fractal: warpedRidged(0),
    fractal3: warpedRidged3(0),
    params: (f) => ({
      seaBias: (f - RIDGED_MASK_SKEW_OFFSET) * 2600.0,
      elevAmp: 1.0 + 0.25 * f,
      temp: 0.0, humidity: 0.0, erosion: 0.0, roughness: 0.0,
    }),
  },
  {
    name: 'subcontinental', level: 5,
    fractal: warpedRidged(65),
    fractal3: warpedRidged3(65),
    params: (f) => ({
      seaBias: f * 900.0,
      elevAmp: 1.0,
      temp: 0.0, humidity: 0.0, erosion: 0.0, roughness: 0.0,
    }),
  },
  {
    name: 'regional', level: 6,
    fractal: (x, y, s) => fractal(x, y, s, 5, 2.0, 0.5, false),
    fractal3: (x, y, z, s) => fractal3(x, y, z, s, 5, 2.0, 0.5, false),
    params: regionalParams,
  },
  {
    name: 'subregional', level: 7,
    fractal: warpedRidged(91),
    fractal3: warpedRidged3(91),
    params: (f) => ({
      seaBias: f * 750.0,
      elevAmp: 1.0,
      temp: 0.0, humidity: 0.0, erosion: 0.0, roughness: 0.0,
    }),
  },
  {
    name: 'local', level: 9,
    fractal: (x, y, s) => Math.abs(fractal(x, y, s, 4, 2.2, 0.55, false)),
    fractal3: (x, y, z, s) => Math.abs(fractal3(x, y, z, s, 4, 2.2, 0.55, false)),
    params: (f) => ({
      seaBias: 0.0, elevAmp: 1.0 + 0.15 * f, temp: 0.0, humidity: 0.0,
      erosion: 0.0,
      roughness: 0.4 + 0.6 * f,
    }),
  },
]
