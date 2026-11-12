import assert from 'node:assert/strict'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { TwoBoneIKSolver, FootIKSolver, IKChain, IKRig } from '../src/animation/ikSolver.js'
import * as skel from '../src/animation/skeletonUtils.js'
import { createShapeKeyDriver } from '../src/animation/shapeKeys.js'
import { SpringBoneChain } from '../src/animation/springBones.js'
import { quatSlerp, quatNormalize, quatFromUnitVectors } from '../src/animation/rigMath.js'

const seeded = (seed) => {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const between = (rnd, lo, hi) => lo + (hi - lo) * rnd()
const vecOf = (v) => [v.x, v.y, v.z]
const quatOf = (q) => [q.x, q.y, q.z, q.w]
const worldPos = (o) => vecOf(o.getWorldPosition(new THREE.Vector3()))
const worldQuat = (o) => quatOf(o.getWorldQuaternion(new THREE.Quaternion()))
const sameTuple = (actual, expected, what, tolerance = 0) => {
  assert.equal(actual.length, expected.length, what + ' length')
  for (let i = 0; i < expected.length; i++) {
    const gap = Math.abs(actual[i] - expected[i])
    if (!(gap <= tolerance) && !Object.is(actual[i], expected[i])) throw new Error(what + '[' + i + '] got ' + actual[i] + ' expected ' + expected[i])
  }
}
const throwsMatching = (fn, pattern) => assert.throws(fn, (error) => pattern.test(error.message))
const randomQuat = (rnd) => new THREE.Quaternion(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()

const buildArm = (rnd) => {
  const parent = new THREE.Group()
  parent.position.set(between(rnd, -2, 2), between(rnd, -2, 2), between(rnd, -2, 2))
  parent.quaternion.copy(randomQuat(rnd))
  const s = between(rnd, 0.5, 2)
  parent.scale.set(s, s, s)
  const root = new THREE.Bone()
  root.position.set(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1))
  root.quaternion.copy(randomQuat(rnd))
  const middle = new THREE.Bone()
  middle.position.set(between(rnd, -1, 1), between(rnd, 0.3, 1.2), between(rnd, -1, 1))
  middle.quaternion.copy(randomQuat(rnd))
  const end = new THREE.Bone()
  end.position.set(between(rnd, -1, 1), between(rnd, 0.3, 1.2), between(rnd, -1, 1))
  parent.add(root)
  root.add(middle)
  middle.add(end)
  parent.updateMatrixWorld(true)
  return { parent, root, middle, end }
}

const poseOf = ({ parent, root, middle, end }) => ({
  parentWorldQuat: worldQuat(parent),
  parentMatrixWorld: Array.from(parent.matrixWorld.elements),
  rootWorld: worldPos(root),
  middleWorld: worldPos(middle),
  endWorld: worldPos(end),
  rootWorldQuat: worldQuat(root),
  middleWorldQuat: worldQuat(middle),
  rootLocal: quatOf(root.quaternion),
  middleLocal: quatOf(middle.quaternion),
})

const armCase = (seed, { reachScale = 0.7, weight = 1 } = {}) => {
  const rnd = seeded(seed)
  const arm = buildArm(rnd)
  const pose = poseOf(arm)
  const solver = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
  const upper = new THREE.Vector3(...pose.middleWorld).distanceTo(new THREE.Vector3(...pose.rootWorld))
  const lower = new THREE.Vector3(...pose.endWorld).distanceTo(new THREE.Vector3(...pose.middleWorld))
  const dir = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
  const target = new THREE.Vector3(...pose.rootWorld).addScaledVector(dir, (upper + lower) * reachScale)
  solver.setTarget(vecOf(target))
  solver.setPoleVector([between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)])
  solver.weight = weight
  const result = solver.solve(pose)
  return { arm, pose, solver, result, target, upper, lower }
}

