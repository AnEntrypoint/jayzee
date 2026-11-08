import {
  ATM_BOTTOM, ATM_TOP, ATM_RAYLEIGH_H, ATM_MIE_H, ATM_RAYLEIGH, ATM_MIE_EXT,
  LUT_WIDTH as TRANS_LUT_WIDTH, LUT_HEIGHT as TRANS_LUT_HEIGHT,
  bakeTransmittanceLUT, uFromR as transUFromR, vFromMu as transVFromMu,
  assertWholeCount, clampRange, distToTop, rFromU, muFromV,
} from './atmosphere-transmittance-lut.js'

export const SCAT_LUT_WIDTH = 64
export const SCAT_LUT_HEIGHT = 32
export const SCAT_LUT_LAYERS = 24
export const SCATTERING_MARCH_STEPS = 64

export const SCAT_MUS_WARP_K = 1.4
export const MAX_ALTITUDE_REL_JUMP = 0.6
const ATANH_EDGE = 0.999999
const VERIFY_NEGATIVE_SLACK = -1e-6
const VERIFY_LUMINANCE_FLOOR = 1e-8

function distToGround(r, mu) {
  const disc = r * r * (mu * mu - 1.0) + ATM_BOTTOM * ATM_BOTTOM
  if (disc < 0) return -1
  const d = -r * mu - Math.sqrt(disc)
  return d >= 0 ? d : -1
}

function densities(r) {
  const alt = Math.max(r, ATM_BOTTOM) - ATM_BOTTOM
  return [Math.exp(-alt / ATM_RAYLEIGH_H), Math.exp(-alt / ATM_MIE_H)]
}

function sampleTransmittance(transData, tw, th, r, mu) {
  const fx = transUFromR(r) * tw - 0.5, fy = transVFromMu(mu, r) * th - 0.5
  const x0 = clampRange(Math.floor(fx), 0, tw - 1), x1 = clampRange(x0 + 1, 0, tw - 1)
  const y0 = clampRange(Math.floor(fy), 0, th - 1), y1 = clampRange(y0 + 1, 0, th - 1)
  const tx = clampRange(fx - Math.floor(fx), 0, 1), ty = clampRange(fy - Math.floor(fy), 0, 1)
  const i00 = (y0 * tw + x0) * 3, i10 = (y0 * tw + x1) * 3, i01 = (y1 * tw + x0) * 3, i11 = (y1 * tw + x1) * 3
  const out = [0, 0, 0]
  for (let c = 0; c < 3; c++) {
    const top = transData[i00 + c] * (1 - tx) + transData[i10 + c] * tx
    const bot = transData[i01 + c] * (1 - tx) + transData[i11 + c] * tx
    out[c] = top * (1 - ty) + bot * ty
  }
  return out
}

export function muSFromLayer(layerIndex, layers) {
  const t = clampRange((layerIndex + 0.5) / layers, 0, 1) * 2 - 1
  return clampRange(Math.tanh(SCAT_MUS_WARP_K * t) / Math.tanh(SCAT_MUS_WARP_K), -1, 1)
}

export function layerFromMuS(muS, layers) {
  const t = Math.atanh(clampRange(muS, -ATANH_EDGE, ATANH_EDGE) * Math.tanh(SCAT_MUS_WARP_K)) / SCAT_MUS_WARP_K
  const w = clampRange((t + 1) * 0.5, 0, 1)
  return clampRange(Math.floor(w * layers), 0, layers - 1)
}

