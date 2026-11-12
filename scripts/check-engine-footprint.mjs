import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { glueUrl } from './lib/scenarioTiers.mjs'

const MIB = 1024 * 1024
const FIXED = 'engine/out/engine-core-64mib.mjs'
const THREADED = 'engine/out/engine-core-1024mib-threads.mjs'
const FIXED_WASM_LIMIT = 700000
const THREADED_WASM_LIMIT = 800000
const RESIDENT_LIMIT_MIB = 256
const WRITTEN_MIB = 512
const PREFAULT_MIB = 8
const CARVED_MIB = 1
const PLAN = { players: 1024, workers: 4, budgetBytes: 1024 * MIB }
const self = fileURLToPath(import.meta.url)

const residentMib = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024

if (process.argv[2] === 'prefault') {
  const { loadEngineModule } = await import('../src/engine/EngineWorld.js')
  const module = await loadEngineModule(glueUrl(FIXED))
  const before = residentMib()
  const first = module._engine_arena_prefault(PREFAULT_MIB * MIB)
  const after = residentMib()
  const again = module._engine_arena_prefault(PREFAULT_MIB * MIB)
  const carved = module._engine_arena_carve(CARVED_MIB * MIB, 64) !== 0
  const toppedUp = module._engine_arena_prefault(PREFAULT_MIB * MIB)
  module._engine_arena_seal()
  const sealed = module._engine_arena_prefault(2 * PREFAULT_MIB * MIB)
  process.stdout.write(JSON.stringify({ first, again, carved, toppedUp, sealed, addedMib: after - before }), () => process.exit(0))
} else if (process.argv[2] === 'child') {
  const { loadEngineModule, releaseEngineModule, resolvePlan } = await import('../src/engine/EngineWorld.js')
  const before = residentMib()
  const started = performance.now()
  const module = await loadEngineModule(glueUrl(THREADED), resolvePlan(PLAN))
  const loadMs = performance.now() - started
  if (process.argv[3] === 'write') module.HEAPU8.fill(1, module.HEAPU8.length - WRITTEN_MIB * MIB)
  const after = residentMib()
  await releaseEngineModule(module)
  process.stdout.write(JSON.stringify({ before, after, loadMs, memoryMib: module.HEAPU8.length / MIB }), () => process.exit(0))
} else {
  const child = (mode) => JSON.parse(execFileSync(process.execPath, [self, 'child', mode], { encoding: 'utf8' }))
  const wasmBytes = (glue) => statSync(new URL(glueUrl(glue).replace(/\.mjs$/, '.wasm'))).size

  gate('the fixed glue is under ' + FIXED_WASM_LIMIT + ' bytes and the threaded glue under ' + THREADED_WASM_LIMIT + ', where registering every Jolt type made them 1408976 and 1435581', () => {
    assert.ok(wasmBytes(FIXED) < FIXED_WASM_LIMIT, 'the fixed wasm is ' + wasmBytes(FIXED) + ' bytes')
    assert.ok(wasmBytes(THREADED) < THREADED_WASM_LIMIT, 'the threaded wasm is ' + wasmBytes(THREADED) + ' bytes')
  })

  gate('a threaded 1024 MiB instance adds under ' + RESIDENT_LIMIT_MIB + ' MiB of resident memory by the end of engine_init, so its arena is not written at load', () => {
    const run = child('load')
    assert.equal(run.memoryMib, 1024)
    assert.ok(run.after - run.before < RESIDENT_LIMIT_MIB, 'the instance added ' + Math.round(run.after - run.before) + ' MiB')
  })

  gate('control: the same instance with ' + WRITTEN_MIB + ' MiB of its memory written adds over ' + WRITTEN_MIB + ' MiB, so the measurement sees written pages', () => {
    const run = child('write')
    assert.ok(run.after - run.before > WRITTEN_MIB, 'a written instance added only ' + Math.round(run.after - run.before) + ' MiB')
  })

  gate('the arena prefault writes ' + PREFAULT_MIB + ' MiB ahead of the cursor once, nothing on a second call, only what a carve of ' + CARVED_MIB + ' MiB used up after it, and nothing once the arena is sealed', () => {
    const run = JSON.parse(execFileSync(process.execPath, [self, 'prefault'], { encoding: 'utf8' }))
    assert.equal(run.first, PREFAULT_MIB * MIB)
    assert.ok(run.addedMib > PREFAULT_MIB * 0.75 && run.addedMib < PREFAULT_MIB * 2, 'the prefault added ' + run.addedMib + ' MiB of resident memory')
    assert.equal(run.again, 0)
    assert.equal(run.carved, true)
    assert.ok(run.toppedUp >= CARVED_MIB * MIB && run.toppedUp < CARVED_MIB * MIB + 4096, 'the top-up wrote ' + run.toppedUp + ' bytes')
    assert.equal(run.sealed, 0)
  })

  finish()
}
