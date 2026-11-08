import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createEngineWorld, TREE_CLASS } from '../src/engine/EngineWorld.js'

const CELLS = 32
const CELL = 8
const ORIGIN = -128
const BALL = 0.35
const FOREST_STEPS = 256

let seed = 11
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const forestCentres = () => {
  const centres = []
  for (let iz = 0; iz < CELLS; iz++) {
    for (let ix = 0; ix < CELLS; ix++) centres.push([ORIGIN + ix * CELL + CELL / 2, ORIGIN + iz * CELL + CELL / 2])
  }
  return centres
}

const denseForest = async (gravity = -18) => {
  const world = await createEngineWorld({ capacity: 512, gravity })
  world.configureVegetation({ origin: ORIGIN, cellSize: CELL })
  for (const [x, z] of forestCentres()) world.placeTree([x, 0, z], 0, 1, TREE_CLASS.trunk)
  world.attachVegetation()
  return world
}

gate('a dense forest of 1024 trunks adds one vegetation body to the world', async () => {
  const world = await createEngineWorld({ capacity: 8 })
  const before = world.physicsBodies()
  world.configureVegetation({ origin: ORIGIN, cellSize: CELL })
  for (const [x, z] of forestCentres()) world.placeTree([x, 0, z], 0, 1, TREE_CLASS.trunk)
  assert.equal(world.vegetationPlaced(), CELLS * CELLS)
  assert.equal(world.physicsBodies(), before, 'placing trees adds no body before the attach')
  world.attachVegetation()
  assert.equal(world.physicsBodies(), before + 1)
})

gate('a sphere fired into a trunk is stopped by it', async () => {
  const world = await createEngineWorld({ capacity: 8, gravity: 0, drag: 0 })
  world.configureVegetation({ origin: -16, cellSize: CELL })
  world.placeTree([10, 0, 10], 0, 1, TREE_CLASS.trunk)
  world.attachVegetation()
  const handle = world.spawn([0, 3, 10], [6, 0, 0])
  for (let t = 0; t < 128; t++) world.step()
  assert.ok(world.position(handle)[0] < 9.6, 'the sphere passed the trunk at x ' + world.position(handle)[0])
})

gate('a sphere fired past a trunk, outside its reach, passes it (control)', async () => {
  const world = await createEngineWorld({ capacity: 8, gravity: 0, drag: 0 })
  world.configureVegetation({ origin: -16, cellSize: CELL })
  world.placeTree([10, 0, 10], 0, 1, TREE_CLASS.trunk)
  world.attachVegetation()
  const handle = world.spawn([0, 3, 13], [6, 0, 0])
  for (let t = 0; t < 128; t++) world.step()
  assert.ok(world.position(handle)[0] > 11, 'the control sphere stopped at x ' + world.position(handle)[0])
})

gate('a rock stops a sphere and a pass-through class does not', async () => {
  const rock = await createEngineWorld({ capacity: 8, gravity: 0, drag: 0 })
  rock.configureVegetation({ origin: -16, cellSize: CELL })
  rock.placeTree([10, 0, 10], 0, 1, TREE_CLASS.rock)
  rock.attachVegetation()
  const stopped = rock.spawn([0, 0.6, 10], [6, 0, 0])
  for (let t = 0; t < 128; t++) rock.step()
  assert.ok(rock.position(stopped)[0] < 9.3, 'the rock did not stop the sphere, x ' + rock.position(stopped)[0])

  const pass = await createEngineWorld({ capacity: 8, gravity: 0, drag: 0 })
  pass.configureVegetation({ origin: -16, cellSize: CELL })
  pass.placeTree([10, 0, 10], 0, 1, TREE_CLASS.pass)
  pass.attachVegetation()
  const through = pass.spawn([0, 0.6, 10], [6, 0, 0])
  for (let t = 0; t < 128; t++) pass.step()
  assert.ok(pass.position(through)[0] > 11, 'a pass-through instance stopped the sphere, x ' + pass.position(through)[0])
})

gate('spheres dropped into the forest rest on the ground and are never pushed below it', async () => {
  const world = await denseForest()
  const handles = []
  for (let i = 0; i < 40; i++) {
    const x = ORIGIN + random() * CELLS * CELL
    const z = ORIGIN + random() * CELLS * CELL
    handles.push(world.spawn([x, 4 + random() * 2, z]))
  }
  for (let t = 0; t < 512; t++) world.step()
  for (const handle of handles) {
    assert.ok(world.position(handle)[1] >= BALL - 0.05, 'a sphere is below the ground at y ' + world.position(handle)[1])
  }
})

gate('one vegetation body costs one physics body, one trunk body per tree costs one each', async () => {
  const field = await denseForest()
  const fieldBodies = field.physicsBodies()
  const legacy = await createEngineWorld({ capacity: 512 })
  for (const [x, z] of forestCentres()) legacy.addTrunk([x, 3, z], 0.4, 3)
  const legacyBodies = legacy.physicsBodies()
  assert.equal(fieldBodies, 2, 'ground plus one vegetation body')
  assert.equal(legacyBodies, 1 + CELLS * CELLS, 'ground plus one body per tree')

  const timed = async (world) => {
    const spawned = []
    for (let i = 0; i < 200; i++) spawned.push(world.spawn([ORIGIN + random() * CELLS * CELL, 5, ORIGIN + random() * CELLS * CELL]))
    const start = performance.now()
    for (let t = 0; t < FOREST_STEPS; t++) world.step()
    return performance.now() - start
  }
  const fieldMs = await timed(field)
  const legacyMs = await timed(legacy)
  console.log('cost over ' + FOREST_STEPS + ' ticks with 200 spheres: vegetation field ' + fieldMs.toFixed(2) + ' ms, one body per tree ' + legacyMs.toFixed(2) + ' ms')
  assert.ok(Number.isFinite(fieldMs) && Number.isFinite(legacyMs))
})

gate('a cell refuses a 33rd tree, and a placement outside the field is refused', async () => {
  const world = await createEngineWorld({ capacity: 8 })
  world.configureVegetation({ origin: ORIGIN, cellSize: CELL })
  for (let i = 0; i < 32; i++) world.placeTree([ORIGIN + 1, 0, ORIGIN + 1], 0, 1, TREE_CLASS.trunk)
  assert.throws(() => world.placeTree([ORIGIN + 1, 0, ORIGIN + 1], 0, 1, TREE_CLASS.trunk), RangeError)
  assert.throws(() => world.placeTree([ORIGIN - 1, 0, ORIGIN + 1], 0, 1, TREE_CLASS.trunk), RangeError)
  assert.throws(() => world.placeTree([ORIGIN + 1, 0, ORIGIN + 1], 0, 3, TREE_CLASS.trunk), RangeError)
})

finish()
