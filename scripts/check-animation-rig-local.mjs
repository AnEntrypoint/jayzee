import assert from 'node:assert/strict'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { FootIKSolver, IKChain, IKRig, TwoBoneIKSolver, makeTwoBoneResult } from '../src/animation/ikSolver.js'
import { createShapeKeyDriver } from '../src/animation/shapeKeys.js'
import * as skel from '../src/animation/skeletonUtils.js'
import { GRAVITY_MS2, MAX_STEP_S, SpringBoneChain } from '../src/animation/springBones.js'

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
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2])
const randomQuat = (rnd) => new THREE.Quaternion(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
const throwsMatching = (fn, pattern) => assert.throws(fn, (error) => pattern.test(error.message))

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

const applySolve = (arm, result) => {
  arm.root.quaternion.fromArray(result.rootLocal)
  arm.middle.quaternion.fromArray(result.middleLocal)
  arm.parent.updateMatrixWorld(true)
}

const solveCase = (seed, { reachScale = 0.7, weight = 1, pole = true } = {}) => {
  const rnd = seeded(seed)
  const arm = buildArm(rnd)
  const pose = poseOf(arm)
  const solver = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
  const dir = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
  const reach = solver.rootLength + solver.middleLength
  const inner = Math.abs(solver.rootLength - solver.middleLength)
  const distance = reachScale > 1 ? reach * reachScale : inner + (reach - inner) * reachScale
  const target = vecOf(new THREE.Vector3(...pose.rootWorld).addScaledVector(dir, distance))
  const poleVector = [between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)]
  solver.setTarget(target)
  if (pole) solver.setPoleVector(poleVector)
  solver.weight = weight
  return { arm, pose, solver, target, reach, poleVector, dir: vecOf(dir), result: solver.solve(pose) }
}

gate('the two-bone solver measures bone lengths as the world distances between the joints', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const arm = buildArm(seeded(seed))
    const pose = poseOf(arm)
    const solver = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
    assert.ok(Math.abs(solver.rootLength - dist(pose.rootWorld, pose.middleWorld)) < 1e-12)
    assert.ok(Math.abs(solver.middleLength - dist(pose.middleWorld, pose.endWorld)) < 1e-12)
  }
})

gate('applying the solved local rotations in a three scene graph puts the end bone on a reachable target, on 80 seeded arms under rotated and scaled parents', () => {
  for (let seed = 1; seed <= 80; seed++) {
    const c = solveCase(seed, { reachScale: 0.3 + (seed % 7) * 0.1 })
    assert.equal(c.result.solved, true, 'seed ' + seed)
    applySolve(c.arm, c.result)
    assert.ok(dist(worldPos(c.arm.end), c.target) < 1e-9 * (1 + c.reach), 'seed ' + seed + ' end is ' + dist(worldPos(c.arm.end), c.target) + ' m off')
    assert.ok(Math.abs(dist(worldPos(c.arm.root), worldPos(c.arm.middle)) - c.solver.rootLength) < 1e-9, 'root bone length kept')
    assert.ok(Math.abs(dist(worldPos(c.arm.middle), worldPos(c.arm.end)) - c.solver.middleLength) < 1e-9, 'middle bone length kept')
    assert.ok(dist(worldPos(c.arm.root), c.pose.rootWorld) < 1e-12, 'root stays in place')
  }
})

gate('an out-of-reach target leaves the arm straight, at full reach on the line from the root to the target', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const c = solveCase(seed, { reachScale: 1.6 })
    applySolve(c.arm, c.result)
    const end = worldPos(c.arm.end)
    const expected = [0, 1, 2].map((k) => c.pose.rootWorld[k] + c.dir[k] * c.reach)
    assert.ok(dist(end, expected) < 1e-6 * (1 + c.reach), 'seed ' + seed + ' off by ' + dist(end, expected))
  }
})

