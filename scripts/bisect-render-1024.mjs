import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, extname, join, normalize, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const [from, to] = args.filter((arg) => !arg.startsWith('--'))
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}
const debugPort = Number(flag('debug-port', ''))
const port = Number(flag('port', '8843'))
const scene = flag('scene', '')
const outDir = flag('out', join(root, 'build', 'diag', 'bisect-render-1024'))
const emsdkDir = process.env.EMSDK_DIR || join(root, 'build', 'emsdk')
const joltDir = join(root, 'build', 'jolt')
const RENDER_PATH = '/scripts/browser/engine-render.html?phase=10&tier=1024&timed=1'
const RENDER_TIMEOUT_MS = 1200000
const POLL_MS = 2000
const MAX_BUFFER = 256 * 1024 * 1024
const WASM_NAME = 'engine-core-128mib-timed.wasm'
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css' }
const BUILD_SCRIPT = 'set -euo pipefail; source "$1/emsdk_env.sh" >/dev/null; emcmake cmake -S "$2" -B "$3" -DENGINE_TIER_MIB=128 -DENGINE_LEAK_ON_TICK=OFF -DENGINE_PHASE_TIMERS=ON -DFETCHCONTENT_SOURCE_DIR_JOLTPHYSICS="$4" >/dev/null && cmake --build "$3" --parallel'

if (!from || !to) throw new TypeError('usage: node scripts/bisect-render-1024.mjs <from> <to> --debug-port=<port> [--scene=<sha>] [--port=8843] [--out=DIR]')
if (!Number.isInteger(debugPort) || debugPort <= 0) throw new TypeError('--debug-port must name the remote debugging port of the project playwriter browser')

const git = (gitArgs, encoding = 'utf8') => execFileSync('git', gitArgs, { cwd: root, encoding, maxBuffer: MAX_BUFFER })
const gitText = (gitArgs) => git(gitArgs).trim()
const fullSha = (ref) => gitText(['rev-parse', '--verify', ref + '^{commit}'])
const blob = (sha, path) => git(['show', sha + ':' + path], 'buffer')
const filesUnder = (sha, path) => gitText(['ls-tree', '-r', '--name-only', sha, '--', path]).split('\n').filter(Boolean)
const stage = (sha, path, dest) => {
  const files = filesUnder(sha, path)
  if (files.length === 0) throw new Error(path + ' is not in ' + sha)
  for (const file of files) {
    const target = join(dest, file)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, blob(sha, file))
  }
}
const joltPin = (sha) => {
  const match = blob(sha, 'engine/CMakeLists.txt').toString('utf8').match(/GIT_TAG\s+([0-9a-f]{40})/)
  return match ? match[1] : null
}
const localJolt = gitText(['-C', joltDir, 'rev-parse', 'HEAD'])
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
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

const renderInPlaywriterBrowser = async (url) => {
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true })
    socket.addEventListener('error', () => failed(new Error('no devtools socket on port ' + debugPort)), { once: true })
  })
  let nextId = 0
  const waiting = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
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
  let targetId = null
  try {
    ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
    await send('Page.navigate', { url }, sessionId)
    const deadline = Date.now() + RENDER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.engineRenderResult ?? null)', returnByValue: true }, sessionId)
      const result = JSON.parse(evaluated.result.value ?? 'null')
      if (result && result.done === true) return result
      await sleep(POLL_MS)
    }
    return { error: 'the render did not finish within ' + RENDER_TIMEOUT_MS + ' ms' }
  } finally {
    if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
    socket.close()
  }
}

const buildEngine = (engineDir, buildDir) => spawnSync('bash', ['-c', BUILD_SCRIPT, 'bisect', emsdkDir, engineDir, buildDir, joltDir], { encoding: 'utf8', maxBuffer: MAX_BUFFER })

const runJob = async (job, site, buildDir) => {
  try {
    rmSync(site, { recursive: true, force: true })
    stage(job.engine, 'engine', site)
    stage(job.page, 'src/engine', site)
    stage(job.page, 'scripts/browser/engine-render.html', site)
    stage(job.page, 'scripts/browser/engine-render-browser.js', site)
    const pin = joltPin(job.engine)
    if (pin !== localJolt) return { error: 'the commit pins Jolt ' + (pin ?? 'none') + ', build/jolt is ' + localJolt }
    const built = buildEngine(join(site, 'engine'), buildDir)
    if (built.status !== 0) return { error: 'engine build exit ' + built.status, tail: (built.stderr + built.stdout).slice(-800) }
    const wasmSha256 = sha256(readFileSync(join(site, 'engine', 'out', WASM_NAME)))
    const run = await renderInPlaywriterBrowser('http://127.0.0.1:' + port + RENDER_PATH)
    if (run.error) return { wasmSha256, error: run.error }
    return { wasmSha256, tier: run.tier, checksum: run.checksum, visible: run.visible, ok: run.ok, errors: run.errors, backend: run.backend, adapter: run.adapter, frameTimeMedianMs: run.frameTimeMedianMs, frameTimeP99Ms: run.frameTimeP99Ms, result: run }
  } catch (error) {
    return { error: error.message }
  }
}

const control = gitText(['rev-parse', fullSha(from) + '^'])
const commits = [control, ...gitText(['rev-list', '--reverse', '--first-parent', fullSha(from) + '^..' + fullSha(to)]).split('\n').filter(Boolean)]
const jobs = commits.map((engine) => ({ engine, page: scene ? fullSha(scene) : engine, control: engine === control }))

const tmp = mkdtempSync(join(tmpdir(), 'bisect-render-1024-'))
const site = join(tmp, 'site')
const buildDir = join(tmp, 'build')
const cleanup = () => rmSync(tmp, { recursive: true, force: true })
const interrupt = () => {
  cleanup()
  process.exit(130)
}
process.once('SIGINT', interrupt)
process.once('SIGTERM', interrupt)

mkdirSync(outDir, { recursive: true })
const records = []
let server = null
try {
  mkdirSync(site, { recursive: true })
  server = await serve(site, port)
  for (const job of jobs) {
    const short = job.engine.slice(0, 7)
    const subject = gitText(['log', '-1', '--format=%s', job.engine])
    const label = job.control ? 'control (parent of ' + fullSha(from).slice(0, 7) + '): ' + subject : subject
    const record = await runJob(job, site, buildDir)
    const row = Object.assign({ sha: job.engine, short, label, page: job.page, scene: scene || null }, record)
    records.push(row)
    writeFileSync(join(outDir, short + '.json'), JSON.stringify(row, null, 1))
    const shown = row.error ? 'ERROR ' + row.error : 'checksum=' + row.checksum + ' visible=' + JSON.stringify(row.visible) + ' ok=' + row.ok + ' backend=' + row.backend + ' adapter=' + JSON.stringify(row.adapter && row.adapter.description)
    console.log(short + ' page=' + job.page.slice(0, 7) + ' ' + label + ' | ' + shown)
  }
} finally {
  if (server) server.close()
  cleanup()
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(records.map(({ result, ...row }) => row), null, 1))
process.exitCode = records.some((row) => row.error || row.ok !== true) ? 1 : 0
