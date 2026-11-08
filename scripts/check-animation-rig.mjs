import assert from 'node:assert/strict'
import { register } from 'node:module'
import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { TwoBoneIKSolver, FootIKSolver, IKChain, IKRig } from '../src/animation/ikSolver.js'
import * as jzSkel from '../src/animation/skeletonUtils.js'
import { createShapeKeyDriver } from '../src/animation/shapeKeys.js'
import { SpringBoneChain } from '../src/animation/springBones.js'
import { quatSlerp, quatNormalize, quatFromUnitVectors } from '../src/animation/rigMath.js'

const SPOINT = '/workspace/spoint/'
const THREE_URL = pathToFileURL(SPOINT + 'node_modules/three/build/three.module.js').href
const hook = 'export async function resolve(specifier, context, next) {'
  + ' if (specifier === "/node_modules/three/build/three.module.js") return { url: ' + JSON.stringify(THREE_URL) + ', shortCircuit: true };'
  + ' return next(specifier, context) }'
register('data:text/javascript,' + encodeURIComponent(hook))

const THREE = await import(THREE_URL)
const fromSpoint = (file) => import(pathToFileURL(SPOINT + 'src/animation/' + file).href)
const spIK = await fromSpoint('IKSolver.js')
const spSkel = (await fromSpoint('SkeletonUtils.js')).SkeletonUtils
const spShape = await fromSpoint('ShapeKeys.js')
const spSpring = await fromSpoint('SpringBones.js')

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
    if (!(gap <= tolerance) && !Object.is(actual[i], expected[i])) {
      throw new Error(what + '[' + i + '] got ' + actual[i] + ' expected ' + expected[i])
    }
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

const twoBoneCase = (seed, { weight = 1, useWorldSpace = true, reachScale = 0.7, poleZero = false } = {}) => {
  const rnd = seeded(seed)
  const arm = buildArm(rnd)
  const pose = poseOf(arm)
  const sp = new spIK.TwoBoneIKSolver(arm.root, arm.middle, arm.end, { useWorldSpace })
  const jz = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld, { useWorldSpace })
  const dir = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
  const reach = (sp.rootLength + sp.middleLength) * reachScale
  const rootPos = new THREE.Vector3(...pose.rootWorld)
  const target = useWorldSpace ? rootPos.clone().addScaledVector(dir, reach) : new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1))
  const pole = { x: between(rnd, -1, 1), y: between(rnd, -1, 1), z: between(rnd, -1, 1) }
  sp.setTarget(target)
  jz.setTarget(vecOf(target))
  if (!poleZero) {
    sp.setPoleVector(pole)
    jz.setPoleVector([pole.x, pole.y, pole.z])
  }
  sp.weight = weight
  jz.weight = weight
  sp.solve()
  const result = jz.solve(pose)
  return { arm, sp, jz, result, target, pose }
}

gate('TwoBoneIKSolver measures the same bone lengths as spoint from world positions', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const { sp, jz } = twoBoneCase(seed)
    assert.equal(jz.rootLength, sp.rootLength)
    assert.equal(jz.middleLength, sp.middleLength)
  }
})

gate('TwoBoneIKSolver local rotations match spoint on 60 seeded arms with reachable targets and weight 1', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const { sp, result, arm } = twoBoneCase(seed)
    assert.equal(result.solved, true, 'seed ' + seed)
    assert.equal(sp.solved, true, 'spoint seed ' + seed)
    sameTuple(result.rootLocal, quatOf(arm.root.quaternion), 'root seed ' + seed, 1e-12)
    sameTuple(result.middleLocal, quatOf(arm.middle.quaternion), 'middle seed ' + seed, 1e-12)
  }
})

gate('TwoBoneIKSolver matches spoint with weight 0.4, out-of-reach targets, the default pole and local-space targets', () => {
  const variants = [{ weight: 0.4 }, { reachScale: 1.8 }, { poleZero: true }, { useWorldSpace: false }, { weight: 0.4, reachScale: 1.5, useWorldSpace: false }]
  for (const variant of variants) {
    let solvedCount = 0
    for (let seed = 100; seed < 120; seed++) {
      const { sp, result, arm } = twoBoneCase(seed, variant)
      assert.equal(result.solved, sp.solved, JSON.stringify(variant) + ' seed ' + seed)
      if (!result.solved) continue
      solvedCount++
      sameTuple(result.rootLocal, quatOf(arm.root.quaternion), 'root ' + JSON.stringify(variant), 1e-12)
      sameTuple(result.middleLocal, quatOf(arm.middle.quaternion), 'middle ' + JSON.stringify(variant), 1e-12)
    }
    assert.ok(solvedCount >= 15, JSON.stringify(variant) + ' solved only ' + solvedCount)
  }
})