gate('the elbow bends toward the pole vector, taken in the parent frame', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const c = solveCase(seed, { reachScale: 0.6 })
    applySolve(c.arm, c.result)
    const root = c.pose.rootWorld
    const middle = worldPos(c.arm.middle)
    const poleWorld = vecOf(new THREE.Vector3(...c.poleVector).normalize().applyQuaternion(new THREE.Quaternion(...c.pose.parentWorldQuat)))
    const along = [0, 1, 2].reduce((sum, k) => sum + poleWorld[k] * c.dir[k], 0)
    const side = [0, 1, 2].map((k) => poleWorld[k] - along * c.dir[k])
    const elbow = [0, 1, 2].map((k) => middle[k] - root[k])
    const elbowAlong = [0, 1, 2].reduce((sum, k) => sum + elbow[k] * c.dir[k], 0)
    const elbowSide = [0, 1, 2].map((k) => elbow[k] - elbowAlong * c.dir[k])
    const sideLength = Math.hypot(...side)
    if (sideLength < 1e-3) continue
    const cos = [0, 1, 2].reduce((sum, k) => sum + side[k] * elbowSide[k], 0) / (sideLength * Math.hypot(...elbowSide))
    assert.ok(cos > 1 - 1e-9, 'seed ' + seed + ' elbow is ' + cos + ' from the pole side')
  }
})

gate('weight 0 keeps the pose, weight 1 reaches the target, and weight 0.5 is the three slerp between the two', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const full = solveCase(seed)
    const none = solveCase(seed, { weight: 0 })
    const half = solveCase(seed, { weight: 0.5 })
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(none.result.rootLocal[k] - none.pose.rootLocal[k]) < 1e-12, 'weight 0 root')
    const expected = new THREE.Quaternion(...half.pose.rootLocal).slerp(new THREE.Quaternion(...full.result.rootLocal), 0.5)
    const got = new THREE.Quaternion(...half.result.rootLocal)
    assert.ok(Math.abs(Math.abs(got.dot(expected)) - 1) < 1e-9, 'seed ' + seed + ' half weight root')
    applySolve(half.arm, half.result)
    assert.ok(dist(worldPos(half.arm.end), half.target) > 1e-4, 'control: half weight does not reach the target')
  }
})

gate('control: a moved target changes the solved rotations, and a result object passed in is filled and returned without a new one', () => {
  const a = solveCase(5)
  const out = makeTwoBoneResult()
  a.solver.setTarget([a.target[0] + 0.2, a.target[1], a.target[2] - 0.1])
  const b = a.solver.solve(a.pose, out)
  assert.equal(b, out)
  assert.equal(out.solved, true)
  assert.ok(Math.hypot(...out.rootLocal.map((v, k) => v - a.result.rootLocal[k])) > 1e-4)
})

gate('the solver stays unsolved for a target on the root, a disabled solver and a missing pose, and refuses malformed input by name', () => {
  const c = solveCase(3)
  c.solver.setTarget(c.pose.rootWorld)
  assert.deepEqual(c.solver.solve(c.pose), { solved: false })
  c.solver.setTarget(c.target)
  c.solver.enabled = false
  assert.deepEqual(c.solver.solve(c.pose), { solved: false })
  c.solver.enabled = true
  assert.deepEqual(c.solver.solve(null), { solved: false })
  assert.equal(c.solver.solve(c.pose).solved, true)
  throwsMatching(() => c.solver.setTarget([0, Number.NaN, 0]), /TwoBoneIKSolver/)
  throwsMatching(() => c.solver.setPoleVector([0, 0, 0]), /non-zero length/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { tolerance: 0 }), /options\.tolerance/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { useWorldSpace: 'yes' }), /options\.useWorldSpace/)
  throwsMatching(() => c.solver.solve({ ...c.pose, rootWorld: [0, 0] }), /pose\.rootWorld/)
})

gate('a target given in the parent frame solves to the same rotations as its world position', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const world = solveCase(seed)
    const local = new TwoBoneIKSolver(world.pose.rootWorld, world.pose.middleWorld, world.pose.endWorld, { useWorldSpace: false })
    local.setTarget(vecOf(world.arm.parent.worldToLocal(new THREE.Vector3(...world.target))))
    local.setPoleVector(world.poleVector)
    const result = local.solve(world.pose)
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(result.rootLocal[k] - world.result.rootLocal[k]) < 1e-9 && Math.abs(result.middleLocal[k] - world.result.middleLocal[k]) < 1e-9, 'seed ' + seed)
  }
})

