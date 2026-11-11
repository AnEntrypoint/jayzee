import assert from 'node:assert/strict'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createEngineWorld, loadEngineModule, resolvePlan } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { BODY_SPACING_M } from '../src/engine/sceneSetup.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue64 = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const glue128 = pathToFileURL(join(root, 'engine/out/engine-core-128mib.mjs')).href
const glue512 = pathToFileURL(join(root, 'engine/out/engine-core-512mib.mjs')).href
const MIB = 1024 * 1024

gate('a 64 MiB build given 1024 players and a 64 MiB budget runs the 64 tier and reports it', async () => {
  const plan = resolvePlan({ players: 1024, budgetBytes: 64 * MIB })
  const layout = readLayout(await loadEngineModule(glue64, plan))
  assert.equal(layout.players, 64)
  assert.equal(layout.bodies, 2048)
  assert.ok(layout.usedBytes <= 64 * MIB, 'the plan allocates above its budget: ' + layout.usedBytes)
})

gate('a 128 MiB build given 1024 players and a 128 MiB budget steps down to the 256 tier, since the 1024 tier needs more', async () => {
  const plan = resolvePlan({ players: 1024, budgetBytes: 128 * MIB })
  const layout = readLayout(await loadEngineModule(glue128, plan))
  assert.equal(layout.players, 256)
  assert.ok(layout.usedBytes <= 128 * MIB, 'the plan allocates above its budget: ' + layout.usedBytes)
})

gate('a 512 MiB build given 1024 players and a 512 MiB budget runs the 1024 tier with 12288 bodies', async () => {
  const plan = resolvePlan({ players: 1024, budgetBytes: 512 * MIB })
  const layout = readLayout(await loadEngineModule(glue512, plan))
  assert.equal(layout.players, 1024)
  assert.equal(layout.bodies, 12288)
  assert.ok(layout.usedBytes <= 512 * MIB, 'the plan allocates above its budget: ' + layout.usedBytes)
})

gate('a 128 MiB build given 1024 players and only a 64 MiB budget falls back to the 64 tier', async () => {
  const plan = resolvePlan({ players: 1024, budgetBytes: 64 * MIB })
  const layout = readLayout(await loadEngineModule(glue128, plan))
  assert.equal(layout.players, 64)
})

gate('the 1024 tier holds 12288 bodies: a full world spawns, steps and keeps its memory fixed', async () => {
  const world = await createEngineWorld({ players: 1024, budgetBytes: 512 * MIB, capacity: 12288, gravity: -9.8 }, glue512)
  const before = world.memoryBytes()
  const rows = Array.from({ length: 12288 }, (_, i) => ({ position: [(i % 128) * 2, 3 + (i % 7), Math.floor(i / 128) * 2], velocity: [0, 0, 0] }))
  const handles = world.spawnMany(rows)
  assert.equal(handles.length, 12288)
  assert.equal(world.count, 12288)
  for (let i = 0; i < 5; i++) world.step()
  assert.equal(world.count, 12288)
  assert.equal(world.memoryBytes(), before)
})

gate('the 1024 tier carves nothing from the arena after warm-up, with 12288 bodies settling', async () => {
  const world = await createEngineWorld({ players: 1024, budgetBytes: 512 * MIB, capacity: 12288, gravity: -9.8 }, glue512)
  const rows = Array.from({ length: 12288 }, (_, i) => ({ position: [(i % 100) * BODY_SPACING_M - 30, 1 + (i % 5), Math.floor(i / 100) * BODY_SPACING_M - 30], velocity: [0, 0, 0] }))
  world.spawnMany(rows)
  for (let i = 0; i < 60; i++) world.step()
  world.markWarmup()
  for (let i = 0; i < 300; i++) world.step()
  assert.equal(world.allocationsSinceWarmup(), 0)
})

gate('the 1024 tier refuses a world larger than its 12288 bodies', async () => {
  await assert.rejects(() => createEngineWorld({ players: 1024, budgetBytes: 512 * MIB, capacity: 12289 }, glue512), RangeError)
})

finish()
