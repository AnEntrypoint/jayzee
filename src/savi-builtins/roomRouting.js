const ROOM_NAME_LIMIT = 64

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)

const requireRooms = (rooms) => {
  if (!Array.isArray(rooms)) throw new TypeError('rooms takes an array of { roomId, playerCount, maxPlayers }')
  for (const room of rooms) {
    if (!room || typeof room.roomId !== 'string') throw new TypeError('each room has a string roomId')
    if (!isFiniteNumber(room.playerCount) || room.playerCount < 0) throw new TypeError('room ' + room.roomId + ' has a playerCount of zero or more')
    if (!isFiniteNumber(room.maxPlayers) || room.maxPlayers <= 0) throw new TypeError('room ' + room.roomId + ' has a positive maxPlayers')
  }
  return rooms
}

const requireRejected = (rejected) => {
  if (rejected === undefined) return []
  if (!Array.isArray(rejected) || !rejected.every((name) => typeof name === 'string')) throw new TypeError('rejectedRooms takes an array of room names')
  return rejected
}

const hasSpace = (room) => room.playerCount < room.maxPlayers

export const roomFor = (key) => {
  if (typeof key !== 'string') throw new TypeError('roomFor takes a string key')
  const slug = key.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (slug === '') throw new RangeError('a key with no letters or digits has no room name; refused as a scoped negative')
  const name = 'room-' + slug
  if (name.length > ROOM_NAME_LIMIT) throw new RangeError('room names are at most ' + ROOM_NAME_LIMIT + ' characters; refused as a scoped negative')
  return name
}

export const nextRoomName = (rooms, exclude = []) => {
  const taken = new Set([...requireRooms(rooms).map((room) => room.roomId), ...requireRejected(exclude)])
  for (let n = 1; ; n++) {
    const name = 'room-' + n
    if (!taken.has(name)) return name
  }
}

export const mostFullWithSpace = (ctx) => {
  const rooms = requireRooms(ctx.rooms)
  const rejected = requireRejected(ctx.rejectedRooms)
  let best = null
  for (const room of rooms) {
    if (!hasSpace(room) || rejected.includes(room.roomId)) continue
    if (best === null || room.playerCount > best.playerCount || (room.playerCount === best.playerCount && room.createdAt < best.createdAt)) best = room
  }
  return best === null ? null : best.roomId
}

export const firstOpenRoom = (ctx) => {
  const rooms = requireRooms(ctx.rooms)
  const rejected = requireRejected(ctx.rejectedRooms)
  const requested = ctx.requestedRoomId
  if (typeof requested === 'string') {
    const room = rooms.find((candidate) => candidate.roomId === requested)
    if (room && hasSpace(room) && !rejected.includes(requested)) return requested
  }
  const available = mostFullWithSpace(ctx)
  if (available !== null) return available
  return nextRoomName(rooms, rejected)
}

export const ROOM_ROUTING_NAMES = Object.freeze(['firstOpenRoom', 'mostFullWithSpace', 'nextRoomName', 'roomFor'])