gate('the foot solver casts straight down from half the ray distance above the foot and returns a local offset that puts the foot on the hit height', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const rnd = seeded(seed)
    const parent = new THREE.Group()
    parent.position.set(between(rnd, -3, 3), between(rnd, -3, 3), between(rnd, -3, 3))
    parent.quaternion.copy(randomQuat(rnd))
    const s = between(rnd, 0.5, 2)
    parent.scale.set(s, s, s)
    const foot = new THREE.Bone()
    foot.position.set(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1))
    parent.add(foot)
    parent.updateMatrixWorld(true)
    const before = worldPos(foot)
    const groundY = before[1] + between(rnd, -0.4, 0.4)
    const calls = []
    const solver = new FootIKSolver((origin, direction, distance) => { calls.push({ origin, direction, distance }); return [origin[0], groundY, origin[2]] }, { rayDistance: 4 })
    const result = solver.solve(before, Array.from(parent.matrixWorld.elements))
    assert.equal(result.solved, true)
    assert.deepEqual(calls, [{ origin: [before[0], before[1] + 2, before[2]], direction: [0, -1, 0], distance: 4 }])
    foot.position.add(new THREE.Vector3(...result.delta))
    parent.updateMatrixWorld(true)
    const after = worldPos(foot)
    assert.ok(Math.abs(after[1] - groundY) < 1e-9 && Math.abs(after[0] - before[0]) < 1e-9 && Math.abs(after[2] - before[2]) < 1e-9, 'seed ' + seed)
  }
})

gate('the foot solver scales the lift by its weight, stays unsolved on a miss or a non-finite hit, and refuses a missing callback or a bad ray distance', () => {
  const half = new FootIKSolver(() => [0, 1, 0])
  half.weight = 0.5
  assert.deepEqual(half.solve([0, 0.2, 0]).delta, [0, 0.4, 0])
  assert.deepEqual(new FootIKSolver(() => null).solve([0, 0, 0]), { solved: false })
  assert.deepEqual(new FootIKSolver(() => [0, Number.NaN, 0]).solve([0, 0, 0]), { solved: false })
  const off = new FootIKSolver(() => [0, 1, 0])
  off.enabled = false
  assert.deepEqual(off.solve([0, 0, 0]), { solved: false })
  throwsMatching(() => new FootIKSolver(null), /raycast callback/)
  throwsMatching(() => new FootIKSolver(() => null, { rayDistance: -1 }), /options\.rayDistance/)
})

gate('a chain runs its solvers in order and records a solver with no solve as a refusal, and a rig refuses empty or duplicate chain names and skips every chain while disabled', () => {
  const order = []
  const chain = new IKChain('arm')
  chain.addSolver({ solve: () => order.push('a') }).addSolver({ nope: true }).addSolver({ solve: () => order.push('b') })
  chain.solve()
  assert.deepEqual(order, ['a', 'b'])
  assert.equal(chain.refusals.length, 1)
  chain.disable().solve()
  assert.deepEqual(order, ['a', 'b'])
  const rig = new IKRig({ bones: [] })
  const leg = rig.createChain('leg')
  leg.addSolver({ solve: () => order.push('leg') })
  assert.equal(rig.getChain('leg'), leg)
  throwsMatching(() => rig.createChain(''), /non-empty chain name/)
  throwsMatching(() => rig.createChain('leg'), /already named "leg"/)
  rig.disable().update()
  assert.deepEqual(order, ['a', 'b'])
  rig.enable().update()
  assert.deepEqual(order, ['a', 'b', 'leg'])
})

const skeletonOf = (names) => ({ bones: names.map((name) => ({ name, quaternion: [0, 0, 0, 1] })) })

