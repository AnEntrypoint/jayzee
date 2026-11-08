const DEEP_OCEAN_BELOW_M = -200
const BEACH_TOP_M = 8
const SNOWCAP_ABOVE_M = 2200
const ROCK_SNOW_BLEND_ABOVE_M = 1300
const UPLAND_ABOVE_M = 500
const ROCK_SNOW_BLEND_SPAN_M = 900
const UPLAND_BLEND_SPAN_M = 800
const DEEP_OCEAN = [18, 42, 92]
const SEA = [42, 92, 158]
const BEACH = [214, 199, 152]
const SNOW = [235, 238, 242]
const ROCK = [120, 118, 108]
const UPLAND = [96, 128, 74]
const DRY = [176, 164, 108]
const GRASS = [104, 150, 76]
const FOREST = [58, 108, 58]
const SUN_RAW = [-0.55, 0.62, -0.56]
const SUN_LEN = Math.hypot(SUN_RAW[0], SUN_RAW[1], SUN_RAW[2])
const SUN_X = SUN_RAW[0] / SUN_LEN
const SUN_Y = SUN_RAW[1] / SUN_LEN
const SUN_Z = SUN_RAW[2] / SUN_LEN
const RELIEF_EXAGGERATION = 3
const LIGHT_GAIN = 0.55
const STEEP_FROM = 0.25
const STEEP_TO = 1.2
const STEEP_DARKEN = 0.22
const SHADE_MIN = 0.5
const SHADE_MAX = 1.3

const clamp01 = (v) => Math.max(0, Math.min(1, v))
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]

export function biomeColor(height, temp, humidity, seaLevel) {
  const h = height - seaLevel
  if (h < DEEP_OCEAN_BELOW_M) return [...DEEP_OCEAN]
  if (h < 0) return [...SEA]
  if (h < BEACH_TOP_M) return [...BEACH]
  if (h > SNOWCAP_ABOVE_M) return [...SNOW]
  if (h > ROCK_SNOW_BLEND_ABOVE_M) return lerp3(ROCK, SNOW, clamp01((h - ROCK_SNOW_BLEND_ABOVE_M) / ROCK_SNOW_BLEND_SPAN_M))
  if (h > UPLAND_ABOVE_M) return lerp3(UPLAND, ROCK, clamp01((h - UPLAND_ABOVE_M) / UPLAND_BLEND_SPAN_M))
  const base = lerp3(DRY, GRASS, clamp01(humidity))
  return lerp3(base, FOREST, clamp01(humidity - 0.5) * 2 * clamp01((temp - 0.15) / 0.7))
}

export function reliefShade(dhdx, dhdz) {
  const gx = dhdx * RELIEF_EXAGGERATION
  const gz = dhdz * RELIEF_EXAGGERATION
  const lambert = (SUN_Y - gx * SUN_X - gz * SUN_Z) / Math.sqrt(gx * gx + 1 + gz * gz)
  const lit = 1 + LIGHT_GAIN * (lambert / SUN_Y - 1)
  const t = clamp01((Math.hypot(dhdx, dhdz) - STEEP_FROM) / (STEEP_TO - STEEP_FROM))
  const shade = lit * (1 - STEEP_DARKEN * t * t * (3 - 2 * t))
  return shade < SHADE_MIN ? SHADE_MIN : shade > SHADE_MAX ? SHADE_MAX : shade
}

export function shadeHeightGrid(heights, rows, cols, spacingM, land, rgbIn, rgbOut, inChannels, outChannels, shadeOut) {
  for (let r = 0; r < rows; r++) {
    const up = r > 0 ? r - 1 : r
    const dn = r < rows - 1 ? r + 1 : r
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c
      const ic = i * inChannels
      const oc = i * outChannels
      let m = 1
      if (land[i]) {
        const lf = c > 0 ? c - 1 : c
        const rt = c < cols - 1 ? c + 1 : c
        const dhdx = rt > lf ? (heights[r * cols + rt] - heights[r * cols + lf]) / ((rt - lf) * spacingM) : 0
        const dhdz = dn > up ? (heights[dn * cols + c] - heights[up * cols + c]) / ((dn - up) * spacingM) : 0
        m = Number.isFinite(dhdx) && Number.isFinite(dhdz) ? reliefShade(dhdx, dhdz) : 1
      }
      if (shadeOut) shadeOut[i] = m
      rgbOut[oc] = Math.min(255, rgbIn[ic] * m)
      rgbOut[oc + 1] = Math.min(255, rgbIn[ic + 1] * m)
      rgbOut[oc + 2] = Math.min(255, rgbIn[ic + 2] * m)
    }
  }
}
