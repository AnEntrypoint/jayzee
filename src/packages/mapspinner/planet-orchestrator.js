import { resolvePlanetRadiusM } from './planet-radius.js'
import { Quadtree } from './quadtree.js'
import { resolveLodConfig, applyLodConfig } from './lod-config.js'
import { FACE_FRAME, CULL_ELEV_FRAC, extractFrustumPlanes } from './planet-orchestrator-cull.js'

const FACE_COUNT = 6
const PLANE_FLOATS = 24
const ATAN_INV_K = 4.0 / Math.PI
const DEFAULT_MAX_LEAVES = 4096
const MIN_LEAVES = FACE_COUNT
const MIN_LEVEL_CAP = 0

export const PLANET_FRAME_OK = 'ok'
export const PLANET_FRAME_LEVEL_CAPPED = 'level-capped'
export const PLANET_FRAME_OVER_BUDGET = 'over-budget'

export class PlanetOrchestratorError extends Error {
  constructor(code, message) {
    super(`${code}: ${message}`)
    this.name = 'PlanetOrchestratorError'
    this.code = code
  }
}

function wholeBudget(value) {
  if (!Number.isInteger(value) || value < MIN_LEAVES) throw new PlanetOrchestratorError('planet-max-leaves-not-whole', `maxLeaves must be an integer of at least ${MIN_LEAVES}, got ${value}`)
  return value
}

function finiteVec3(name, v) {
  if (!v || v.length < 3 || !Number.isFinite(v[0]) || !Number.isFinite(v[1]) || !Number.isFinite(v[2])) throw new PlanetOrchestratorError('planet-frame-vector-not-finite', `${name} must be three finite numbers`)
}

export function faceLocalInto(face, eye, radius, out, offset = 0) {
  const F = FACE_FRAME[face]
  const cu = eye[0] * F.u[0] + eye[1] * F.u[1] + eye[2] * F.u[2]
  const cv = eye[0] * F.v[0] + eye[1] * F.v[1] + eye[2] * F.v[2]
  const cc = eye[0] * F.c[0] + eye[1] * F.c[1] + eye[2] * F.c[2]
  out[offset] = ATAN_INV_K * radius * Math.atan2(cu, cc)
  out[offset + 1] = ATAN_INV_K * radius * Math.atan2(cv, cc)
  out[offset + 2] = cc
  return cc
}

