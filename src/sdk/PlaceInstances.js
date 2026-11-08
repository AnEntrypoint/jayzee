export const INSTANCE_SCOPES = Object.freeze(['party', 'solo'])
export const INSTANCE_LIFETIMES = Object.freeze(['ephemeral', 'session', 'persistent'])

const INSTANCE_ROOM = /^(party|solo):/

function refuse(reasonCode, message) {
  return Object.assign(new Error(message), { reasonCode })
}

function playerCountOf(handle) {
  return handle.server.playerManager.getPlayerCount()
}

function requireDirectory(directory) {
  if (!directory) throw new Error('PlaceInstances requires a RoomDirectory')
  for (const method of ['getRoom', 'createRoom', 'stopRoom', 'listRooms']) {
    if (typeof directory[method] !== 'function') throw refuse('instance-directory', `PlaceInstances: RoomDirectory is missing ${method}()`)
  }
}

export function instanceRoomId(scope, groupId) {
  if (!INSTANCE_SCOPES.includes(scope)) throw refuse('instance-scope', `PlaceInstances: scope "${scope}" is not one of ${INSTANCE_SCOPES.join(', ')}`)
  if (typeof groupId !== 'string' || groupId.length === 0) throw refuse('instance-group', `PlaceInstances: ${scope} groupId must be a non-empty string`)
  return `${scope}:${groupId}`
}

export class PlaceInstances {
  constructor(directory, { place, lifetime = 'session' } = {}) {
    requireDirectory(directory)
    if (typeof place !== 'string' || place.length === 0) throw refuse('instance-place', 'PlaceInstances requires a place (world name)')
    if (!INSTANCE_LIFETIMES.includes(lifetime)) throw refuse('instance-lifetime', `PlaceInstances: lifetime "${lifetime}" is not one of ${INSTANCE_LIFETIMES.join(', ')}`)
    this.directory = directory
    this.place = place
    this.lifetime = lifetime
    this.pending = new Map()
  }

  get(scope, groupId) {
    return this.directory.getRoom(instanceRoomId(scope, groupId))
  }

  acquire(scope, groupId, opts = {}) {
    const roomId = instanceRoomId(scope, groupId)
    const existing = this.directory.getRoom(roomId)
    if (existing) return Promise.resolve(existing)
    const inflight = this.pending.get(roomId)
    if (inflight) return inflight
    const created = Promise.resolve(this.directory.createRoom(roomId, this.place, opts))
      .finally(() => this.pending.delete(roomId))
    this.pending.set(roomId, created)
    return created
  }

  async release(scope, groupId) {
    const roomId = instanceRoomId(scope, groupId)
    const handle = this.directory.getRoom(roomId)
    if (!handle) return false
    if (this.lifetime !== 'ephemeral') return false
    if (playerCountOf(handle) > 0) return false
    return this.directory.stopRoom(roomId)
  }

  async sweep() {
    if (this.lifetime !== 'ephemeral') return 0
    const empty = this.directory.listRooms()
      .filter(room => INSTANCE_ROOM.test(room.roomId))
      .filter(room => playerCountOf(room) === 0)
    const stopped = await Promise.all(empty.map(room => this.directory.stopRoom(room.roomId)))
    return stopped.filter(Boolean).length
  }

  list(scope = null) {
    if (scope !== null && !INSTANCE_SCOPES.includes(scope)) throw refuse('instance-scope', `PlaceInstances: scope "${scope}" is not one of ${INSTANCE_SCOPES.join(', ')}`)
    return this.directory.listRooms()
      .filter(room => scope === null ? INSTANCE_ROOM.test(room.roomId) : room.roomId.startsWith(`${scope}:`))
      .map(room => ({ roomId: room.roomId, port: room.port, worldName: room.worldName, players: playerCountOf(room) }))
  }
}
