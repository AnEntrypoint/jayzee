import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runPageWitness } from './page-witness.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const PORT = Number(process.env.PLAYER_WEBGPU_PORT || 8802)
const PAGE = process.argv[2] || process.env.PLAYER_WEBGPU_PAGE || 'scripts/browser/player-webgpu.html?r=1'
const TIMEOUT_MS = 90000
const RESULT_WITH_ADAPTER = `(async () => {
  const out = window.playerWebgpuResult
  if (!out) return null
  const adapter = navigator.gpu ? await navigator.gpu.requestAdapter() : null
  const info = adapter && adapter.info ? { vendor: adapter.info.vendor, architecture: adapter.info.architecture, description: adapter.info.description, isFallbackAdapter: adapter.info.isFallbackAdapter ?? adapter.isFallbackAdapter ?? null } : null
  return JSON.stringify({ gpu: !navigator.gpu ? 'no navigator.gpu' : adapter ? 'adapter' : 'no adapter', adapter: info, out })
})()`

const startedMs = Date.now()
const run = await runPageWitness({ root, port: PORT, pagePath: PAGE, expression: RESULT_WITH_ADAPTER, timeoutMs: TIMEOUT_MS })
const report = { page: PAGE, wallMs: Date.now() - startedMs, gpu: run.result ? run.result.gpu : null, adapter: run.result ? run.result.adapter : null, out: run.result ? run.result.out : null, errors: run.errors ?? [], error: run.error ?? null }
console.log(JSON.stringify(report, null, 1))
if (run.error || !report.out || !report.out.ok) process.exitCode = 1
