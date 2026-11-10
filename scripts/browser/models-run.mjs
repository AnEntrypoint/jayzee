import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runRenderWitness } from './render-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/models/run.json')
const port = Number(process.argv[3] ?? '8843')
const frames = Number(process.argv[4] ?? '600')
if (!Number.isInteger(frames) || frames < 200) throw new RangeError('frames must be a whole number of at least 200')
const query = 'phase=10&tier=64&timed=1&models=1&frames=' + frames
const started = Date.now()
const run = await runRenderWitness({ root, port, query })
const wallMs = Date.now() - started
const out = { query, wallMs, error: run.error ?? null, result: run.result ?? null }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify({ wallMs, error: out.error, models: out.result?.models ?? null }, null, 1))
if (run.error || !out.result?.models?.ok) process.exitCode = 1
