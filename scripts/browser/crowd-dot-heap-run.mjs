import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { connectCdp } from './cdp-client.mjs'
import { poll, projectDebugPort, sleep, stopChild } from './page-witness.mjs'

const OWN_FILES = ['playerLodRendererWebGPU.js', 'crowdDots.js', 'webgpuInstancing.js', 'dotGeometry.js']
const ENTRY_FILE = 'playerLodRendererWebGPU.js'
const PAGE_FILE = 'crowd-dot-heap-browser.js'
const TIMEOUT_MS = 180000
const LIMIT_BYTES_PER_UPDATE = 64

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/crowd-dot-heap/run.json')
const port = Number(process.argv[3] ?? '8851')
const debugPort = projectDebugPort(root)
if (debugPort === null) throw new Error('no project playwriter browser: .playwriter/debug-port is missing')

const fileOf = (url) => url.split('?')[0].split('/').pop()
const live = []
const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
live.push(server)
const url = 'http://127.0.0.1:' + port + '/scripts/browser/crowd-dot-heap.html'
let exitCode = 0
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
  let state = null
  while (Date.now() < deadline) {
    state = JSON.parse((await evaluate('JSON.stringify(window.crowdDotLoop ?? null)')) ?? 'null')
    if (state && (state.ready || state.error)) break
    await sleep(200)
  }
  if (!state || state.error || !state.ready) throw new Error('the page did not become ready: ' + (state ? state.error : 'no loop'))
  await page('HeapProfiler.collectGarbage')
  await page('HeapProfiler.startSampling', { samplingInterval: 1, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
  const measuredUpdates = await evaluate('window.crowdDotMeasure()')
  const { profile } = await page('HeapProfiler.stopSampling')
  const bytes = { underUpdate: 0, ownFiles: 0, control: 0 }
  const sites = new Map()
  const walk = (node, under) => {
    const file = fileOf(node.callFrame.url)
    const here = under || file === ENTRY_FILE
    if (node.selfSize > 0) {
      if (here) {
        bytes.underUpdate += node.selfSize
        const key = (node.callFrame.functionName || '(anonymous)') + ' ' + file + ':' + node.callFrame.lineNumber
        sites.set(key, (sites.get(key) ?? 0) + node.selfSize)
      }
      if (OWN_FILES.includes(file)) bytes.ownFiles += node.selfSize
      if (file === PAGE_FILE && node.callFrame.functionName === 'crowdDotMeasure') bytes.control += node.selfSize
    }
    for (const child of node.children) walk(child, here)
  }
  walk(profile.head, false)
  const end = JSON.parse(await evaluate('JSON.stringify(window.crowdDotLoop)'))
  const out = { backend: end.backend, instances: end.instances, measuredUpdates, bytes, bytesPerUpdate: bytes.underUpdate / measuredUpdates, sites: [...sites.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12), controlObjects: end.controlObjects }
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
  console.log(JSON.stringify(out))
  if (out.backend !== 'webgpu' || bytes.control === 0 || out.bytesPerUpdate > LIMIT_BYTES_PER_UPDATE) exitCode = 1
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
  close()
  stopChild(server, live)
}
process.exitCode = exitCode