gate('applying the solved rotations puts the end bone on a reachable target', () => {
  for (let seed = 200; seed < 220; seed++) {
    const { result, arm, target } = twoBoneCase(seed)
    arm.root.quaternion.set(...result.rootLocal)
    arm.middle.quaternion.set(...result.middleLocal)
    arm.parent.updateMatrixWorld(true)
    const endNow = arm.end.getWorldPosition(new THREE.Vector3())
    assert.ok(endNow.distanceTo(target) < 1e-9, 'seed ' + seed + ' gap ' + endNow.distanceTo(target))
  }
})

gate('an out-of-reach target leaves the end bone on the root-to-target line at full reach', () => {
  const { result, arm, target, sp } = twoBoneCase(7, { reachScale: 2 })
  arm.root.quaternion.set(...result.rootLocal)
  arm.middle.quaternion.set(...result.middleLocal)
  arm.parent.updateMatrixWorld(true)
  const rootNow = arm.root.getWorldPosition(new THREE.Vector3())
  const endNow = arm.end.getWorldPosition(new THREE.Vector3())
  assert.ok(Math.abs(endNow.distanceTo(rootNow) - (sp.rootLength + sp.middleLength)) < 1e-9)
  const along = target.clone().sub(rootNow).normalize()
  assert.ok(endNow.clone().sub(rootNow).normalize().distanceTo(along) < 1e-9)
})

gate('control: a perturbed target changes the solved root rotation', () => {
  const base = twoBoneCase(9)
  const moved = new TwoBoneIKSolver(base.pose.rootWorld, base.pose.middleWorld, base.pose.endWorld)
  moved.setTarget([base.target.x + 0.05, base.target.y, base.target.z])
  const other = moved.solve(base.pose)
  assert.ok(other.rootLocal.some((v, i) => Math.abs(v - base.result.rootLocal[i]) > 1e-6))
})

gate('TwoBoneIKSolver returns unsolved like spoint for a target on the root, a disabled solver and a missing parent', () => {
  const rnd = seeded(31)
  const arm = buildArm(rnd)
  const pose = poseOf(arm)
  const sp = new spIK.TwoBoneIKSolver(arm.root, arm.middle, arm.end)
  const jz = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
  sp.setTarget(arm.root.getWorldPosition(new THREE.Vector3()))
  jz.setTarget(pose.rootWorld)
  sp.solve()
  assert.equal(sp.solved, false)
  assert.equal(jz.solve(pose).solved, false)
  jz.setTarget([9, 9, 9])
  jz.enabled = false
  assert.equal(jz.solve(pose).solved, false)
  jz.enabled = true
  assert.equal(jz.solve({ ...pose, parentWorldQuat: null }).solved, false)
  const orphan = new THREE.Bone()
  const mid = new THREE.Bone()
  mid.position.set(0, 1, 0)
  const tip = new THREE.Bone()
  tip.position.set(0, 1, 0)
  orphan.add(mid)
  mid.add(tip)
  orphan.updateMatrixWorld(true)
  const spOrphan = new spIK.TwoBoneIKSolver(orphan, mid, tip).setTarget({ x: 1, y: 1, z: 0 })
  spOrphan.solve()
  assert.equal(spOrphan.solved, false)
  assert.equal(jz.solve(pose).solved, true)
})

gate('TwoBoneIKSolver refuses what spoint refuses: non-finite targets, a zero pole, bad tolerance and a non-boolean world-space flag', () => {
  const jz = new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0])
  throwsMatching(() => jz.setTarget([0, NaN, 0]), /setTarget needs 3 finite numbers/)
  throwsMatching(() => jz.setTarget({ x: 0, y: 0, z: 0 }), /setTarget needs 3 finite numbers/)
  throwsMatching(() => jz.setPoleVector([0, 0, 0]), /non-zero length/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { tolerance: 0 }), /tolerance needs a finite number greater than 0/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1, 0], [0, 2, 0], { useWorldSpace: 'yes' }), /useWorldSpace needs a boolean/)
  throwsMatching(() => new TwoBoneIKSolver([0, 0, 0], [0, 1], [0, 2, 0]), /middle position needs 3 finite numbers/)
  const spBones = [new THREE.Bone(), new THREE.Bone(), new THREE.Bone()]
  const sp = new spIK.TwoBoneIKSolver(...spBones)
  throwsMatching(() => sp.setPoleVector({ x: 0, y: 0, z: 0 }), /non-zero length/)
  throwsMatching(() => new spIK.TwoBoneIKSolver(...spBones, { tolerance: 0 }), /tolerance needs a finite number greater than 0/)
})

