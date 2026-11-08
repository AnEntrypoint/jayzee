import { TERRAIN_DEFAULTS as TD } from '../../terrain-pure/terrainDefaults.js'

const knob = (host, name) => (host ? host['__' + name] : null)

function vec4(host, name, fallback) {
  const v = knob(host, name)
  return (v && v.length === 4 && Array.prototype.every.call(v, Number.isFinite)) ? v : fallback
}

function num(host, name, fallback) {
  const v = knob(host, name)
  return (v != null && Number.isFinite(+v)) ? +v : fallback
}

const spec = [0, 0, 0, 0]
const out = { lo: TD.poolDispLo, hi: TD.poolDispHi, spec, cover: TD.poolCover }

export function resolvePoolParams(host) {
  out.lo = vec4(host, 'poolDispLo', TD.poolDispLo)
  out.hi = vec4(host, 'poolDispHi', TD.poolDispHi)
  spec[0] = num(host, 'poolSpecExpRough', TD.poolSpecExpRough)
  spec[1] = num(host, 'poolSpecExpSharp', TD.poolSpecExpSharp)
  spec[2] = num(host, 'poolSlope0', TD.poolSlope0)
  spec[3] = num(host, 'poolSlope1', TD.poolSlope1)
  out.cover = num(host, 'poolCover', TD.poolCover)
  return out
}

export function resolveWetness(host) {
  return Math.min(1, Math.max(0, num(host, 'wetness', 0)))
}
