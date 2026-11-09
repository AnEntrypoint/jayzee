import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const [from, to] = args.filter((arg) => !arg.startsWith('--'))
if (!from || !to) throw new TypeError('usage: node scripts/bisect-render-1024.mjs <from> <to> [--port=8843] [--debug-port=9843] [--profile=DIR] [--out=DIR]')
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}
const port = Number(flag('port', '8843'))
const debugPort = Number(flag('debug-port', '9843'))
const profile = flag('profile', join(root, '.playwriter', 'browser-profile'))
const outDir = flag('out', join(root, 'build', 'diag', 'render-bisect'))
const playwrightCore = process.env.PLAYWRIGHT_CORE
if (!playwrightCore) throw new TypeError('PLAYWRIGHT_CORE must name the playwright-core index.mjs')
const pageUrl = 'http://127.0.0.1:' + port + '/scripts/browser/engine-render.html?phase=10&tier=1024&timed=1'

const git = (gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const poll = async (probe, tries, gapMs) => {
  for (let i = 0; i < tries; i++) {
    const value = await probe().catch(() => null)
    if (value) return value
    await sleep(gapMs)
  }
  return null
}

const live = []
const drop = (child) => {
  const at = live.indexOf(child)
  if (at !== -1) live.splice(at, 1)
}
const kill = (child) => {
  try { process.kill(-child.pid, 'SIGKILL') } catch {
    try { child.kill('SIGKILL') } catch {}
  }
  drop(child)
}
const original = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (original === 'HEAD') throw new Error('the shared checkout is detached; check out a branch before the bisect')
const restore = () => {
  try { git(['checkout', '--quiet', original]) } catch (error) { console.error('could not restore ' + original + ': ' + error.message) }
}
const stopAll = () => {
  live.splice(0).forEach((child) => kill(child))
  restore()
}
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    stopAll()
    process.exit(1)
  })
}

const build = (sha) => {
  git(['checkout', '--detach', '--quiet', sha])
  const run = spawnSync('bash', [join(root, 'engine', 'build.sh')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ENGINE_VARIANT: 'timed', ENGINE_TIER_MIB: '128' } })
  if (run.status !== 0) return { error: 'engine build exit ' + run.status, tail: (run.stderr + run.stdout).slice(-800) }
  return { wasmSha256: run.stdout.trim().split('\n').pop().split(/\s+/)[0] }
}

const witness = async () => {
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  live.push(server)
  try {
    const served = await poll(async () => server.exitCode === null && (await fetch('http://127.0.0.1:' + port + '/scripts/browser/engine-render.html')).status === 200, 60, 200)
    if (!served) return { error: 'the bisect static server did not answer 200 on port ' + port + ' (is another process using it?)' }
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
      kill(chrome)
    }
  } finally {
    kill(server)
  }
}

const control = git(['rev-parse', from + '^'])
const commits = [control].concat(git(['rev-list', '--reverse', '--first-parent', from + '^..' + to]).split('\n').filter(Boolean))
mkdirSync(outDir, { recursive: true })
const records = []
try {
  for (const sha of commits) {
    const short = sha.slice(0, 7)
    const subject = git(['log', '-1', '--format=%s', sha])
    const label = sha === control ? 'control (parent of ' + from.slice(0, 7) + '): ' + subject : subject
    const built = build(sha)
    let record
    if (built.error) {
      record = { error: built.error, tail: built.tail }
    } else {
      const run = await witness()
      record = run.error
        ? { wasmSha256: built.wasmSha256, error: run.error }
        : { wasmSha256: built.wasmSha256, tier: run.result.tier, checksum: run.result.checksum, visible: run.result.visible, ok: run.result.ok, errors: run.result.errors, backend: run.result.backend, frameTimeMedianMs: run.result.frameTimeMedianMs, frameTimeP99Ms: run.result.frameTimeP99Ms, result: run.result }
    }
    const row = Object.assign({ sha, short, label }, record)
    records.push(row)
    writeFileSync(join(outDir, short + '.json'), JSON.stringify(row, null, 1))
    const shown = row.error ? 'ERROR ' + row.error : 'checksum=' + row.checksum + ' visible=' + JSON.stringify(row.visible) + ' ok=' + row.ok + ' backend=' + row.backend
    console.log(short + ' ' + label + ' | ' + shown)
  }
} finally {
  stopAll()
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(records.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'result'))), null, 1))
