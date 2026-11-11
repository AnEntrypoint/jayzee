import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { BatchBeyondRebaseError, createEngineWorld, loadEngineModule } from '../src/engine/EngineWorld.js'
import { readLayout } from '../src/engine/bridge.js'
import { solverIterationsFor } from '../src/engine/solverIterations.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { RENDER_COLLISION_TOLERANCE_M } from '../src/engine/cameraRelative.js'
import { PHYSICS_REBASE_M } from '../src/engine/physicsOrigin.js'

const R = PLANET_RADIUS_M
const OPTIONS = Object.freeze({ capacity: 16, tickRate: 60, gravity: 0, drag: 0, radius: 0.5, restitution: 0 })
const NEAR = Object.freeze([0.3, 3.7, 0.1])
const AT_RADIUS = Object.freeze([0.3, R + 2.3, 0.1])
const errorOf = (p, truth) => Math.max(Math.abs(p[0] - truth[0]), Math.abs(p[1] - truth[1]), Math.abs(p[2] - truth[2]))

const rawBatch = async (rows) => {
  const module = await loadEngineModule()
  const layout = readLayout(module)
  const status = module._engine_world_configure(OPTIONS.capacity, OPTIONS.tickRate, OPTIONS.gravity, OPTIONS.drag, OPTIONS.radius, OPTIONS.restitution, solverIterationsFor(layout.players))
  assert.equal(status, 0)
  const stage = new Float64Array(module.HEAPF64.buffer, layout.regions.stageRows, rows.length * 6)
  rows.forEach((row, i) => stage.set([row[0], row[1], row[2], 0, 0, 0], i * 6))
  assert.ok(module._engine_spawn_batch(rows.length) >= 0)
  const handles = new Uint32Array(module.HEAPU32.buffer, layout.regions.stageHandles, rows.length)
  const positions = new Float64Array(module.HEAPF64.buffer, layout.regions.positions, layout.bodies * 3)
  return rows.map((row, i) => {
    const base = (handles[i] & 0xffff) * 3
    return errorOf([positions[base], positions[base + 1], positions[base + 2]], row)
  })
}

gate('control: the engine alone, given a batch whose second row is at planet radius, stores that row more than 0.1 m from where it was placed', async () => {
  const errors = await rawBatch([NEAR, AT_RADIUS])
  console.log('raw batch ' + JSON.stringify({ rowErrorsM: errors }))
  assert.ok(errors[0] <= RENDER_COLLISION_TOLERANCE_M, 'row 0 error ' + errors[0] + ' m')
  assert.ok(errors[1] > 0.1, 'row 1 error ' + errors[1] + ' m, so the control does not show the misuse')
})

gate('misuse: spawnMany refuses a row more than ' + PHYSICS_REBASE_M + ' m from row 0 with BatchBeyondRebaseError, and spawns nothing', async () => {
  const world = await createEngineWorld(OPTIONS)
  const rebases = world.rebaseCount
  let caught = null
  try {
    world.spawnMany([{ position: NEAR }, { position: [5, 3, 5] }, { position: AT_RADIUS }])
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof BatchBeyondRebaseError)
  assert.ok(caught instanceof RangeError)
  assert.equal(caught.code, 'batch-beyond-rebase')
  assert.equal(caught.row, 2)
  assert.equal(caught.limitM, PHYSICS_REBASE_M)
  assert.ok(Math.abs(caught.distanceM - (R - 1.4)) < 1e-6, 'distance ' + caught.distanceM)
  assert.equal(world.count, 0)
  assert.equal(world.rebaseCount, rebases)
  assert.throws(() => world.spawnMany([{ position: [0, 0, 0] }, { position: [PHYSICS_REBASE_M + 0.001, 0, 0] }]), BatchBeyondRebaseError)
  assert.equal(world.count, 0)
})

gate('correct use: a batch whose rows are all within ' + PHYSICS_REBASE_M + ' m of row 0 spawns at planet radius with no follow call, and every row is within ' + RENDER_COLLISION_TOLERANCE_M + ' m of its placement', async () => {
  const world = await createEngineWorld(OPTIONS)
  const rows = [AT_RADIUS, [700.7, R + 1.1, -300.3], [-600.2, R + 0.7, 410.9], [0.3 + PHYSICS_REBASE_M, R + 2.3, 0.1]].map((position) => ({ position }))
  const handles = world.spawnMany(rows)
  assert.equal(handles.length, 4)
  const worst = Math.max(...handles.map((h, i) => errorOf(world.position(h), rows[i].position)))
  console.log('batch at radius ' + JSON.stringify({ worstErrorM: worst, rebases: world.rebaseCount }))
  assert.ok(worst <= RENDER_COLLISION_TOLERANCE_M, 'worst row error ' + worst + ' m')
  assert.equal(world.rebaseCount, 1)
  assert.deepEqual(world.spawnMany([]), [])
  assert.equal(world.spawnMany([{ position: [0.3, R + 5, 0.1] }]).length, 1)
})

gate('correct use: single spawns and setPosition at planet radius need no follow call, because the engine follows each placement', async () => {
  const world = await createEngineWorld(OPTIONS)
  const a = world.spawn(NEAR)
  const b = world.spawn(AT_RADIUS)
  assert.ok(errorOf(world.position(b), AT_RADIUS) <= RENDER_COLLISION_TOLERANCE_M)
  assert.equal(world.rebaseCount, 1)
  const far = [1500.5, R + 9.25, -2200.75]
  world.setPosition(a, far)
  assert.ok(errorOf(world.position(a), far) <= RENDER_COLLISION_TOLERANCE_M)
  assert.equal(world.rebaseCount, 2)
  world.follow(AT_RADIUS)
  assert.equal(world.rebaseCount, 3)
  const again = world.spawnMany([{ position: AT_RADIUS }, { position: [10, R + 2, 10] }])
  assert.equal(again.length, 2)
  assert.equal(world.count, 4)
})

finish()
