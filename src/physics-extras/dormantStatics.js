export const DORMANT_REINSERT_BATCH = 32
export const DORMANT_REORDER_DISPLACEMENT_M = 32
export const DORMANT_ORDER_BUCKET_M = 32
export const DORMANT_ORDER_BUCKET_COUNT = 128

export function reachAlongRay(center, radius, origin, direction, maxDistance) {
  const ox = center[0] - origin[0]
  const oy = center[1] - origin[1]
  const oz = center[2] - origin[2]
  const along = ox * direction[0] + oy * direction[1] + oz * direction[2]
  const perpendicular2 = ox * ox + oy * oy + oz * oz - along * along
  if (perpendicular2 > radius * radius) return Infinity
  const entry = along - Math.sqrt(radius * radius - perpendicular2)
  if (along + radius < 0 || entry > maxDistance) return Infinity
  return Math.max(0, entry)
}

export function boundsRadius(min, max) {
  return Math.hypot(
    Math.max(Math.abs(min[0]), Math.abs(max[0])),
    Math.max(Math.abs(min[1]), Math.abs(max[1])),
    Math.max(Math.abs(min[2]), Math.abs(max[2])),
  )
}

export function nearestMoverDistance(position, movers) {
  let best = Infinity
  for (const mover of movers) {
    const dx = position[0] - mover[0]
    const dy = position[1] - mover[1]
    const dz = position[2] - mover[2]
    const d2 = dx * dx + dy * dy + dz * dz
    if (d2 < best) best = d2
  }
  return Math.sqrt(best)
}

export function orderBucket(distance) {
  return Math.min(DORMANT_ORDER_BUCKET_COUNT - 1, Math.floor(distance / DORMANT_ORDER_BUCKET_M))
}

export function orderNearestFirst(items) {
  const buckets = Array.from({ length: DORMANT_ORDER_BUCKET_COUNT }, () => [])
  for (const { bodyId, distance } of items) buckets[orderBucket(distance)].push(bodyId)
  return buckets.flat()
}

export function needsReorder(orderedFor, movers) {
  if (!orderedFor || orderedFor.length !== movers.length) return true
  for (let i = 0; i < movers.length; i++) {
    const a = orderedFor[i]
    const b = movers[i]
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) > DORMANT_REORDER_DISPLACEMENT_M) return true
  }
  return false
}
