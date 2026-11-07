const NOISE_DEFAULTS = Object.freeze({ frequency: 1, amplitude: 1, seed: 0, delta: 0.0001, metric: 'euclidean' })

const F2 = 0.5 * (Math.sqrt(3) - 1)
const G2 = (3 - Math.sqrt(3)) / 6
const F3 = 1 / 3
const G3 = 1 / 6
const GRAD2 = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]]
const GRAD3 = [[1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0], [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1], [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1], [1, 1, 0], [-1, 1, 0], [0, -1, 1], [0, 1, -1]]
const TWO_32 = 4294967296

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const fnv1a = (text) => {
  let h = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const seedWord = (seed) => {
  if (typeof seed === 'string') return fnv1a(seed)
  if (typeof seed === 'number' && Number.isInteger(seed)) return seed >>> 0
  throw new TypeError('seed takes an integer or a string')
}

export const makeSeededRng = (seed) => {
  let state = seedWord(seed)
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return (t ^ (t >>> 14)) >>> 0
  }
  return {
    next,
    double: () => next() / TWO_32,
    int32: () => next() | 0,
    uint32: next,
    range(min, max) {
      if (!isFiniteNumber(min) || !isFiniteNumber(max) || min > max) throw new RangeError('range takes finite min <= max')
      return min + (next() / TWO_32) * (max - min)
    },
  }
}

const buildPerm = (seed) => {
  const rng = makeSeededRng(seed)
  const base = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = rng.uint32() % (i + 1)
    const swap = base[i]
    base[i] = base[j]
    base[j] = swap
  }
  return base.concat(base)
}

const permCache = new Map()

const permFor = (seed) => {
  const key = seedWord(seed)
  let perm = permCache.get(key)
  if (!perm) {
    if (permCache.size >= 32) permCache.delete(permCache.keys().next().value)
    perm = buildPerm(key)
    permCache.set(key, perm)
  }
  return perm
}

const hashU32 = (i, k, seed, salt) => {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(k, 0x165667b1) ^ Math.imul(seed, 0x9e3779b1) ^ Math.imul(salt, 0x85ebca77)
  h ^= h >>> 15
  h = Math.imul(h, 0x2c1b3c6d)
  h ^= h >>> 12
  h = Math.imul(h, 0x297a2d39)
  h ^= h >>> 15
  return h >>> 0
}

const dot2 = (g, x, y) => g[0] * x + g[1] * y
const dot3 = (g, x, y, z) => g[0] * x + g[1] * y + g[2] * z

const simplex2At = (perm, x, y) => {
  const s = (x + y) * F2
  const i = Math.floor(x + s)
  const j = Math.floor(y + s)
  const t = (i + j) * G2
  const x0 = x - (i - t)
  const y0 = y - (j - t)
  const i1 = x0 > y0 ? 1 : 0
  const j1 = 1 - i1
  const x1 = x0 - i1 + G2
  const y1 = y0 - j1 + G2
  const x2 = x0 - 1 + 2 * G2
  const y2 = y0 - 1 + 2 * G2
  const ii = i & 255
  const jj = j & 255
  const g0 = GRAD2[perm[ii + perm[jj]] & 7]
  const g1 = GRAD2[perm[ii + i1 + perm[jj + j1]] & 7]
  const g2 = GRAD2[perm[ii + 1 + perm[jj + 1]] & 7]
  const corner = (dx, dy, g) => {
    const w = 0.5 - dx * dx - dy * dy
    if (w < 0) return 0
    const w2 = w * w
    return w2 * w2 * dot2(g, dx, dy)
  }
  return 70 * (corner(x0, y0, g0) + corner(x1, y1, g1) + corner(x2, y2, g2))
}

