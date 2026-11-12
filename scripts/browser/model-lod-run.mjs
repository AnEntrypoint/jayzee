import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { projectDebugPort, runPageWitness } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/model-lod/run.json')
const port = Number(process.argv[3] ?? '8846')
const backend = process.argv[4] ?? 'webgpu'
if (backend !== 'webgpu' && backend !== 'webgl2') throw new RangeError('backend must be webgpu or webgl2')
const debugPort = process.env.ENGINE_DEBUG_PORT ? Number(process.env.ENGINE_DEBUG_PORT) : projectDebugPort(root)
const DONE = '(() => { const r = window.modelLodResult; return r && r.done === true ? JSON.stringify(r) : null })()'

const run = await runPageWitness({ root, port, pagePath: 'scripts/browser/model-lod.html?backend=' + backend, expression: DONE, timeoutMs: 300000, pollMs: 1000, record: false, debugPort })
const result = run.result ?? null
const out = { error: run.error ?? result?.error ?? null, result }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify({ error: out.error, ok: result?.ok ?? false, backend: result?.backend ?? null, path: result?.effectivePath ?? null, steps: (result?.steps ?? []).map((s) => ({ name: s.name, ok: s.ok, drawnClusters: s.drawnClusters, cost: s.cost, bias: s.bias, shed: s.shed, levels: s.levels.join('') })) }, null, 1))
console.log(out.error || result?.ok !== true ? 'RESULT: FAIL' : 'RESULT: PASS')
if (out.error || result?.ok !== true) process.exitCode = 1
