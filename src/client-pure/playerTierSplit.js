export const PLAYER_LOD_FULL_COUNT = 30
export const PLAYER_LOD_REDUCED_D = 120
export const PLAYER_LOD_REDUCED_D2 = PLAYER_LOD_REDUCED_D * PLAYER_LOD_REDUCED_D

export const TIER_FULL = 0
export const TIER_REDUCED = 1
export const TIER_DOT = 2

const SCRATCH_MIN_ENTRIES = 64

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

const refuse = (message) => {
  throw new RangeError(message)
}

export const createTierScratch = () => ({
  count: 0,
  d2: new Float64Array(0),
  order: new Int32Array(0),
  spare: new Int32Array(0),
  tiers: new Uint8Array(0),
})

const ensureScratch = (scratch, n) => {
  if (scratch.d2.length >= n) return
  const size = Math.max(n, scratch.d2.length * 2, SCRATCH_MIN_ENTRIES)
  scratch.d2 = new Float64Array(size)
  scratch.order = new Int32Array(size)
  scratch.spare = new Int32Array(size)
  scratch.tiers = new Uint8Array(size)
}

const sortByDistance = (scratch, n) => {
  const d2 = scratch.d2
  let from = scratch.order
  let to = scratch.spare
  for (let width = 1; width < n; width *= 2) {
    for (let lo = 0; lo < n; lo += 2 * width) {
      const mid = Math.min(lo + width, n)
      const hi = Math.min(lo + 2 * width, n)
      let a = lo
      let b = mid
      let k = lo
      while (a < mid && b < hi) to[k++] = d2[from[b]] < d2[from[a]] ? from[b++] : from[a++]
      while (a < mid) to[k++] = from[a++]
      while (b < hi) to[k++] = from[b++]
    }
    const swap = from
    from = to
    to = swap
  }
  scratch.order = from
  scratch.spare = to
}

export function rankPlayerTiers(scratch, entries, viewerPos, fullCount = PLAYER_LOD_FULL_COUNT, reducedD2 = PLAYER_LOD_REDUCED_D2) {
  if (!Array.isArray(entries)) throw new TypeError('classifyPlayerTiers needs an array of entries')
  if (!viewerPos || !finite(viewerPos.x) || !finite(viewerPos.y) || !finite(viewerPos.z)) refuse('viewerPos needs finite x, y and z')
  if (!Number.isInteger(fullCount) || fullCount < 0) refuse('fullCount must be a whole number of at least 0')
  if (!finite(reducedD2) || reducedD2 < 0) refuse('reducedD2 must be a finite number of at least 0')
  const n = entries.length
  ensureScratch(scratch, n)
  const d2 = scratch.d2
  for (let i = 0; i < n; i++) {
    const e = entries[i]
    if (!e || !finite(e.x) || !finite(e.y) || !finite(e.z)) refuse('entry ' + i + ' needs finite x, y and z')
    const dx = e.x - viewerPos.x, dy = e.y - viewerPos.y, dz = e.z - viewerPos.z
    d2[i] = dx * dx + dy * dy + dz * dz
    scratch.order[i] = i
  }
  sortByDistance(scratch, n)
  const order = scratch.order
  const tiers = scratch.tiers
  for (let i = 0; i < n; i++) {
    const k = order[i]
    tiers[k] = i < fullCount ? TIER_FULL : d2[k] < reducedD2 ? TIER_REDUCED : TIER_DOT
  }
  scratch.count = n
  return scratch
}

export function tierSetsOf(scratch, entries) {
  const full = new Set(), reduced = new Set(), dot = new Set(), ranked = [], tierById = new Map()
  for (let i = 0; i < scratch.count; i++) {
    const k = scratch.order[i]
    const id = entries[k].id
    const tier = scratch.tiers[k]
    if (tier === TIER_FULL) full.add(id)
    else if (tier === TIER_REDUCED) reduced.add(id)
    else dot.add(id)
    ranked.push(id)
    tierById.set(id, tier)
  }
  return { full, reduced, dot, order: ranked, tierById }
}

const shared = createTierScratch()

export function classifyPlayerTiers(entries, viewerPos, fullCount = PLAYER_LOD_FULL_COUNT, reducedD2 = PLAYER_LOD_REDUCED_D2) {
  return tierSetsOf(rankPlayerTiers(shared, entries, viewerPos, fullCount, reducedD2), entries)
}