const simplex3At = (perm, x, y, z) => {
  const s = (x + y + z) * F3
  const i = Math.floor(x + s)
  const j = Math.floor(y + s)
  const k = Math.floor(z + s)
  const t = (i + j + k) * G3
  const x0 = x - (i - t)
  const y0 = y - (j - t)
  const z0 = z - (k - t)
  let i1, j1, k1, i2, j2, k2
  if (x0 >= y0) {
    if (y0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 1; k2 = 0
    } else if (x0 >= z0) {
      i1 = 1; j1 = 0; k1 = 0; i2 = 1; j2 = 0; k2 = 1
    } else {
      i1 = 0; j1 = 0; k1 = 1; i2 = 1; j2 = 0; k2 = 1
    }
  } else if (y0 < z0) {
    i1 = 0; j1 = 0; k1 = 1; i2 = 0; j2 = 1; k2 = 1
  } else if (x0 < z0) {
    i1 = 0; j1 = 1; k1 = 0; i2 = 0; j2 = 1; k2 = 1
  } else {
    i1 = 0; j1 = 1; k1 = 0; i2 = 1; j2 = 1; k2 = 0
  }
  const x1 = x0 - i1 + G3
  const y1 = y0 - j1 + G3
  const z1 = z0 - k1 + G3
  const x2 = x0 - i2 + 2 * G3
  const y2 = y0 - j2 + 2 * G3
  const z2 = z0 - k2 + 2 * G3
  const x3 = x0 - 1 + 3 * G3
  const y3 = y0 - 1 + 3 * G3
  const z3 = z0 - 1 + 3 * G3
  const ii = i & 255
  const jj = j & 255
  const kk = k & 255
  const g0 = GRAD3[perm[ii + perm[jj + perm[kk]]] & 15]
  const g1 = GRAD3[perm[ii + i1 + perm[jj + j1 + perm[kk + k1]]] & 15]
  const g2 = GRAD3[perm[ii + i2 + perm[jj + j2 + perm[kk + k2]]] & 15]
  const g3 = GRAD3[perm[ii + 1 + perm[jj + 1 + perm[kk + 1]]] & 15]
  const corner = (dx, dy, dz, g) => {
    const w = 0.6 - dx * dx - dy * dy - dz * dz
    if (w < 0) return 0
    const w2 = w * w
    return w2 * w2 * dot3(g, dx, dy, dz)
  }
  return 32 * (corner(x0, y0, z0, g0) + corner(x1, y1, z1, g1) + corner(x2, y2, z2, g2) + corner(x3, y3, z3, g3))
}

const fbm2At = (perm, x, z, o) => {
  let sum = 0
  let amp = 1
  let freq = o.frequency
  for (let k = 0; k < o.octaves; k++) {
    sum += amp * simplex2At(perm, x * freq, z * freq)
    amp *= o.gain
    freq *= o.lacunarity
  }
  return sum
}

const ridged2At = (perm, x, z, o) => {
  let sum = 0
  let amp = 1
  let freq = o.frequency
  let weight = 1
  for (let k = 0; k < o.octaves; k++) {
    const s = 1 - Math.abs(simplex2At(perm, x * freq, z * freq))
    const signal = s * s
    sum += signal * weight * amp
    weight = Math.min(1, Math.max(0, signal * o.ridgeGain))
    amp *= o.gain
    freq *= o.lacunarity
  }
  return sum
}

const billowed2At = (perm, x, z, o) => {
  let sum = 0
  let amp = 1
  let freq = o.frequency
  for (let k = 0; k < o.octaves; k++) {
    sum += amp * (2 * Math.abs(simplex2At(perm, x * freq, z * freq)) - 1)
    amp *= o.gain
    freq *= o.lacunarity
  }
  return sum
}

const pickOptions = (name, opts, allowed, required) => {
  for (const key of Object.keys(opts)) {
    if (!allowed.includes(key)) throw new RangeError(name + ' option ' + key + ' is not an upstream option for it')
  }
  for (const key of required) {
    if (opts[key] === undefined) throw new RangeError(name + ' needs ' + key + '; upstream states no default for it, so it is required here')
  }
  const out = { ...NOISE_DEFAULTS }
  for (const key of allowed) {
    if (opts[key] === undefined) continue
    if (key === 'seed') {
      seedWord(opts.seed)
      out.seed = opts.seed
    } else if (key === 'metric') {
      if (opts.metric !== 'euclidean') throw new RangeError(name + ' metric ' + opts.metric + ' is refused: only euclidean is implemented')
      out.metric = opts.metric
    } else {
      if (!isFiniteNumber(opts[key])) throw new TypeError(name + ' ' + key + ' takes a finite number')
      out[key] = opts[key]
    }
  }
  for (const key of ['x', 'z', 'y']) {
    if (allowed.includes(key) && opts[key] !== undefined && !isFiniteNumber(opts[key])) throw new TypeError(name + ' ' + key + ' takes a finite number')
  }
  return out
}

const checkOctaves = (name, o) => {
  if (!Number.isInteger(o.octaves) || o.octaves < 1 || o.octaves > 16) throw new RangeError(name + ' octaves is a whole number from 1 to 16')
}

const BASE = ['frequency', 'amplitude', 'seed']
const FRACTAL = ['octaves', 'gain', 'lacunarity']

export const simplex2 = (opts) => {
  const o = pickOptions('simplex2', opts, ['x', 'z', ...BASE], ['x', 'z'])
  return o.amplitude * simplex2At(permFor(o.seed), opts.x * o.frequency, opts.z * o.frequency)
}

