export const ENTITY_POSITION_CASE = Object.freeze({
  position: 'position',
  noPosition: 'noPosition',
  unknownEntity: 'unknownEntity',
})

const NO_POSITION = Object.freeze({ case: ENTITY_POSITION_CASE.noPosition, position: null })
const UNKNOWN_ENTITY = Object.freeze({ case: ENTITY_POSITION_CASE.unknownEntity, position: null })

export function positionOfEntity(spatial, entities, id, work) {
  if (spatial && typeof spatial.getPosition === 'function') {
    const p = spatial.getPosition(id)
    if (p) {
      work.positionOfEntityResolves++
      return { case: ENTITY_POSITION_CASE.position, position: p }
    }
  }
  const entity = entities?.get(id)
  if (!entity) {
    work.positionOfEntityUnknownEntity++
    return UNKNOWN_ENTITY
  }
  if (!entity.position) {
    work.positionOfEntityNoPosition++
    return NO_POSITION
  }
  work.positionOfEntityResolves++
  return { case: ENTITY_POSITION_CASE.position, position: entity.position }
}

export function withinAnyGate(position, gatePoints, planetRadius, radiusSquared) {
  const points = gatePoints.length / 3 | 0
  for (let i = 0; i < points; i++) {
    const dx = position[0] - gatePoints[i * 3]
    const dy = planetRadius > 0 ? position[1] - gatePoints[i * 3 + 1] : 0
    const dz = position[2] - gatePoints[i * 3 + 2]
    if (dx * dx + dy * dy + dz * dz <= radiusSquared) return true
  }
  return false
}
