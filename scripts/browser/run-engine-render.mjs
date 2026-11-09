import http from 'node:http'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize } from 'node:path'

const ROOT = normalize(new URL('../..', import.meta.url).pathname)
const PHASE = process.argv.includes('--phase=11') ? 11 : 10
const TIER = process.argv.includes('--tier=1024') ? 1024 : 64
const CHROMIUM = process.env.CHROMIUM || '/usr/lib/chromium/chromium.real'
const PLAYWRIGHT = process.env.PLAYWRIGHT_CORE
if (!PLAYWRIGHT) throw new Error('set PLAYWRIGHT_CORE to the path of a playwright-core index.mjs')
const { chromium } = await import(PLAYWRIGHT)
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.wasm': 'application/wasm' }
const srv = http.createServer(async (q, s) => {
  const path = normalize(join(ROOT, decodeURIComponent(new URL(q.url, 'http://x').pathname)))
  if (!path.startsWith(ROOT)) { s.statusCode = 403; s.end(); return }
  try {
    s.setHeader('content-type', TYPES[extname(path)] || 'application/octet-stream')
    s.end(await readFile(path))
  } catch { s.statusCode = 404; s.end('not found') }
})
await new Promise((res) => srv.listen(0, '127.0.0.1', res))
const port = srv.address().port
const browser = await chromium.launch({
  executablePath: CHROMIUM,
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan,UseSkiaRenderer,WebGPUService', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader', '--no-sandbox'],
})
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 540 } })
  await page.goto(`http://127.0.0.1:${port}/scripts/browser/engine-render.html?phase=${PHASE}&tier=${TIER}`, { waitUntil: 'load' })
  await page.waitForFunction(() => window.engineRenderResult && window.engineRenderResult.done === true, null, { timeout: 280000 })
  const result = await page.evaluate(() => window.engineRenderResult)
  process.stdout.write(JSON.stringify(result) + '\n')
  if (result.ok !== true) process.exitCode = 1
} finally {
  await browser.close()
  srv.close()
}
