import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const verdictPath = join(root, 'build/kaggle/verdict.json')

export const decide = (verdict, payloadSha256) => {
  if (verdict === null) return { ok: false, reason: 'no Kaggle regression verdict at build/kaggle/verdict.json' }
  if (verdict.payloadSha256 !== payloadSha256) return { ok: false, reason: 'the verdict is for payload ' + String(verdict.payloadSha256).slice(0, 12) + ' and this tree packs ' + payloadSha256.slice(0, 12) }
  if (verdict.ok !== true) return { ok: false, reason: 'the Kaggle regression run failed: ' + (verdict.failures ?? []).join('; ') }
  return { ok: true, reason: 'Kaggle run ' + verdict.version + ' passed for payload ' + payloadSha256.slice(0, 12) }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { BASELINE } = await import('./plan.mjs')
  const { ensureReference } = await import('./reference.mjs')
  ensureReference(BASELINE.referenceCommit)
  const packed = JSON.parse(execFileSync('node', [join(root, 'scripts/kaggle/pack.mjs'), 'regress', 'build/kaggle/gate'], { cwd: root, encoding: 'utf8' }).trim().split('\n').pop())
  const verdict = existsSync(verdictPath) ? JSON.parse(readFileSync(verdictPath, 'utf8')) : null
  const decision = decide(verdict, packed.payloadSha256)
  if (!decision.ok) {
    console.error('push refused: ' + decision.reason + '. Run: npm run kaggle:regress')
    process.exit(1)
  }
  console.log('push gate: ' + decision.reason)
}