const buildFoot = (rnd) => {
  const parent = new THREE.Group()
  parent.position.set(between(rnd, -2, 2), between(rnd, -2, 2), between(rnd, -2, 2))
  parent.quaternion.copy(randomQuat(rnd))
  parent.scale.set(between(rnd, 0.5, 2), between(rnd, 0.5, 2), between(rnd, 0.5, 2))
  const foot = new THREE.Bone()
  foot.position.set(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1))
  parent.add(foot)
  parent.updateMatrixWorld(true)
  return { parent, foot }
}

gate('FootIKSolver gives the same local height adjustment as spoint under rotated and scaled parents', () => {
  for (let seed = 300; seed < 330; seed++) {
    const rnd = seeded(seed)
    const { parent, foot } = buildFoot(rnd)
    const groundY = between(rnd, -3, 3)
    const weight = seed % 2 === 0 ? 1 : 0.6
    const before = vecOf(foot.position)
    const footWorld = worldPos(foot)
    const spCalls = []
    const sp = new spIK.FootIKSolver(foot, (origin, direction, distance) => {
      spCalls.push([vecOf(origin), vecOf(direction), distance])
      return { x: 0, y: groundY, z: 0 }
    }, { rayDistance: 4 })
    sp.weight = weight
    sp.solve()
    const jzCalls = []
    const jz = new FootIKSolver((origin, direction, distance) => {
      jzCalls.push([origin, direction, distance])
      return [0, groundY, 0]
    }, { rayDistance: 4 })
    jz.weight = weight
    const result = jz.solve(footWorld, Array.from(parent.matrixWorld.elements))
    assert.equal(result.solved, true)
    assert.deepEqual(jzCalls, spCalls)
    sameTuple([before[0] + result.delta[0], before[1] + result.delta[1], before[2] + result.delta[2]], vecOf(foot.position), 'foot seed ' + seed, 0)
  }
})

gate('FootIKSolver casts from half the ray distance above the foot, straight down', () => {
  let seen = null
  const jz = new FootIKSolver((origin, direction, distance) => { seen = { origin, direction, distance }; return null })
  assert.equal(jz.solve([1, 2, 3]).solved, false)
  assert.deepEqual(seen, { origin: [1, 7, 3], direction: [0, -1, 0], distance: 10 })
  const noParent = new FootIKSolver(() => [0, -0.5, 0]).solve([1, 2, 3])
  assert.deepEqual(noParent, { solved: true, delta: [0, -2.5, 0] })
})

gate('FootIKSolver stays unsolved on a miss or a non-finite hit and refuses a missing callback or bad ray distance', () => {
  assert.equal(new FootIKSolver(() => [0, NaN, 0]).solve([0, 0, 0]).solved, false)
  assert.equal(new FootIKSolver(() => undefined).solve([0, 0, 0]).solved, false)
  const disabled = new FootIKSolver(() => [0, 1, 0])
  disabled.enabled = false
  assert.equal(disabled.solve([0, 0, 0]).solved, false)
  throwsMatching(() => new FootIKSolver(null), /needs a raycast callback function; got null/)
  throwsMatching(() => new FootIKSolver(() => null, { rayDistance: -1 }), /rayDistance needs a finite number greater than 0; got -1/)
  const spBone = new THREE.Bone()
  throwsMatching(() => new spIK.FootIKSolver(spBone, null), /needs a raycast callback function; got null/)
  throwsMatching(() => new spIK.FootIKSolver(spBone, () => null, { rayDistance: -1 }), /rayDistance needs a finite number greater than 0; got -1/)
})

