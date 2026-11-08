import { createAnchorField } from './anchor-field.js'
import { normalize, mul } from './glsl-rt.js'
import { RELIEF_DESIGN_RADIUS_M, SHAPE_UNIFORM_DEFAULTS } from '../../terrain-pure/terrainDefaults.js'
import { assertHashVersion, carveChord2, HASH_VERSION_FLOAT } from './height-spec.js'
import { createHeightEval } from './height-eval.js'

export const HEIGHT_UNIFORM_DEFAULTS = {
  hasHpf: 1,
  ...SHAPE_UNIFORM_DEFAULTS,
  uVsCheap: 0.0,
  uOctMax: 12, uInciseRidgeOcts: 4, uBroadLowOcts: 2, uPeakOcts: 3,
  uNoUnroll: 64,
  uDetailFbmOcts: 3,
}

export class HeightSamplerError extends Error {
  constructor(code, message) { super(message); this.name = 'HeightSamplerError'; this.code = code; }
}

function reliefScaleOf(v, radius) {
  if (v == null) return radius / RELIEF_DESIGN_RADIUS_M
  if (typeof v !== 'number' || !Number.isFinite(v)) {
    throw new HeightSamplerError('height-cpu-bad-relief-scale', 'createHeightSampler: reliefScale must be a finite number, got ' + typeof v + ' ' + String(v))
  }
  return v
}

export function createHeightSampler(opts = {}) {
  if (opts.sculpt) throw new TypeError('createHeightSampler: the CPU height mirror cannot evaluate a sculpt override (it is a GPU texture fetch), so a sampler built with one would silently disagree with the rendered ground -- plumb the sculpt field through the spec instead of passing it here')
  const radius = opts.radius || 6360
  const reliefScale = reliefScaleOf(opts.reliefScale, radius)
  const RES = opts.hpfTexRes || 128
  const BAKE_MAX_LEVEL = Math.round(Math.log2(RES))
  const af = opts.anchorField || createAnchorField({ seed: opts.seed })
  const U = { ...HEIGHT_UNIFORM_DEFAULTS, defRadius: radius, ...(opts.uniforms || {}) }

  const faceBuf = new Array(6).fill(null)
  const bakeFace = (face) => {
    const buf = new Float32Array(RES * RES * 4)
    for (let y = 0; y < RES; y++) {
      const fv = y / (RES - 1)
      for (let x = 0; x < RES; x++) {
        const fu = x / (RES - 1)
        const s = af.sampleUV(face, fu, fv, BAKE_MAX_LEVEL)
        const o = (y * RES + x) * 4
        buf[o] = s.seaBias; buf[o + 1] = s.elevAmp; buf[o + 2] = s.temp; buf[o + 3] = s.humidity
      }
    }
    faceBuf[face] = buf
    return buf
  }
  const hpfFace = (face) => faceBuf[face] || bakeFace(face)

  const hashVersion = assertHashVersion(opts.hashVersion ?? HASH_VERSION_FLOAT)
  const precision = opts.precision ?? (hashVersion === HASH_VERSION_FLOAT ? 'f32' : 'f64')
  const specParams = { hpfRes: RES, landBias: U.uLandBias, beachShelfM: U.uBeachShelfM, reliefScale: 0 }
  const compile = (carves) => createHeightEval({ hashVersion, carves, precision, params: specParams, hpfFace, hpfRes: RES })
  const requestedCarves = opts.carves || []
  if (requestedCarves.length && hashVersion === HASH_VERSION_FLOAT) throw new RangeError('createHeightSampler: terrain carves need hashVersion 2 (the legacy GLSL terrain has no carve term)')
  const naturalHeight = compile([])
  const carves = requestedCarves.map((c) => resolveCarve(c, radius, naturalHeight))
  const composeSpecHeight = carves.length ? compile(carves) : naturalHeight

  function heightAt(dir) {
    const d = normalize(dir)
    return composeSpecHeight(d[0], d[1], d[2]) * reliefScale
  }
  function surfacePoint(dir) { const d = normalize(dir); return mul(d, radius + heightAt(d)) }

  return { heightAt, surfacePoint, radius, anchorField: af, uniforms: U, hashVersion, carves }
}

function resolveCarve(c, radius, naturalHeight) {
  const l = Math.hypot(c.dir[0], c.dir[1], c.dir[2])
  if (!(l > 0) || !(c.innerM >= 0) || !(c.outerM > c.innerM)) throw new RangeError('terrain carve needs a non-zero dir and 0 <= innerM < outerM, got ' + JSON.stringify(c))
  const dir = [c.dir[0] / l, c.dir[1] / l, c.dir[2] / l]
  return { dir, innerChord2: carveChord2(c.innerM, radius), outerChord2: carveChord2(c.outerM, radius), targetH: naturalHeight(dir[0], dir[1], dir[2]) }
}
