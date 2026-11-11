import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { finish, gate } from './lib/gate.mjs'
import { Quadtree, localToDeformed } from '../src/packages/mapspinner/quadtree.js'
import { FACE_FRAME, worldToFaceLocal } from '../src/terrain-pure/cubeSphereCells.js'
import { PLANET_RADIUS_M } from '../src/engine/sphere.js'
import { capAreaKm2 } from '../src/engine/population.js'
import { densityFor } from '../src/engine/populationDensity.js'
import { createVegetationPool, planVegetationPool } from '../src/engine/vegetation.js'
import { MAX_PATCH_LEVEL, PATCH_FACES, PATCH_IDS_PER_FACE, createLeafPatchCentre, leafPatchId, leafPatchIds, patchLeaf, vegetationLevelFor } from '../src/engine/vegetationPatches.js'

const R = PLANET_RADIUS_M
const CAPACITY = 1024
const FACE = 2
const SPAN_LEAVES = 3
const CAMERA = Object.freeze([123456.7, -98765.4])
const GROUND_ALTITUDE_M = 2
const HIGH_ALTITUDE_M = 50000
const SLOTS = 256
const DENSITY = densityFor('trees')
const LEVEL = vegetationLevelFor({ capacityPerPatch: CAPACITY, densityPerKm2: DENSITY })
const LEAF_M = (2 * R) / 2 ** LEVEL
const centreOf = createLeafPatchCentre()

const makeTree = (floorM = LEAF_M) => {
  const tree = new Quadtree(R)
  tree.setNearFieldLeafFloor(floorM, SPAN_LEAVES)
  return tree
}

const planIds = (tree, camX, camY, altitudeM, level = LEVEL) => {
  const leaves = tree.updateQuadtree(camX, camY, altitudeM, camX, camY, undefined, undefined, altitudeM)
  const out = []
  const count = leafPatchIds(FACE, leaves, level, out)
  return { ids: out.slice(0, count), leaves: leaves.length, finest: Math.max(...leaves.map((leaf) => leaf.level)) }
}

const worldOfFaceLocal = (face, ox, oy) => {
  const p = localToDeformed(ox, oy, 0, R)
  const F = FACE_FRAME[face]
  return [0, 1, 2].map((k) => F.u[k] * p[0] + F.v[k] * p[1] + F.c[k] * p[2])
}

const directionOf = (centre) => {
  const cl = Math.cos(centre.latRad)
  return [cl * Math.sin(centre.lonRad), Math.sin(centre.latRad), cl * Math.cos(centre.lonRad)]
}

const angleBetween = (a, b) => {
  const cx = a[1] * b[2] - a[2] * b[1]
  const cy = a[2] * b[0] - a[0] * b[2]
  const cz = a[0] * b[1] - a[1] * b[0]
  return Math.atan2(Math.hypot(cx, cy, cz), a[0] * b[0] + a[1] * b[1] + a[2] * b[2])
}

const makePool = () => createVegetationPool({
  plan: planVegetationPool({ maxBufferBytes: 1e12, residentPatches: SLOTS, capacityPerPatch: CAPACITY }),
  worldSeed: 9,
  heightAt: () => 0,
  patchCentre: centreOf,
  now: (() => { let t = 0; return () => (t += 1) })(),
  cullRadiusM: LEAF_M,
})

const settle = (pool) => {
  while (pool.stats().pending > 0) pool.step()
}

const patchDigest = (pool, id) => {
  const slot = pool.slotOf(id)
  const count = pool.counts()[0][slot]
  const view = pool.buffers()[0][slot].subarray(0, count * 16)
  return createHash('sha256').update(new Uint8Array(view.buffer, view.byteOffset, view.byteLength)).digest('hex')
}

gate('the patch level is the coarsest whose leaf holds the tree density within 1024 instances, on every face, at the face centre, an edge and a corner', () => {
  assert.equal(LEVEL, 17)
  const side = 2 ** LEVEL
  let worst = 0
  for (let face = 0; face < PATCH_FACES; face++) {
    for (const [tx, ty] of [[side / 2, side / 2], [side / 2 - 1, side / 2 - 1], [0, side / 2], [side - 1, side / 2], [side / 2, 0], [0, 0], [side - 1, side - 1], [side / 4, side / 4]]) {
      const count = Math.round(DENSITY * capAreaKm2(centreOf(leafPatchId(face, LEVEL, tx, ty)).capRad))
      assert.ok(count <= CAPACITY, 'face ' + face + ' leaf ' + tx + ',' + ty + ' needs ' + count)
      if (count > worst) worst = count
    }
  }
  const coarser = Math.round(DENSITY * capAreaKm2(centreOf(leafPatchId(0, LEVEL - 1, side / 4, side / 4)).capRad))
  assert.ok(coarser > CAPACITY, 'control: one level coarser must not fit, it needs ' + coarser)
  console.log('patch level ' + LEVEL + ', leaf ' + LEAF_M.toFixed(3) + ' m on the face, worst sampled leaf ' + worst + ' instances, one level coarser ' + coarser)
})