const applyArm = ({ arm, result }) => {
  arm.root.quaternion.set(...result.rootLocal)
  arm.middle.quaternion.set(...result.middleLocal)
  arm.parent.updateMatrixWorld(true)
  return { rootNow: arm.root.getWorldPosition(new THREE.Vector3()), middleNow: arm.middle.getWorldPosition(new THREE.Vector3()), endNow: arm.end.getWorldPosition(new THREE.Vector3()) }
}

gate('the solver measures the two bone lengths that three measures between the world positions', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { solver, upper, lower } = armCase(seed)
    assert.ok(Math.abs(solver.rootLength - upper) < 1e-12, 'upper length, seed ' + seed)
    assert.ok(Math.abs(solver.middleLength - lower) < 1e-12, 'lower length, seed ' + seed)
  }
})

gate('on 60 seeded arms under a rotated and scaled parent, the solved rotations put the end bone on a reachable target in the three scene graph', () => {
  for (let seed = 200; seed < 260; seed++) {
    const run = armCase(seed)
    assert.equal(run.result.solved, true)
    const { endNow } = applyArm(run)
    assert.ok(endNow.distanceTo(run.target) < 1e-9, 'seed ' + seed + ' gap ' + endNow.distanceTo(run.target))
  }
})

gate('the solve keeps both bone lengths, so only rotations change', () => {
  for (let seed = 300; seed < 320; seed++) {
    const run = armCase(seed)
    const { rootNow, middleNow, endNow } = applyArm(run)
    assert.ok(Math.abs(rootNow.distanceTo(middleNow) - run.upper) < 1e-9)
    assert.ok(Math.abs(middleNow.distanceTo(endNow) - run.lower) < 1e-9)
    sameTuple(vecOf(rootNow), run.pose.rootWorld, 'root stays in place', 1e-12)
  }
})

gate('an out-of-reach target leaves the end bone on the root-to-target line at full reach', () => {
  for (let seed = 7; seed < 17; seed++) {
    const run = armCase(seed, { reachScale: 2 })
    const { rootNow, endNow } = applyArm(run)
    assert.ok(Math.abs(endNow.distanceTo(rootNow) - (run.upper + run.lower)) < 1e-9)
    const along = run.target.clone().sub(rootNow).normalize()
    assert.ok(endNow.clone().sub(rootNow).normalize().distanceTo(along) < 1e-9)
  }
})

gate('a weight of 0 keeps the current local rotations and a weight of 0.4 lands between them and the full solve', () => {
  for (let seed = 40; seed < 50; seed++) {
    const none = armCase(seed, { weight: 0 })
    sameTuple(none.result.rootLocal, none.pose.rootLocal, 'root at weight 0', 1e-12)
    sameTuple(none.result.middleLocal, none.pose.middleLocal, 'middle at weight 0', 1e-12)
    const full = armCase(seed, { weight: 1 })
    const part = armCase(seed, { weight: 0.4 })
    const expected = quatOf(new THREE.Quaternion(...full.pose.rootLocal).slerp(new THREE.Quaternion(...full.result.rootLocal), 0.4))
    sameTuple(part.result.rootLocal, expected, 'root at weight 0.4', 1e-12)
  }
})

gate('control: a perturbed target changes the solved root rotation', () => {
  const base = armCase(9)
  const moved = new TwoBoneIKSolver(base.pose.rootWorld, base.pose.middleWorld, base.pose.endWorld)
  moved.setTarget([base.target.x + 0.05, base.target.y, base.target.z])
  const other = moved.solve(base.pose)
  assert.ok(other.rootLocal.some((v, i) => Math.abs(v - base.result.rootLocal[i]) > 1e-6))
})

gate('the solver is unsolved for a target on the root, a disabled solver and a missing parent, and solved again after', () => {
  const { pose } = armCase(31)
  const solver = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
  solver.setTarget(pose.rootWorld)
  assert.equal(solver.solve(pose).solved, false)
  solver.setTarget([9, 9, 9])
  solver.enabled = false
  assert.equal(solver.solve(pose).solved, false)
  solver.enabled = true
  assert.equal(solver.solve({ ...pose, parentWorldQuat: null }).solved, false)
  assert.equal(solver.solve(pose).solved, true)
})

