import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import WebSocket from 'ws'
import { pack, unpack } from '../src/protocol/msgpack.js'
import { MSG } from '../src/protocol/messages.js'
import { gate, finish } from './lib/gate.mjs'

const cli = fileURLToPath(new URL('../bin/jayzee-serve.js', import.meta.url))
const UPLOAD = 'upload-token-for-gate'
const EDITOR = 'editor-token-for-gate'
const bearer = (token) => ({ authorization: 'Bearer ' + token })

const startServer = (env) => new Promise((resolve, reject) => {
  const child = spawn(process.execPath, [cli, '--host', '127.0.0.1', '--port', '0'], { env: { PATH: process.env.PATH, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
  let out = ''
  const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('no listen line within 10 s')) }, 10000)
  child.stdout.on('data', (chunk) => {
    out += chunk
    const match = /listening on \S+:(\d+)/.exec(out)
    if (match) {
      clearTimeout(timer)
      resolve({ child, port: Number(match[1]) })
    }
  })
  child.on('exit', (code) => { clearTimeout(timer); reject(new Error('exited before listening, code ' + code)) })
})

const stopServer = (child) => new Promise((resolve) => {
  if (child.exitCode !== null || child.signalCode !== null) return resolve({ code: child.exitCode, signal: child.signalCode })
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000)
  child.once('exit', (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
  child.kill('SIGTERM')
})

const connect = (port, headers = {}) => new Promise((resolve) => {
  const ws = new WebSocket('ws://127.0.0.1:' + port + '/', { headers })
  ws.once('open', () => resolve({ ws }))
  ws.once('unexpected-response', (req, res) => {
    res.resume()
    resolve({ status: res.statusCode, challenge: res.headers['www-authenticate'] ?? null })
  })
  ws.once('error', (error) => resolve({ error: error.message }))
})

const reply = (ws) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('no reply within 3 s')), 3000)
  ws.once('message', (data) => {
    clearTimeout(timer)
    resolve(unpack(new Uint8Array(data)))
  })
})

const exchange = (ws, message) => {
  const answer = reply(ws)
  ws.send(pack(message))
  return answer
}

const withServer = async (env, stopped, body) => {
  const { child, port } = await startServer(env)
  try {
    return await body(port)
  } finally {
    stopped.push(await stopServer(child))
  }
}

const ran = { stopped: [] }
let fatal = null
try {
  await withServer({ UPLOAD_TOKEN: UPLOAD, EDITOR_TOKEN: EDITOR }, ran.stopped, async (port) => {
    ran.noToken = await connect(port)
    ran.wrongToken = await connect(port, bearer('nope'))
    ran.shortToken = await connect(port, bearer(UPLOAD.slice(0, -1)))
    const good = await connect(port, bearer(UPLOAD))
    ran.open = Boolean(good.ws)
    const ws = good.ws
    ran.echo = await exchange(ws, { type: 1, payload: { a: 1 } })
    const malformedReply = reply(ws)
    ws.send(Buffer.from([0xc1]))
    ran.malformed = await malformedReply
    ran.afterMalformed = await exchange(ws, { type: 1, payload: { a: 2 } })
    ran.editorBeforeAuth = await exchange(ws, { type: MSG.EDITOR_UPDATE, payload: { x: 1 } })
    ran.authWrong = await exchange(ws, { type: MSG.AUTH_EDITOR, payload: { token: 'nope' } })
    ran.editorAfterWrong = await exchange(ws, { type: MSG.EDITOR_UPDATE, payload: { x: 2 } })
    ran.authRight = await exchange(ws, { type: MSG.AUTH_EDITOR, payload: { token: EDITOR } })
    ran.editorAfterRight = await exchange(ws, { type: MSG.EDITOR_UPDATE, payload: { x: 3 } })
    const other = await connect(port, bearer(UPLOAD))
    ran.otherEditor = await exchange(other.ws, { type: MSG.EDITOR_SELECT, payload: { id: 4 } })
    other.ws.close()
    ws.close()
  })
  await withServer({ UPLOAD_TOKEN: UPLOAD }, ran.stopped, async (port) => {
    const conn = await connect(port, bearer(UPLOAD))
    ran.unsetNoToken = await exchange(conn.ws, { type: MSG.AUTH_EDITOR, payload: {} })
    ran.unsetEmpty = await exchange(conn.ws, { type: MSG.AUTH_EDITOR, payload: { token: '' } })
    ran.unsetGuess = await exchange(conn.ws, { type: MSG.AUTH_EDITOR, payload: { token: UPLOAD } })
    ran.unsetEditor = await exchange(conn.ws, { type: MSG.EDITOR_UPDATE, payload: { x: 1 } })
    conn.ws.close()
  })
  await withServer({ EDITOR_TOKEN: EDITOR }, ran.stopped, async (port) => {
    ran.uploadUnset = await connect(port, bearer(UPLOAD))
  })
} catch (error) {
  fatal = error.message
}

