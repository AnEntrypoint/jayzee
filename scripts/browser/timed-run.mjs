import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { mergeLoad, stampLoad } from './timed-result.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [phase, outPath, portArg = '8843'] = process.argv.slice(2)
if (!phase || !outPath) throw new TypeError('usage: node scripts/browser/timed-run.mjs <phase> <out.json> [port]')
const before = stampLoad()
const startedMs = Date.now()
const run = await runRenderWitness({ root, port: Number(portArg), query: 'phase=' + phase + '&tier=1024&timed=1' })
const after = stampLoad()
if (run.error) {
  console.log(JSON.stringify({ outPath, error: run.error }))
  process.exitCode = 1
} else {
  const text = JSON.stringify(mergeLoad(run.result, before, after))
  writeFileSync(outPath, text)
  console.log(JSON.stringify({ outPath, bytes: text.length, elapsedS: Math.round((Date.now() - startedMs) / 1000), backend: run.result.backend, adapter: run.result.adapter ? run.result.adapter.description : null }))
}
