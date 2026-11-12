import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateSync } from 'node:zlib'
import { connectCdp, openPage } from './cdp-client.mjs'
import { poll, projectDebugPort, sleep, stopChild } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/prop-cutoff/run.json')
const port = Number(process.argv[3] ?? '8849')
const backend = process.argv[4] ?? 'webgpu'
if (backend !== 'webgpu' && backend !== 'webgl2') throw new RangeError('backend must be webgpu or webgl2')
const debugPort = process.env.ENGINE_DEBUG_PORT ? Number(process.env.ENGINE_DEBUG_PORT) : projectDebugPort(root)
const WIDTH = 960
const HEIGHT = 540
const BUDGETS = [0, 100, 250, 0]
const COLOUR_GAP = 12
const READY_TRIES = 240
const READY_GAP_MS = 500
const PAINT_GAP_MS = 400

const paeth = (a, b, c) => {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c
}

const decodePng = (bytes) => {
  let at = 8
  let width = 0
  let height = 0
  let channels = 0
  const parts = []
  while (at < bytes.length) {
    const length = bytes.readUInt32BE(at)
    const type = bytes.toString('latin1', at + 4, at + 8)
    const body = bytes.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      width = body.readUInt32BE(0)
      height = body.readUInt32BE(4)
      if (body[8] !== 8 || (body[9] !== 2 && body[9] !== 6) || body[12] !== 0) throw new Error('the screenshot is not an 8-bit RGB or RGBA png without interlace')
      channels = body[9] === 6 ? 4 : 3
    }
    if (type === 'IDAT') parts.push(body)
    at += 12 + length
  }
  const raw = inflateSync(Buffer.concat(parts))
  const stride = width * channels
  const pixels = Buffer.alloc(stride * height)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    for (let x = 0; x < stride; x++) {
      const value = raw[y * (stride + 1) + 1 + x]
      const left = x >= channels ? pixels[y * stride + x - channels] : 0
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0
      const corner = x >= channels && y > 0 ? pixels[(y - 1) * stride + x - channels] : 0
      const predicted = filter === 0 ? 0 : filter === 1 ? left : filter === 2 ? up : filter === 3 ? (left + up) >> 1 : paeth(left, up, corner)
      pixels[y * stride + x] = (value + predicted) & 255
    }
  }
  return { width, height, channels, pixels }
}

const drawnAt = (image, px, py) => {
  if (px < 1 || py < 1 || px >= image.width - 1 || py >= image.height - 1) return null
  const at = (py * image.width + px) * image.channels
  let gap = 0
  for (let c = 0; c < 3; c++) gap = Math.max(gap, Math.abs(image.pixels[at + c] - image.pixels[c]))
  return gap > COLOUR_GAP
}

const run = async () => {
  if (debugPort === null) return { error: 'no browser debug port: set ENGINE_DEBUG_PORT or start the project browser' }
  const live = []
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  const url = 'http://127.0.0.1:' + port + '/scripts/browser/prop-cutoff.html?backend=' + backend
  let client = null
  let browserContextId = null
  try {
    const served = await poll(async () => (await fetch(url)).status === 200, 60, 200)
    if (!served) return { error: 'the static server did not answer for ' + url }
    client = await connectCdp(debugPort)
    const { send } = client
    browserContextId = (await send('Target.createBrowserContext', { disposeOnDetach: true })).browserContextId
    const { sessionId } = await openPage(send, { url, browserContextId })
    await send('Emulation.setDeviceMetricsOverride', { width: WIDTH, height: HEIGHT + 200, deviceScaleFactor: 1, mobile: false }, sessionId)
    const evaluate = async (expression) => (await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId)).result.value
    const ready = await poll(async () => (await evaluate('window.propCutoff && window.propCutoff.ready ? JSON.stringify(window.propCutoff) : null')) ?? null, READY_TRIES, READY_GAP_MS)
    if (!ready) return { error: 'the page did not load the renderer' }
    const page = JSON.parse(ready)
    if (page.error) return { error: page.error }
    const steps = []
    for (const budget of BUDGETS) {
      const step = JSON.parse(await evaluate('window.propCutoffStep(' + budget + ')'))
      await sleep(PAINT_GAP_MS)
      const shot = await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: WIDTH, height: HEIGHT, scale: 1 } }, sessionId)
      const image = decodePng(Buffer.from(shot.data, 'base64'))
      let drawn = 0
      let expected = 0
      let wrong = 0
      let offScreen = 0
      for (const body of step.bodies) {
        const seen = drawnAt(image, body.px, body.py)
        if (seen === null) {
          offScreen += 1
          continue
        }
        drawn += seen ? 1 : 0
        expected += body.inside ? 1 : 0
        if (seen !== body.inside) wrong += 1
      }
      if (page.backend === 'webgpu' && budget === 0 && drawn === 0) return { error: 'the screenshot shows no prop with no budget set, so this browser does not composite the WebGPU canvas and the draw cannot be counted', backend: page.backend, steps }
      const planned = step.visible.reduce((a, b) => a + b, 0)
      const row = { budget, status: step.status, cutoffM: Math.sqrt(step.cutoffSquared), inFrustum: step.prop.inFrustum, shed: step.prop.shed, planned, drawn, expected, wrong, offScreen, createsAfterSeal: step.createsAfterSeal, allocationsSinceWarmup: step.allocationsSinceWarmup }
      row.ok = step.status === 0 && offScreen === 0 && step.createsAfterSeal === 0 && Number(step.allocationsSinceWarmup) === 0 &&
        (budget === 0 ? drawn === step.bodies.length && step.cutoffSquared === 0 && step.prop.shed === 0 : drawn <= budget && drawn > 0 && step.prop.shed > 0 && (page.backend === 'webgpu' ? wrong === 0 && step.cutoffSquared > 0 : drawn === planned))
      steps.push(row)
    }
    return { error: null, backend: page.backend, steps, ok: steps.every((row) => row.ok) }
  } finally {
    if (client && browserContextId) await client.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {})
    if (client) client.close()
    stopChild(server, live)
  }
}

const out = await run().catch((error) => ({ error: error.message }))
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
console.log(out.error || out.ok !== true ? 'RESULT: FAIL' : 'RESULT: PASS')
if (out.error || out.ok !== true) process.exitCode = 1
