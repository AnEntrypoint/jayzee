import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { LAST_BODY_GENERATION, SLOT_BITS, SLOT_MASK, createEngineWorld } from '../src/engine/EngineWorld.js'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const glue = pathToFileURL(join(root, 'engine/out/engine-core-64mib.mjs')).href
const CYCLES = 10000

gate('the first spawns return handles 0, 1 and 2, so a fresh world keeps the phase 2 ids', async () => {
  const world = await createEngineWorld({ capacity: 8 }, glue)
  assert.deepEqual([world.spawn([0, 1, 0]), world.spawn([1, 1, 0]), world.spawn([2, 1, 0])], [0, 1, 2])
})

gate('a despawned slot is reused under a new generation, and the old handle is refused', async () => {
  const world = await createEngineWorld({ capacity: 8 }, glue)
  const first = world.spawn([0, 3, 0])
  world.despawn(first)
  const reused = world.spawn([0, 4, 0])
  assert.equal(reused, 1 << SLOT_BITS)
  assert.throws(() => world.despawn(first), RangeError)
  assert.throws(() => world.position(first), RangeError)
  assert.deepEqual(world.position(reused), [0, 4, 0])
})

gate('a slot retires at its last generation: its handles stay refused, and the slot is never reused', async () => {
  const world = await createEngineWorld({ capacity: 2 }, glue)
  let handle = world.spawn([0, 3, 0])
  const issued = []
  for (;;) {
    issued.push(handle)
    world.despawn(handle)
    if (world.retiredSlots > 0) break
    handle = world.spawn([0, 3, 0])
  }
  assert.equal(issued.length, LAST_BODY_GENERATION + 1)
  assert.equal(new Set(issued).size, LAST_BODY_GENERATION + 1)
  assert.equal(issued.at(-1) >>> SLOT_BITS, LAST_BODY_GENERATION)
  for (const old of issued) assert.throws(() => world.despawn(old), RangeError)
  const next = world.spawn([0, 3, 0])
  assert.equal(next & SLOT_MASK, 1)
  assert.equal(world.retiredSlots, 1)
  assert.equal(world.count, 1)
  assert.throws(() => world.spawn([0, 3, 0]), RangeError)
})

gate('despawn removes the body from the physics world, so the count and the snapshot drop with it', async () => {
  const world = await createEngineWorld({ capacity: 8 }, glue)
  world.spawn([0, 3, 0])
  const middle = world.spawn([1, 3, 0])
  world.spawn([2, 3, 0])
  world.despawn(middle)
  assert.equal(world.count, 2)
  assert.equal(world.snapshot().positions.length, 6)
  for (let i = 0; i < 10; i++) world.step()
  assert.equal(world.count, 2)
})

gate('spawnMany creates a batch in one call, returns the handles, and sets each position', async () => {
  const world = await createEngineWorld({ capacity: 64 }, glue)
  const rows = Array.from({ length: 50 }, (_, i) => ({ position: [i, 2, -i], velocity: [0, 0, 0] }))
  const handles = world.spawnMany(rows)
  assert.equal(handles.length, 50)
  assert.equal(world.count, 50)
  handles.forEach((handle, i) => assert.deepEqual(world.position(handle).map((v) => v + 0), [i, 2, -i + 0]))
})

gate('a world refuses a spawn past its capacity with a RangeError, as the JS world does', async () => {
  const world = await createEngineWorld({ capacity: 8 }, glue)
  world.spawnMany(Array.from({ length: 8 }, () => ({ position: [0, 3, 0] })))
  assert.throws(() => world.spawn([0, 3, 0]), RangeError)
  assert.throws(() => world.spawnMany([{ position: [0, 3, 0] }]), RangeError)
})

gate('after warmup, 10000 spawn and despawn cycles with ticks allocate nothing in the engine', async () => {
  const world = await createEngineWorld({ capacity: 512 }, glue)
  const warm = world.spawnMany(Array.from({ length: 256 }, (_, i) => ({ position: [i % 16, 6, Math.floor(i / 16)] })))
  for (let i = 0; i < 20; i++) world.step()
  warm.forEach((handle) => world.despawn(handle))
  for (let i = 0; i < 2; i++) world.step()
  world.markWarmup()
  for (let cycle = 0; cycle < CYCLES; cycle++) {
    const handle = world.spawn([(cycle % 9) - 4, 5 + (cycle % 3), (cycle % 7) - 3], [0, 0, 0])
    if (cycle % 3 === 0) world.step()
    world.despawn(handle)
    if (cycle % 500 === 0) {
      const batch = world.spawnMany(Array.from({ length: 4 }, (_, k) => ({ position: [k, 5, 0] })))
      world.step()
      batch.forEach((handle) => world.despawn(handle))
    }
  }
  assert.equal(world.count, 0)
  const allocations = world.allocationsSinceWarmup()
  assert.equal(allocations, 0, 'the engine allocated ' + allocations + ' blocks after warmup')
})

finish()