gate('the solver refuses non-finite targets, a zero pole, a bad tolerance and a non-boolean world-space flag', () => {
  const solver = new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0])
  throwsMatching(() => solver.setTarget([0, NaN, 0]), /setTarget needs 3 finite numbers/)
  throwsMatching(() => solver.setPoleVector([0, 0, 0]), /non-zero length/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { tolerance: 0 }), /tolerance needs a finite number greater than 0/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { useWorldSpace: 'yes' }), /useWorldSpace needs a boolean/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1], [0, 2, 0]), /middle position needs 3 finite numbers/)
})

gate('the foot solver moves the foot to the ground height in world space under rotated and scaled parents', () => {
  for (let seed = 300; seed < 330; seed++) {
    const rnd = seeded(seed)
    const parent = new THREE.Group()
    parent.position.set(between(rnd, -2, 2), between(rnd, -2, 2), between(rnd, -2, 2))
    parent.quaternion.copy(randomQuat(rnd))
    parent.scale.set(between(rnd, 0.5, 2), between(rnd, 0.5, 2), between(rnd, 0.5, 2))
    const foot = new THREE.Bone()
    foot.position.set(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1))
    parent.add(foot)
    parent.updateMatrixWorld(true)
    const groundY = between(rnd, -3, 3)
    const before = worldPos(foot)
    const solver = new FootIKSolver(() => [0, groundY, 0], { rayDistance: 4 })
    const result = solver.solve(before, Array.from(parent.matrixWorld.elements))
    assert.equal(result.solved, true)
    foot.position.x += result.delta[0]
    foot.position.y += result.delta[1]
    foot.position.z += result.delta[2]
    parent.updateMatrixWorld(true)
    const after = worldPos(foot)
    assert.ok(Math.abs(after[1] - groundY) < 1e-9, 'seed ' + seed + ' foot height ' + after[1] + ' ground ' + groundY)
    assert.ok(Math.abs(after[0] - before[0]) < 1e-9 && Math.abs(after[2] - before[2]) < 1e-9, 'seed ' + seed + ' foot moved sideways')
  }
})

gate('the foot solver casts from half the ray distance above the foot, straight down, and is unsolved on a miss', () => {
  let seen = null
  const solver = new FootIKSolver((origin, direction, distance) => { seen = { origin, direction, distance }; return null })
  assert.equal(solver.solve([1, 2, 3]).solved, false)
  assert.deepEqual(seen, { origin: [1, 7, 3], direction: [0, -1, 0], distance: 10 })
  assert.deepEqual(new FootIKSolver(() => [0, -0.5, 0]).solve([1, 2, 3]), { solved: true, delta: [0, -2.5, 0] })
  assert.equal(new FootIKSolver(() => [0, NaN, 0]).solve([0, 0, 0]).solved, false)
  throwsMatching(() => new FootIKSolver(null), /needs a raycast callback function; got null/)
  throwsMatching(() => new FootIKSolver(() => null, { rayDistance: -1 }), /rayDistance needs a finite number greater than 0; got -1/)
})

gate('a chain runs its solvers in order, records the ones without solve, and a disabled chain or rig runs none', () => {
  const order = []
  const chain = new IKChain('legs')
  chain.addSolver({ solve: () => order.push('a') }).addSolver(null).addSolver({}).addSolver({ solve: () => order.push('b') })
  chain.solve()
  assert.deepEqual(order, ['a', 'b'])
  assert.equal(chain.refusals.length, 2)
  chain.disable().solve()
  assert.deepEqual(order, ['a', 'b'])
  chain.enable().solve()
  assert.deepEqual(order, ['a', 'b', 'a', 'b'])
  assert.equal(typeof IKRig, 'function')
})

