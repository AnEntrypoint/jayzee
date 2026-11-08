import { WebSocketServer } from 'ws'
import { pack, unpack } from '../protocol/msgpack.js'
import { MSG } from '../protocol/messages.js'
import { refuseSocket, upgradeRefusal } from './SocketUpgrade.js'
import { authEditorVerdict, messageRefusal } from './socketMessageToken.js'

const decode = (data) => {
  try {
    const message = unpack(new Uint8Array(data))
    return message !== null && typeof message === 'object' && typeof message.type === 'number' ? message : null
  } catch {
    return null
  }
}

const send = (ws, message) => {
  if (ws.readyState === ws.OPEN) ws.send(pack(message))
}

export function createSocketServer({ server, env = process.env, onMessage } = {}) {
  if (!server || typeof server.on !== 'function') throw new TypeError('createSocketServer needs an http server')
  if (typeof onMessage !== 'function') throw new TypeError('createSocketServer needs an onMessage(connection, message) function')
  const wss = new WebSocketServer({ noServer: true })
  const clients = new Set()

  server.on('upgrade', (req, socket, head) => {
    const refusal = upgradeRefusal(req, env)
    if (refusal !== null) {
      refuseSocket(socket, refusal.status, refusal.reason, refusal.headers)
      return
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req))
  })

  wss.on('connection', (ws) => {
    const connection = { ws, isEditor: false }
    clients.add(ws)
    ws.on('close', () => clients.delete(ws))
    ws.on('error', () => clients.delete(ws))
    ws.on('message', (data) => {
      const message = decode(data)
      if (message === null) {
        send(ws, { type: MSG.EDITOR_ERROR, payload: { reason: 'malformed' } })
        return
      }
      if (message.type === MSG.AUTH_EDITOR) {
        const verdict = authEditorVerdict(env, message.payload)
        if (verdict === 'ok') connection.isEditor = true
        send(ws, { type: MSG.AUTH_EDITOR_ACK, payload: { ok: verdict === 'ok' } })
        return
      }
      const refusal = messageRefusal(connection, message.type)
      if (refusal !== null) {
        send(ws, { type: MSG.EDITOR_ERROR, payload: { reason: refusal, type: message.type } })
        return
      }
      try {
        onMessage(connection, message)
      } catch {
        send(ws, { type: MSG.EDITOR_ERROR, payload: { reason: 'handler-threw', type: message.type } })
      }
    })
  })

  return {
    wss,
    close: () => new Promise((resolve) => {
      for (const ws of clients) ws.terminate()
      wss.close(() => resolve())
    }),
  }
}