gate('IKChain records solvers without solve as refusals and runs the rest in order, as spoint does', () => {
  for (const Chain of [IKChain, spIK.IKChain]) {
    const order = []
    const chain = new Chain('legs')
    chain.addSolver({ solve: () => order.push('a') }).addSolver(null).addSolver({}).addSolver({ solve: () => order.push('b') })
    chain.solve()
    assert.deepEqual(order, ['a', 'b'])
    assert.equal(chain.refusals.length, 2)
    chain.disable().solve()
    assert.deepEqual(order, ['a', 'b'])
    chain.enable().solve()
    assert.deepEqual(order, ['a', 'b', 'a', 'b'])
  }
})

gate('IKRig refuses an empty or duplicate chain name and skips every chain while disabled, as spoint does', () => {
  for (const Rig of [IKRig, spIK.IKRig]) {
    const rig = new Rig({ bones: [] })
    let runs = 0
    rig.createChain('arm').addSolver({ solve: () => runs++ })
    throwsMatching(() => rig.createChain('arm'), /cannot replace the chain already named "arm"/)
    throwsMatching(() => rig.createChain(''), /needs a non-empty chain name/)
    rig.update()
    rig.disable().update()
    assert.equal(runs, 1)
    rig.enable().update()
    assert.equal(runs, 2)
    assert.equal(rig.getChain('missing'), undefined)
  }
})

const NAMED_BONES = ['root', 'spine', 'Chest', 'armature|neck', 'Head', 'shoulder.l', 'RightShoulder', 'upper_armL', 'armature|upper_arm.r', 'LeftForeArm',
  'lower_armR', 'handL', 'RightHand', 'LeftUpLeg', 'upper_legR', 'armature|lower_leg.l', 'RightLeg', 'footL', 'armature|foot.r', 'Hips', 'constructor', 'tail']
