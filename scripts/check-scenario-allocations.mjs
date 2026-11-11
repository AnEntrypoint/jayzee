import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { finish, gate } from './lib/gate.mjs'

const execFileAsync = promisify(execFile)
const child = fileURLToPath(new URL('./lib/scenarioAllocChild.mjs', import.meta.url))
const WARMUP_TICKS = 30000
const COUNTED_TICKS = 600
const LOOPS = Object.freeze([
  { name: 'settle', label: 'settle body loop (step, 256 position reads, 256 velocity reads, World#hashInto each tick)', moved: (before, after) => after.hash !== 0 },
  { name: 'lockstep-rts', label: 'lockstep RTS character loop (orders, steering for 8 units, step, engine state hash and game hash each tick)', moved: (before, after) => after.hash !== 0 },
  { name: 'boss-fight', label: 'boss fight loop with a moving target (chase, seeded player path, travelling shots, hits and boss attacks inside the counted ticks)', moved: (before, after) => after.shotsFired > before.shotsFired && after.shotsHit > before.shotsHit && after.bossAttacks > before.bossAttacks && after.waypointsReached > before.waypointsReached },
  { name: 'deathrun', label: 'deathrun loop shuttling over the surface checkpoints (steering, checkpoint reach and the kill-height test each tick, a lap inside the counted ticks)', moved: (before, after) => after.laps > before.laps && after.fallCount === 0 },
])
const SECOND_WORLD_LOOPS = Object.freeze(['boss-fight', 'deathrun'])

const SYNCHRONOUS_OPTIMISER = '--no-concurrent-recompilation'
const measure = async (name, worldsBefore) => JSON.parse((await execFileAsync(process.execPath, [SYNCHRONOUS_OPTIMISER, child, name, String(WARMUP_TICKS), String(COUNTED_TICKS), String(worldsBefore)], { encoding: 'utf8', maxBuffer: 1 << 22 })).stdout)

const runs = new Map()
for (const loop of LOOPS) runs.set(loop.name, await measure(loop.name, 0))
const secondWorld = []
for (const name of SECOND_WORLD_LOOPS) secondWorld.push(await measure(name, 1))

for (const loop of LOOPS) {
  const run = runs.get(loop.name)
  gate(loop.label + ': the counted ' + COUNTED_TICKS + ' ticks ran on the engine after ' + WARMUP_TICKS + ' warm-up ticks on the same world, the only world in its process', () => {
    assert.ok(run.before.engineTick >= WARMUP_TICKS - WARMUP_TICKS / 100, 'engine tick ' + run.before.engineTick + ' after warm-up')
    assert.ok(run.after.engineTick - run.before.engineTick >= COUNTED_TICKS - 10, 'engine ticks counted ' + (run.after.engineTick - run.before.engineTick))
    assert.equal(loop.moved(run.before, run.after), true, JSON.stringify({ before: run.before, after: run.after }))
  })
  gate(loop.label + ': EngineWorld, the bridge and the scenario loop allocate zero bytes over the counted ticks (heap sampled at every allocation)', () => {
    assert.equal(run.own, 0, 'allocated ' + run.own + ' bytes: ' + JSON.stringify(run.sites))
  })
  gate(loop.label + ': nothing called from the loop allocates either (the engine glue under it)', () => {
    assert.equal(run.inherited, 0, 'callees allocated ' + run.inherited + ' bytes: ' + JSON.stringify(run.sites))
  })
  gate(loop.label + ': the sampler attributes the control allocations to the measuring file, so the zero is not a blind sampler', () => {
    assert.equal(run.controlCount, COUNTED_TICKS)
    assert.ok(run.control > 0, 'the control allocation was not sampled')
  })
}

console.log(JSON.stringify({
  warmupTicks: WARMUP_TICKS,
  countedTicks: COUNTED_TICKS,
  loops: LOOPS.map((loop) => ({ name: loop.name, tier: runs.get(loop.name).tier, own: runs.get(loop.name).own, inherited: runs.get(loop.name).inherited, control: runs.get(loop.name).control, byFile: runs.get(loop.name).byFile })),
  afterAnEarlierWorldInTheSameProcess: secondWorld.map((run) => ({ name: run.name, own: run.own, inherited: run.inherited, bytesPerTick: (run.own + run.inherited) / COUNTED_TICKS, sites: run.sites })),
}))
finish()
