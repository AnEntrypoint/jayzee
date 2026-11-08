export const COLLIDER_DEFAULT_EXTENT_M = 510
export const COLLIDER_DEFAULT_RESOLUTION_M = 4

const FIELD_WASM_BYTES_PER_SAMPLE = 4
const FINE_FIELD_WASM_BUDGET_BYTES = 1024 * 1024
export const FINE_FIELD_MAX_N = Math.floor(Math.sqrt(FINE_FIELD_WASM_BUDGET_BYTES / FIELD_WASM_BYTES_PER_SAMPLE))

function positiveFinite(v) {
  return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null
}

function evenN(n) {
  return n % 2 === 0 ? n : n + 1
}

export function colliderLatticeOf(tcfg, opts = {}) {
  const tphys = (tcfg && typeof tcfg === 'object' && tcfg.physics) || {}
  const extent = positiveFinite(tphys.extent) ?? COLLIDER_DEFAULT_EXTENT_M
  const resolution = positiveFinite(tphys.resolution) ?? COLLIDER_DEFAULT_RESOLUTION_M
  const configuredN = evenN(Math.max(2, Math.round(extent / resolution)))
  const sourceSpacingM = positiveFinite(opts.sourceSpacingM) ?? 0
  const followsSource = tphys.followSource !== false && sourceSpacingM > 0
  let N = configuredN
  let sourceN = 0
  if (followsSource) {
    sourceN = Math.min(Math.max(2, Math.round(extent / sourceSpacingM) + 1), FINE_FIELD_MAX_N)
    if (sourceN > N) N = sourceN
  }
  return Object.freeze({
    extentM: extent,
    resolutionM: resolution,
    configuredN,
    configuredSpacingM: extent / (configuredN - 1),
    sourceSpacingM,
    sourceN,
    N,
    spacingM: extent / (N - 1),
    followsSource,
    fineFieldMaxN: FINE_FIELD_MAX_N,
  })
}

export function sourceSpacingOfBake(baked) {
  if (!baked || !Number.isInteger(baked.N) || baked.N < 2) return 0
  const extent = positiveFinite(baked.extent)
  if (extent === null) return 0
  return extent / (baked.N - 1)
}

export async function colliderLatticeSpacingOf(tcfg, io) {
  if (!io || typeof io.read !== 'function' || typeof io.decode !== 'function' || typeof io.warn !== 'function') {
    throw new TypeError('colliderLatticeSpacingOf needs io.read(url), io.decode(bytes) and io.warn(...args)')
  }
  const url = tcfg && tcfg.bakedHeightfield
  let sourceSpacingM = 0
  let kind = 'configured'
  if (url) {
    try {
      const spacing = sourceSpacingOfBake(io.decode(await io.read(url)))
      if (spacing > 0) {
        sourceSpacingM = spacing
        kind = 'bake'
      }
    } catch (e) {
      io.warn(`[terrain] near-field lattice: ${url} could not be read, so the near band takes the configured collider lattice instead of the baked one:`, (e && e.message) || e)
    }
  }
  return { ...colliderLatticeOf(tcfg, { sourceSpacingM }), kind }
}
