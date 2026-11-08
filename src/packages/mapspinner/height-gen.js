import * as g from './glsl-rt.js'

const LTYPE_FBM = 0
const LTYPE_RIDGED = 1
export const NOISE_LAYERS = Object.freeze([
  Object.freeze({ ltype: LTYPE_RIDGED, numOct: 10, gain: 0.5, ridgeOffset: 1.064, ridgeExp: 1.005, warpStr: 1.6, hmin: 0.0, hmax: 1.0 }),
  Object.freeze({ ltype: LTYPE_FBM, numOct: 18, gain: 0.5, ridgeOffset: 1.064, ridgeExp: 1.665, warpStr: 2.6, hmin: -2.0, hmax: 2.0 }),
  Object.freeze({ ltype: LTYPE_RIDGED, numOct: 18, gain: 0.5, ridgeOffset: 1.064, ridgeExp: 1.1, warpStr: 0.9, hmin: -2.0, hmax: 2.0 }),
])
export const CONTINENTAL_BIAS_AMP = 50.0
const NO_UNROLL_BASE = 64
const OCTAVE_ROTATION_RAD = 0.5236
const FRACTAL_HEIGHT_M = 750000.0
const OCEAN_DEPTH_FLOOR_M = -350000.0
const OCEAN_DEEPEN = 1.25
const DEFAULT_BEACH_SHELF_M = 150.0
const NO_SCULPT_OFFSET_M = 0.0

export function makeHeight(U, hpfSample) {
  const octaveCount = (numOctaves) => numOctaves + (U.uNoUnroll > 0 ? U.uNoUnroll - NO_UNROLL_BASE : 0)

  function h3(p) {
    p = g.fract(g.mul(p, g.vec3(0.1031, 0.1030, 0.0973)))
    p = g.add(p, g.dot(p, g.add(g.sw(p, 'yxz'), 33.33)))
    return g.fract((g.sw(p, 'x') + g.sw(p, 'y')) * g.sw(p, 'z')) * 2.0 - 1.0
  }

  function snoise3(P) {
    const fl = g.floor(P)
    const i = g.ivec3(fl)
    const f = g.sub(P, fl)
    const u = g.mul(g.mul(g.mul(f, f), f), g.add(g.mul(f, g.sub(g.mul(f, 6.0), 15.0)), 10.0))
    const i0 = g.vec3(i)
    const i1 = g.add(g.vec3(i), g.vec3(1.0))
    const n000 = h3(i0)
    const n100 = h3(g.vec3(g.sw(i1, 'x'), g.sw(i0, 'y'), g.sw(i0, 'z')))
    const n010 = h3(g.vec3(g.sw(i0, 'x'), g.sw(i1, 'y'), g.sw(i0, 'z')))
    const n110 = h3(g.vec3(g.sw(i1, 'x'), g.sw(i1, 'y'), g.sw(i0, 'z')))
    const n001 = h3(g.vec3(g.sw(i0, 'x'), g.sw(i0, 'y'), g.sw(i1, 'z')))
    const n101 = h3(g.vec3(g.sw(i1, 'x'), g.sw(i0, 'y'), g.sw(i1, 'z')))
    const n011 = h3(g.vec3(g.sw(i0, 'x'), g.sw(i1, 'y'), g.sw(i1, 'z')))
    const n111 = h3(i1)
    const ux = g.sw(u, 'x')
    const x00 = g.mix(n000, n100, ux)
    const x10 = g.mix(n010, n110, ux)
    const x01 = g.mix(n001, n101, ux)
    const x11 = g.mix(n011, n111, ux)
    const uy = g.sw(u, 'y')
    return g.mix(g.mix(x00, x10, uy), g.mix(x01, x11, uy), g.sw(u, 'z'))
  }

  function valueFbm(x, gain, numOctaves) {
    let v = 0.0, a = 1.0, norm = 0.0, p = x
    const nb = octaveCount(numOctaves)
    for (let i = 0; i < nb; i++) {
      v += a * snoise3(p)
      norm += a
      a *= gain
      p = g.mul(p, 2.0)
    }
    return v / norm
  }

  function rotateDomain(pos, angle) {
    const c = g.cos(angle)
    const s = g.sin(angle)
    return g.vec3(c * g.sw(pos, 'x') - s * g.sw(pos, 'z'), g.sw(pos, 'y'), s * g.sw(pos, 'x') + c * g.sw(pos, 'z'))
  }

  function valueRidgedFbmRot(xIn, gain, numOctaves, offset, exponent) {
    let v = 0.0, w = 1.0, norm = 0.0, a = 1.0, p = xIn
    const nb = octaveCount(numOctaves)
    for (let i = 0; i < nb; i++) {
      const signal = g.pow(g.max(offset - g.abs(snoise3(p)), 0.0), exponent)
      v += signal * w * a
      norm += a
      w = g.clamp(signal, 0.0, 1.0)
      a *= gain
      p = rotateDomain(g.mul(p, 2.0), g.float(i) * OCTAVE_ROTATION_RAD)
    }
    return v / g.max(norm, 1e-5)
  }

  function evalLayer(pos, L) {
    const t = L.ltype === LTYPE_FBM
      ? valueFbm(pos, L.gain, L.numOct) * 0.5 + 0.5
      : valueRidgedFbmRot(pos, L.gain, L.numOct, L.ridgeOffset, L.ridgeExp)
    return L.hmin + (L.hmax - L.hmin) * t
  }

  function sampleFractalTerrain(pCoords) {
    const h0 = evalLayer(pCoords, NOISE_LAYERS[0])
    const warped = g.add(pCoords, g.mul(g.mul(pCoords, NOISE_LAYERS[0].warpStr), h0))
    const h1 = evalLayer(warped, NOISE_LAYERS[1])
    const h2 = evalLayer(warped, NOISE_LAYERS[2])
    return (h0 + h1 + h2) / 3.0
  }

  function fractalTerrainH(dir0) {
    const dirN = g.normalize(dir0)
    const p = g.mul(dirN, 3.0)
    let h = (sampleFractalTerrain(p) - 0.17) * 0.6
    const pmix = snoise3(g.add(g.mul(p, 0.53), g.vec3(123.0, 456.0, 789.0))) * 0.5 + 0.5
    const vPower = g.mix(0.95, 1.3, pmix)
    h = h > 0.0 ? g.pow(h, 0.8 * vPower) : -g.pow(-h, 0.8 * vPower)
    return h * g.clamp(snoise3(g.mul(dirN, 4.0)) * 0.5 + 0.7, 0.3, 1.0)
  }

  function continentalBias(dir) {
    return g.sw(hpfSample(dir), 'r')
  }

  function composeHeight(dir0) {
    const frac = fractalTerrainH(dir0)
    const cbias = continentalBias(dir0) * CONTINENTAL_BIAS_AMP
    let h = frac * FRACTAL_HEIGHT_M + cbias + U.uLandBias
    if (h < 0.0) {
      h = g.max(h * OCEAN_DEEPEN, OCEAN_DEPTH_FLOOR_M)
    } else {
      const bShelf = U.uBeachShelfM > 1.0 ? U.uBeachShelfM : DEFAULT_BEACH_SHELF_M
      if (h < bShelf) h = (h * h / bShelf) * (2.0 - h / bShelf)
    }
    h = h * (U.uReliefScale > 0.0 ? U.uReliefScale : 1.0)
    return h + NO_SCULPT_OFFSET_M
  }

  return { snoise3, composeHeight, continentalBias }
}
