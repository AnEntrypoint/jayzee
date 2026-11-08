import { createHash } from 'node:crypto'
import { uploadTokenVerdict } from './uploadToken.js'

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

export const refuseSocket = (socket, status, reason, headers = '') => {
  socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\n' + headers + 'Connection: close\r\nContent-Length: 0\r\n\r\n')
}

export function upgradeRefusal(req, env) {
  const verdict = uploadTokenVerdict(env, req.headers.authorization)
  if (verdict === 'unset') return { status: 503, reason: 'Service Unavailable', headers: '' }
  if (verdict === 'wrong') return { status: 401, reason: 'Unauthorized', headers: 'WWW-Authenticate: Bearer\r\n' }
  const key = req.headers['sec-websocket-key']
  const upgradable = req.method === 'GET' && typeof key === 'string' && String(req.headers.upgrade).toLowerCase() === 'websocket' && req.headers['sec-websocket-version'] === '13'
  return upgradable ? null : { status: 400, reason: 'Bad Request', headers: '' }
}

export const websocketAccept = (key) => createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64')

export function createSocketUpgradeHandler({ env = process.env, onConnect } = {}) {
  if (typeof onConnect !== 'function') throw new TypeError('createSocketUpgradeHandler needs an onConnect(socket, head, req) function')
  return function handleSocketUpgrade(req, socket, head) {
    const refusal = upgradeRefusal(req, env)
    if (refusal !== null) {
      refuseSocket(socket, refusal.status, refusal.reason, refusal.headers)
      return
    }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + websocketAccept(req.headers['sec-websocket-key']) + '\r\n\r\n')
    onConnect(socket, head, req)
  }
}
