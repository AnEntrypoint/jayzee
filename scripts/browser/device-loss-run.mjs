import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp } from './cdp-client.mjs'
import { poll, projectDebugPort, sleep, stopChild } from './page-witness.mjs'

const TIMEOUT_MS = 300000
const COLLECTIONS = 3
const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/device-loss/run.json')
const port = Number(process.argv[3] ?? '8843')
const glue = process.argv[4] === 'budget' ? '?glue=budget' : ''
const debugPort = projectDebugPort(root)
if (debugPort === null) throw new Error('no project playwriter browser: .playwriter/debug-port is missing')

const live = []
const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
live.push(server)
const url = 'http://127.0.0.1:' + port + '/scripts/browser/device-loss.html' + glue
const started = Date.now()
let out = null
const { send, close } = await connectCdp(debugPort, { sendTimeoutMs: 120000 })
let targetId = null
try {
  const served = await poll(async () => server.exitCode === null && (await fetch(url)).status === 200, 60, 200)
  if (!served) throw new Error('the static server did not answer 200 for ' + url);
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (method, params = {}) => send(method, params, sessionId)
  const evaluate = async (expression) => (await page('Runtime.evaluate', { expression, returnByValue: true })).result.value
  await page('HeapProfiler.enable')
  await page('Page.bringToFront')
  await page('Page.navigate', { url })
  const deadline = Date.now() + TIMEOUT_MS
  let result = null
  while (Date.now() < deadline) {
    result = JSON.parse((await evaluate('JSON.stringify(window.deviceLossResult ?? null)')) ?? 'null')
    if (result && result.done === true) break
    await sleep(500)
  }
  if (!result || result.done !== true) result = { error: 'the page did not publish its result', errors: [] }
  for (let i = 0; i < COLLECTIONS; i++) await page('HeapProfiler.collectGarbage')
  const firstModuleCollected = await evaluate('window.deviceLossFirstModule ? window.deviceLossFirstModule.deref() === undefined : null')
  const heldAfterLossBytes = firstModuleCollected === false ? result.firstWasmBytes ?? null : 0
  out = { wallMs: Date.now() - started, ...result, firstModuleCollected, heldAfterLossBytes }
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
  close()
  stopChild(server, live)
}
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
if (out.ok !== true || (out.errors ?? []).length > 0) process.exitCode = 1
