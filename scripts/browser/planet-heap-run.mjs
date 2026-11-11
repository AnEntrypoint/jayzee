import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp } from './cdp-client.mjs'
import { liveObjectBytes } from './heap-witness.mjs'
import { poll, projectDebugPort, sleep, stopChild } from './page-witness.mjs'
import { PLANET_RUNS, planetQuery } from '../../src/engine/planetWitness.js'

const GROWTH_LIMIT_BYTES = 64 * 1024
const SETTLE_FRAMES = 300
const WINDOW_FRAMES = 900
const TIMEOUT_MS = 600000
const POLL_MS = 100

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [label = '64-webgpu', outText, portText = '8849'] = process.argv.slice(2)
const config = PLANET_RUNS.find((run) => run.tier + '-' + run.backend === label)
if (!config) throw new RangeError('no planet run named ' + label + '; known: ' + PLANET_RUNS.map((run) => run.tier + '-' + run.backend).join(', '))
const outPath = resolve(root, outText ?? join('build', 'diag', 'planet-heap', label + '.json'))
const port = Number(portText)
const frames = 60 + SETTLE_FRAMES + WINDOW_FRAMES + 60
const debugPort = projectDebugPort(root)
if (debugPort === null) throw new Error('no project playwriter browser: .playwriter/debug-port is missing')

const live = []
const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
live.push(server)
const url = 'http://127.0.0.1:' + port + '/scripts/browser/engine-render.html?' + planetQuery(config, frames)
let exitCode = 0
const { send, on, off, close } = await connectCdp(debugPort, { sendTimeoutMs: 120000 })
let targetId = null
try {
  const served = await poll(async () => server.exitCode === null && (await fetch(url)).status === 200, 60, 200)
  if (!served) throw new Error('the static server did not answer 200 for ' + url);
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
  const cdp = { send: page, on, off }
  const deadline = Date.now() + TIMEOUT_MS
  const frameNow = () => evaluate('(() => { const r = window.engineRenderResult; return r ? (r.done === true ? ' + frames + ' : (r.lastFrame ?? -1)) : -1 })()')
  const untilFrame = async (frame) => {
    let at = await frameNow()
    while (at < frame && Date.now() < deadline) {
      await sleep(POLL_MS)
      at = await frameNow()
    }
    return at
  }
  await page('HeapProfiler.enable')
  await page('Page.bringToFront')
  await page('Page.navigate', { url })
  const beforeFrame = await untilFrame(60 + SETTLE_FRAMES)
  const before = { frames: beforeFrame, ...(await liveObjectBytes(cdp)) }
  const afterFrame = await untilFrame(beforeFrame + WINDOW_FRAMES)
  const after = { frames: afterFrame, ...(await liveObjectBytes(cdp)) }
  await untilFrame(frames)
  const result = JSON.parse(await evaluate('JSON.stringify((() => { const r = window.engineRenderResult ?? {}; return { done: r.done ?? false, ok: r.ok ?? null, errors: r.errors ?? [], backend: r.backend ?? null, allocationsSinceWarmup: r.allocationsSinceWarmup ?? null, heapAtWarm: r.heapAtWarm ?? null, heapAtEnd: r.heapAtEnd ?? null } })())'))
  const growthBytes = after.bytes - before.bytes
  const witness = { label, forcedGc: true, warmed: beforeFrame >= 60, frames: afterFrame - beforeFrame, requestedFrames: frames, retained: { before, after }, growthBytes, growthLimitBytes: GROWTH_LIMIT_BYTES, withinLimit: growthBytes <= GROWTH_LIMIT_BYTES, samples: [], page: result }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(witness, null, 1) + '\n')
  console.log(JSON.stringify({ out: outPath, label, windowFrames: witness.frames, before: { frames: before.frames, bytes: before.bytes, objects: before.objects, codeBytes: before.codeBytes }, after: { frames: after.frames, bytes: after.bytes, objects: after.objects, codeBytes: after.codeBytes }, growthBytes, withinLimit: witness.withinLimit, page: result }))
  if (!witness.withinLimit || witness.frames < 600 || result.done !== true || result.errors.length > 0) exitCode = 1
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
  close()
  stopChild(server, live)
}
process.exitCode = exitCode
