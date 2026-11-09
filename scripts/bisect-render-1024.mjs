import { execFileSync, spawnSync } from 'node:child_process'
import { runRenderWitness, stopChild } from './browser/render-witness.mjs'
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
const scene = flag('scene', '')
const SCENE_FILE = 'scripts/browser/engine-render-browser.js'
const playwrightCore = process.env.PLAYWRIGHT_CORE
if (!playwrightCore) throw new TypeError('PLAYWRIGHT_CORE must name the playwright-core index.mjs')
const pageUrl = 'http://127.0.0.1:' + port + '/scripts/browser/engine-render.html?phase=10&tier=1024&timed=1'

const git = (gitArgs) => execFileSync('git', gitArgs, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
const live = []
const kill = (child) => stopChild(child, live)
const original = git(['rev-parse', '--abbrev-ref', 'HEAD'])
if (original === 'HEAD') throw new Error('the shared checkout is detached; check out a branch before the bisect')
const restore = () => {
  try {
    git(['checkout', 'HEAD', '--', SCENE_FILE])
    git(['checkout', '--quiet', original])
  } catch (error) {
    console.error('could not restore ' + original + ': ' + error.message)
  }
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
  git(['checkout', 'HEAD', '--', SCENE_FILE])
  git(['checkout', '--detach', '--quiet', sha])
  if (scene) git(['checkout', scene, '--', SCENE_FILE])
  const run = spawnSync('bash', [join(root, 'engine', 'build.sh')], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, ENGINE_VARIANT: 'timed', ENGINE_TIER_MIB: '128' } })
  if (run.status !== 0) return { error: 'engine build exit ' + run.status, tail: (run.stderr + run.stdout).slice(-800) }
  return { wasmSha256: run.stdout.trim().split('\n').pop().split(/\s+/)[0] }
}

const witness = () => runRenderWitness({ root, port, debugPort, profile, pageUrl, playwrightCore, live })

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
    const row = Object.assign({ sha, short, label, scene: scene || null }, record)
    records.push(row)
    writeFileSync(join(outDir, short + '.json'), JSON.stringify(row, null, 1))
    const shown = row.error ? 'ERROR ' + row.error : 'checksum=' + row.checksum + ' visible=' + JSON.stringify(row.visible) + ' ok=' + row.ok + ' backend=' + row.backend
    console.log(short + ' ' + label + ' | ' + shown)
  }
} finally {
  stopAll()
}
writeFileSync(join(outDir, 'summary.json'), JSON.stringify(records.map((row) => Object.fromEntries(Object.entries(row).filter(([key]) => key !== 'result'))), null, 1))
