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
const PLAN = { players: 1024, workers: 4, budgetBytes: 1024 * MIB }
const SCENE_BODIES = 12288
const PLAN_BODIES = 131072
const POSE_ROW_BYTES = 28
const SCENE_SHARE_OF_PLAN = 0.35
const self = fileURLToPath(import.meta.url)

const residentMib = () => Number(/VmRSS:\s+(\d+)/.exec(readFileSync('/proc/self/status', 'utf8'))[1]) / 1024

if (process.argv[2] === 'configure') {
  const { loadEngineModule, releaseEngineModule, resolvePlan } = await import('../src/engine/EngineWorld.js')
  const module = await loadEngineModule(glueUrl(THREADED), resolvePlan(PLAN))
  const before = residentMib()
  const status = module._engine_world_configure(Number(process.argv[3]), 60, -9.8, 0, 0.5, 0, 4)
  const after = residentMib()
  const poseBytes = module._engine_pose_bytes()
  await releaseEngineModule(module)
  process.stdout.write(JSON.stringify({ status, addedMib: after - before, poseBytes }), () => process.exit(0))
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

  gate('a world configured for ' + SCENE_BODIES + ' bodies on the plan for ' + PLAN_BODIES + ' is sized to the ' + SCENE_BODIES + ': its resident cost is under ' + SCENE_SHARE_OF_PLAN + ' of the full plan and its pose buffer holds ' + SCENE_BODIES + ' rows', () => {
    const configured = (bodies) => JSON.parse(execFileSync(process.execPath, [self, 'configure', String(bodies)], { encoding: 'utf8' }))
    const scene = configured(SCENE_BODIES)
    const plan = configured(PLAN_BODIES)
    console.log('configure cost: ' + scene.addedMib.toFixed(1) + ' MiB for ' + SCENE_BODIES + ' bodies, ' + plan.addedMib.toFixed(1) + ' MiB for ' + PLAN_BODIES + '; pose bytes ' + scene.poseBytes + ' and ' + plan.poseBytes)
    assert.equal(scene.status, 0)
    assert.equal(plan.status, 0)
    assert.ok(scene.addedMib < SCENE_SHARE_OF_PLAN * plan.addedMib, 'the scene world added ' + scene.addedMib + ' MiB against ' + plan.addedMib + ' MiB for the plan')
    assert.equal(plan.poseBytes - scene.poseBytes, (PLAN_BODIES - SCENE_BODIES) * POSE_ROW_BYTES)
  })

  finish()
}
