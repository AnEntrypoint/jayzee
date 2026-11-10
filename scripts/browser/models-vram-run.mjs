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
const CASES = [[0, 'bc7-rgba-unorm'], [0, 'rgba8unorm'], [1, 'bc7-rgba-unorm'], [1, 'rgba8unorm'], [2, 'bc7-rgba-unorm'], [2, 'rgba8unorm']]
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
const pages = []
try {
  sampleOnce()
  for (const [tier, format] of CASES) {
    const pageStarted = Date.now()
    const run = await runPageWitness({ root, port, pagePath: 'scripts/browser/models-vram.html?tier=' + tier + '&format=' + format, expression: DONE, timeoutMs: 300000, pollMs: 1000, record: false })
    pages.push({ tier, format, wallMs: Date.now() - pageStarted, error: run.error ?? run.result?.error ?? null, adapter: run.result?.adapter ?? null, row: run.result?.rows?.[0] ?? null, log: run.result?.log ?? [] })
  }
} finally {
  clearInterval(sampler)
}
const wallMs = Date.now() - started
const rows = pages.map((page) => {
  const row = page.row
  if (row === null) return { tier: page.tier, format: page.format, error: page.error }
  if (row.skipped) return row
  const stageAt = (stage) => (page.log.find((e) => e.stage === stage) ?? {}).epochMs
  const idle = samples.filter(([t]) => t >= stageAt('idle') && t < stageAt('allocating')).map(([, used]) => used)
  const peak = samples.filter(([t]) => t >= stageAt('held') && t < stageAt('freed')).map(([, used]) => used)
  const baselineMiB = median(idle)
  const peakMiB = Math.max(...peak)
  const allocatedBytes = (peakMiB - baselineMiB) * MIB
  return { ...row, pageWallMs: page.wallMs, baselineMiB, peakMiB, nvidiaAllocatedBytes: allocatedBytes, withinBudget: row.plannedBytes <= row.budgetBytes, nvidiaWithinBudget: allocatedBytes <= row.budgetBytes }
})
const out = { wallMs, sampleMs: SAMPLE_MS, adapter: pages.find((p) => p.adapter)?.adapter ?? null, errors: pages.filter((p) => p.error).map((p) => ({ tier: p.tier, format: p.format, error: p.error })), rows }
mkdirSync(dirname(outPath), { recursive: true })
writeFileSync(outPath, JSON.stringify(out, null, 1) + '\n')
console.log(JSON.stringify(out, null, 1))
if (out.errors.length > 0 || rows.some((row) => row.error || (!row.skipped && row.outOfMemory))) process.exitCode = 1
