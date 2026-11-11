import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { finish, gate } from './lib/gate.mjs'
import { BODY_SCENARIOS } from './lib/scenarioWorlds.mjs'

const execFileAsync = promisify(execFile)
const child = fileURLToPath(new URL('./lib/scenarioHashChild.mjs', import.meta.url))
const rootUrl = new URL('../', import.meta.url)
const reportDir = new URL('build/diag/scenarios/', rootUrl)
const MIB = 1024 * 1024
const WHOLE_SCENARIO = 1e9
const CONTROL_TICKS = 20
const CHARACTER_SCENARIOS = Object.freeze(['lockstep-rts', 'deathrun-pit', 'deathrun-early-pit', 'boss-fight-moving'])
const SCENARIOS = Object.freeze([...Object.keys(BODY_SCENARIOS), ...CHARACTER_SCENARIOS])
const THREAD_COUNTS = Object.freeze([2, 4])
const PAIRS = Object.freeze([
  { label: '512 MiB, 1024 players', players: 1024, budgetBytes: 512 * MIB, fixed: 'engine/out/engine-core-512mib.mjs', threaded: 'engine/out/engine-core-512mib-threads.mjs' },
  { label: '128 MiB, 256 players', players: 256, budgetBytes: 128 * MIB, fixed: 'engine/out/engine-core-128mib.mjs', threaded: 'engine/out/engine-core-128mib-threads.mjs' },
])

const engineExports = (glue) => [...new Set(readFileSync(new URL(glue, rootUrl), 'utf8').match(/_engine_[a-z0-9_]+/g))].sort()
const wasmDigest = (glue) => createHash('sha256').update(readFileSync(new URL(glue.replace(/\.mjs$/, '.wasm'), rootUrl))).digest('hex').slice(0, 8)

const runIsolated = async (pair, scenario, glue, workers, tickLimit) => {
  const args = [child, scenario, glue, String(workers), String(pair.players), String(pair.budgetBytes), String(tickLimit)]
  return JSON.parse((await execFileAsync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 20 })).stdout)
}

const report = []
for (const pair of PAIRS) {
  const scenarios = {}
  for (const scenario of SCENARIOS) {
    const fixedPending = Promise.all([runIsolated(pair, scenario, pair.fixed, 1, CONTROL_TICKS), runIsolated(pair, scenario, pair.fixed, 1, WHOLE_SCENARIO)])
    const threaded = []
    for (const workers of THREAD_COUNTS) threaded.push(await runIsolated(pair, scenario, pair.threaded, workers, WHOLE_SCENARIO))
    const [stoppedEarly, fixed] = await fixedPending
    scenarios[scenario] = { stoppedEarly, fixed, threaded }
  }
  report.push({ ...pair, fixedWasmSha256: wasmDigest(pair.fixed), threadedWasmSha256: wasmDigest(pair.threaded), scenarios })
}

for (const pair of report) {
  gate(pair.label + ': the fixed and the threaded glue export the same engine functions, so the two builds come from one source revision', () => {
    const fixed = engineExports(pair.fixed)
    const threaded = engineExports(pair.threaded)
    const onlyThreaded = threaded.filter((name) => !fixed.includes(name))
    const onlyFixed = fixed.filter((name) => !threaded.includes(name))
    assert.deepEqual({ onlyFixed, onlyThreaded }, { onlyFixed: [], onlyThreaded: [] }, 'rebuild both glues from one source: only in fixed [' + onlyFixed + '], only in threaded [' + onlyThreaded + ']')
  })
  for (const scenario of SCENARIOS) {
    const { stoppedEarly, fixed, threaded } = pair.scenarios[scenario]
    gate(pair.label + ': ' + scenario + ': the fixed build ran the whole scenario on the engine (' + fixed.ticks + ' ticks, ' + fixed.entities + ' bodies or characters followed, ' + fixed.trailPoints + ' hashed checkpoints)', () => {
      assert.equal(fixed.engineTick, fixed.ticks)
      assert.ok(fixed.trailPoints >= 4, 'only ' + fixed.trailPoints + ' checkpoints')
      assert.ok(fixed.first.every(Number.isFinite), 'non-finite first position')
    })
    threaded.forEach((run, at) => {
      gate(pair.label + ': ' + scenario + ': the threaded build at ' + THREAD_COUNTS[at] + ' workers equals the fixed build bit for bit: final position hash ' + fixed.hashes.position + ' and the ' + Object.keys(fixed.hashes).filter((key) => key !== 'position').join(', ') + ' hashes (trail is every 30-tick checkpoint)', () => {
        assert.equal(run.engineTick, fixed.engineTick)
        assert.deepEqual(run.hashes, fixed.hashes)
      })
    })
    gate(pair.label + ': ' + scenario + ': the fixed build stopped at tick ' + CONTROL_TICKS + ' gives a different position hash, so the hash follows the state', () => {
      assert.equal(stoppedEarly.engineTick, CONTROL_TICKS)
      assert.notEqual(stoppedEarly.hashes.position, fixed.hashes.position)
    })
  }
}

mkdirSync(reportDir, { recursive: true })
writeFileSync(new URL('determinism.json', reportDir), JSON.stringify({ threadCounts: THREAD_COUNTS, pairs: report }, null, 1) + '\n')

finish()
