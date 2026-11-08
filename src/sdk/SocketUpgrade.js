import { createHash } from 'node:crypto'
import { uploadTokenVerdict } from './uploadToken.js'

const WEBSOCKET_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'

const refuseSocket = (socket, status, reason, headers = '') => {
  socket.end('HTTP/1.1 ' + status + ' ' + reason + '\r\n' + headers + 'Connection: close\r\nContent-Length: 0\r\n\r\n')
}

export function createSocketUpgradeHandler({ env = process.env, onConnect } = {}) {
  if (typeof onConnect !== 'function') throw new TypeError('createSocketUpgradeHandler needs an onConnect(socket, head, req) function')
  return function handleSocketUpgrade(req, socket, head) {
    const verdict = uploadTokenVerdict(env, req.headers.authorization)
    if (verdict === 'unset') {
      refuseSocket(socket, 503, 'Service Unavailable')
      return
    }
    if (verdict === 'wrong') {
      refuseSocket(socket, 401, 'Unauthorized', 'WWW-Authenticate: Bearer\r\n')
      return
    }
    const key = req.headers['sec-websocket-key']
    const upgradable = req.method === 'GET' && typeof key === 'string' && String(req.headers.upgrade).toLowerCase() === 'websocket' && req.headers['sec-websocket-version'] === '13'
    if (!upgradable) {
      refuseSocket(socket, 400, 'Bad Request')
      return
    }
    const accept = createHash('sha1').update(key + WEBSOCKET_GUID).digest('base64')
    socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n')
    onConnect(socket, head, req)
  }
}
