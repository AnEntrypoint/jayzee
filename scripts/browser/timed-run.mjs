import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { mergeLoad, stampLoad } from './timed-result.mjs'
const [, , profile, port, phase, outPath] = process.argv
const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
const before = stampLoad()
const url ='http://127.0.0.1:8765/scripts/browser/engine-render.html?phase=' + phase + '&tier=1024&timed=1'
const child = spawn('/workspace/jayzee/scripts/browser/chromium-webgpu.sh', ['--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--no-first-run', '--no-default-browser-check', '--no-sandbox', url], { env: { ...process.env, DISPLAY: ':1', WEBGPU_PROJECT_ROOT: '/workspace/jayzee', WEBGPU_CHROMIUM: '/usr/lib/chromium/chromium.real' }, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let version = null
for (let i = 0; i < 120 && !version; i++) {
  try { version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json() } catch { await new Promise((r) => setTimeout(r, 500)) }
}
if (!version) { console.log('NO_DEVTOOLS'); process.exit(1) }
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
const context = browser.contexts()[0]
let page = context.pages().find((p) => p.url().includes('engine-render'))
if (!page) page = await context.waitForEvent('page', { timeout: 60000, predicate: (p) => p.url().includes('engine-render') })
const started = Date.now()
await page.waitForFunction(() => window.engineRenderResult && window.engineRenderResult.done === true, null, { timeout: 1200000, polling: 2000 })
const after = stampLoad()
const text = JSON.stringify(mergeLoad(await page.evaluate(() => window.engineRenderResult), before, after))
writeFileSync(outPath, text)
const gpu = await page.evaluate(() => navigator.gpu ? 'navigator.gpu present' : 'no navigator.gpu')
await browser.close().catch(() => {})
try { process.kill(-child.pid, 'SIGKILL') } catch {}
console.log(JSON.stringify({ outPath, bytes: text.length, elapsedS: Math.round((Date.now() - started) / 1000), gpu }))
process.exit(0)