const HUMANOID_KEYS = ['hips', 'spine', 'chest', 'neck', 'head', 'leftShoulder', 'rightShoulder', 'leftUpperArm', 'rightUpperArm', 'leftLowerArm', 'rightLowerArm',
  'leftHand', 'rightHand', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg', 'leftFoot', 'rightFoot', 'tail', 'constructor', 'toString', 'missing']

gate('bone lookups by name and humanoid name match spoint, including the literal fallback for unknown and prototype names', () => {
  const jzSkeleton = { bones: NAMED_BONES.map((name) => ({ name, quaternion: [0, 0, 0, 1] })) }
  const spSkeleton = { bones: NAMED_BONES.map((name) => Object.assign(new THREE.Bone(), { name })) }
  for (const key of HUMANOID_KEYS) {
    assert.equal(jzSkel.findBoneByHumanoidName(jzSkeleton, key)?.name ?? null, spSkel.findBoneByHumanoidName(spSkeleton, key)?.name ?? null, key)
  }
  for (const name of [...NAMED_BONES, 'nope']) {
    assert.equal(jzSkel.findBoneByName(jzSkeleton, name)?.name ?? null, spSkel.findBoneByName(spSkeleton, name)?.name ?? null, name)
  }
  assert.equal(jzSkel.getRootBone(jzSkeleton).name, spSkel.getRootBone(spSkeleton).name)
  const noHips = { bones: [{ name: 'tail' }, { name: 'spine' }] }
  assert.equal(jzSkel.getRootBone(noHips).name, 'tail')
  assert.equal(spSkel.getRootBone({ bones: [{ name: 'tail' }, { name: 'spine' }] }).name, 'tail')
  assert.equal(jzSkel.getRootBone({ bones: [] }), null)
  assert.equal(jzSkel.getRootBone(null), null)
  assert.equal(jzSkel.findBoneByHumanoidName(undefined, 'hips'), null)
  assert.deepEqual([...jzSkel.buildBoneMap(jzSkeleton).keys()], [...spSkel.buildBoneMap(spSkeleton).keys()])
  assert.equal(jzSkel.buildBoneMap(null).size, 0)
  assert.equal(jzSkel.findBoneByHumanoidName(jzSkeleton, 'hips').name, 'Hips')
  assert.equal(jzSkel.findBoneByHumanoidName(jzSkeleton, 'constructor').name, 'constructor')
})

gate('quaternion and vector interpolation match three slerp and lerp as spoint calls them', () => {
  const rnd = seeded(77)
  for (let i = 0; i < 40; i++) {
    const a = randomQuat(rnd)
    const b = randomQuat(rnd)
    const t = between(rnd, -0.2, 1.2)
    sameTuple(jzSkel.interpolateQuaternion(quatOf(a), quatOf(b), t), quatOf(spSkel.interpolateQuaternion(a, b, t)), 'slerp ' + i, 0)
    const near = a.clone().slerp(b, 1e-4)
    sameTuple(quatSlerp(quatOf(a), quatOf(near), t), quatOf(a.clone().slerp(near, t)), 'near slerp ' + i, 0)
    const u = new THREE.Vector3(between(rnd, -5, 5), between(rnd, -5, 5), between(rnd, -5, 5))
    const v = new THREE.Vector3(between(rnd, -5, 5), between(rnd, -5, 5), between(rnd, -5, 5))
    sameTuple(jzSkel.interpolateVector3(vecOf(u), vecOf(v), t), vecOf(spSkel.interpolateVector3(u, v, t)), 'lerp ' + i, 0)
  }
})

gate('packQuaternion and unpackQuaternion match spoint for unit, scaled, zero and Int16Array buffers', () => {
  const rnd = seeded(91)
  const inputs = [[0, 0, 0, 0], [0, 0, 0, 1], [0.0001, 0, 0, 0], [3, -4, 0, 0]]
  for (let i = 0; i < 30; i++) inputs.push(quatOf(randomQuat(rnd)).map((c) => c * between(rnd, 0.2, 3)))
  for (const q of inputs) {
    for (const Buffer of [Array, Int16Array, Float64Array]) {
      const jzBuf = Buffer === Array ? new Array(6).fill(0) : new Buffer(6)
      const spBuf = Buffer === Array ? new Array(6).fill(0) : new Buffer(6)
      jzSkel.packQuaternion(q, jzBuf, 2)
      spSkel.packQuaternion(new THREE.Quaternion(...q), spBuf, 2)
      assert.deepEqual(Array.from(jzBuf), Array.from(spBuf), JSON.stringify(q))
      sameTuple(jzSkel.unpackQuaternion(jzBuf, 2), quatOf(spSkel.unpackQuaternion(spBuf, 2)), 'unpack ' + JSON.stringify(q), 0)
    }
  }
  const zero = [0, 0, 0, 0]
  jzSkel.packQuaternion([0, 0, 0, 0], zero)
  assert.deepEqual(zero, [0, 0, 0, 0])
  assert.deepEqual(jzSkel.unpackQuaternion(zero), [0, 0, 0, 1])
  const tiny = [0, 0, 0, 0]
  jzSkel.packQuaternion([0.0005, 0, 0, 0], tiny)
  assert.deepEqual(tiny, [16384, 0, 0, 0])
})

gate('skeleton state packing round-trips through spoint and refuses a short buffer with spoint message', () => {
  const rnd = seeded(12)
  const quats = Array.from({ length: 5 }, () => quatOf(randomQuat(rnd)))
  const jzSkeleton = { bones: quats.map((q, i) => ({ name: 'b' + i, quaternion: q.slice() })) }
  const spSkeleton = { bones: quats.map((q, i) => Object.assign(new THREE.Bone(), { name: 'b' + i })) }
  spSkeleton.bones.forEach((bone, i) => bone.quaternion.set(...quats[i]))
  const jzBuf = new Int16Array(23)
  const spBuf = new Int16Array(23)
  assert.equal(jzSkel.packSkeletonState(jzSkeleton, jzBuf, 3), spSkel.packSkeletonState(spSkeleton, spBuf, 3))
  assert.deepEqual(Array.from(jzBuf), Array.from(spBuf))
  const restored = { bones: quats.map(() => ({ quaternion: [9, 9, 9, 9] })) }
  assert.equal(jzSkel.unpackSkeletonState(restored, jzBuf, 3), 23)
  spSkel.unpackSkeletonState(spSkeleton, spBuf, 3)
  restored.bones.forEach((bone, i) => sameTuple(bone.quaternion, quatOf(spSkeleton.bones[i].quaternion), 'restored ' + i, 0))
  assert.throws(() => jzSkel.packSkeletonState(jzSkeleton, new Int16Array(22), 3), /need 23 slots, got 22/)
  assert.throws(() => spSkel.packSkeletonState(spSkeleton, new Int16Array(22), 3), /need 23 slots, got 22/)
  assert.throws(() => jzSkel.unpackSkeletonState(restored, new Int16Array(22), 3), /need 23 slots, got 22/)
  assert.equal(jzSkel.packSkeletonState(null, jzBuf, 4), 4)
})

const meshTree = (Make) => {
  const root = Make('group')
  const body = Make('mesh', { smile: 0, blink: 1 }, [0.2, 0.3])
  const eyes = Make('mesh', { blink: 0, squint: 1 }, [0.9, 0.1])
  const plain = Make('mesh', null, null)
  const deep = Make('mesh', { smile: 0 }, [0.6])
  root.add(body)
  root.add(plain)
  body.add(eyes)
  plain.add(deep)
  return root
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

gate('the shape key driver matches spoint on a three tree and a plain tree: names, meshes, clamped writes, setMany, reset and snapshot', () => {
  for (const tree of [meshTree(threeNode), meshTree(plainNode)]) {
    const jz = createShapeKeyDriver(tree)
    const spFresh = spShape.createShapeKeyDriver(meshTree(threeNode))
    assert.equal(jz.meshCount, spFresh.meshCount)
    assert.deepEqual(jz.names(), spFresh.names())
    assert.deepEqual(jz.snapshot(), spFresh.snapshot())
    assert.equal(jz.set('smile', 1.7), spFresh.set('smile', 1.7))
    assert.equal(jz.set('blink', -2), spFresh.set('blink', -2))
    jz.setMany({ squint: 0.25, smile: 0.5 })
    spFresh.setMany({ squint: 0.25, smile: 0.5 })
    assert.deepEqual(jz.snapshot(), spFresh.snapshot())
    jz.reset()
    spFresh.reset()
    assert.deepEqual(jz.snapshot(), spFresh.snapshot())
    assert.equal(jz.meshCount, 3)
  }
})

gate('the shape key driver refuses unknown names and non-finite weights with spoint messages', () => {
  const jz = createShapeKeyDriver(meshTree(plainNode))
  const sp = spShape.createShapeKeyDriver(meshTree(threeNode))
  for (const driver of [jz, sp]) {
    throwsMatching(() => driver.set('frown', 1), /no shape key named "frown"/)
    throwsMatching(() => driver.get('frown'), /no shape key named "frown"/)
    assert.throws(() => driver.set('smile', NaN), TypeError)
    assert.throws(() => driver.set('smile', '1'), TypeError)
  }
})

gate('improvement: a prototype name such as toString is refused, where spoint writes it onto the influence array', () => {
  const tree = meshTree(threeNode)
  const sp = spShape.createShapeKeyDriver(tree)
  sp.set('toString', 0.5)
  const body = tree.children[0]
  const stray = Object.keys(body.morphTargetInfluences).filter((key) => !/^\d+$/.test(key))
  assert.equal(stray.length, 1)
  const jz = createShapeKeyDriver(meshTree(plainNode))
  throwsMatching(() => jz.set('toString', 0.5), /no shape key named "toString"/)
  throwsMatching(() => jz.get('constructor'), /no shape key named "constructor"/)
})

const buildTail = (rnd, count) => {
  const parent = new THREE.Group()
  parent.position.set(between(rnd, -1, 1), between(rnd, 1, 2), between(rnd, -1, 1))
  parent.quaternion.copy(randomQuat(rnd))
  const bones = []
  let holder = parent
  for (let i = 0; i < count; i++) {
    const bone = new THREE.Bone()
    bone.name = 'tail' + i
    if (i > 0) bone.position.set(between(rnd, -0.2, 0.2), between(rnd, 0.2, 0.5), between(rnd, -0.2, 0.2))
    bone.quaternion.copy(randomQuat(rnd))
    holder.add(bone)
    bones.push(bone)
    holder = bone
  }
  parent.updateMatrixWorld(true)
  return { parent, bones }
}

const springCase = (seed, options, steps) => {
  const rnd = seeded(seed)
  const { parent, bones } = buildTail(rnd, 4 + (seed % 3))
  const spColliders = (options.colliders ?? []).map((c) => ({ ...c, bone: bones[c.index] }))
  const sp = new spSpring.SpringBoneChain(bones, { ...options, colliders: spColliders })
  const jz = new SpringBoneChain(bones.map(worldPos), bones.map(worldQuat), worldQuat(parent), options)
  const wind = options.wind ? new THREE.Vector3(between(rnd, -1, 1), 0, between(rnd, -1, 1)).normalize() : null
  for (let s = 0; s < steps; s++) {
    parent.position.x += between(rnd, -0.08, 0.08)
    parent.position.z += between(rnd, -0.08, 0.08)
    parent.updateMatrixWorld(true)
    const dt = s % 5 === 4 ? 0.2 : 1 / 60
    sp.update(dt, wind)
    const locals = jz.update(dt, worldPos(bones[0]), wind ? vecOf(wind) : null)
    assert.equal(locals.length, bones.length - 1)
    locals.forEach((q, k) => sameTuple(q, quatOf(bones[k].quaternion), 'seed ' + seed + ' step ' + s + ' bone ' + k, 1e-12))
    jz.points.forEach((p, k) => sameTuple(p, vecOf(sp.points[k]), 'point ' + k, 1e-12))
  }
  return { sp, jz, bones }
}

gate('SpringBoneChain bone rotations and points match spoint over 40 steps with the default options', () => {
  for (let seed = 400; seed < 410; seed++) springCase(seed, {}, 40)
})

gate('SpringBoneChain matches spoint with gravity, wind, a bend limit and full bounce', () => {
  for (let seed = 410; seed < 420; seed++) springCase(seed, { amount: 0.3, bounce: 1, gravity: 0.8, wind: { force: 3 }, limit: 25 }, 40)
})

gate('SpringBoneChain matches spoint with colliders, including spoint moving the collider centre after each push', () => {
  let differs = 0
  for (let seed = 420; seed < 430; seed++) {
    const options = { gravity: 1, limit: 170 }
    const withColliders = springCase(seed, { ...options, colliders: [{ index: 0, radius: 0.9, offset: [0, 0.1, 0] }, { index: 1, radius: 0.6 }] }, 40)
    const without = springCase(seed, options, 40)
    if (withColliders.jz.points.some((p, k) => p.some((v, i) => Math.abs(v - without.jz.points[k][i]) > 1e-9))) differs++
  }
  assert.ok(differs >= 5, 'colliders changed only ' + differs + ' of 10 chains')
})

gate('SpringBoneChain ignores a non-positive dt, clamps a long dt to 1/30 s, and moves when the root moves', () => {
  const rnd = seeded(500)
  const { bones } = buildTail(rnd, 4)
  const make = () => new SpringBoneChain(bones.map(worldPos), bones.map(worldQuat), [0, 0, 0, 1], { gravity: 1 })
  const a = make()
  assert.equal(a.update(0, worldPos(bones[0])), null)
  assert.equal(a.update(NaN, worldPos(bones[0])), null)
  const b = make()
  const c = make()
  const root = worldPos(bones[0])
  assert.deepEqual(b.update(5, root), c.update(1 / 30, root))
  const d = make()
  const still = make().update(1 / 60, root)
  const shifted = d.update(1 / 60, [root[0] + 0.3, root[1], root[2]])
  assert.ok(shifted.some((q, k) => q.some((v, i) => Math.abs(v - still[k][i]) > 1e-9)))
})

gate('SpringBoneChain refuses what spoint refuses: short chains, stacked bones, bad fractions, limits, wind and colliders', () => {
  const p = [[0, 0, 0], [0, 1, 0], [0, 2, 0]]
  const q = [[0, 0, 0, 1], [0, 0, 0, 1], [0, 0, 0, 1]]
  throwsMatching(() => new SpringBoneChain([[0, 0, 0]], [[0, 0, 0, 1]]), /at least two bones/)
  throwsMatching(() => new SpringBoneChain(p, q.slice(1)), /one world quaternion per bone/)
  throwsMatching(() => new SpringBoneChain([[0, 0, 0], [0, 0, 0]], q.slice(1)), /bone 0 sits on bone 1/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { amount: 1.5 }), /amount needs a number from 0 to 1; got 1.5/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { bounce: NaN }), /bounce needs a number from 0 to 1; got NaN/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { limit: 0 }), /limit needs degrees from over 0 to 180; got 0/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { limit: 181 }), /limit needs degrees/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { wind: { force: -1 } }), /wind.force needs a finite number of at least 0; got -1/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { colliders: [{ index: 3, radius: 1 }] }), /collider bone must be one of the chain bones/)
  throwsMatching(() => new SpringBoneChain(p, q, undefined, { colliders: [{ index: 1, radius: 0 }] }), /collider radius needs a number greater than 0; got 0/)
  throwsMatching(() => new SpringBoneChain([[0, 0, 0], [0, NaN, 0]], q.slice(1)), /world position 1 needs 3 finite numbers/)
  const bones = [new THREE.Bone(), new THREE.Bone()]
  bones[1].position.set(0, 1, 0)
  bones[0].add(bones[1])
  throwsMatching(() => new spSpring.SpringBoneChain(bones, { amount: 1.5 }), /amount needs a number from 0 to 1; got 1.5/)
  throwsMatching(() => new spSpring.SpringBoneChain(bones, { limit: 0 }), /limit needs degrees from over 0 to 180; got 0/)
  throwsMatching(() => new spSpring.SpringBoneChain(bones, { colliders: [{ bone: bones[0], radius: 0 }] }), /collider radius needs a number greater than 0; got 0/)
})

