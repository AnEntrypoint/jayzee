export const SEARCH_KINDS = Object.freeze(['coast', 'hills', 'forest', 'rocks'])
export const SEARCH_STEP_M = 32
export const SEARCH_MAX_RADIUS_M = 4096
export const SEARCH_MAX_SAMPLES = 16384
export const COAST_BAND_M = 6
export const COAST_MIN_ABOVE_SEA_M = 0.1
export const HILL_MIN_SLOPE = 0.35
export const HILL_PROBE_M = 4
export const DENSITY_MIN = 0.5

const TAU = Math.PI * 2
const MIN_RING_SAMPLES = 8

const needFn = (ctx, name, kind) => {
  if (typeof ctx[name] !== 'function') throw new TypeError('searchBookmark ' + kind + ' needs ctx.' + name + '(x, z)')
  return ctx[name]
}

const positive = (value, fallback, name) => {
  if (value === undefined) return fallback
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('searchBookmark ' + name + ' must be a positive finite number')
  return value
}

const scoreCoast = (ctx, x, z, step) => {
  const h = ctx.heightAt(x, z)
  if (!Number.isFinite(h)) return null
  const above = h - ctx.seaLevelY
  if (above < COAST_MIN_ABOVE_SEA_M || above > COAST_BAND_M) return 0
  let wet = 0
  for (let k = 0; k < 4; k++) {
    const nx = x + (k === 0 ? step : k === 1 ? -step : 0)
    const nz = z + (k === 2 ? step : k === 3 ? -step : 0)
    const nh = ctx.heightAt(nx, nz)
    if (Number.isFinite(nh) && nh < ctx.seaLevelY) wet += 1
  }
  return wet === 0 ? 0 : 1 + wet - above / COAST_BAND_M
}

const scoreHills = (ctx, x, z) => {
  const h = ctx.heightAt(x, z)
  const hx = ctx.heightAt(x + HILL_PROBE_M, z)
  const hz = ctx.heightAt(x, z + HILL_PROBE_M)
  if (!Number.isFinite(h) || !Number.isFinite(hx) || !Number.isFinite(hz)) return null
  if (h < ctx.seaLevelY) return 0
  const slope = Math.hypot(hx - h, hz - h) / HILL_PROBE_M
  return slope >= HILL_MIN_SLOPE ? slope : 0
}

const scoreDensity = (density) => (ctx, x, z) => {
  const h = ctx.heightAt(x, z)
  const d = ctx[density](x, z)
  if (!Number.isFinite(h) || !Number.isFinite(d)) return null
  if (h < ctx.seaLevelY) return 0
  return d >= DENSITY_MIN ? d : 0
}

const SCORERS = Object.freeze({
  coast: { score: scoreCoast, needs: [] },
  hills: { score: scoreHills, needs: [] },
  forest: { score: scoreDensity('treeDensityAt'), needs: ['treeDensityAt'] },
  rocks: { score: scoreDensity('rockDensityAt'), needs: ['rockDensityAt'] },
})

export function searchBookmark(kind, ctx) {
  if (!Object.hasOwn(SCORERS, kind)) throw new RangeError('searchBookmark kind must be one of ' + SEARCH_KINDS.join(', ') + '; got ' + String(kind))
  if (!ctx || typeof ctx !== 'object') throw new TypeError('searchBookmark needs a ctx object')
  const scorer = SCORERS[kind]
  needFn(ctx, 'heightAt', kind)
  for (const name of scorer.needs) needFn(ctx, name, kind)
  if (!Number.isFinite(ctx.seaLevelY)) throw new TypeError('searchBookmark needs a finite ctx.seaLevelY')
  const origin = ctx.origin
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite)) throw new TypeError('searchBookmark needs ctx.origin as finite [x, z]')
  const step = positive(ctx.stepM, SEARCH_STEP_M, 'stepM')
  const maxRadius = positive(ctx.maxRadiusM, SEARCH_MAX_RADIUS_M, 'maxRadiusM')
  const maxSamples = positive(ctx.maxSamples, SEARCH_MAX_SAMPLES, 'maxSamples')
  let samples = 0
  let skipped = 0
  for (let ring = 1; ring * step <= maxRadius; ring++) {
    const radius = ring * step
    const count = Math.max(MIN_RING_SAMPLES, Math.ceil((TAU * radius) / step))
    let bestScore = 0
    let bestX = 0
    let bestZ = 0
    for (let i = 0; i < count; i++) {
      if (samples >= maxSamples) return { found: false, reason: 'sample-budget', samples, skipped, ring }
      const angle = (TAU * i) / count
      const x = origin[0] + radius * Math.cos(angle)
      const z = origin[1] + radius * Math.sin(angle)
      samples += 1
      const score = scorer.score(ctx, x, z, step)
      if (score === null) {
        skipped += 1
        continue
      }
      if (score > bestScore) {
        bestScore = score
        bestX = x
        bestZ = z
      }
    }
    if (bestScore > 0) return { found: true, kind, spec: { x: bestX, z: bestZ }, distanceM: radius, ring, score: bestScore, samples, skipped }
  }
  return { found: false, reason: 'no-match', samples, skipped, ring: Math.floor(maxRadius / step) }
}

export function resolveBookmarkSpec(bookmark, ctx) {
  if (!bookmark || typeof bookmark !== 'object') throw new TypeError('resolveBookmarkSpec needs a bookmark')
  if (bookmark.spec) return { found: true, spec: bookmark.spec }
  if (typeof bookmark.search !== 'string') throw new TypeError('bookmark ' + String(bookmark.name) + ' has neither a spec nor a search kind')
  return searchBookmark(bookmark.search, ctx)
}
