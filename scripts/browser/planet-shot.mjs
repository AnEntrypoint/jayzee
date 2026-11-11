import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { connectCdp } from './cdp-client.mjs'
import { poll, projectDebugPort, sleep, stopChild } from './page-witness.mjs'
const root = fileURLToPath(new URL('../..', import.meta.url)).replace(/\/$/, '')
const [query, out] = process.argv.slice(2)
const port = 8853
const live = []
const server = spawn(process.execPath, [root + '/scripts/browser/serve-root.mjs', String(port)], { cwd: root, stdio: 'ignore' })
live.push(server)
const url = 'http://127.0.0.1:' + port + '/scripts/browser/engine-render.html?' + query
const { send, close } = await connectCdp(projectDebugPort(root), { sendTimeoutMs: 120000 })
let targetId = null
try {
  await poll(async () => (await fetch(url)).status === 200, 60, 200);
  ({ targetId } = await send('Target.createTarget', { url: 'about:blank' }))
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  const page = (m, p = {}) => send(m, p, sessionId)
  await page('Page.bringToFront')
  await page('Page.navigate', { url })
  const end = Date.now() + 120000
  let state = null
  while (Date.now() < end) {
    state = (await page('Runtime.evaluate', { expression: 'JSON.stringify((() => { const r = window.engineRenderResult || {}; return { done: r.done, held: r.heldAtEnd, last: r.lastFrame, errors: r.errors } })())', returnByValue: true })).result.value
    const s = JSON.parse(state)
    if (s.held || s.done) break
    await sleep(500)
  }
  console.log(state)
  const shot = await page('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
} finally {
  if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {})
  close()
  stopChild(server, live)
}
