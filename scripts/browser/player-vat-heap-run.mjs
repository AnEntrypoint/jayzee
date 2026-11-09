import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { sampleWindow } from './heap-witness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}
const debugPort = Number(flag('debug-port', ''))
const port = Number(flag('port', '8845'))
const outPath = resolve(root, flag('out', 'build/diag/player-vat-heap.json'))
const PAGE_PATH = '/scripts/browser/player-vat.html?r=3'
const TIMEOUT_MS = 1200000
const POLL_MS = 500
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' }

if (!Number.isInteger(debugPort) || debugPort <= 0) throw new TypeError('--debug-port must name the remote debugging port of the project playwriter browser')

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

const serve = (dir, listenPort) => new Promise((ready, failed) => {
  const server = createServer(async (req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://127.0.0.1').pathname)
    const target = normalize(join(dir, pathname))
    if (target !== dir && !target.startsWith(dir + sep)) {
      res.writeHead(403).end()
      return
    }
    try {
      const body = await readFile(target)
      res.writeHead(200, { 'content-type': TYPES[extname(target)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body)
    } catch {
      res.writeHead(404).end()
    }
  })
  server.once('error', failed)
  server.listen(listenPort, '127.0.0.1', () => ready(server))
})

const connect = async () => {
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true })
    socket.addEventListener('error', () => failed(new Error('no devtools socket on port ' + debugPort)), { once: true })
  })
  return socket
}

const openSession = (socket) => {
  let nextId = 0
  const waiting = new Map()
  const listeners = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params)
      return
    }
    const settle = waiting.get(message.id)
    if (!settle) return
    waiting.delete(message.id)
    if (message.error) settle.reject(new Error(message.error.message))
    else settle.resolve(message.result)
  })
  const send = (method, params = {}, sessionId) => new Promise((resolveSend, rejectSend) => {
    const id = ++nextId
    waiting.set(id, { resolve: resolveSend, reject: rejectSend })
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })
  return { send, listeners }
}

const main = async () => {
  const server = await serve(root, port)
  const socket = await connect()
  const { send, listeners } = openSession(socket)
  let targetId = null
  let exitCode = 0
  try {
    ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params = {}) => send(method, params, sessionId)
    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
    const cdp = {
      send: page,
      on: (name, listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener]),
      off: (name, listener) => listeners.set(name, (listeners.get(name) ?? []).filter((kept) => kept !== listener)),
    }
    await page('HeapProfiler.enable')
    await page('Page.bringToFront')
    await page('Page.navigate', { url: 'http://127.0.0.1:' + port + PAGE_PATH })
    const deadline = Date.now() + TIMEOUT_MS
    while ((await evaluate('typeof window.playerVatLoop')) !== 'object' && Date.now() < deadline) await sleep(POLL_MS)
    const witness = await sampleWindow({
      cdp,
      isStarted: async () => (await evaluate('window.playerVatLoop.warmed === true')) === true,
      isDone: async () => (await evaluate('window.playerVatLoop.done === true')) === true,
      frames: 0,
      intervalMs: 200,
      maxMs: TIMEOUT_MS,
    })
    const final = JSON.parse(await evaluate('JSON.stringify({ loop: window.playerVatLoop ?? null, result: window.playerVatResult ?? null })'))
    witness.frames = final.loop?.frames ?? 0
    witness.page = { loopError: final.loop ? final.loop.error : 'no loop', ok: final.result?.ok ?? null, errors: final.result?.errors ?? [], cases: final.result?.cases ?? [] }
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, JSON.stringify(witness, null, 1) + '\n')
    if (witness.page.loopError !== null || witness.page.ok !== true) exitCode = 1
    const growth = witness.retained.after.bytes - witness.retained.before.bytes
    console.log(JSON.stringify({ out: outPath, warmed: witness.warmed, forcedGc: witness.forcedGc, frames: witness.frames, growthBytes: growth, pageOk: witness.page.ok, loopError: witness.page.loopError }))
  } finally {
    if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
    socket.close()
    server.close()
    server.closeAllConnections()
  }
  process.exitCode = exitCode
}

await main()
