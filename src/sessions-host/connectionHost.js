import { DISCONNECT_REASONS, MSG } from '../protocol/messages.js'
import { pack, unpack } from '../protocol/msgpack.js'
import { admitFirstMessage, heartbeatAckPayload, isSessionTokenShape, reconnectRestore, SOCKET_ADMISSION } from '../sessions-pure/connectionHandlers.js'
import { SessionStore } from '../sessions-pure/sessionStore.js'

const send = (socket, type, payload) => socket.send(pack({ type, payload }))

const copyVec = (v) => (Array.isArray(v) ? [...v] : undefined)

export function createConnectionHost({ tickHost, now, sessions = null, playerConfig = {}, snapSpawn = () => [0, 0, 0], randomFill = undefined } = {}) {
  if (!tickHost || typeof tickHost.addPlayer !== 'function') throw new TypeError('[connectionHost] tickHost must be a tick host')
  if (typeof now !== 'function') throw new TypeError('[connectionHost] now must be a clock function in milliseconds')
  const store = sessions || new SessionStore({ now, randomFill })
  const connections = new Map()
  const byToken = new Map()
  const stats = { joins: 0, reconnects: 0, migrations: 0, refusals: 0, disconnects: 0, inputs: 0 }

  const refuse = (socket, code) => {
    stats.refusals++
    send(socket, MSG.DISCONNECT_REASON, { code })
    connections.delete(socket)
    socket.close()
  }

  const bind = (conn, playerId, token) => {
    conn.playerId = playerId
    conn.token = token
    byToken.set(token, conn)
    store.pin(token)
  }

  const savedStateOf = (playerId) => {
    const player = tickHost.playerManager.getPlayer(playerId)
    const st = player.state
    return { position: copyVec(st.position), velocity: copyVec(st.velocity), rotation: copyVec(st.rotation), health: st.health, name: player.name }
  }

  const detach = (conn) => {
    connections.delete(conn.socket)
    if (conn.playerId === null) return
    if (byToken.get(conn.token) === conn) byToken.delete(conn.token)
    store.update(conn.token, { state: savedStateOf(conn.playerId) })
    store.release(conn.token)
    tickHost.removePlayer(conn.playerId)
    conn.playerId = null
    stats.disconnects++
  }

  const join = (conn, payload) => {
    const position = snapSpawn()
    const playerId = tickHost.addPlayer(conn.socket, { position, name: payload && payload.name })
    const token = store.create(playerId, {})
    bind(conn, playerId, token)
    stats.joins++
    send(conn.socket, MSG.HANDSHAKE_ACK, { playerId, sessionToken: token, tick: tickHost.tickNumber, sessionTtlMs: store.ttl })
  }

  const liveSession = (payload) => {
    const token = payload && payload.sessionToken
    if (!isSessionTokenShape(token)) return null
    return store.get(token)
  }

  const restore = (conn, session) => {
    const holder = byToken.get(session.token)
    if (holder) {
      const stale = holder.socket
      detach(holder)
      stale.close()
    }
    const restored = reconnectRestore(session.state, playerConfig, snapSpawn)
    const playerId = tickHost.addPlayer(conn.socket, { position: restored.position, rotation: restored.rotation, name: restored.name, health: restored.health })
    store.rebindOwner(session.token, tickHost.playerManager.ownerOf(playerId))
    bind(conn, playerId, session.token)
    return { playerId, restored }
  }

  const reconnect = (conn, payload) => {
    const session = liveSession(payload)
    if (!session) return refuse(conn.socket, DISCONNECT_REASONS.INVALID_SESSION)
    const { playerId, restored } = restore(conn, session)
    stats.reconnects++
    send(conn.socket, MSG.RECONNECT_ACK, { playerId, sessionToken: session.token, tick: tickHost.tickNumber, position: restored.position, health: restored.health })
  }

  const migrate = (conn, payload) => {
    const session = liveSession(payload)
    if (!session) return refuse(conn.socket, DISCONNECT_REASONS.INVALID_SESSION)
    const holder = byToken.get(session.token)
    const player = holder ? tickHost.playerManager.getPlayer(holder.playerId) : null
    if (!holder || !player || !player.connected) {
      const { playerId } = restore(conn, session)
      stats.migrations++
      send(conn.socket, MSG.MIGRATE_ACK, { playerId, tick: tickHost.tickNumber, resumed: false })
      return
    }
    const previous = holder.socket
    connections.delete(previous)
    holder.playerId = null
    player.socket = conn.socket
    bind(conn, player.id, session.token)
    stats.migrations++
    send(conn.socket, MSG.MIGRATE_ACK, { playerId: player.id, tick: tickHost.tickNumber, resumed: true })
    previous.close()
  }

  const first = (conn, data) => {
    const admission = admitFirstMessage(data, false)
    if (admission.refusal) return refuse(conn.socket, DISCONNECT_REASONS.PROTOCOL_MISMATCH)
    const message = admission.message
    if (admission.way === SOCKET_ADMISSION.MIGRATE) return migrate(conn, message.payload)
    if (message && message.type === MSG.RECONNECT) return reconnect(conn, message.payload)
    if (message && message.type === MSG.HANDSHAKE) return join(conn, message.payload)
    return refuse(conn.socket, DISCONNECT_REASONS.PROTOCOL_MISMATCH)
  }

  const later = (conn, data) => {
    let message
    try { message = unpack(data) } catch (error) { return }
    if (!message || conn.playerId === null) return
    const payload = message.payload || {}
    if (message.type === MSG.INPUT || message.type === MSG.PLAYER_INPUT) {
      if (tickHost.receiveInput(conn.playerId, payload.input, payload.seq)) stats.inputs++
      return
    }
    if (message.type === MSG.HEARTBEAT) send(conn.socket, MSG.HEARTBEAT_ACK, heartbeatAckPayload(payload.timestamp, now()))
  }

  const connect = (socket) => {
    if (!socket || typeof socket.send !== 'function' || typeof socket.close !== 'function') throw new TypeError('[connectionHost] a socket needs send and close')
    const conn = { socket, playerId: null, token: null, admitted: false }
    connections.set(socket, conn)
    return conn
  }

  const receive = (socket, data) => {
    const conn = connections.get(socket)
    if (!conn) return
    if (conn.admitted) return later(conn, data)
    conn.admitted = true
    first(conn, data)
  }

  const closed = (socket) => {
    const conn = connections.get(socket)
    if (conn) detach(conn)
  }

  const attach = (socket) => {
    connect(socket)
    socket.onMessage = (data) => receive(socket, data)
    socket.onClose = () => closed(socket)
  }

  return {
    connect,
    receive,
    closed,
    attach,
    sessions: store,
    stats,
    playerIdOf: (socket) => connections.get(socket)?.playerId ?? null,
    get connectionCount() { return connections.size },
  }
}
