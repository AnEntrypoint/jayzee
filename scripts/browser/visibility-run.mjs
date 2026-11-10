import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/visibility/run.json')
const port = Number(process.argv[3] ?? '8843')
const backend = process.argv[4] ?? 'webgpu'
if (backend !== 'webgpu' && backend !== 'webgl2') throw new RangeError('backend must be webgpu or webgl2')
const flags = process.argv.slice(5)
for (const flag of flags) if (flag !== 'dump' && flag !== 'occluded') throw new RangeError('unknown flag ' + flag)
const DONE = '(() => { const r = window.visibilityResult; return r && r.done === true ? JSON.stringify(r) : null })()'

const query = ['backend=' + backend]
if (flags.includes('dump')) query.push('dump=1')
if (flags.includes('occluded')) query.push('scene=occluded')
const started = Date.now()
const run = await runPageWitness({ root, port, pagePath: 'scripts/browser/visibility.html?' + query.join('&'), expression: DONE, timeoutMs: 300000, pollMs: 1000, record: false })
const wallMs = Date.now() - started
const result = run.result ?? null
const out = { wallMs, error: run.error ?? result?.error ?? null, result }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify({ wallMs, error: out.error, ok: result?.ok ?? false, scene: result?.scene ?? null, totals: result?.totals ?? null, configs: result?.configs ?? null, comparisons: result?.comparisons ?? null }, null, 1))
if (out.error || result?.ok !== true) process.exitCode = 1