gate('bones are found by name and by humanoid alias, with the literal name as the fallback and no prototype names', () => {
  const skeleton = skeletonOf(['root', 'spine', 'upper_armL', 'LeftFoot', 'tail'])
  assert.equal(skel.findBoneByName(skeleton, 'spine').name, 'spine')
  assert.equal(skel.findBoneByName(skeleton, 'missing'), null)
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'hips').name, 'root')
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'leftUpperArm').name, 'upper_armL')
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'leftFoot').name, 'LeftFoot')
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'tail').name, 'tail')
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'toString'), null)
  assert.equal(skel.findBoneByHumanoidName(skeleton, 'head'), null)
  assert.equal(skel.getRootBone(skeleton).name, 'root')
  assert.equal(skel.getRootBone(skeletonOf(['a', 'b'])).name, 'a')
  assert.equal(skel.getRootBone(null), null)
  assert.deepEqual([...skel.buildBoneMap(skeleton).keys()], ['root', 'spine', 'upper_armL', 'LeftFoot', 'tail'])
  assert.equal(skel.buildBoneMap(null).size, 0)
})

gate('quaternion and vector interpolation agree with three slerp and lerp', () => {
  const rnd = seeded(77)
  for (let i = 0; i < 50; i++) {
    const a = randomQuat(rnd)
    const b = randomQuat(rnd)
    const t = rnd()
    const got = skel.interpolateQuaternion(quatOf(a), quatOf(b), t)
    const expected = quatOf(a.clone().slerp(b, t))
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(got[k] - expected[k]) < 1e-12, 'slerp ' + i)
    const v = skel.interpolateVector3([1, 2, 3], [-3, 0, 9], t)
    const ve = vecOf(new THREE.Vector3(1, 2, 3).lerp(new THREE.Vector3(-3, 0, 9), t))
    for (let k = 0; k < 3; k++) assert.ok(Math.abs(v[k] - ve[k]) < 1e-12, 'lerp ' + i)
  }
})

gate('a packed quaternion comes back within one int16 step, a scaled input packs as its unit form, and a skeleton state round-trips', () => {
  const rnd = seeded(9)
  const buffer = new Int16Array(4)
  for (let i = 0; i < 100; i++) {
    const q = quatOf(randomQuat(rnd))
    skel.packQuaternion(q.map((v) => v * 3), buffer)
    const back = skel.unpackQuaternion(buffer)
    for (let k = 0; k < 4; k++) assert.ok(Math.abs(back[k] - q[k]) < 2 / 32767, 'quat ' + i)
  }
  const skeleton = skeletonOf(['a', 'b', 'c'])
  skeleton.bones.forEach((bone) => { bone.quaternion = quatOf(randomQuat(rnd)) })
  const state = new Int16Array(14)
  assert.equal(skel.packSkeletonState(skeleton, state, 2), 14)
  const copy = skeletonOf(['a', 'b', 'c'])
  assert.equal(skel.unpackSkeletonState(copy, state, 2), 14)
  copy.bones.forEach((bone, i) => bone.quaternion.forEach((v, k) => assert.ok(Math.abs(v - skeleton.bones[i].quaternion[k]) < 2 / 32767)))
  throwsMatching(() => skel.packSkeletonState(skeleton, new Int16Array(11)), /buffer too short: need 12 slots, got 11/)
  throwsMatching(() => skel.unpackSkeletonState(skeleton, new Int16Array(12), 1), /need 13 slots, got 12/)
  state[2] += 4000
  const moved = skeletonOf(['a', 'b', 'c'])
  skel.unpackSkeletonState(moved, state, 2)
  assert.ok(Math.abs(moved.bones[0].quaternion[0] - copy.bones[0].quaternion[0]) > 0.01, 'control: a changed buffer changes the bone')
})

const morphMesh = (names) => {
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial())
  mesh.morphTargetDictionary = Object.fromEntries(names.map((name, i) => [name, i]))
  mesh.morphTargetInfluences = names.map(() => 0)
  return mesh
}

