export const PLACEMENT_WEIGHTS = { PLAYER_WEIGHT: 1.0, ENTITY_WEIGHT: 0.02, TICKMS_WEIGHT: 0.5, DILATION_PENALTY: 50 }

export function scoreRoom(room) {
  const { PLAYER_WEIGHT, ENTITY_WEIGHT, TICKMS_WEIGHT, DILATION_PENALTY } = PLACEMENT_WEIGHTS
  return (room.players || 0) * PLAYER_WEIGHT
    + (room.entities || 0) * ENTITY_WEIGHT
    + (room.avgTickMs || 0) * TICKMS_WEIGHT
    + (1 - (room.dilationFactor ?? 1)) * DILATION_PENALTY
}

export function scoreWorkerRooms(rooms) {
  return rooms.reduce((sum, room) => sum + scoreRoom(room), 0)
}

export function parseRoomPickQuery(searchParams) {
  return {
    requestedRoom: searchParams.get('requested') || null,
    rejectedRooms: (searchParams.get('rejected') || '').split(',').filter(Boolean),
    worldName: searchParams.get('world') || null,
  }
}
