import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp } from './cdp-client.mjs'
import { liveObjectBytes } from './heap-witness.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}
const debugPort = Number(flag('debug-port', ''))
const port = Number(flag('port', '8845'))
const frames = Number(flag('frames', '600'))
const outPath = resolve(root, flag('out', 'build/diag/player-vat-heap.json'))
const TIMEOUT_MS = 1200000
const SEND_TIMEOUT_MS = 120000
const POLL_MS = 100
const CHECKPOINT_SHARES = [0.1, 0.5, 1]
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' }

if (!Number.isInteger(debugPort) || debugPort <= 0) throw new TypeError('--debug-port must name the remote debugging port of the project playwriter browser')
if (!Number.isInteger(frames) || frames < 600) throw new RangeError('--frames must be a whole number from 600: ' + frames)

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

const main = async () => {
  const server = await serve(root, port)
  const { send, on, off, close } = await connectCdp(debugPort, { sendTimeoutMs: SEND_TIMEOUT_MS })
  let targetId = null
  let exitCode = 0
  try {
    ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    const page = (method, params = {}) => send(method, params, sessionId)
    const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
    const cdp = { send: page, on, off }
    const deadline = Date.now() + TIMEOUT_MS
    const until = async (expression) => {
      while ((await evaluate(expression)) !== true && Date.now() < deadline) await sleep(POLL_MS)
      return (await evaluate(expression)) === true
    }
    const checkpoint = async () => {
      const live = await liveObjectBytes(cdp)
      return { frames: await evaluate('window.playerVatLoop.frames'), ...live }
    }
    await page('HeapProfiler.enable')
    await page('Page.bringToFront')
    await page('Page.navigate', { url: 'http://127.0.0.1:' + port + '/scripts/browser/player-vat.html?r=3&frames=' + frames })
    await until("typeof window.playerVatLoop === 'object'")
    const warmed = await until('window.playerVatLoop.warmed === true')
    const checkpoints = [await checkpoint()]
    for (const share of CHECKPOINT_SHARES) {
      const reached = share === 1 ? await until('window.playerVatLoop.done === true') : await until('window.playerVatLoop.done === true || window.playerVatLoop.frames >= ' + Math.ceil(frames * share))
      if (!reached) break
      checkpoints.push(await checkpoint())
    }
    const final = JSON.parse(await evaluate('JSON.stringify({ loop: window.playerVatLoop ?? null, result: window.playerVatResult ?? null })'))
    const witness = {
      forcedGc: true,
      warmed,
      frames: final.loop?.frames ?? 0,
      requestedFrames: frames,
      retained: { before: checkpoints[0], after: checkpoints[checkpoints.length - 1] },
      checkpoints,
      samples: [],
      page: { loopError: final.loop ? final.loop.error : 'no loop', done: final.loop?.done ?? false, ok: final.result?.ok ?? null, errors: final.result?.errors ?? [], cases: final.result?.cases ?? [] },
    }
    await mkdir(dirname(outPath), { recursive: true })
    await writeFile(outPath, JSON.stringify(witness, null, 1) + '\n')
    if (witness.page.loopError !== null || witness.page.ok !== true || witness.page.done !== true) exitCode = 1
    console.log(JSON.stringify({
      out: outPath,
      warmed,
      frames: witness.frames,
      growthBytes: witness.retained.after.bytes - witness.retained.before.bytes,
      checkpoints: checkpoints.map((point) => ({ frames: point.frames, bytes: point.bytes, codeBytes: point.codeBytes })),
      pageOk: witness.page.ok,
      loopError: witness.page.loopError,
    }))
  } finally {
    if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
    close()
    server.close()
    server.closeAllConnections()
  }
  process.exitCode = exitCode
}

await main()