gate('quatFromUnitVectors matches three on general, opposite and nearly opposite vectors, including the 1e-8 switch', () => {
  const rnd = seeded(610)
  const cases = []
  for (let i = 0; i < 20; i++) {
    const from = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
    const to = new THREE.Vector3(between(rnd, -1, 1), between(rnd, -1, 1), between(rnd, -1, 1)).normalize()
    cases.push([from, to], [from, from.clone().negate()])
  }
  const nearlyOpposite = new THREE.Vector3(-1, Math.sqrt(1e-7), 0).normalize()
  cases.push([new THREE.Vector3(1, 0, 0), nearlyOpposite], [new THREE.Vector3(0, 0, 1), new THREE.Vector3(0, 0, -1)])
  let flipped = 0
  for (const [from, to] of cases) {
    const expected = quatOf(new THREE.Quaternion().setFromUnitVectors(from, to))
    if (from.dot(to) + 1 < 1e-8) flipped++
    sameTuple(quatFromUnitVectors(vecOf(from), vecOf(to)), expected, 'fromUnitVectors', 0)
  }
  assert.ok(flipped >= 20, 'opposite branch reached ' + flipped + ' times')
  const near = quatFromUnitVectors([1, 0, 0], vecOf(nearlyOpposite))
  assert.ok(Math.abs(near[2]) > 0.5, 'a dot of 1 - 5e-8 takes the cross-product branch, as three does')
})