export function inscatterAt(r, mu, muS, transLUT, steps = SCATTERING_MARCH_STEPS) {
  assertWholeCount(steps, 'steps')
  const dTop = distToTop(r, mu)
  if (dTop <= 0) return { inscatR: [0, 0, 0], inscatM: 0 }
  const dGround = distToGround(r, mu)
  const d = dGround > 0 && dGround < dTop ? dGround : dTop
  const sinMu = Math.sqrt(Math.max(0, 1 - mu * mu))
  const sinMuS = Math.sqrt(Math.max(0, 1 - muS * muS))
  const dt = d / steps
  let inscatRr = 0, inscatRg = 0, inscatRb = 0, inscatM = 0
  let odR = 0, odM = 0
  const tw = transLUT.width, th = transLUT.height, tdata = transLUT.data
  for (let i = 0; i < steps; i++) {
    const t = dt * (i + 0.5)
    const px = sinMu * t, py = 0, pz = r + mu * t
    const pr = Math.hypot(px, py, pz)
    const [dRd, dMd] = densities(pr)
    const dR = dRd * dt, dM = dMd * dt
    odR += dR
    odM += dM
    const mie = ATM_MIE_EXT * odM
    const tViewR = Math.exp(-(ATM_RAYLEIGH[0] * odR + mie))
    const tViewG = Math.exp(-(ATM_RAYLEIGH[1] * odR + mie))
    const tViewB = Math.exp(-(ATM_RAYLEIGH[2] * odR + mie))
    const pMuS = (px * sinMuS + py * 0 + pz * muS) / pr
    const [tSunR, tSunG, tSunB] = sampleTransmittance(tdata, tw, th, pr, pMuS)
    inscatRr += tViewR * tSunR * dR
    inscatRg += tViewG * tSunG * dR
    inscatRb += tViewB * tSunB * dR
    inscatM += (tViewR * tSunR + tViewG * tSunG + tViewB * tSunB) / 3 * dM
  }
  return { inscatR: [inscatRr, inscatRg, inscatRb], inscatM }
}

export function bakeScatteringLUT(width = SCAT_LUT_WIDTH, height = SCAT_LUT_HEIGHT, layers = SCAT_LUT_LAYERS, steps = SCATTERING_MARCH_STEPS, transLUT = null) {
  assertWholeCount(width, 'width')
  assertWholeCount(height, 'height')
  assertWholeCount(layers, 'layers')
  assertWholeCount(steps, 'steps')
  const trans = transLUT || bakeTransmittanceLUT(TRANS_LUT_WIDTH, TRANS_LUT_HEIGHT)
  const data = new Float32Array(width * height * layers * 4)
  for (let l = 0; l < layers; l++) {
    const muS = muSFromLayer(l, layers)
    const layerBase = l * width * height * 4
    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height
      const rowBase = layerBase + y * width * 4
      for (let x = 0; x < width; x++) {
        const r = rFromU((x + 0.5) / width)
        const { inscatR, inscatM } = inscatterAt(r, muFromV(v, r), muS, trans, steps)
        const idx = rowBase + x * 4
        data[idx] = inscatR[0]
        data[idx + 1] = inscatR[1]
        data[idx + 2] = inscatR[2]
        data[idx + 3] = inscatM
      }
    }
  }
  return { data, width, height, layers }
}

export function verifyScatteringLUT({ data, width, height, layers }) {
  const reasons = []
  let nonFinite = 0, negative = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i]
    if (!Number.isFinite(v)) nonFinite++
    else if (v < VERIFY_NEGATIVE_SLACK) negative++
  }
  if (nonFinite > 0) reasons.push(`${nonFinite} non-finite texels`)
  if (negative > 0) reasons.push(`${negative} negative texels`)
  const layerBase = Math.floor(layers / 2) * width * height * 4
  let maxRelJump = 0, jumpViolations = 0
  let prevLum = null
  for (let x = 0; x < width; x++) {
    const idx = layerBase + x * 4
    const lum = data[idx] + data[idx + 1] + data[idx + 2] + data[idx + 3]
    if (prevLum !== null) {
      const relJump = Math.abs(lum - prevLum) / Math.max(prevLum, lum, VERIFY_LUMINANCE_FLOOR)
      if (relJump > maxRelJump) maxRelJump = relJump
      if (relJump > MAX_ALTITUDE_REL_JUMP) jumpViolations++
    }
    prevLum = lum
  }
  if (jumpViolations > 0) reasons.push(`${jumpViolations} altitude-smoothness violations (maxRelJump=${maxRelJump.toFixed(3)})`)
  return { ok: reasons.length === 0, reasons, nonFinite, negative, jumpViolations, maxRelJump }
}
