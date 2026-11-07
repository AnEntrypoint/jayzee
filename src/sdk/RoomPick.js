import { scoreRoom } from './RoomOrchestratorHttp.js'

export class RoomPickError extends Error {
  constructor(reasonCode, message) {
    super(message)
    this.name = 'RoomPickError'
    this.reasonCode = reasonCode
  }
}

export function selectRoomForJoin({ candidates, request, pickRoom = null }) {
  const rejected = new Set(request.rejectedRooms)
  const open = candidates.filter(room => !rejected.has(room.roomId) && (!request.worldName || room.worldName === request.worldName))
  if (open.length === 0) return null
  if (pickRoom) {
    const chosenId = pickRoom({ candidates: open, requestedRoom: request.requestedRoom, rejectedRooms: [...rejected] })
    if (chosenId == null) return null
    const chosen = open.find(room => room.roomId === chosenId)
    if (!chosen) throw new RoomPickError('pick-outside-candidates', `pickRoom returned "${chosenId}", which is not an open candidate`)
    return chosen
  }
  const requested = request.requestedRoom && open.find(room => room.roomId === request.requestedRoom)
  if (requested) return requested
  let best = open[0]
  let bestScore = scoreRoom(best)
  for (let i = 1; i < open.length; i++) {
    const score = scoreRoom(open[i])
    if (score < bestScore) {
      best = open[i]
      bestScore = score
    }
  }
  return best
}
