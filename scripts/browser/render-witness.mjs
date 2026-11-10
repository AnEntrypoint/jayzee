import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp, openPage } from './cdp-client.mjs'

export const RENDER_TIMEOUT_MS = 1200000
const SEND_TIMEOUT_MS = 60000
const POLL_MS = 2000

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

export const poll = async (probe, tries, gapMs) => {
  for (let i = 0; i < tries; i++) {
    const value = await probe().catch(() => null)
    if (value) return value
    await sleep(gapMs)
  }
  return null
}

export const stopChild = (child, live) => {
  const at = live.indexOf(child)
  if (at !== -1) live.splice(at, 1)
  try { child.kill('SIGKILL') } catch {}
}

export const projectDebugPort = (root, readText = (path) => readFileSync(path, 'utf8')) => {
  let text = null
  try {
    text = readText(join(root, '.playwriter', 'debug-port'))
  } catch {
    return null
  }
  const port = Number(text.trim())
  return Number.isInteger(port) && port > 0 ? port : null
}

const renderInProjectBrowser = async (debugPort, pageUrl) => {
  const { send, close } = await connectCdp(debugPort, { sendTimeoutMs: SEND_TIMEOUT_MS })
  let browserContextId = null
  try {
    ({ browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true }))
    const { sessionId } = await openPage(send, { url: pageUrl, browserContextId })
    const deadline = Date.now() + RENDER_TIMEOUT_MS
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.engineRenderResult ?? null)', returnByValue: true }, sessionId)
      const result = JSON.parse(evaluated.result.value ?? 'null')
      if (result && result.done === true) return { result }
      await sleep(POLL_MS)
    }
    return { error: 'the render did not finish within ' + RENDER_TIMEOUT_MS + ' ms' }
  } finally {
    if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    close()
  }
}

export const runRenderWitness = async ({ root, port, pageUrl, live, debugPort = projectDebugPort(root) }) => {
  if (debugPort === null) return { error: 'no project playwriter browser for ' + root + ': .playwriter/debug-port is missing. Start it through the playwriter setup first.' }
  const reachable = await poll(async () => (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).status === 200, 3, 500)
  if (!reachable) return { error: 'the project playwriter browser does not answer on debug port ' + debugPort + '. Start it through the playwriter setup first; this script starts no browser.' }
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  try {
    const served = await poll(async () => server.exitCode === null && (await fetch('http://127.0.0.1:' + port + '/scripts/browser/engine-render.html')).status === 200, 60, 200)
    if (!served) return { error: 'the static server did not answer 200 on port ' + port + ' (is another process using it?)' }
    return await renderInProjectBrowser(debugPort, pageUrl).catch((error) => ({ error: error.message }))
  } finally {
    stopChild(server, live)
  }
}

if (process.argv[1] && process.argv[1].endsWith('/browser/render-witness.mjs')) {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const [outPath, portArg = '8843'] = process.argv.slice(2)
  if (!outPath) throw new TypeError('usage: node scripts/browser/render-witness.mjs <out.json> [port]')
  const port = Number(portArg)
  const run = await runRenderWitness({ root, port, pageUrl: 'http://127.0.0.1:' + port + '/scripts/browser/engine-render.html?phase=10&tier=1024&timed=1', live: [] })
  const text = JSON.stringify(run.result ?? { error: run.error }, null, 1) + '\n'
  writeFileSync(outPath, text)
  console.log(text)
  if (run.error) process.exitCode = 1
}