gate('TwoBoneIKSolver matches spoint when the pole lies along the root-to-target line, on both reference axes', () => {
  let solved = 0
  for (const [seed, dirArray] of [[640, [0.2, 0.9, -0.3]], [641, [0.99, 0.1, 0.05]], [642, [-0.95, -0.2, 0.1]], [643, [0, 0, 1]], [644, [0.93, 0.3, 0.2]]]) {
    const rnd = seeded(seed)
    const arm = buildArm(rnd)
    const pose = poseOf(arm)
    const sp = new spIK.TwoBoneIKSolver(arm.root, arm.middle, arm.end)
    const jz = new TwoBoneIKSolver(pose.rootWorld, pose.middleWorld, pose.endWorld)
    const dir = new THREE.Vector3(...dirArray).normalize()
    const target = new THREE.Vector3(...pose.rootWorld).addScaledVector(dir, (sp.rootLength + sp.middleLength) * 0.6)
    const parentQuat = arm.parent.getWorldQuaternion(new THREE.Quaternion())
    const pole = dir.clone().applyQuaternion(parentQuat.clone().invert())
    sp.setTarget(target).setPoleVector(pole)
    jz.setTarget(vecOf(target)).setPoleVector(vecOf(pole))
    sp.solve()
    const result = jz.solve(pose)
    assert.equal(result.solved, sp.solved)
    if (!result.solved) continue
    solved++
    sameTuple(result.rootLocal, quatOf(arm.root.quaternion), 'pole fallback root ' + seed, 1e-12)
    sameTuple(result.middleLocal, quatOf(arm.middle.quaternion), 'pole fallback middle ' + seed, 1e-12)
  }
  assert.equal(solved, 5)
})

gate('control: unpacking a perturbed buffer changes the quaternion', () => {
  const buf = [0, 0, 0, 0]
  jzSkel.packQuaternion(quatNormalize([0.1, 0.2, 0.3, 0.9]), buf)
  const base = jzSkel.unpackQuaternion(buf)
  buf[0] += 50
  assert.ok(jzSkel.unpackQuaternion(buf).some((v, i) => Math.abs(v - base[i]) > 1e-4))
})

finish()
