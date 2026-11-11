import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { loadavg } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RUN_TIMEOUT_MS = 900000
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const [config, maxRunsText = '25', outText] = process.argv.slice(2)
if (!config) {
  console.error('usage: node scripts/browser/planet-hunt.mjs <tier-backend, e.g. 64-webgl2> [max runs] [out dir]')
  process.exit(2)
}
const maxRuns = Number(maxRunsText)
if (!Number.isInteger(maxRuns) || maxRuns < 1) throw new RangeError('max runs must be a whole number of at least 1')
const outDir = resolve(root, outText ?? join('build', 'diag', 'hunt-' + config))
mkdirSync(outDir, { recursive: true })

const runs = []
let captured = null
for (let n = 1; n <= maxRuns && captured === null; n++) {
  const dir = join(outDir, 'run-' + n)
  const load1 = loadavg()[0]
  const started = Date.now()
  const child = spawnSync(process.execPath, [join(root, 'scripts', 'browser', 'planet-witness-run.mjs'), dir], { cwd: root, env: { ...process.env, PLANET_ONLY: config }, encoding: 'utf8', timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 26 })
  writeFileSync(dir + '.log', (child.stdout ?? '') + (child.stderr ?? ''))
  const dumps = existsSync(join(dir, 'dumps')) ? readdirSync(join(dir, 'dumps')) : []
  const record = existsSync(join(dir, config + '.json')) ? JSON.parse(readFileSync(join(dir, config + '.json'), 'utf8')) : null
  const row = { run: n, exit: child.status, timedOut: child.error?.code === 'ETIMEDOUT', wallMs: Date.now() - started, load1Before: load1, ok: record?.verdict?.ok ?? null, failures: record?.verdict?.failures ?? null, frameCases: record?.frameCases?.length ?? null, workerTick: record?.result?.workerTick ?? null, dumps }
  runs.push(row)
  console.log(JSON.stringify(row))
  if (dumps.length > 0) captured = { run: n, dump: join(dir, 'dumps', dumps[0]) }
}
const summary = { config, maxRuns, runs: runs.length, clean: runs.filter((row) => row.dumps.length === 0 && row.exit === 0).length, captured }
writeFileSync(join(outDir, 'hunt.json'), JSON.stringify({ summary, runs }, null, 1) + '\n')
console.log('HUNT ' + JSON.stringify(summary))