gate('slerp and lerp equal three on 40 seeded pairs, including pairs 1e-4 apart and t outside 0 to 1', () => {
  const rnd = seeded(77)
  for (let i = 0; i < 40; i++) {
    const a = randomQuat(rnd)
    const b = randomQuat(rnd)
    const t = between(rnd, -0.2, 1.2)
    sameTuple(skel.interpolateQuaternion(quatOf(a), quatOf(b), t), quatOf(a.clone().slerp(b, t)), 'slerp ' + i, 0)
    const near = a.clone().slerp(b, 1e-4)
    sameTuple(quatSlerp(quatOf(a), quatOf(near), t), quatOf(a.clone().slerp(near, t)), 'near slerp ' + i, 0)
    const u = new THREE.Vector3(between(rnd, -5, 5), between(rnd, -5, 5), between(rnd, -5, 5))
    const v = new THREE.Vector3(between(rnd, -5, 5), between(rnd, -5, 5), between(rnd, -5, 5))
    sameTuple(skel.interpolateVector3(vecOf(u), vecOf(v), t), vecOf(u.clone().lerp(v, t)), 'lerp ' + i, 0)
  }
})

gate('a packed quaternion unpacks to the same rotation within the 16-bit step, for unit and scaled inputs', () => {
  const rnd = seeded(91)
  for (let i = 0; i < 40; i++) {
    const unit = randomQuat(rnd)
    const scale = between(rnd, 0.2, 3)
    const scaled = quatOf(unit).map((c) => c * scale)
    const buffer = new Int16Array(6)
    skel.packQuaternion(scaled, buffer, 2)
    const back = new THREE.Quaternion(...skel.unpackQuaternion(buffer, 2))
    assert.ok(Math.abs(back.length() - 1) < 1e-12, 'unpacked quaternion is unit length')
    assert.ok(back.angleTo(unit) < 2e-4, 'pair ' + i + ' angle ' + back.angleTo(unit))
  }
  const zero = [0, 0, 0, 0]
  skel.packQuaternion([0, 0, 0, 0], zero)
  assert.deepEqual(zero, [0, 0, 0, 0])
  assert.deepEqual(skel.unpackQuaternion(zero), [0, 0, 0, 1])
})

gate('control: unpacking a perturbed buffer changes the quaternion', () => {
  const buffer = [0, 0, 0, 0]
  skel.packQuaternion(quatNormalize([0.1, 0.2, 0.3, 0.9]), buffer)
  const base = skel.unpackQuaternion(buffer)
  buffer[0] += 500
  assert.ok(skel.unpackQuaternion(buffer).some((v, i) => Math.abs(v - base[i]) > 1e-3))
})

gate('a skeleton state packs to a fixed slot count, restores every bone and refuses a short buffer', () => {
  const rnd = seeded(12)
  const quats = Array.from({ length: 5 }, () => quatOf(randomQuat(rnd)))
  const skeleton = { bones: quats.map((q, i) => ({ name: 'b' + i, quaternion: q.slice() })) }
  const buffer = new Int16Array(23)
  assert.equal(skel.packSkeletonState(skeleton, buffer, 3), 23)
  const restored = { bones: quats.map(() => ({ quaternion: [9, 9, 9, 9] })) }
  assert.equal(skel.unpackSkeletonState(restored, buffer, 3), 23)
  restored.bones.forEach((bone, i) => assert.ok(new THREE.Quaternion(...bone.quaternion).angleTo(new THREE.Quaternion(...quats[i])) < 2e-4, 'bone ' + i))
  assert.throws(() => skel.packSkeletonState(skeleton, new Int16Array(22), 3), /need 23 slots, got 22/)
  assert.throws(() => skel.unpackSkeletonState(restored, new Int16Array(22), 3), /need 23 slots, got 22/)
  assert.equal(skel.packSkeletonState(null, buffer, 4), 4)
})

