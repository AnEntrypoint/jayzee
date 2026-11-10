import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [outPath, portArg = '8846'] = process.argv.slice(2)
if (!outPath) throw new TypeError('usage: node scripts/browser/threads-run.mjs <out.json> [port]')
const DONE = '(() => { const r = window.engineThreadsResult; return r && r.done ? JSON.stringify(r) : null })()'
const run = await runPageWitness({ root, port: Number(portArg), pagePath: 'scripts/browser/engine-threads.html', expression: DONE, timeoutMs: 600000, record: true })
if (run.error) {
  console.log(JSON.stringify({ error: run.error }))
  process.exitCode = 1
} else {
  writeFileSync(outPath, JSON.stringify(run.result, null, 1) + '\n')
  console.log(JSON.stringify(run.result))
  if (run.result.ok !== true) process.exitCode = 1
}