gate('a leaf has one id and an id has one leaf: every node of levels 0 to 5 on six faces round-trips, and no two share an id', () => {
  const seen = new Set()
  let nodes = 0
  for (let face = 0; face < PATCH_FACES; face++) {
    for (let level = 0; level <= 5; level++) {
      for (let ty = 0; ty < 2 ** level; ty++) {
        for (let tx = 0; tx < 2 ** level; tx++) {
          const id = leafPatchId(face, level, tx, ty)
          assert.deepEqual(patchLeaf(id), { face, level, tx, ty })
          seen.add(id)
          nodes += 1
        }
      }
    }
  }
  assert.equal(seen.size, nodes)
  assert.equal(nodes, PATCH_FACES * 1365)
})

gate('the id range ends inside the safe integers, the deepest corner leaf round-trips, and a bad face, level, cell or id is refused', () => {
  const last = 2 ** MAX_PATCH_LEVEL - 1
  const top = leafPatchId(PATCH_FACES - 1, MAX_PATCH_LEVEL, last, last)
  assert.equal(top, PATCH_FACES * PATCH_IDS_PER_FACE - 1)
  assert.equal(top, Number.MAX_SAFE_INTEGER - 2)
  assert.deepEqual(patchLeaf(top), { face: PATCH_FACES - 1, level: MAX_PATCH_LEVEL, tx: last, ty: last })
  assert.deepEqual(patchLeaf(leafPatchId(3, LEVEL, 70000, 12345)), { face: 3, level: LEVEL, tx: 70000, ty: 12345 })
  assert.ok(leafPatchId(0, LEVEL, 0, 0) > 2 ** 32, 'control: a level 17 id is past 32 bits')
  assert.throws(() => leafPatchId(PATCH_FACES, 0, 0, 0), RangeError)
  assert.throws(() => leafPatchId(0, MAX_PATCH_LEVEL + 1, 0, 0), RangeError)
  assert.throws(() => leafPatchId(0, 2, 4, 0), RangeError)
  assert.throws(() => leafPatchId(0, 2, 0, -1), RangeError)
  assert.throws(() => leafPatchId(0, 2, 0.5, 0), RangeError)
  assert.throws(() => patchLeaf(top + 1), RangeError)
  assert.throws(() => patchLeaf(-1), RangeError)
})

gate('the same quadtree leaves give the same patch ids, in the same order, and the ids of one plan are all different', () => {
  const tree = makeTree()
  const a = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  const b = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  const fresh = planIds(makeTree(), CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  assert.ok(a.ids.length >= 9, 'control: the plan holds patches around the camera, it holds ' + a.ids.length)
  assert.ok(a.ids.length <= SLOTS)
  assert.deepEqual(b.ids, a.ids)
  assert.deepEqual(fresh.ids, a.ids)
  assert.equal(new Set(a.ids).size, a.ids.length)
  assert.equal(a.finest, LEVEL)
  console.log('plan at the ground: ' + a.leaves + ' quadtree leaves, ' + a.ids.length + ' vegetation patches at level ' + LEVEL)
})

gate('neighbouring leaves have different ids, and each patch centre lies in its own leaf and in no neighbour', () => {
  const tree = makeTree()
  const { ids } = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  const side = 2 ** LEVEL
  for (const id of ids) {
    const leaf = patchLeaf(id)
    assert.equal(leaf.face, FACE)
    assert.equal(leaf.level, LEVEL)
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) {
      const nx = leaf.tx + dx
      const ny = leaf.ty + dy
      if (nx < 0 || ny < 0 || nx >= side || ny >= side) continue
      assert.notEqual(leafPatchId(FACE, LEVEL, nx, ny), id)
    }
    const dir = directionOf(centreOf(id))
    const local = worldToFaceLocal(dir[0] * R, dir[1] * R, dir[2] * R, R)
    assert.equal(local.face, FACE)
    assert.equal(Math.floor((local.ox + R) / LEAF_M), leaf.tx)
    assert.equal(Math.floor((local.oy + R) / LEAF_M), leaf.ty)
  }
  const under = leafPatchId(FACE, LEVEL, Math.floor((CAMERA[0] + R) / LEAF_M), Math.floor((CAMERA[1] + R) / LEAF_M))
  assert.ok(ids.includes(under), 'the leaf under the camera has no patch')
})

gate('the patch cap covers the four corners of its leaf, measured with the quadtree module\'s own face mapping', () => {
  const tree = makeTree()
  const { ids } = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  let tightest = Infinity
  for (const id of ids) {
    const leaf = patchLeaf(id)
    const centre = centreOf(id)
    const dir = directionOf(centre)
    const ox = leaf.tx * LEAF_M - R
    const oy = leaf.ty * LEAF_M - R
    const middle = worldOfFaceLocal(FACE, ox + LEAF_M / 2, oy + LEAF_M / 2)
    assert.ok(angleBetween(dir, middle) < 1e-9, 'the centre is ' + angleBetween(dir, middle) + ' rad from the leaf middle')
    let widest = 0
    for (const [cu, cv] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const angle = angleBetween(dir, worldOfFaceLocal(FACE, ox + cu * LEAF_M, oy + cv * LEAF_M))
      assert.ok(angle <= centre.capRad + 1e-9, 'a corner is outside the cap')
      if (angle > widest) widest = angle
    }
    tightest = Math.min(tightest, centre.capRad - widest)
    assert.ok(centre.capRad - widest < 1e-9, 'the cap is wider than its widest corner')
  }
  assert.ok(Number.isFinite(tightest))
})