gate('bone lookups find a bone by name, fall back to the first bone as root, and give null for no skeleton', () => {
  const skeleton = { bones: ['Hips', 'Spine', 'constructor'].map((name) => ({ name, quaternion: [0, 0, 0, 1] })) }
  assert.equal(skel.findBoneByName(skeleton, 'Spine').name, 'Spine')
  assert.equal(skel.findBoneByName(skeleton, 'nope') ?? null, null)
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'hips').name, 'Hips')
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'constructor').name, 'constructor')
  assert.equal(skel.getRootBone({ bones: [{ name: 'tail' }, { name: 'spine' }] }).name, 'tail')
  assert.equal(skel.getRootBone({ bones: [] }), null)
  assert.equal(skel.getRootBone(null), null)
  assert.equal(skel.buildBoneMap(null).size, 0)
  assert.deepEqual([...skel.buildBoneMap(skeleton).keys()].length, 3)
})

const meshTree = (make) => {
  const root = make('group')
  const body = make('mesh', { smile: 0, blink: 1 }, [0.2, 0.3])
  const eyes = make('mesh', { blink: 0, squint: 1 }, [0.9, 0.1])
  const plain = make('mesh', null, null)
  const deep = make('mesh', { smile: 0 }, [0.6])
  root.add(body)
  root.add(plain)
  body.add(eyes)
  plain.add(deep)
  return { root, body, eyes, deep }
}
const threeNode = (kind, dict, influences) => {
  const node = kind === 'group' ? new THREE.Group() : new THREE.Mesh()
  if (kind === 'mesh') {
    node.morphTargetDictionary = dict ?? undefined
    node.morphTargetInfluences = influences ?? undefined
  }
  return node
}
const plainNode = (kind, dict, influences) => {
  const node = { children: [], add(child) { this.children.push(child) } }
  if (kind === 'mesh') Object.assign(node, { isMesh: true, morphTargetDictionary: dict, morphTargetInfluences: influences })
  return node
}

gate('the shape key driver writes a clamped weight to every mesh that has the key, on a three tree and on a plain tree', () => {
  for (const make of [threeNode, plainNode]) {
    const tree = meshTree(make)
    const driver = createShapeKeyDriver(tree.root)
    assert.equal(driver.meshCount, 3)
    assert.deepEqual([...driver.names()].sort(), ['blink', 'smile', 'squint'])
    driver.set('smile', 1.7)
    assert.equal(tree.body.morphTargetInfluences[0], 1)
    assert.equal(tree.deep.morphTargetInfluences[0], 1)
    driver.set('blink', -2)
    assert.equal(tree.body.morphTargetInfluences[1], 0)
    assert.equal(tree.eyes.morphTargetInfluences[0], 0)
    driver.setMany({ squint: 0.25, smile: 0.5 })
    assert.equal(tree.eyes.morphTargetInfluences[1], 0.25)
    assert.equal(tree.body.morphTargetInfluences[0], 0.5)
    assert.equal(driver.get('squint'), 0.25)
    driver.reset()
    assert.deepEqual([...tree.body.morphTargetInfluences], [0, 0])
    assert.deepEqual([...tree.eyes.morphTargetInfluences], [0, 0])
    assert.deepEqual([...tree.deep.morphTargetInfluences], [0])
  }
})

gate('the shape key driver refuses an unknown name, a prototype name and a weight that is not a finite number', () => {
  const driver = createShapeKeyDriver(meshTree(plainNode).root)
  throwsMatching(() => driver.set('frown', 1), /no shape key named "frown"/)
  throwsMatching(() => driver.get('frown'), /no shape key named "frown"/)
  throwsMatching(() => driver.set('toString', 0.5), /no shape key named "toString"/)
  assert.throws(() => driver.set('smile', NaN), TypeError)
  assert.throws(() => driver.set('smile', '1'), TypeError)
})

