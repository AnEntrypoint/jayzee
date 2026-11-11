import { writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

export const RENDER_TIMEOUT_MS = 1200000
export const RENDER_PAGE = 'scripts/browser/engine-render.html'
const RENDER_POLL_MS = 2000
const RENDER_DONE = '(() => { const result = window.engineRenderResult; return result && result.done === true ? JSON.stringify(result) : null })()'

export const runRenderWitness = ({ root, port, query = 'phase=10&tier=1024&timed=1', live = [], debugPort, trace = false }) =>
  runPageWitness({ root, port, pagePath: RENDER_PAGE + '?' + query, expression: RENDER_DONE, timeoutMs: RENDER_TIMEOUT_MS, pollMs: RENDER_POLL_MS, record: false, trace, live, ...(debugPort === undefined ? {} : { debugPort }) })

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = fileURLToPath(new URL('../..', import.meta.url))
  const [outPath, portArg = '8843'] = process.argv.slice(2)
  if (!outPath) throw new TypeError('usage: node scripts/browser/render-witness.mjs <out.json> [port]')
  const run = await runRenderWitness({ root, port: Number(portArg) })
  const text = JSON.stringify(run.result ?? { error: run.error }, null, 1) + '\n'
  writeFileSync(outPath, text)
  console.log(text)
  if (run.error) process.exitCode = 1
}
