import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
const [, , profile, port, label] = process.argv
const { chromium } = await import(process.env.PLAYWRIGHT_CORE)
const url = 'http://127.0.0.1:8765/scripts/browser/adapter-probe.html'
const child = spawn('/workspace/jayzee/scripts/browser/chromium-webgpu.sh', ['--user-data-dir=' + profile, '--remote-debugging-port=' + port, '--no-first-run', '--no-default-browser-check', '--no-sandbox', url], { env: { ...process.env, DISPLAY: ':1', WEBGPU_PROJECT_ROOT: '/workspace/jayzee', WEBGPU_CHROMIUM: '/usr/lib/chromium/chromium.real' }, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
let stderr = ''
child.stderr.on('data', (d) => { stderr += d })
let version = null
for (let i = 0; i < 120 && !version; i++) {
  try { version = await (await fetch('http://127.0.0.1:' + port + '/json/version')).json() } catch { await new Promise((r) => setTimeout(r, 500)) }
}
if (!version) { console.log(JSON.stringify({ label, error: 'no devtools endpoint', stderr: stderr.slice(0, 800) })); process.exit(1) }
const browser = await chromium.connectOverCDP('http://127.0.0.1:' + port)
const context = browser.contexts()[0]
let page = context.pages().find((p) => p.url().includes('adapter-probe'))
if (!page) page = await context.waitForEvent('page', { timeout: 60000, predicate: (p) => p.url().includes('adapter-probe') })
await page.waitForFunction(() => window.probe && Array.isArray(window.probe.tries ?? window.probe.results) && (window.probe.tries ?? window.probe.results).length >= 5, null, { timeout: 120000, polling: 500 })
const probe = await page.evaluate(() => window.probe)
const localState = JSON.parse(readFileSync(profile + '/Local State', 'utf8'))
const labs = localState.browser && localState.browser.enabled_labs_experiments
const ua = await page.evaluate(() => navigator.userAgent)
await browser.close().catch(() => {})
try { process.kill(-child.pid, 'SIGKILL') } catch {}
console.log(JSON.stringify({ label, userAgent: ua, labs, probe }, null, 1))
process.exit(0)
