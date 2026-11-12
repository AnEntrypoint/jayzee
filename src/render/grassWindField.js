import { GRASS_WAVE2_GAIN, grassWindGust } from './grassWind.js'

export const GRASS_WIND_FIELD_CELLS = 64
export const GRASS_WIND_FIELD_REACH_M = 64
export const GRASS_WIND_FIELD_CHANNELS = 3
export const GRASS_WIND_FIELD_TEXEL_BYTES = 4
export const GRASS_WIND_SWAY_RANGE = 1 + GRASS_WAVE2_GAIN

const a = [0, 0, 0]
const b = [0, 0, 0]
const c = [0, 0, 0]
const d = [0, 0, 0]

const wrap = (v, period) => {
  const r = v % period
  return r < 0 ? r + period : r
}

export function grassWindFieldValue(out, x, z, t, dirX, dirZ, reachM, m = Math) {
  const px = wrap(x, reachM)
  const pz = wrap(z, reachM)
  const u = px / reachM
  const v = pz / reachM
  grassWindGust(a, px, pz, t, dirX, dirZ, m)
  grassWindGust(b, px - reachM, pz, t, dirX, dirZ, m)
  grassWindGust(c, px, pz - reachM, t, dirX, dirZ, m)
  grassWindGust(d, px - reachM, pz - reachM, t, dirX, dirZ, m)
  const wa = (1 - u) * (1 - v)
  const wb = u * (1 - v)
  const wc = (1 - u) * v
  const wd = u * v
  out[0] = a[0] * wa + b[0] * wb + c[0] * wc + d[0] * wd
  out[1] = a[1] * wa + b[1] * wb + c[1] * wc + d[1] * wd
  out[2] = a[2] * wa + b[2] * wb + c[2] * wc + d[2] * wd
  return out
}

const toByte = (value, range) => {
  const n = Math.round((value / range) * 127.5 + 127.5)
  return n < 0 ? 0 : n > 255 ? 255 : n
}

export function createGrassWindField({ cells = GRASS_WIND_FIELD_CELLS, reachM = GRASS_WIND_FIELD_REACH_M, dirX = 1, dirZ = 0, math = Math } = {}) {
  if (!Number.isInteger(cells) || cells < 2 || (cells & (cells - 1)) !== 0) throw new RangeError('grass wind field cells must be a power of two of at least 2; got ' + String(cells))
  if (typeof reachM !== 'number' || !Number.isFinite(reachM) || reachM <= 0) throw new RangeError('grass wind field reach must be a positive finite number of metres; got ' + String(reachM))
  if (!Number.isFinite(dirX) || !Number.isFinite(dirZ) || Math.hypot(dirX, dirZ) === 0) throw new RangeError('grass wind field direction must be a finite non-zero [x, z]')
  const length = Math.hypot(dirX, dirZ)
  let windX = dirX / length
  let windZ = dirZ / length
  const cellM = reachM / cells
  const data = new Float32Array(cells * cells * GRASS_WIND_FIELD_CHANNELS)
  const texels = new Uint8Array(cells * cells * GRASS_WIND_FIELD_TEXEL_BYTES)
  const scratch = [0, 0, 0]
  let version = 0
  let time = 0

  const update = (t) => {
    if (typeof t !== 'number' || !Number.isFinite(t)) throw new RangeError('grass wind field time must be a finite number of seconds')
    for (let iz = 0; iz < cells; iz++) {
      for (let ix = 0; ix < cells; ix++) {
        grassWindFieldValue(scratch, (ix + 0.5) * cellM, (iz + 0.5) * cellM, t, windX, windZ, reachM, math)
        const cell = iz * cells + ix
        const o = cell * GRASS_WIND_FIELD_CHANNELS
        data[o] = scratch[0]
        data[o + 1] = scratch[1]
        data[o + 2] = scratch[2]
        const p = cell * GRASS_WIND_FIELD_TEXEL_BYTES
        texels[p] = toByte(scratch[0], GRASS_WIND_SWAY_RANGE)
        texels[p + 1] = toByte(scratch[1], 1)
        texels[p + 2] = toByte(scratch[2], 1)
        texels[p + 3] = 255
      }
    }
    time = t
    version += 1
    return version
  }

  const sample = (out, x, z) => {
    const fx = wrap(x, reachM) / cellM - 0.5
    const fz = wrap(z, reachM) / cellM - 0.5
    const x0 = Math.floor(fx)
    const z0 = Math.floor(fz)
    const tx = fx - x0
    const tz = fz - z0
    const ix0 = x0 & (cells - 1)
    const ix1 = (x0 + 1) & (cells - 1)
    const iz0 = z0 & (cells - 1)
    const iz1 = (z0 + 1) & (cells - 1)
    for (let k = 0; k < GRASS_WIND_FIELD_CHANNELS; k++) {
      const v00 = data[(iz0 * cells + ix0) * GRASS_WIND_FIELD_CHANNELS + k]
      const v10 = data[(iz0 * cells + ix1) * GRASS_WIND_FIELD_CHANNELS + k]
      const v01 = data[(iz1 * cells + ix0) * GRASS_WIND_FIELD_CHANNELS + k]
      const v11 = data[(iz1 * cells + ix1) * GRASS_WIND_FIELD_CHANNELS + k]
      const lo = v00 + (v10 - v00) * tx
      const hi = v01 + (v11 - v01) * tx
      out[k] = lo + (hi - lo) * tz
    }
    return out
  }

  const setDirection = (x, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(z) || Math.hypot(x, z) === 0) throw new RangeError('grass wind field direction must be a finite non-zero [x, z]')
    const l = Math.hypot(x, z)
    windX = x / l
    windZ = z / l
  }

  return {
    cells,
    reachM,
    cellM,
    data,
    texels,
    update,
    sample,
    setDirection,
    get version() { return version },
    get time() { return time },
    get dirX() { return windX },
    get dirZ() { return windZ },
  }
}
