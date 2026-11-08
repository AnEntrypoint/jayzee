import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { connect } from 'node:net'
import { gate, finish } from './lib/gate.mjs'
import { createSocketUpgradeHandler } from '../src/sdk/SocketUpgrade.js'

const TOKEN = randomBytes(24).toString('hex')
const WRONG = randomBytes(24).toString('hex')
const PATH = '/socket'
const KEY = 'dGhlIHNhbXBsZSBub25jZQ=='
const RFC_ACCEPT = 's3pPLMBiTxaQ9kYGzzhZRbK+xOo='

const env = { UPLOAD_TOKEN: TOKEN }
let connections = 0
const server = createServer((req, res) => { res.writeHead(404); res.end() })
server.on('upgrade', createSocketUpgradeHandler({ env, onConnect(socket) { connections++; socket.end() } }))
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const parse = (raw) => {
  if (raw.length === 0) return { status: 0, headers: {} }
  const [statusLine, ...lines] = raw.split('\r\n\r\n')[0].split('\r\n')
  const headers = {}
  for (const line of lines) {
    const at = line.indexOf(':')
    headers[line.slice(0, at).trim().toLowerCase()] = line.slice(at + 1).trim()
  }
  return { status: Number(statusLine.split(' ')[1]), headers }
}

const upgrade = (authorization) => new Promise((resolve, reject) => {
  const sock = connect(port, '127.0.0.1')
  let raw = ''
  const timer = setTimeout(() => { sock.destroy(); reject(new Error('no response from the socket server')) }, 10000)
  sock.setEncoding('utf8')
  sock.on('connect', () => {
    const lines = ['GET ' + PATH + ' HTTP/1.1', 'Host: 127.0.0.1:' + port, 'Upgrade: websocket', 'Connection: Upgrade', 'Sec-WebSocket-Key: ' + KEY, 'Sec-WebSocket-Version: 13']
    if (authorization !== undefined) lines.push('Authorization: ' + authorization)
    sock.write(lines.join('\r\n') + '\r\n\r\n')
  })
  sock.on('data', (chunk) => { raw += chunk })
  sock.on('error', (error) => { clearTimeout(timer); reject(error) })
  sock.on('close', () => { clearTimeout(timer); resolve(parse(raw)) })
})

const noHeader = await upgrade(undefined)
const basic = await upgrade('Basic ' + Buffer.from('user:' + TOKEN).toString('base64'))
const wrong = await upgrade('Bearer ' + WRONG)
const short = await upgrade('Bearer ' + TOKEN.slice(0, -1))
const refused = connections
const right = await upgrade('Bearer ' + TOKEN)
const afterRight = connections
delete env.UPLOAD_TOKEN
const unset = await upgrade('Bearer ' + TOKEN)
const afterUnset = connections
env.UPLOAD_TOKEN = ''
const emptied = await upgrade('Bearer ' + TOKEN)
env.UPLOAD_TOKEN = TOKEN
const restored = await upgrade('Bearer ' + TOKEN)
server.closeAllConnections()
await new Promise((resolve) => server.close(resolve))

gate('no Authorization header gets 401 with a Bearer challenge, and no connection is made', () => {
  assert.equal(noHeader.status, 401)
  assert.equal(noHeader.headers['www-authenticate'], 'Bearer')
  assert.equal(refused, 0)
})

gate('a Basic credential that carries the right token gets 401', () => {
  assert.equal(basic.status, 401)
})

gate('a wrong token and a token one character short each get 401, and no connection is made', () => {
  assert.equal(wrong.status, 401)
  assert.equal(short.status, 401)
  assert.equal(refused, 0)
})

gate('the right token gets 101 Switching Protocols with the RFC 6455 accept key for the sample key, and one connection is made', () => {
  assert.equal(right.status, 101)
  assert.equal(right.headers['sec-websocket-accept'], RFC_ACCEPT)
  assert.equal(afterRight, 1)
})

gate('UPLOAD_TOKEN unset refuses even the right token with 503, and no connection is made', () => {
  assert.equal(unset.status, 503)
  assert.equal(afterUnset, afterRight)
})

gate('UPLOAD_TOKEN empty refuses the right token with 503', () => {
  assert.equal(emptied.status, 503)
})

gate('restoring UPLOAD_TOKEN on the same handler gives 101 again, so the token is read on each upgrade', () => {
  assert.equal(restored.status, 101)
})

gate('the handler cannot be built without an onConnect function', () => {
  assert.throws(() => createSocketUpgradeHandler({ env }), TypeError)
})

finish()
