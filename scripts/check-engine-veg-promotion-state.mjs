import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createEngineWorld, PROMOTED_BODY_GONE, TREE_CLASS } from '../src/engine/EngineWorld.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { TRANSFORM_STRIDE_FLOATS } from '../src/engine/sharedData.js'
import { VEG_HIDDEN_INSTANCES, createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'

const R = PLANET_RADIUS_M
const CELL = 8
const ORIGIN = -128
const PATCH_RADIUS_M = 100
const CAP_RAD = PATCH_RADIUS_M / R
const TREES_PER_KM2 = 2000
const CAPACITY = 128
const PATCH = 7
const OTHER_PATCH = 8
const MATCH_M = 0.05
const BALL_RADIUS = 0.5
const FIRE_SPEED = 10
const FIRE_HEIGHT = 2
const FIRE_BACK = 5
const FIRE_TICKS = 60
const AFTER_TICKS = 120
const CAP = 2
const SHOTS = 3
const BASIS = 12
const PASS_CLEARANCE = 3

const clock = () => { let t = 0; return () => (t += 1) }
const patchCentre = (id, out) => {
  out.latRad = Math.PI / 2 - (id - PATCH) * 0.01
  out.lonRad = 0
  out.capRad = CAP_RAD
  return out
}

const makePool = (hiddenCapacity) => {
  const pool = createVegetationPool({
    plan: planVegetationPool({ maxBufferBytes: 1e12, residentPatches: 2, capacityPerPatch: CAPACITY }),
    worldSeed: 42,
    heightAt: () => 0,
    patchCentre,
    densityOf: () => TREES_PER_KM2,
    now: clock(),
    generatePerFrame: CAPACITY * 2,
    cullRadiusM: PATCH_RADIUS_M,
    hiddenCapacity,
  })
  pool.sync([PATCH])
  pool.step()
  return pool
}

const treesOf = (pool) => {
  const slot = pool.slotOf(PATCH)
  const trees = []
  const w = [0, 0, 0]
  for (let i = 0; i < pool.generatedAt(slot); i++) {
    pool.readWorld(0, slot, i, w)
    trees.push([w[0], w[1] - R, w[2]])
  }
  return trees
}

const isolated = (trees) => {
  const picked = []
  for (let i = 0; i < trees.length && picked.length < SHOTS; i++) {
    const [x, , z] = trees[i]
    const clear = trees.every((t, j) => j === i || Math.abs(t[2] - z) > 2)
    const apart = picked.every((p) => Math.abs(trees[p][2] - z) > 4)
    if (clear && apart && Math.abs(x) < 90 && Math.abs(z) < 90) picked.push(i)
  }
  assert.equal(picked.length, SHOTS, 'the patch has ' + SHOTS + ' trees a sphere can reach along x')
  return picked
}

const makeWorld = async (trees) => {
  const world = await createEngineWorld({ capacity: 32, gravity: 0, drag: 0, radius: BALL_RADIUS })
  world.configureVegetation({ origin: ORIGIN, cellSize: CELL })
  for (const t of trees) world.placeTree([t[0], 0, t[2]], 0, 1, TREE_CLASS.trunk)
  world.attachVegetation()
  return world
}

const fireAt = (world, tree, height = FIRE_HEIGHT) => world.spawn([tree[0] - FIRE_BACK, height, tree[2]], [FIRE_SPEED, 0, 0])

const scene = async (cap) => {
  const pool = makePool()
  const trees = treesOf(pool)
  const targets = isolated(trees)
  const world = await makeWorld(trees)
  if (cap > 0) world.setVegetationPromotion(cap)
  const shots = targets.map((i) => fireAt(world, trees[i]))
  return { pool, trees, targets, world, shots }
}

const basisOf = (pool, slot, i) => Array.from(pool.buffers()[0][slot].subarray(i * TRANSFORM_STRIDE_FLOATS, i * TRANSFORM_STRIDE_FLOATS + BASIS))
const blank = (basis) => basis.every((v) => v === 0)

const promotedTree = (s, row = 0) => {
  const at = s.world.promotedVegetation()[row].position
  return [at[0], 0, at[2]]
}

const hidePromoted = (pool, world) => {
  const found = [0, 0, 0]
  const hidden = []
  for (const row of world.promotedVegetation()) {
    assert.ok(pool.nearest(row.position[0], row.position[1] + R, row.position[2], MATCH_M, found), 'no drawn instance within ' + MATCH_M + ' m of promoted instance ' + row.instance)
    assert.ok(pool.hide(found[0], found[1], found[2]))
    hidden.push(found[2])
  }
  return hidden
}

gate('a hidden instance has a zero basis so it rasterises nothing, the slot is marked for upload, and unhide restores its bytes exactly', () => {
  const pool = makePool()
  const slot = pool.slotOf(PATCH)
  const memory = pool.memory()
  const block = memory.block
  const before = Float32Array.from(pool.buffers()[0][slot])
  memory.dirty[slot] = 0
  assert.equal(pool.hide(0, slot, 3), true)
  assert.equal(pool.isHidden(0, slot, 3), true)
  assert.ok(blank(basisOf(pool, slot, 3)))
  assert.equal(memory.dirty[slot], 1)
  assert.equal(pool.counts()[0][slot], pool.generatedAt(slot), 'the shown count is unchanged, so the detail prefix is unchanged')
  for (let i = 0; i < pool.generatedAt(slot); i++) if (i !== 3) assert.deepEqual(basisOf(pool, slot, i), Array.from(before.subarray(i * 16, i * 16 + BASIS)))
  assert.equal(pool.stats().hidden, 1)
  memory.dirty[slot] = 0
  assert.equal(pool.unhide(0, slot, 3), true)
  assert.equal(memory.dirty[slot], 1)
  assert.deepEqual(pool.buffers()[0][slot], before)
  assert.equal(pool.stats().hidden, 0)
  assert.equal(pool.unhide(0, slot, 3), false)
  assert.equal(pool.memory().block, block, 'hiding allocates no new instance block')
  assert.throws(() => pool.hide(0, slot, pool.generatedAt(slot)), RangeError)
})

gate('a hidden instance stays hidden when its patch leaves and streams back, and the hidden table refuses past its fixed capacity instead of growing', () => {
  const pool = makePool(2)
  const slot = pool.slotOf(PATCH)
  const before = Float32Array.from(pool.buffers()[0][slot])
  pool.hide(0, slot, 5)
  pool.sync([OTHER_PATCH])
  pool.step()
  assert.equal(pool.slotOf(PATCH), undefined)
  pool.sync([PATCH, OTHER_PATCH])
  pool.step()
  const back = pool.slotOf(PATCH)
  assert.ok(blank(basisOf(pool, back, 5)), 'the regenerated patch drew the hidden instance again')
  assert.equal(pool.hide(0, back, 6), true)
  assert.equal(pool.hide(0, back, 7), false)
  assert.equal(pool.stats().hiddenRefused, 1)
  assert.ok(!blank(basisOf(pool, back, 7)))
  pool.unhideAll()
  assert.deepEqual(pool.buffers()[0][back], before)
  assert.equal(pool.stats().hidden, 0)
  assert.equal(VEG_HIDDEN_INSTANCES, 64, 'the default hidden table matches the engine cap of 64 promoted instances')
})

gate('promoted bodies join the world: the count, the positions, the hash and the saved state carry them, and each one hides exactly its drawn instance', async () => {
  const { pool, trees, targets, world, shots } = await scene(CAP)
  const hashBefore = world.hash()
  for (let t = 0; t < FIRE_TICKS; t++) world.step()
  const rows = world.promotedVegetation()
  assert.equal(rows.length, CAP)
  assert.equal(world.count, SHOTS + CAP)
  assert.notEqual(world.hash(), hashBefore)
  for (const row of rows) {
    assert.ok(row.alive)
    assert.equal(row.cls, TREE_CLASS.trunk)
    assert.ok(Number.isFinite(world.position(row.handle)[0]))
  }
  const hidden = hidePromoted(pool, world)
  assert.equal(new Set(hidden).size, CAP)
  assert.ok(hidden.every((i) => targets.includes(i)), 'a hidden instance is not one of the touched trees')
  const slot = pool.slotOf(PATCH)
  let drawn = 0
  for (let i = 0; i < trees.length; i++) if (!blank(basisOf(pool, slot, i))) drawn += 1
  assert.equal(drawn, trees.length - CAP)
  const state = world.exportState()
  assert.equal(state.count, SHOTS + CAP)
  assert.equal(state.positions.length, (SHOTS + CAP) * 3)
  assert.deepEqual(Array.from(state.promoted), [rows[0].instance, SHOTS, rows[1].instance, SHOTS + 1])
  assert.ok(shots.every((h) => Number.isFinite(world.position(h)[0])))
  world.restoreVegetation()
  pool.unhideAll()
  assert.equal(world.count, SHOTS)
  assert.equal(world.exportState().promoted, undefined)
  assert.equal(pool.stats().hidden, 0)
})

gate('a world with no promotion exports the same state shape as before, with no promoted list', async () => {
  const { world } = await scene(0)
  for (let t = 0; t < FIRE_TICKS; t++) world.step()
  assert.deepEqual(Object.keys(world.exportState()), ['tick', 'count', 'positions', 'velocities'])
  assert.equal(world.count, SHOTS)
})

gate('a saved state round-trips into a fresh world: the same instances are promoted, the hash and the re-exported state are equal, and both worlds then run to the same hash', async () => {
  const a = await scene(CAP)
  for (let t = 0; t < FIRE_TICKS; t++) a.world.step()
  const state = a.world.exportState()
  const b = await scene(0)
  assert.equal(b.world.count, SHOTS)
  b.world.importState(state)
  assert.equal(b.world.count, SHOTS + CAP)
  assert.equal(b.world.hash(), a.world.hash())
  assert.deepEqual(b.world.exportState(), state)
  assert.deepEqual(b.world.promotedVegetation().map((r) => r.instance), a.world.promotedVegetation().map((r) => r.instance))
  const tree = promotedTree(a)
  const through = [a, b].map((s) => fireAt(s.world, tree, 5))
  let equal = 0
  for (let t = 0; t < AFTER_TICKS; t++) {
    a.world.step()
    b.world.step()
    if (a.world.hash() === b.world.hash()) equal += 1
  }
  assert.ok(a.world.position(through[0])[0] > tree[0] + PASS_CLEARANCE, 'the saved world stopped a sphere at a promoted trunk')
  assert.ok(b.world.position(through[1])[0] > tree[0] + PASS_CLEARANCE, 'the restored world stopped a sphere at a trunk that was promoted in the saved state')
  assert.equal(equal, AFTER_TICKS, 'the two worlds agreed on ' + equal + ' of ' + AFTER_TICKS + ' ticks after the restore')
})

gate('a rollback inside one world keeps the promoted handles: importing its own earlier state restores the hash without re-promoting', async () => {
  const { world } = await scene(CAP)
  for (let t = 0; t < FIRE_TICKS; t++) world.step()
  const rows = world.promotedVegetation()
  const state = world.exportState()
  const hash = world.hash()
  for (let t = 0; t < 30; t++) world.step()
  world.importState(state)
  assert.equal(world.hash(), hash)
  assert.deepEqual(world.promotedVegetation(), rows)
  assert.equal(world.tick, state.tick)
})

gate('importing a state with no promoted list into a world that holds promotions returns those trunks to the static shape', async () => {
  const fresh = await scene(0)
  const plain = fresh.world.exportState()
  const { world, trees, targets } = await scene(CAP)
  for (let t = 0; t < FIRE_TICKS; t++) world.step()
  assert.equal(world.count, SHOTS + CAP)
  world.setVegetationPromotion(0)
  world.importState(plain)
  assert.equal(world.count, SHOTS)
  assert.equal(world.promotedVegetation().length, 0)
  const again = targets.map((i) => fireAt(world, trees[i], 5))
  for (let t = 0; t < FIRE_TICKS; t++) world.step()
  again.forEach((h, k) => assert.ok(world.position(h)[0] < trees[targets[k]][0], 'a restored trunk did not stop its sphere'))
})

gate('a promoted body that was despawned is saved as gone: the restored world keeps the trunk out of the static shape and adds no body for it', async () => {
  const a = await scene(CAP)
  for (let t = 0; t < FIRE_TICKS; t++) a.world.step()
  a.world.despawn(a.world.promotedVegetation()[0].handle)
  const state = a.world.exportState()
  assert.equal(state.promoted[1], PROMOTED_BODY_GONE)
  assert.equal(state.count, SHOTS + CAP - 1)
  const b = await scene(0)
  b.world.importState(state)
  assert.equal(b.world.count, SHOTS + CAP - 1)
  assert.deepEqual(b.world.exportState(), state)
  assert.equal(b.world.promotedVegetation()[0].alive, false)
  const tree = promotedTree(b)
  const through = fireAt(b.world, tree, 5)
  for (let t = 0; t < FIRE_TICKS; t++) b.world.step()
  assert.ok(b.world.position(through)[0] > tree[0] + PASS_CLEARANCE)
})

gate('restoring promotions after warm-up carves nothing from the arena and no allocation fails', async () => {
  const a = await scene(CAP)
  for (let t = 0; t < FIRE_TICKS; t++) a.world.step()
  const state = a.world.exportState()
  const b = await scene(0)
  b.world.markWarmup()
  b.world.importState(state)
  for (let t = 0; t < FIRE_TICKS; t++) b.world.step()
  assert.equal(b.world.allocationsSinceWarmup(), 0)
  assert.equal(b.world.allocationFailures(), 0)
})

finish()