export const simplex3 = (opts) => {
  const o = pickOptions('simplex3', opts, ['x', 'y', 'z', ...BASE], ['x', 'y', 'z'])
  return o.amplitude * simplex3At(permFor(o.seed), opts.x * o.frequency, opts.y * o.frequency, opts.z * o.frequency)
}

export const fbm2 = (opts) => {
  const o = pickOptions('fbm2', opts, ['x', 'z', ...BASE, ...FRACTAL], ['x', 'z', ...FRACTAL])
  checkOctaves('fbm2', o)
  return o.amplitude * fbm2At(permFor(o.seed), opts.x, opts.z, o)
}

export const ridged = (opts) => {
  const o = pickOptions('ridged', opts, ['x', 'z', ...BASE, ...FRACTAL, 'ridgeGain'], ['x', 'z', ...FRACTAL, 'ridgeGain'])
  checkOctaves('ridged', o)
  return o.amplitude * ridged2At(permFor(o.seed), opts.x, opts.z, o)
}

export const billowed2 = (opts) => {
  const o = pickOptions('billowed2', opts, ['x', 'z', ...BASE, ...FRACTAL], ['x', 'z', ...FRACTAL])
  checkOctaves('billowed2', o)
  return o.amplitude * billowed2At(permFor(o.seed), opts.x, opts.z, o)
}

export const gradient2 = (opts) => {
  const o = pickOptions('gradient2', opts, ['x', 'z', 'frequency', 'seed', 'delta'], ['x', 'z'])
  if (!(o.delta > 0)) throw new RangeError('gradient2 delta is a positive step')
  const perm = permFor(o.seed)
  const field = (x, z) => simplex2At(perm, x * o.frequency, z * o.frequency)
  const gx = (field(opts.x + o.delta, opts.z) - field(opts.x - o.delta, opts.z)) / (2 * o.delta)
  const gz = (field(opts.x, opts.z + o.delta) - field(opts.x, opts.z - o.delta)) / (2 * o.delta)
  return { x: gx, z: gz, magnitude: Math.hypot(gx, gz) }
}

export const domainWarp2 = (opts) => {
  const o = pickOptions('domainWarp2', opts, ['x', 'z', 'warpAmp', 'warpFrequency', ...BASE, ...FRACTAL], ['x', 'z', 'warpAmp', 'warpFrequency', ...FRACTAL])
  checkOctaves('domainWarp2', o)
  const perm = permFor(o.seed)
  const qx = simplex2At(perm, opts.x * o.warpFrequency, opts.z * o.warpFrequency)
  const qz = simplex2At(perm, (opts.x + 5.2) * o.warpFrequency, (opts.z + 1.3) * o.warpFrequency)
  return o.amplitude * fbm2At(perm, opts.x + o.warpAmp * qx, opts.z + o.warpAmp * qz, o)
}

export const voronoi2 = (opts) => {
  const o = pickOptions('voronoi2', opts, ['x', 'z', 'frequency', 'seed', 'metric'], ['x', 'z'])
  const seed = seedWord(o.seed)
  const px = opts.x * o.frequency
  const pz = opts.z * o.frequency
  const cx = Math.floor(px)
  const cz = Math.floor(pz)
  let f1 = Infinity
  let f2 = Infinity
  let nearest = 0
  for (let dx = -1; dx <= 1; dx++) {
    for (let dz = -1; dz <= 1; dz++) {
      const ix = cx + dx
      const iz = cz + dz
      const fx = ix + hashU32(ix, iz, seed, 0) / TWO_32
      const fz = iz + hashU32(ix, iz, seed, 1) / TWO_32
      const d = Math.hypot(px - fx, pz - fz)
      if (d < f1) {
        f2 = f1
        f1 = d
        nearest = hashU32(ix, iz, seed, 2)
      } else if (d < f2) {
        f2 = d
      }
    }
  }
  return { f1, f2, cell: nearest }
}

export const white2 = (opts) => {
  const o = pickOptions('white2', opts, ['x', 'z', 'seed'], ['x', 'z'])
  const seed = seedWord(o.seed)
  const ix = Math.floor(opts.x)
  const iz = Math.floor(opts.z)
  return o.amplitude * (hashU32(ix, iz, seed, 3) / TWO_32 * 2 - 1)
}

export const NOISE_NAMES = Object.freeze(['simplex2', 'simplex3', 'fbm2', 'ridged', 'billowed2', 'gradient2', 'domainWarp2', 'voronoi2', 'white2', 'makeSeededRng'])
export const NOISE_OPTION_DEFAULTS = NOISE_DEFAULTS