gate('a re-plan keeps the id, the slot and the bytes of every patch that stays, generates only the patches that enter, and a returning patch has the same bytes', () => {
  const tree = makeTree()
  const pool = makePool()
  const first = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  pool.sync(first.ids)
  settle(pool)
  const before = new Map(first.ids.map((id) => [id, { slot: pool.slotOf(id), digest: patchDigest(pool, id) }]))
  assert.equal(pool.stats().generated, first.ids.length)

  const moved = planIds(tree, CAMERA[0] + 1.5 * LEAF_M, CAMERA[1], GROUND_ALTITUDE_M)
  const stay = moved.ids.filter((id) => before.has(id))
  const enter = moved.ids.filter((id) => !before.has(id))
  const leave = first.ids.filter((id) => !moved.ids.includes(id))
  assert.ok(stay.length > 0 && enter.length > 0 && leave.length > 0, 'control: the move keeps ' + stay.length + ', adds ' + enter.length + ' and drops ' + leave.length)
  pool.sync(moved.ids)
  settle(pool)
  assert.equal(pool.stats().generated, first.ids.length + enter.length)
  for (const id of stay) {
    assert.equal(pool.slotOf(id), before.get(id).slot)
    assert.equal(patchDigest(pool, id), before.get(id).digest)
  }
  for (const id of leave) assert.equal(pool.slotOf(id), undefined)

  const back = planIds(tree, CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  assert.deepEqual(back.ids, first.ids)
  pool.sync(back.ids)
  settle(pool)
  assert.equal(pool.stats().generated, first.ids.length + enter.length + leave.length)
  for (const id of first.ids) assert.equal(patchDigest(pool, id), before.get(id).digest)
  assert.equal(pool.stats().deferred, 0)
  console.log('re-plan: ' + first.ids.length + ' patches, a move of 1.5 leaves keeps ' + stay.length + ', adds ' + enter.length + ' and drops ' + leave.length)
})

gate('a finer quadtree over the same ground gives the same patch ids: four finer leaves fold into their level 17 patch', () => {
  const coarse = planIds(makeTree(), CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  const fine = planIds(makeTree(LEAF_M / 2), CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M)
  assert.equal(fine.finest, LEVEL + 1)
  assert.ok(fine.ids.length > 0)
  assert.equal(new Set(fine.ids).size, fine.ids.length)
  for (const id of fine.ids) assert.ok(coarse.ids.includes(id), 'a finer plan made a patch id the coarser plan does not have')
  const leavesAtFinest = makeTree(LEAF_M / 2).updateQuadtree(CAMERA[0], CAMERA[1], GROUND_ALTITUDE_M, CAMERA[0], CAMERA[1], undefined, undefined, GROUND_ALTITUDE_M).filter((leaf) => leaf.level >= LEVEL).length
  assert.ok(leavesAtFinest > fine.ids.length, 'control: the finer plan holds more leaves (' + leavesAtFinest + ') than patches (' + fine.ids.length + ')')
})

gate('a leaf coarser than the patch level gets no patch: a high camera plans leaves and no vegetation', () => {
  const high = planIds(makeTree(), CAMERA[0], CAMERA[1], HIGH_ALTITUDE_M)
  assert.ok(high.leaves > 0)
  assert.ok(high.finest < LEVEL, 'control: the finest leaf from ' + HIGH_ALTITUDE_M + ' m is level ' + high.finest)
  assert.equal(high.ids.length, 0)
})

gate('the pool generates a leaf patch on each face: every instance lies inside the patch cap, on its face, within the capacity', () => {
  const pool = makePool()
  const side = 2 ** LEVEL
  const ids = Array.from({ length: PATCH_FACES }, (_, face) => leafPatchId(face, LEVEL, side / 2 + 37 * face, side / 2 - 11 * face))
  pool.sync(ids)
  settle(pool)
  const world = [0, 0, 0]
  for (const id of ids) {
    const leaf = patchLeaf(id)
    const slot = pool.slotOf(id)
    const count = pool.counts()[0][slot]
    const centre = centreOf(id)
    const dir = directionOf(centre)
    assert.equal(count, Math.round(DENSITY * capAreaKm2(centre.capRad)))
    assert.ok(count > 0 && count <= CAPACITY)
    for (let i = 0; i < count; i++) {
      pool.readWorld(0, slot, i, world)
      assert.ok(angleBetween(dir, world) <= centre.capRad + 1e-9, 'an instance is outside its patch cap')
      assert.equal(worldToFaceLocal(world[0], world[1], world[2], R).face, leaf.face)
    }
  }
})

finish()