export function createPlanetOrchestrator(opts = {}) {
  const radius = resolvePlanetRadiusM(opts, 'createPlanetOrchestrator')
  const maxLeaves = wholeBudget(opts.maxLeaves ?? DEFAULT_MAX_LEAVES)
  const knobs = opts.knobs ?? null
  const lodOpts = { splitFactor: opts.splitFactor, maxLevel: opts.maxLevel }
  const backend = opts.backend ?? null
  if (backend !== null && typeof backend.drawPatches !== 'function') throw new PlanetOrchestratorError('planet-backend-has-no-draw-patches', 'a backend must carry drawPatches(leaves, count, frame)')

  const trees = []
  const culls = []
  const planes = new Float64Array(PLANE_FLOATS)
  for (let f = 0; f < FACE_COUNT; f++) {
    const F = FACE_FRAME[f]
    trees.push(new Quadtree(radius))
    culls.push({ R: radius, maxElev: radius * CULL_ELEV_FRAC, ux: F.u[0], uy: F.u[1], uz: F.u[2], vx: F.v[0], vy: F.v[1], vz: F.v[2], cx: F.c[0], cy: F.c[1], cz: F.c[2], ex: 0, ey: 0, ez: 0, planes })
  }

  const leaves = {
    face: new Uint8Array(maxLeaves),
    level: new Uint8Array(maxLeaves),
    tx: new Uint32Array(maxLeaves),
    ty: new Uint32Array(maxLeaves),
    ox: new Float64Array(maxLeaves),
    oy: new Float64Array(maxLeaves),
    l: new Float64Array(maxLeaves),
  }
  const faceStart = new Uint32Array(FACE_COUNT + 1)
  const local = new Float64Array(FACE_COUNT * 3)
  const stats = { frame: 0, count: 0, status: PLANET_FRAME_OK, levelCap: 0, maxLevel: 0, splitDist: 0, nearestFace: 0, altitudeM: 0, dropped: 0, passes: 0 }
  const lodKey = { fovy: NaN, viewportH: NaN, split: undefined, level: undefined, dist: undefined }
  let cfg = null

  function lodFor(fovy, viewportH) {
    const split = knobs ? knobs.__splitFactor : undefined
    const level = knobs ? knobs.__maxLevel : undefined
    const dist = knobs ? knobs.__distFactor : undefined
    if (cfg !== null && lodKey.fovy === fovy && lodKey.viewportH === viewportH && lodKey.split === split && lodKey.level === level && lodKey.dist === dist) return cfg
    if (!(viewportH > 0) || !Number.isFinite(viewportH)) throw new PlanetOrchestratorError('planet-viewport-not-positive', `viewportH must be a positive finite pixel count, got ${viewportH}`)
    cfg = resolveLodConfig(lodOpts, fovy, knobs)
    lodKey.fovy = fovy
    lodKey.viewportH = viewportH
    lodKey.split = knobs ? knobs.__splitFactor : undefined
    lodKey.level = knobs ? knobs.__maxLevel : undefined
    lodKey.dist = knobs ? knobs.__distFactor : undefined
    return cfg
  }

  function faceLocal(face, eye) {
    return faceLocalInto(face, eye, radius, local, face * 3)
  }

  function gather(levelCap, altitude, useCull) {
    let n = 0
    let over = 0
    for (let f = 0; f < FACE_COUNT; f++) {
      faceStart[f] = n
      const tree = trees[f]
      tree.maxLevel = levelCap
      const o = f * 3
      const found = tree.updateQuadtree(local[o], local[o + 1], local[o + 2], local[o], local[o + 1], undefined, undefined, altitude, useCull ? culls[f] : null)
      for (let i = 0; i < found.length; i++) {
        if (n === maxLeaves) {
          over++
          continue
        }
        const leaf = found[i]
        leaves.face[n] = f
        leaves.level[n] = leaf.level
        leaves.tx[n] = leaf.tx
        leaves.ty[n] = leaf.ty
        leaves.ox[n] = leaf.ox
        leaves.oy[n] = leaf.oy
        leaves.l[n] = leaf.l
        n++
      }
    }
    faceStart[FACE_COUNT] = n
    stats.count = n
    return over
  }

  function frame(view) {
    if (view === null || typeof view !== 'object') throw new PlanetOrchestratorError('planet-frame-view-missing', 'frame needs a view with eye, fovy and viewportH')
    finiteVec3('view.eye', view.eye)
    const eye = view.eye
    const lod = lodFor(view.fovy, view.viewportH)
    const useCull = view.viewProjRel != null
    if (useCull) {
      if (view.viewProjRel.length !== 16) throw new PlanetOrchestratorError('planet-view-proj-not-16', 'viewProjRel must be a 16-element column-major matrix')
      extractFrustumPlanes(view.viewProjRel, planes)
    }
    let nearest = 0
    let nearestDot = -Infinity
    for (let f = 0; f < FACE_COUNT; f++) {
      const cc = faceLocal(f, eye)
      if (cc > nearestDot) {
        nearestDot = cc
        nearest = f
      }
      const c = culls[f]
      c.ex = eye[0]
      c.ey = eye[1]
      c.ez = eye[2]
      applyLodConfig(trees[f], radius, view.viewportH, lod)
    }
    const altitude = Number.isFinite(view.altitudeM) ? view.altitudeM : Math.hypot(eye[0], eye[1], eye[2]) - radius
    let levelCap = lod.maxLevel
    let over = gather(levelCap, altitude, useCull)
    let passes = 1
    while (over > 0 && levelCap > MIN_LEVEL_CAP) {
      levelCap--
      over = gather(levelCap, altitude, useCull)
      passes++
    }
    stats.frame++
    stats.status = over > 0 ? PLANET_FRAME_OVER_BUDGET : levelCap < lod.maxLevel ? PLANET_FRAME_LEVEL_CAPPED : PLANET_FRAME_OK
    stats.levelCap = levelCap
    stats.maxLevel = lod.maxLevel
    stats.splitDist = trees[0].splitDist
    stats.nearestFace = nearest
    stats.altitudeM = altitude
    stats.dropped = over
    stats.passes = passes
    if (backend !== null) backend.drawPatches(leaves, stats.count, stats)
    return stats
  }

  function setNearFieldLeafFloor(leafM, spanLeaves, groundClearanceM, innerSpanLeaves) {
    let floor = 0
    for (let f = 0; f < FACE_COUNT; f++) floor = trees[f].setNearFieldLeafFloor(leafM, spanLeaves, groundClearanceM, innerSpanLeaves)
    return floor
  }

  return { radius, maxLeaves, leaves, faceStart, stats, frame, setNearFieldLeafFloor, lodConfig: () => cfg }
}
