import { ENTITY_POSITION_CASE, withinAnyGate } from './entityPosition.js'

const MIN_GATE_VALUES = 3

export function resolveDeliveredIds(ringRelevantIds, unmanagedIds, gatePoints, planetRadius, relevanceRadius, positionOf) {
  if (!unmanagedIds || unmanagedIds.length === 0) return ringRelevantIds
  const delivered = new Set(ringRelevantIds)
  if (!gatePoints || gatePoints.length < MIN_GATE_VALUES) {
    for (const id of unmanagedIds) delivered.add(id)
    return delivered
  }
  const radiusSquared = relevanceRadius * relevanceRadius
  for (const id of unmanagedIds) {
    const found = positionOf(id)
    if (found.case !== ENTITY_POSITION_CASE.position || withinAnyGate(found.position, gatePoints, planetRadius, radiusSquared)) delivered.add(id)
  }
  return delivered
}
