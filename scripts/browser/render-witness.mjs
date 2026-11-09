import { spawn } from 'node:child_process'
import { join } from 'node:path'

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
  try { process.kill(-child.pid, 'SIGKILL') } catch {
    try { child.kill('SIGKILL') } catch {}
  }
}

export const runRenderWitness = async ({ root, port, debugPort, profile, pageUrl, playwrightCore, live }) => {
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  try {
    const served = await poll(async () => server.exitCode === null && (await fetch('http://127.0.0.1:' + port + '/scripts/browser/engine-render.html')).status === 200, 60, 200)
    if (!served) return { error: 'the static server did not answer 200 on port ' + port + ' (is another process using it?)' }
    const chrome = spawn(join(root, 'scripts', 'browser', 'chromium-webgpu.sh'), ['--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, '--no-first-run', '--no-default-browser-check', '--no-sandbox'], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1', WEBGPU_PROJECT_ROOT: root, WEBGPU_CHROMIUM: '/usr/lib/chromium/chromium.real' }, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    live.push(chrome)
    try {
      const version = await poll(async () => (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json(), 120, 500)
      if (!version) return { error: 'no devtools endpoint on port ' + debugPort + ' (profile ' + profile + ')' }
      const { chromium } = await import(playwrightCore)
      const cdp = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort)
      try {
        const context = cdp.contexts()[0]
        let page = await poll(async () => context.pages().find((p) => p.url().includes('engine-render')), 20, 500)
        if (!page) {
          page = context.pages()[0] || await context.newPage()
          await page.goto(pageUrl, { waitUntil: 'commit', timeout: 60000 })
        }
        await page.waitForFunction(() => window.engineRenderResult && window.engineRenderResult.done === true, null, { timeout: 1200000, polling: 2000 })
        return { result: await page.evaluate(() => window.engineRenderResult) }
      } finally {
        await cdp.close().catch(() => {})
      }
    } finally {
      stopChild(chrome, live)
    }
  } finally {
    stopChild(server, live)
  }
}
