import { LOD_DEFAULTS } from './lod-defaults.js'

export const LOD_STEP = 7.2
export const LOD_LEAN = 0.35
export const LOD_POP_ALTITUDE_MUL = 8.0

const SPLIT_FACTOR_FLOOR = 0.05
const MAX_LEVEL_MIN = 2
const MAX_LEVEL_MAX = 22

const publishedByKnobs = new WeakMap()

function publishedFor(knobs) {
  let published = publishedByKnobs.get(knobs)
  if (!published) {
    published = { __maxLevel: null, __splitFactor: null }
    publishedByKnobs.set(knobs, published)
  }
  return published
}

function publishResolved(knobs, key, value) {
  if (!knobs || !Number.isFinite(value)) return
  const published = publishedFor(knobs)
  if (knobs[key] === undefined || knobs[key] === published[key]) {
    knobs[key] = value
    published[key] = value
  }
}

export function lodDistFactor(splitFactor, knobs = null) {
  return (knobs && knobs.__distFactor != null) ? +knobs.__distFactor : splitFactor * LOD_POP_ALTITUDE_MUL
}

export function resolveLodConfig(opts = {}, fovy, knobs = null) {
  if (typeof fovy !== 'number' || !Number.isFinite(fovy) || fovy <= 0 || fovy >= Math.PI) {
    throw new RangeError(`mapspinner lod: fovy must be a finite angle in (0, ${Math.PI}) radians, got ${fovy}: Math.tan(fovy / 2) is zero, negative or non-finite at or outside those ends, so the split distance divides by it and pins the quadtree to its 1.1 floor, which collapses the planet to one patch density with no signal`)
  }
  const splitFactorOverridden = !!(knobs && knobs.__splitFactor != null)
  const splitFactor = splitFactorOverridden
    ? Math.max(SPLIT_FACTOR_FLOOR, +knobs.__splitFactor)
    : (opts.splitFactor ?? LOD_DEFAULTS.splitFactor)
  const maxLevelOverridden = !!(knobs && knobs.__maxLevel != null)
  const maxLevel = maxLevelOverridden
    ? Math.max(MAX_LEVEL_MIN, Math.min(MAX_LEVEL_MAX, knobs.__maxLevel | 0))
    : (opts.maxLevel ?? LOD_DEFAULTS.maxLevel)
  publishResolved(knobs, '__maxLevel', maxLevel)
  publishResolved(knobs, '__splitFactor', splitFactor)
  return {
    splitFactor,
    maxLevel,
    distFactor: lodDistFactor(splitFactor, knobs),
    fovy,
    splitFactorOverridden,
    maxLevelOverridden,
  }
}

export function applyLodConfig(qt, radius, viewportH, cfg) {
  qt.computeSplitDist(cfg.splitFactor * LOD_STEP, viewportH, cfg.fovy)
  qt.setConfig(radius, cfg.maxLevel, cfg.distFactor)
  return qt.splitDist
}