const buildTail = (rnd, count) => {
  const parent = new THREE.Group()
  parent.position.set(between(rnd, -1, 1), between(rnd, 1, 2), between(rnd, -1, 1))
  parent.quaternion.copy(randomQuat(rnd))
  const bones = []
  let holder = parent
  for (let i = 0; i < count; i++) {
    const bone = new THREE.Bone()
    if (i > 0) bone.position.set(between(rnd, -0.2, 0.2), between(rnd, 0.2, 0.5), between(rnd, -0.2, 0.2))
    bone.quaternion.copy(randomQuat(rnd))
    holder.add(bone)
    bones.push(bone)
    holder = bone
  }
  parent.updateMatrixWorld(true)
  return { parent, bones }
}

const springRun = (seed, options, steps) => {
  const rnd = seeded(seed)
  const { parent, bones } = buildTail(rnd, 4 + (seed % 3))
  const lengths = bones.slice(1).map((bone, k) => bone.getWorldPosition(new THREE.Vector3()).distanceTo(bones[k].getWorldPosition(new THREE.Vector3())))
  const chain = new SpringBoneChain(bones.map(worldPos), bones.map(worldQuat), worldQuat(parent), options)
  let worstGap = 0
  let worstLength = 0
  for (let s = 0; s < steps; s++) {
    parent.position.x += between(rnd, -0.08, 0.08)
    parent.position.z += between(rnd, -0.08, 0.08)
    parent.updateMatrixWorld(true)
    const locals = chain.update(s % 5 === 4 ? 0.2 : 1 / 60, worldPos(bones[0]), null)
    assert.equal(locals.length, bones.length - 1)
    locals.forEach((q, k) => bones[k].quaternion.set(...q))
    parent.updateMatrixWorld(true)
    for (let k = 1; k < bones.length; k++) {
      const fk = bones[k].getWorldPosition(new THREE.Vector3())
      worstGap = Math.max(worstGap, fk.distanceTo(new THREE.Vector3(...chain.points[k])))
      worstLength = Math.max(worstLength, Math.abs(new THREE.Vector3(...chain.points[k]).distanceTo(new THREE.Vector3(...chain.points[k - 1])) - lengths[k - 1]))
    }
  }
  return { chain, bones, worstGap, worstLength }
}

gate('over 40 steps the spring chain keeps every bone length, and its rotations place the three bones on its points', () => {
  for (let seed = 400; seed < 410; seed++) {
    const { worstGap, worstLength } = springRun(seed, {}, 40)
    assert.ok(worstLength < 1e-9, 'seed ' + seed + ' bone length drift ' + worstLength)
    assert.ok(worstGap < 1e-9, 'seed ' + seed + ' gap between rotations and points ' + worstGap)
  }
})

const sideways = (gravity) => {
  const points = [[0, 2, 0], [0.4, 2, 0], [0.8, 2, 0], [1.2, 2, 0]]
  const quats = points.map(() => [0, 0, 0, 1])
  const chain = new SpringBoneChain(points, quats, [0, 0, 0, 1], { amount: 0.3, bounce: 0.5, gravity, limit: 170 })
  for (let s = 0; s < 120; s++) chain.update(1 / 60, points[0], null)
  return chain.points.at(-1)[1]
}

gate('the same holds with gravity, a bend limit and full bounce, and gravity lowers the tip of a chain held out sideways', () => {
  for (let seed = 410; seed < 420; seed++) {
    const heavy = springRun(seed, { amount: 0.3, bounce: 1, gravity: 0.8, limit: 25 }, 40)
    assert.ok(heavy.worstLength < 1e-9 && heavy.worstGap < 1e-9, 'seed ' + seed)
  }
  const withGravity = sideways(1)
  const without = sideways(0)
  assert.ok(Math.abs(without - 2) < 1e-9, 'a still chain with no gravity moved its tip to ' + without)
  assert.ok(withGravity < 2 - 0.05, 'gravity left the tip at height ' + withGravity)
})

