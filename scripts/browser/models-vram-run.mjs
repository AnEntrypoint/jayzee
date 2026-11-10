import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = fileURLToPath(new URL('../..', import.meta.url))
const outPath = resolve(root, process.argv[2] ?? 'build/diag/models/vram.json')
const port = Number(process.argv[3] ?? '8843')
const SAMPLE_MS = 100
const MIB = 1024 * 1024
const DONE = '(() => { const r = window.vramResult; return r && r.done === true ? JSON.stringify(r) : null })()'

const samples = []
const sampleOnce = () => {
  const text = execFileSync('nvidia-smi', ['--query-gpu=memory.used', '--format=csv,noheader,nounits'], { encoding: 'utf8', timeout: 5000 })
  samples.push([Date.now(), Number(text.trim().split('\n')[0])])
}
const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  return sorted.length === 0 ? NaN : sorted[Math.floor(sorted.length / 2)]
}

const started = Date.now()
const sampler = setInterval(sampleOnce, SAMPLE_MS)
let run
try {
  sampleOnce()
  run = await runPageWitness({ root, port, pagePath: 'scripts/browser/models-vram.html', expression: DONE, timeoutMs: 900000, pollMs: 1000, record: false })
} finally {
  clearInterval(sampler)
}
const wallMs = Date.now() - started
const result = run.result ?? null
const rows = (result?.rows ?? []).map((row) => {
  if (row.skipped) return row
  const stageAt = (stage) => (result.log.find((e) => e.tier === row.tier && e.format === row.format && e.stage === stage) ?? {}).epochMs
  const idleStart = stageAt('idle')
  const allocating = stageAt('allocating')
  const held = stageAt('held')
  const freed = stageAt('freed')
  const idle = samples.filter(([t]) => t >= idleStart && t < allocating).map(([, used]) => used)
  const peak = samples.filter(([t]) => t >= held && t < freed).map(([, used]) => used)
  const baselineMiB = median(idle)
  const peakMiB = Math.max(...peak)
  const allocatedBytes = (peakMiB - baselineMiB) * MIB
  return { ...row, baselineMiB, peakMiB, nvidiaAllocatedBytes: allocatedBytes, withinBudget: row.plannedBytes <= row.budgetBytes, nvidiaWithinBudget: allocatedBytes <= row.budgetBytes }
})
const out = { wallMs, error: run.error ?? result?.error ?? null, adapter: result?.adapter ?? null, sampleMs: SAMPLE_MS, rows }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
if (out.error || rows.length === 0 || rows.some((row) => !row.skipped && row.outOfMemory)) process.exitCode = 1
