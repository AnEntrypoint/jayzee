import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'
import { mergeLoad, stampLoad } from './timed-result.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [outPath, portArg = '8847', framesArg = '1200'] = process.argv.slice(2)
if (!outPath) throw new TypeError('usage: node scripts/browser/planet-path-run.mjs <out.json> [port] [frames]')
const before = stampLoad()
const startedMs = Date.now()
const run = await runRenderWitness({ root, port: Number(portArg), query: 'phase=10&tier=64&timed=1&path=planet&frames=' + framesArg })
const after = stampLoad()
if (run.error) {
  console.log(JSON.stringify({ outPath, error: run.error }))
  process.exitCode = 1
} else {
  const text = JSON.stringify(mergeLoad(run.result, before, after))
  writeFileSync(outPath, text)
  console.log(JSON.stringify({ outPath, bytes: text.length, elapsedS: Math.round((Date.now() - startedMs) / 1000), backend: run.result.backend, frameTimeP99Ms: run.result.frameTimeP99Ms, restages: run.result.restages }))
  if (run.result.ok !== true) process.exitCode = 1
}