gate('the server runs with fatal null: every listen, connect and exchange completed', () => {
  assert.equal(fatal, null, fatal)
})

gate('no token, a wrong token and a token one character short each get 401 with a Bearer challenge', () => {
  assert.deepEqual([ran.noToken.status, ran.wrongToken.status, ran.shortToken.status], [401, 401, 401])
  assert.equal(ran.noToken.challenge, 'Bearer')
})

gate('UPLOAD_TOKEN unset refuses the right token with 503 on every upgrade', () => {
  assert.equal(ran.uploadUnset.status, 503)
})

gate('the right upload token opens a socket and a msgpack message comes back unchanged', () => {
  assert.equal(ran.open, true)
  assert.equal(ran.echo.type, 1)
  assert.equal(ran.echo.payload.a, 1)
})

gate('a malformed frame (msgpack 0xc1) gets EDITOR_ERROR with reason malformed, and the socket stays open', () => {
  assert.equal(ran.malformed.type, MSG.EDITOR_ERROR)
  assert.equal(ran.malformed.payload.reason, 'malformed')
  assert.equal(ran.afterMalformed.type, 1)
  assert.equal(ran.afterMalformed.payload.a, 2)
})

gate('an editor message before AUTH_EDITOR is refused as editor-auth-required and never reaches the handler', () => {
  assert.equal(ran.editorBeforeAuth.type, MSG.EDITOR_ERROR)
  assert.equal(ran.editorBeforeAuth.payload.reason, 'editor-auth-required')
  assert.equal(ran.editorBeforeAuth.payload.type, MSG.EDITOR_UPDATE)
})

gate('a wrong EDITOR_TOKEN is acknowledged ok:false and the editor stays closed', () => {
  assert.equal(ran.authWrong.type, MSG.AUTH_EDITOR_ACK)
  assert.equal(ran.authWrong.payload.ok, false)
  assert.equal(ran.editorAfterWrong.payload.reason, 'editor-auth-required')
})

gate('the right EDITOR_TOKEN is acknowledged ok:true and editor messages then reach the handler', () => {
  assert.equal(ran.authRight.type, MSG.AUTH_EDITOR_ACK)
  assert.equal(ran.authRight.payload.ok, true)
  assert.equal(ran.editorAfterRight.type, MSG.EDITOR_UPDATE)
  assert.equal(ran.editorAfterRight.payload.x, 3)
})

gate('editor state is per socket: a second socket that did not authenticate is still refused', () => {
  assert.equal(ran.otherEditor.type, MSG.EDITOR_ERROR)
  assert.equal(ran.otherEditor.payload.reason, 'editor-auth-required')
})

gate('with EDITOR_TOKEN unset, AUTH_EDITOR fails closed for an absent, empty or guessed token', () => {
  for (const reply of [ran.unsetNoToken, ran.unsetEmpty, ran.unsetGuess]) {
    assert.equal(reply.type, MSG.AUTH_EDITOR_ACK)
    assert.equal(reply.payload.ok, false)
  }
})

gate('with EDITOR_TOKEN unset, an editor message stays refused after AUTH_EDITOR', () => {
  assert.equal(ran.unsetEditor.type, MSG.EDITOR_ERROR)
  assert.equal(ran.unsetEditor.payload.reason, 'editor-auth-required')
})

gate('the CLI exits 0 on SIGTERM for every server it started', () => {
  assert.equal(ran.stopped.length, 3)
  for (const { code, signal } of ran.stopped) assert.deepEqual([code, signal], [0, null])
})

finish()