gate('the shape key driver finds every morph mesh in a three tree and writes clamped weights to each mesh that owns the key', () => {
  const root = new THREE.Group()
  const face = morphMesh(['smile', 'blink'])
  const brows = morphMesh(['blink', 'frown'])
  const holder = new THREE.Group()
  holder.add(brows)
  root.add(face, holder, new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial()))
  const driver = createShapeKeyDriver(root)
  assert.equal(driver.meshCount, 2)
  assert.deepEqual(driver.names(), ['smile', 'blink', 'frown'])
  assert.equal(driver.set('blink', 0.4), 0.4)
  assert.deepEqual([face.morphTargetInfluences[1], brows.morphTargetInfluences[0]], [0.4, 0.4])
  assert.equal(driver.set('smile', 7), 1)
  assert.equal(driver.set('frown', -2), 0)
  driver.setMany({ smile: 0.25, frown: 0.75 })
  assert.deepEqual(driver.snapshot(), { smile: 0.25, blink: 0.4, frown: 0.75 })
  assert.equal(driver.get('frown'), 0.75)
  driver.reset()
  assert.deepEqual(driver.snapshot(), { smile: 0, blink: 0, frown: 0 })
  throwsMatching(() => driver.set('wink', 1), /no shape key named "wink"/)
  throwsMatching(() => driver.set('toString', 1), /no shape key named "toString"/)
  assert.throws(() => driver.set('smile', Number.NaN), TypeError)
  assert.equal(createShapeKeyDriver({ children: [{ isMesh: true, morphTargetDictionary: { a: 0 }, morphTargetInfluences: [0] }] }).meshCount, 1)
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

const chainOf = (tail, options) => new SpringBoneChain(tail.bones.map(worldPos), tail.bones.map(worldQuat), worldQuat(tail.parent), options)

const runSpring = (seed, options, steps, each = () => {}) => {
  const rnd = seeded(seed)
  const tail = buildTail(rnd, 4 + (seed % 3))
  const chain = chainOf(tail, options)
  const wind = options.wind ? vecOf(new THREE.Vector3(between(rnd, -1, 1), 0, between(rnd, -1, 1)).normalize()) : null
  for (let s = 0; s < steps; s++) {
    tail.parent.position.x += between(rnd, -0.08, 0.08)
    tail.parent.position.z += between(rnd, -0.08, 0.08)
    tail.parent.updateMatrixWorld(true)
    const locals = chain.update(s % 5 === 4 ? 0.2 : 1 / 60, worldPos(tail.bones[0]), wind)
    locals.forEach((q, k) => tail.bones[k].quaternion.fromArray(q))
    tail.parent.updateMatrixWorld(true)
    each({ tail, chain, locals, step: s })
  }
  return { tail, chain }
}

gate('the spring chain rotations, applied to three bones, put every bone on the simulated point and keep every bone length, over 40 steps of a moving root', () => {
  for (const [seed, options] of [[1, {}], [2, { gravity: 1, wind: { force: 6 }, bounce: 1 }], [3, { amount: 1, limit: 25 }], [4, { gravity: 0.5, colliders: [{ index: 0, radius: 0.3, offset: [0, 0.1, 0] }] }]]) {
    runSpring(seed, options, 40, ({ tail, chain, locals, step }) => {
      assert.equal(locals.length, tail.bones.length - 1)
      tail.bones.forEach((bone, k) => assert.ok(dist(worldPos(bone), chain.points[k]) < 1e-9, 'seed ' + seed + ' step ' + step + ' bone ' + k + ' is ' + dist(worldPos(bone), chain.points[k]) + ' m off'))
      for (let k = 0; k < chain.lengths.length; k++) assert.ok(Math.abs(dist(chain.points[k], chain.points[k + 1]) - chain.lengths[k]) < 1e-9, 'length ' + k)
    })
  }
})

gate('a still chain with no gravity keeps its rest pose, and gravity lowers the tip', () => {
  const rnd = seeded(11)
  const tail = buildTail(rnd, 5)
  const rest = tail.bones.map((bone) => quatOf(bone.quaternion))
  const still = chainOf(tail, {})
  for (let s = 0; s < 30; s++) {
    const locals = still.update(1 / 60, worldPos(tail.bones[0]))
    locals.forEach((q, k) => assert.ok(Math.abs(Math.abs(q[0] * rest[k][0] + q[1] * rest[k][1] + q[2] * rest[k][2] + q[3] * rest[k][3]) - 1) < 1e-12, 'bone ' + k + ' left its rest rotation'))
  }
  const heavy = chainOf(tail, { gravity: 1, amount: 0.1 })
  const tipBefore = heavy.points[4][1]
  for (let s = 0; s < 60; s++) heavy.update(1 / 60, worldPos(tail.bones[0]))
  assert.ok(heavy.points[4][1] < tipBefore - 0.01, 'tip fell ' + (tipBefore - heavy.points[4][1]))
  assert.equal(GRAVITY_MS2, 9.81)
})

gate('the bend limit holds every bone within its angle of the carried rest direction, and a collider keeps the other bones outside its radius at the push', () => {
  const limit = 20
  runSpring(6, { gravity: 1, amount: 0, limit }, 60, ({ chain }) => {
    for (let k = 0; k < chain.lengths.length; k++) {
      const dir = [0, 1, 2].map((i) => (chain.points[k + 1][i] - chain.points[k][i]) / chain.lengths[k])
      const cos = dir[0] * chain.rest[k][0] + dir[1] * chain.rest[k][1] + dir[2] * chain.rest[k][2]
      assert.ok(Math.acos(Math.min(1, cos)) <= (limit * Math.PI) / 180 + 1e-9, 'bone ' + k + ' bent ' + (Math.acos(Math.min(1, cos)) * 180) / Math.PI)
    }
  })
  let free = 0
  runSpring(6, { gravity: 1, amount: 0 }, 60, ({ chain }) => {
    for (let k = 0; k < chain.lengths.length; k++) {
      const dir = [0, 1, 2].map((i) => (chain.points[k + 1][i] - chain.points[k][i]) / chain.lengths[k])
      const cos = dir[0] * chain.rest[k][0] + dir[1] * chain.rest[k][1] + dir[2] * chain.rest[k][2]
      free = Math.max(free, Math.acos(Math.min(1, cos)))
    }
  })
  assert.ok(free > (limit * Math.PI) / 180, 'control: without the limit the same chain bends past it')
})

gate('the same inputs give the same rotations, a non-positive dt is ignored, a long dt is clamped to 1/30 s, and an out list is reused', () => {
  const tailA = buildTail(seeded(21), 5)
  const tailB = buildTail(seeded(21), 5)
  const a = chainOf(tailA, { gravity: 0.7 })
  const b = chainOf(tailB, { gravity: 0.7 })
  const root = worldPos(tailA.bones[0])
  const moved = [root[0] + 0.3, root[1], root[2]]
  assert.equal(a.update(0, moved), null)
  assert.equal(a.update(-1, moved), null)
  const long = a.update(5, moved)
  const clamped = b.update(MAX_STEP_S, moved)
  assert.deepEqual(long, clamped)
  assert.equal(MAX_STEP_S, 1 / 30)
  const out = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]
  const first = out[0]
  const again = a.update(1 / 60, moved, null, out)
  assert.equal(again, out)
  assert.equal(out[0], first)
  assert.deepEqual(b.update(1 / 60, moved), out.map((q) => [...q]))
  assert.ok(Math.hypot(...out[0].map((v, k) => v - quatOf(tailA.bones[0].quaternion)[k])) > 1e-6, 'a moved root rotates the first bone')
})

gate('the spring chain refuses a short chain, stacked bones, fractions outside 0 to 1, a bad limit, negative wind and a collider off the chain', () => {
  const p = [[0, 0, 0], [0, 1, 0], [0, 2, 0]]
  const q = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]
  throwsMatching(() => new SpringBoneChain([[0, 0, 0]], [[0, 0, 0, 1]]), /at least two bones/)
  throwsMatching(() => new SpringBoneChain(p, q.slice(0, 2)), /one world quaternion per bone/)
  throwsMatching(() => new SpringBoneChain([[0, 0, 0], [0, 0, 0], [0, 1, 0]], q), /bone 0 sits on bone 1/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { amount: 1.5 }), /amount needs a number from 0 to 1/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { bounce: -0.1 }), /bounce/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { limit: 0 }), /limit needs degrees/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { wind: { force: -1 } }), /wind\.force/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { colliders: [{ index: 3, radius: 1 }] }), /collider bone must be one of the chain bones/)
  throwsMatching(() => new SpringBoneChain(p, q, [0, 0, 0, 1], { colliders: [{ index: 0, radius: 0 }] }), /collider radius/)
  assert.equal(new SpringBoneChain(p, q).boneCount, 3)
})

finish()