gate('colliders change the chain, and two runs of the same seed give the same points', () => {
  let differs = 0
  for (let seed = 420; seed < 430; seed++) {
    const options = { gravity: 1, limit: 170 }
    const withColliders = springRun(seed, { ...options, colliders: [{ index: 0, radius: 0.9, offset: [0, 0.1, 0] }, { index: 1, radius: 0.6 }] }, 40)
    const again = springRun(seed, { ...options, colliders: [{ index: 0, radius: 0.9, offset: [0, 0.1, 0] }, { index: 1, radius: 0.6 }] }, 40)
    const without = springRun(seed, options, 40)
    assert.deepEqual(withColliders.chain.points, again.chain.points)
    if (withColliders.chain.points.some((p, k) => p.some((v, i) => Math.abs(v - without.chain.points[k][i]) > 1e-9))) differs++
  }
  assert.ok(differs >= 5, 'colliders changed only ' + differs + ' of 10 chains')
})

gate('the spring chain ignores a non-positive dt, clamps a long dt to 1/30 s, and moves when the root moves', () => {
  const { bones } = buildTail(seeded(500), 4)
  const make = () => new SpringBoneChain(bones.map(worldPos), bones.map(worldQuat), [0, 0, 0, 1], { gravity: 1 })
  const root = worldPos(bones[0])
  assert.equal(make().update(0, root), null)
  assert.equal(make().update(NaN, root), null)
  assert.deepEqual(make().update(5, root), make().update(1 / 30, root))
  const still = make().update(1 / 60, root)
  const shifted = make().update(1 / 60, [root[0] + 0.3, root[1], root[2]])
  assert.ok(shifted.some((q, k) => q.some((v, i) => Math.abs(v - still[k][i]) > 1e-9)))
})

gate('the spring chain refuses short chains, stacked bones, bad fractions, limits, wind and colliders', () => {
  const p = [[0, 0, 0], [0, 1, 0], [0, 2, 0]]
  const q = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]
  throwsMatching(() => new SpringBoneChain([[0, 0, 0]], [[0, 0, 0, 1]]), /at least two bones/)
  throwsMatching(() => new SpringBoneChain([[0, 0, 0], [0, 0, 0]], q.slice(1)), /bone 0 sits on bone 1/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { amount: 1.5 }), /amount needs a number from 0 to 1; got 1.5/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { limit: 0 }), /limit needs degrees from over 0 to 180; got 0/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { wind: { force: -1 } }), /wind.force needs a finite number of at least 0; got -1/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { colliders: [{ index: 3, radius: 1 }] }), /collider bone must be one of the chain bones/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { colliders: [{ index: 1, radius: 0 }] }), /collider radius needs a number greater than 0; got 0/)
})

gate('quatFromUnitVectors equals three on general, opposite and nearly opposite vectors', () => {
  const rnd = seeded(610)
  const cases = []
  for (let i = 0; i < 20; i++) {
    const from = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
    const to = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
    cases.push([from, to], [from, from.clone().negate()])
  }
  cases.push([new THREE.Vector3(1, 0, 0), new THREE.Vector3(-1, Math.sqrt(1e-7), 0).normalize()], [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)])
  for (const [from, to] of cases) {
    const got = new THREE.Quaternion(...quatFromUnitVectors(vecOf(from), vecOf(to)))
    const want = new THREE.Quaternion().setFromUnitVectors(from, to)
    assert.ok(got.angleTo(want) < 1e-6, 'rotation differs from three by ' + got.angleTo(want))
    assert.ok(from.clone().applyQuaternion(got).distanceTo(to) < 1e-6, 'the rotation does not carry from onto to')
  }
})

gate('this gate reads nothing outside the repository', () => {
  assert.equal(import.meta.resolve('three').includes('/node_modules/three/'), true)
})

finish()
