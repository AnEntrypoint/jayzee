import { execFileSync, spawn, spawnSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const args = process.argv.slice(2)
const [from, to] = args.filter((arg) => !arg.startsWith('--'))
if (!from || !to) throw new TypeError('usage: node scripts/bisect-render-1024.mjs <from> <to> [--port=8766] [--debug-port=9766] [--profile=DIR] [--out=DIR]')
const flag = (name, fallback) => {
  const hit = args.find((arg) => arg.startsWith('--' + name + '='))
  return hit ? hit.slice(name.length + 3) : fallback
}
const port = Number(flag('port', '8766'))
const debugPort = Number(flag('debug-port', '9766'))
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

const build = (sha) => {
  git(['checkout', '--detach', '--quiet', sha])
  const run = spawnSync('bash', [join(root, 'engine', 'build.sh')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ENGINE_VARIANT: 'timed', ENGINE_TIER_MIB: '128' } })
  if (run.status !== 0) return { error: 'engine build exit ' + run.status, tail: (run.stderr + run.stdout).slice(-800) }
  return { wasmSha256: run.stdout.trim().split('\n').pop().split(/\s+/)[0] }
}

const witness = async () => {
  const server = spawn(process.execPath, [join(root, 'scripts', 'browser', 'serve-root.mjs'), String(port)], { cwd: root, stdio: 'ignore' })
  try {
    const served = await poll(async () => (await fetch('http://127.0.0.1:' + port + '/scripts/browser/engine-render.html')).ok, 60, 200)
    if (!served) return { error: 'static server did not answer on port ' + port }
    const chrome = spawn(join(root, 'scripts', 'browser', 'chromium-webgpu.sh'), ['--user-data-dir=' + profile, '--remote-debugging-port=' + debugPort, '--no-first-run', '--no-default-browser-check', '--no-sandbox', pageUrl], { env: { ...process.env, DISPLAY: process.env.DISPLAY || ':1', WEBGPU_PROJECT_ROOT: root, WEBGPU_CHROMIUM: '/usr/lib/chromium/chromium.real' }, stdio: ['ignore', 'ignore', 'pipe'], detached: true })
    try {
      const version = await poll(async () => (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json(), 120, 500)
      if (!version) return { error: 'no devtools endpoint on port ' + debugPort + ' (profile ' + profile + ')' }
      const { chromium } = await import(playwrightCore)
      const cdp = await chromium.connectOverCDP('http://127.0.0.1:' + debugPort)
      try {
        const context = cdp.contexts()[0]
        const page = context.pages().find((p) => p.url().includes('engine-render')) || await context.waitForEvent('page', { timeout: 60000, predicate: (p) => p.url().includes('engine-render') })
        await page.waitForFunction(() => window.engineRenderResult && window.engineRenderResult.done === true, null, { timeout: 1200000, polling: 2000 })
        return { result: await page.evaluate(() => window.engineRenderResult) }
      } finally {
        await cdp.close().catch(() => {})
      }
    } finally {
      try { process.kill(-chrome.pid, 'SIGKILL') } catch {}
    }
  } finally {
    server.kill()
  }
}

const original = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (original === 'HEAD') throw new Error('the shared checkout is detached; check out main before the bisect')
if (git(['status', '--porcelain', '--untracked-files=no']) !== '') throw new Error('tracked files are modified; commit or stash them before the bisect')
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
  git(['checkout', '--quiet', original])
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(records.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'result'))), null, 1))
