import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp, openPage, recordPageEvents } from './cdp-client.mjs'

const SEND_TIMEOUT_MS = 60000
const POLL_MS = 500
const DEFAULT_TIMEOUT_MS = 120000
const ERROR_KINDS = ['exception', 'console.error', 'log.javascript.error', 'log.network.error']

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

export const whenSet = (name) => '(() => { const value = window[' + JSON.stringify(name) + ']; return value ? JSON.stringify(value) : null })()'

const evaluateInOwnContext = async ({ debugPort, url, expression, timeoutMs, pollMs, record }) => {
  const client = await connectCdp(debugPort, { sendTimeoutMs: SEND_TIMEOUT_MS })
  const { send, close } = client
  let browserContextId = null
  let recorder = null
  try {
    ({ browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true }))
    const { sessionId } = await openPage(send, { url, browserContextId })
    if (record) recorder = await recordPageEvents(client, sessionId)
    const errorsSoFar = () => (recorder ? recorder.events().filter((event) => ERROR_KINDS.includes(event.kind)).map((event) => event.kind + ' ' + event.text) : [])
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (evaluated.exceptionDetails) return { error: 'the page expression threw: ' + (evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text), errors: errorsSoFar() }
      const value = evaluated.result.value
      if (typeof value === 'string') return { result: JSON.parse(value), errors: errorsSoFar() }
      await sleep(pollMs)
    }
    return { error: 'the page did not publish its result within ' + timeoutMs + ' ms', errors: errorsSoFar() }
  } finally {
    if (recorder) recorder.stop()
    if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    close()
  }
}

export const runPageWitness = async ({ root, port, pagePath, expression, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = POLL_MS, record = true, live = [], debugPort = projectDebugPort(root) }) => {
  if (debugPort === null) return { error: 'no project playwriter browser for ' + root + ': .playwriter/debug-port is missing. Start it through the playwriter setup first.' }
  const reachable = await poll(async () => (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).status === 200, 3, 500)
  if (!reachable) return { error: 'the project playwriter browser does not answer on debug port ' + debugPort + '. Start it through the playwriter setup first; this script starts no browser.' }
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  try {
    const url = 'http://127.0.0.1:' + port + '/' + pagePath.replace(/^\//, '')
    const served = await poll(async () => server.exitCode === null && (await fetch(url)).status === 200, 60, 200)
    if (!served) return { error: 'the static server did not answer 200 for ' + url + ' (is another process using port ' + port + '?)' }
    return await evaluateInOwnContext({ debugPort, url, expression, timeoutMs, pollMs, record }).catch((error) => ({ error: error.message }))
  } finally {
    stopChild(server, live)
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
  const args = process.argv.slice(2)
  const [pagePath, name] = args.filter((arg) => !arg.startsWith('--'))
  const flag = (key, fallback) => {
    const hit = args.find((arg) => arg.startsWith('--' + key + '='))
    return hit ? hit.slice(key.length + 3) : fallback
  }
  if (!pagePath || !name) throw new TypeError('usage: node scripts/browser/page-witness.mjs <page path> <result global> [--out=FILE] [--port=8850] [--timeout=120000]')
  const startedMs = Date.now()
  const run = await runPageWitness({ root, port: Number(flag('port', '8850')), pagePath, expression: whenSet(name), timeoutMs: Number(flag('timeout', String(DEFAULT_TIMEOUT_MS))) })
  const text = JSON.stringify({ page: pagePath, wallMs: Date.now() - startedMs, ...run }, null, 1) + '\n'
  const out = flag('out', '')
  if (out) writeFileSync(resolve(root, out), text)
  console.log(text)
  if (run.error || (run.errors && run.errors.length > 0) || (run.result && run.result.ok === false)) process.exitCode = 1
}
