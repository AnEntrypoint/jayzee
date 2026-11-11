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

const TRACE_CATEGORIES = 'devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,toplevel'

const startTrace = async ({ send, on, off }) => {
  const chunks = []
  const onData = (params) => chunks.push(...params.value)
  on('Tracing.dataCollected', onData)
  await send('Tracing.start', { categories: TRACE_CATEGORIES, transferMode: 'ReportEvents' })
  let stopped = null
  return {
    stop: () => {
      if (stopped) return stopped
      stopped = (async () => {
        const complete = new Promise((resolveDone) => on('Tracing.tracingComplete', () => resolveDone()))
        await send('Tracing.end')
        await Promise.race([complete, sleep(60000)])
        off('Tracing.dataCollected', onData)
        return chunks
      })()
      return stopped
    },
  }
}

const evaluateInOwnContext = async ({ debugPort, url, expression, timeoutMs, pollMs, record, trace = false }) => {
  const client = await connectCdp(debugPort, { sendTimeoutMs: SEND_TIMEOUT_MS })
  const { send, close } = client
  let browserContextId = null
  let recorder = null
  let tracer = null
  try {
    ({ browserContextId } = await send('Target.createBrowserContext', { disposeOnDetach: true }))
    if (trace) tracer = await startTrace(client)
    const { sessionId } = await openPage(send, { url, browserContextId })
    if (record) recorder = await recordPageEvents(client, sessionId)
    const errorsSoFar = () => (recorder ? recorder.events().filter((event) => ERROR_KINDS.includes(event.kind)).map((event) => event.kind + ' ' + event.text) : [])
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      const evaluated = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)
      if (evaluated.exceptionDetails) return { error: 'the page expression threw: ' + (evaluated.exceptionDetails.exception?.description ?? evaluated.exceptionDetails.text), errors: errorsSoFar() }
      const value = evaluated.result.value
      if (typeof value === 'string') return { result: JSON.parse(value), errors: errorsSoFar(), trace: tracer ? await tracer.stop() : null }
      await sleep(pollMs)
    }
    return { error: 'the page did not publish its result within ' + timeoutMs + ' ms', errors: errorsSoFar() }
  } finally {
    if (recorder) recorder.stop()
    if (tracer) await tracer.stop().catch(() => {})
    if (browserContextId) await send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    close()
  }
}

export const runPageWitness = async ({ root, port, pagePath, expression, timeoutMs = DEFAULT_TIMEOUT_MS, pollMs = POLL_MS, record = true, trace = false, live = [], debugPort = projectDebugPort(root) }) => {
  if (debugPort === null) return { error: 'no project playwriter browser for ' + root + ': .playwriter/debug-port is missing. Start it through the playwriter setup first.' }
  const reachable = await poll(async () => (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).status === 200, 3, 500)
  if (!reachable) return { error: 'the project playwriter browser does not answer on debug port ' + debugPort + '. Start it through the playwriter setup first; this script starts no browser.' }
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  try {
    const url = 'http://127.0.0.1:' + port + '/' + pagePath.replace(/^\//, '')
    const served = await poll(async () => server.exitCode === null && (await fetch(url)).status === 200, 60, 200)
    if (!served) return { error: 'the static server did not answer 200 for ' + url + ' (is another process using port ' + port + '?)' }
    return await evaluateInOwnContext({ debugPort, url, expression, timeoutMs, pollMs, record, trace }).catch((error) => ({ error: error.message }))
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
