import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/decode-worker/run.json')
const port = Number(process.argv[3] ?? '8843')
const DONE = '(() => { const r = window.decodeWorkerResult; return r && r.done === true ? JSON.stringify(r) : null })()'

const started = Date.now()
const run = await runPageWitness({ root, port, pagePath: 'scripts/browser/decode-worker.html', expression: DONE, timeoutMs: 120000, pollMs: 500, record: false })
const wallMs = Date.now() - started
const result = run.result ?? { error: run.error ?? 'no result' }
const out = { wallMs, ...result }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
if (result.ok !== true || (result.errors ?? []).length > 0) process.exitCode = 1
