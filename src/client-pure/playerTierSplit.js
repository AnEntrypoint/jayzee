export const PLAYER_LOD_FULL_COUNT = 30
export const PLAYER_LOD_REDUCED_D = 120
export const PLAYER_LOD_REDUCED_D2 = PLAYER_LOD_REDUCED_D * PLAYER_LOD_REDUCED_D

export const TIER_FULL = 0
export const TIER_REDUCED = 1
export const TIER_DOT = 2

const finite = (v) => typeof v === 'number' && Number.isFinite(v)

const refuse = (message) => {
  throw new RangeError(message)
}

export function classifyPlayerTiers(entries, viewerPos, fullCount = PLAYER_LOD_FULL_COUNT, reducedD2 = PLAYER_LOD_REDUCED_D2) {
  if (!Array.isArray(entries)) throw new TypeError('classifyPlayerTiers needs an array of entries')
  if (!viewerPos || !finite(viewerPos.x) || !finite(viewerPos.y) || !finite(viewerPos.z)) refuse('viewerPos needs finite x, y and z')
  if (!Number.isInteger(fullCount) || fullCount < 0) refuse('fullCount must be a whole number of at least 0')
  if (!finite(reducedD2) || reducedD2 < 0) refuse('reducedD2 must be a finite number of at least 0')
  const n = entries.length
  const d2 = new Float64Array(n)
  const order = new Array(n)
  for (let i = 0; i < n; i++) {
    const e = entries[i]
    if (!e || !finite(e.x) || !finite(e.y) || !finite(e.z)) refuse('entry ' + i + ' needs finite x, y and z')
    const dx = e.x - viewerPos.x, dy = e.y - viewerPos.y, dz = e.z - viewerPos.z
    d2[i] = dx * dx + dy * dy + dz * dz
    order[i] = i
  }
  order.sort((a, b) => d2[a] - d2[b])
  const full = new Set(), reduced = new Set(), dot = new Set(), ranked = [], tierById = new Map()
  for (let i = 0; i < n; i++) {
    const k = order[i]
    const id = entries[k].id
    const tier = i < fullCount ? TIER_FULL : d2[k] < reducedD2 ? TIER_REDUCED : TIER_DOT
    if (tier === TIER_FULL) full.add(id)
    else if (tier === TIER_REDUCED) reduced.add(id)
    else dot.add(id)
    ranked.push(id)
    tierById.set(id, tier)
  }
  return { full, reduced, dot, order: ranked, tierById }
}
