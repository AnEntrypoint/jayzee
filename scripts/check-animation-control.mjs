import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createAnimationController, CONTROLLER_DEFAULTS } from '../src/animation/animationController.js'
import { RagdollPose, RagdollPoseError, RAGDOLL_JOINTS } from '../src/animation/ragdollPose.js'
import { parseRagdollActivation, checkRagdollPlan, applyRagdollActivation, RagdollActivationError } from '../src/animation/ragdollActivation.js'
import { buildProceduralSkeleton, boneOf, computeSkinBinding, bindSkin } from '../src/animation/proceduralSkeleton.js'
import { AnimationSystem, setupFootGrounding, groundFeet, FOOT_GROUNDING_DEFAULTS } from '../src/animation/animationSystem.js'
import { IKRig, TwoBoneIKSolver } from '../src/animation/ikSolver.js'

const fakeBlender = (durations = {}) => {
  const log = []
  return {
    log,
    playClip: (name, fade) => { log.push(['play', name, fade]) },
    updateBlend: (dt) => { log.push(['blend', dt]) },
    getClipDuration: (name) => durations[name] ?? 1,
    stop: () => { log.push(['stop']) },
    registerClip: (name, clip) => { log.push(['register', name, clip]) },
    crossFade: (a, b, fade) => { log.push(['cross', a, b, fade]) },
    setBlendTree: (tree) => { log.push(['tree', tree]) },
    stopAll: () => { log.push(['stopAll']) },
  }
}

const manualClock = () => {
  let t = 0
  return { now: () => t, set: (v) => { t = v } }
}

const makeController = (options = {}, durations = {}) => {
  const blender = fakeBlender(durations)
  const clock = manualClock()
  const controller = createAnimationController(blender, options, { now: clock.now })
  return { blender, clock, controller }
}

const plays = (blender) => blender.log.filter((e) => e[0] === 'play').map((e) => e[1] + '@' + e[2])

const throwsCode = (fn, code, field = 'code') => {
  let caught = null
  try { fn() } catch (error) { caught = error }
  assert.ok(caught, 'expected a throw with ' + code)
  assert.equal(caught[field], code)
}

gate('the controller starts in idle and plays Idle with a 0.3 s fade, as spoint idle.enter does', () => {
  const { blender, controller } = makeController()
  assert.equal(controller.getState(), 'idle')
  assert.deepEqual(plays(blender), ['Idle@0.3'])
  assert.equal(CONTROLLER_DEFAULTS.runSpeed, 5)
  assert.equal(CONTROLLER_DEFAULTS.sprintSpeed, 10)
})

gate('idle moves to walk above walkSpeed 1.5 and to run above runSpeed 5, with the spoint clip names and fades', () => {
  const a = makeController()
  a.controller.update(0.016, { speed: 3 })
  assert.equal(a.controller.getState(), 'walk')
  assert.deepEqual(plays(a.blender), ['Idle@0.3', 'WalkLoop@0.3'])
  const b = makeController()
  b.controller.update(0.016, { speed: 6 })
  assert.equal(b.controller.getState(), 'run')
})

gate('control: speed 1.5 exactly does not leave idle, since idle compares with a strict greater-than', () => {
  const { controller } = makeController()
  controller.update(0.016, { speed: 1.5 })
  assert.equal(controller.getState(), 'idle')
})

gate('idle never sends SPRINT itself: speed 12 goes to run, and only the next tick reaches sprint with SprintLoop at 0.2', () => {
  const { blender, controller } = makeController()
  controller.update(0.016, { speed: 12 })
  assert.equal(controller.getState(), 'run')
  controller.update(0.016, { speed: 12 })
  assert.equal(controller.getState(), 'sprint')
  assert.deepEqual(plays(blender).slice(-1), ['SprintLoop@0.2'])
})

gate('a single idle tick that is fast and airborne sends RUN and then JUMP into the new run state, ending in jump', () => {
  const { blender, controller } = makeController()
  controller.update(0.016, { speed: 6, isGrounded: false })
  assert.equal(controller.getState(), 'jump')
  assert.deepEqual(plays(blender), ['Idle@0.3', 'RunLoop@0.3', 'JumpStart@0.1'])
})

gate('walk keeps walking down to 0.1 and drops to idle below it, which is lower than the 1.5 that enters walk', () => {
  const { controller } = makeController()
  controller.update(0.016, { speed: 3 })
  controller.update(0.016, { speed: 1 })
  assert.equal(controller.getState(), 'walk')
  controller.update(0.016, { speed: 0.05 })
  assert.equal(controller.getState(), 'idle')
})

gate('run drops to idle below walkSpeed and to walk below runSpeed', () => {
  const a = makeController()
  a.controller.update(0.016, { speed: 6 })
  a.controller.update(0.016, { speed: 1 })
  assert.equal(a.controller.getState(), 'idle')
  const b = makeController()
  b.controller.update(0.016, { speed: 6 })
  b.controller.update(0.016, { speed: 3 })
  assert.equal(b.controller.getState(), 'walk')
})

gate('sprint returns to run only below runSpeed, so speed 7 keeps sprinting', () => {
  const { controller } = makeController()
  controller.update(0.016, { speed: 12 })
  controller.update(0.016, { speed: 12 })
  controller.update(0.016, { speed: 7 })
  assert.equal(controller.getState(), 'sprint')
  controller.update(0.016, { speed: 4 })
  assert.equal(controller.getState(), 'run')
})

gate('jump lands only when grounded with vertical velocity at or below zero, and plays Land at 0.15', () => {
  const { blender, controller } = makeController()
  controller.update(0.016, { isGrounded: false })
  controller.update(0.016, { isGrounded: true, verticalVelocity: 1 })
  assert.equal(controller.getState(), 'jump')
  controller.update(0.016, { isGrounded: true, verticalVelocity: 0 })
  assert.equal(controller.getState(), 'land')
  assert.deepEqual(plays(blender).slice(-1), ['Land@0.15'])
})

const landedAt = (speed, ms) => {
  const made = makeController()
  made.controller.update(0.016, { isGrounded: false })
  made.clock.set(1000)
  made.controller.update(0.016, { isGrounded: true })
  made.clock.set(1000 + ms)
  made.controller.update(0.016, { speed })
  return made.controller.getState()
}

gate('land holds until 500 ms on the injected clock, then settles to idle, walk or run by speed', () => {
  assert.equal(landedAt(0.3, 499), 'land')
  assert.equal(landedAt(0.3, 500), 'idle')
  assert.equal(landedAt(3, 500), 'walk')
  assert.equal(landedAt(6, 500), 'run')
})

gate('control: a NaN speed at the 500 ms timer matches no guard, and land is kept after the timer has fired once', () => {
  const made = makeController()
  made.controller.update(0.016, { isGrounded: false })
  made.controller.update(0.016, { isGrounded: true })
  made.clock.set(500)
  made.controller.update(0.016, { speed: NaN })
  made.clock.set(5000)
  made.controller.update(0.016, { speed: 0 })
  assert.equal(made.controller.getState(), 'land')
})

gate('attack ends only once time in state exceeds the clip duration in milliseconds, then settles by speed', () => {
  const { controller, clock, blender } = makeController({}, { Attack: 0.8 })
  controller.setState('attack')
  assert.deepEqual(plays(blender).slice(-1), ['Attack@0.1'])
  clock.set(800)
  controller.update(0.016, { speed: 3 })
  assert.equal(controller.getState(), 'attack')
  clock.set(801)
  controller.update(0.016, { speed: 3 })
  assert.equal(controller.getState(), 'walk')
})

gate('die is final: later requests and ticks leave it in die', () => {
  const { controller } = makeController()
  controller.setState('die')
  controller.setState('idle')
  controller.update(0.016, { speed: 6, isGrounded: false })
  assert.equal(controller.getState(), 'die')
})

gate('setState maps the seven spoint names to events, and land or an unknown name sends nothing', () => {
  const { controller } = makeController()
  assert.equal(controller.setState('land'), controller)
  assert.equal(controller.getState(), 'idle')
  controller.setState('nope')
  assert.equal(controller.getState(), 'idle')
  controller.setState('sprint')
  assert.equal(controller.getState(), 'sprint')
  controller.setState('jump')
  assert.equal(controller.getState(), 'jump')
})

gate('control: a request the current state has no transition for is ignored, so jump refuses walk', () => {
  const { controller } = makeController()
  controller.setState('jump')
  controller.setState('walk')
  assert.equal(controller.getState(), 'jump')
})

gate('direction is copied into a Float32Array only from a plain array, so a typed array direction is ignored', () => {
  const { controller } = makeController()
  controller.update(0.016, { direction: [0.1, 0.2, 0.3] })
  assert.deepEqual(Array.from(controller.fsm.context.direction), [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)])
  controller.update(0.016, { direction: new Float32Array([1, 1, 1]) })
  assert.deepEqual(Array.from(controller.fsm.context.direction), [Math.fround(0.1), Math.fround(0.2), Math.fround(0.3)])
})

gate('update ticks the machine first and then calls blender.updateBlend with the same dt', () => {
  const { blender, controller } = makeController()
  controller.update(0.25, { speed: 3 })
  const tail = blender.log.slice(-2)
  assert.deepEqual(tail, [['play', 'WalkLoop', 0.3], ['blend', 0.25]])
})

gate('options override the speed thresholds, so runSpeed 3 makes speed 4 a run', () => {
  const { controller } = makeController({ runSpeed: 3 })
  controller.update(0.016, { speed: 4 })
  assert.equal(controller.getState(), 'run')
})

gate('onStateChange reports each new state and its unsubscribe stops the reports', () => {
  const { controller } = makeController()
  const seen = []
  const off = controller.onStateChange((s) => seen.push(s))
  controller.update(0.016, { speed: 3 })
  off()
  controller.update(0.016, { speed: 6 })
  assert.deepEqual(seen, ['walk'])
})

gate('dispose stops the machine and the blender, and later ticks no longer change state', () => {
  const { controller, blender } = makeController()
  controller.dispose()
  assert.deepEqual(blender.log.slice(-1), [['stop']])
  controller.update(0.016, { speed: 6 })
  assert.equal(controller.getState(), 'idle')
})

gate('refused: a controller without a clock, a blender without playClip, and a NaN dt', () => {
  assert.throws(() => createAnimationController(fakeBlender(), {}, {}), /now\(\) clock/)
  const broken = { ...fakeBlender(), playClip: undefined }
  assert.throws(() => createAnimationController(broken, {}, { now: () => 0 }), /blender.playClip/)
  const { controller } = makeController()
  assert.throws(() => controller.update(NaN, {}), /dt/)
})

const humanoid = (names) => ({ bones: names.map((name) => ({ name, quaternion: [0, 0, 0, 1] })) })
const FULL = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
const yRotation = (angle) => [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)]
const angleAboutY = (q) => 2 * Math.atan2(q[1], q[3])
const close = (a, b, eps = 1e-12) => Math.abs(a - b) < eps

gate('RAGDOLL_JOINTS is spoint\'s sixteen joints, and a full humanoid skeleton gets all sixteen with hips as the anchor', () => {
  assert.equal(RAGDOLL_JOINTS.length, 16)
  const pose = new RagdollPose(humanoid(FULL))
  assert.equal(pose.joints.length, 16)
  assert.equal(pose.anchor.name, 'Hips')
  assert.equal(pose.stiffness, 40)
  assert.equal(pose.limpRate, 3)
})

gate('the anchor option takes a joint out of the driven set, and missing bones are skipped', () => {
  const pose = new RagdollPose(humanoid(['armature|hips', 'Spine', 'Head']), { anchor: 'spine' })
  assert.equal(pose.anchor.name, 'Spine')
  assert.deepEqual(pose.joints.map((j) => j.name), ['head'])
})

gate('a full-strength joint follows the animated pose by 1 - exp(-40 dt) of the angle', () => {
  const skeleton = humanoid(FULL)
  const pose = new RagdollPose(skeleton)
  const head = skeleton.bones.find((b) => b.name === 'Head')
  const target = yRotation(Math.PI / 2)
  head.quaternion.splice(0, 4, ...target)
  pose.apply(0.05)
  const alpha = 1 - Math.exp(-40 * 0.05)
  assert.ok(close(angleAboutY(head.quaternion), alpha * Math.PI / 2), 'angle ' + angleAboutY(head.quaternion))
})

gate('a half-strength joint uses rate 20, and control: it lags a full-strength joint', () => {
  const skeleton = humanoid(FULL)
  const pose = new RagdollPose(skeleton, { strengths: { head: 0.5 } })
  const head = skeleton.bones.find((b) => b.name === 'Head')
  const neck = skeleton.bones.find((b) => b.name === 'Neck')
  head.quaternion.splice(0, 4, ...yRotation(1))
  neck.quaternion.splice(0, 4, ...yRotation(1))
  pose.apply(0.05)
  assert.ok(close(angleAboutY(head.quaternion), (1 - Math.exp(-20 * 0.05))))
  assert.ok(angleAboutY(head.quaternion) < angleAboutY(neck.quaternion))
})

gate('a limp joint relaxes toward its rest pose at limpRate 3, after snapToAnimated', () => {
  const skeleton = humanoid(FULL)
  const pose = new RagdollPose(skeleton)
  const head = skeleton.bones.find((b) => b.name === 'Head')
  head.quaternion.splice(0, 4, ...yRotation(1.2))
  pose.snapToAnimated().setStrength('head', 0)
  pose.apply(0.1)
  assert.ok(close(angleAboutY(head.quaternion), 1.2 * Math.exp(-3 * 0.1)))
})

gate('refused: strengths outside [0, 1], an unknown joint, zero stiffness, a missing anchor and no skeleton', () => {
  const pose = new RagdollPose(humanoid(FULL))
  throwsCode(() => pose.setStrength('head', 1.5), 'bad-strength')
  throwsCode(() => pose.setStrength('head', NaN), 'bad-strength')
  throwsCode(() => pose.setAll('1'), 'bad-strength')
  throwsCode(() => pose.getStrength('tail'), 'unknown-joint')
  throwsCode(() => new RagdollPose(humanoid(['Hips', 'Spine']), { strengths: { head: 1 } }), 'unknown-joint')
  throwsCode(() => new RagdollPose(humanoid(FULL), { stiffness: 0 }), 'bad-rate')
  throwsCode(() => new RagdollPose(humanoid(['Spine'])), 'no-anchor')
  throwsCode(() => new RagdollPose(null), 'no-skeleton')
  assert.ok(new RagdollPoseError('x', 'y') instanceof Error)
})

gate('improvement: apply refuses a NaN or negative dt instead of writing NaN into every bone', () => {
  const skeleton = humanoid(FULL)
  const pose = new RagdollPose(skeleton)
  throwsCode(() => pose.apply(NaN), 'bad-dt')
  throwsCode(() => pose.apply(-0.1), 'bad-dt')
  assert.ok(skeleton.bones.every((b) => b.quaternion.every(Number.isFinite)))
})

gate('parseRagdollActivation fills every joint with all (default 1) and overrides the named bones', () => {
  const plan = parseRagdollActivation({ all: 0.4, bones: { head: 0.2, leftHand: { strength: 0 } } })
  assert.equal(Object.keys(plan.strengths).length, 16)
  assert.equal(plan.strengths.spine, 0.4)
  assert.equal(plan.strengths.head, 0.2)
  assert.equal(plan.strengths.leftHand, 0)
  assert.deepEqual([...plan.explicit], ['head', 'leftHand'])
  assert.equal(plan.active, true)
  assert.ok(Object.isFrozen(plan) && Object.isFrozen(plan.strengths))
  assert.equal(parseRagdollActivation({}).strengths.head, 1)
})

gate('refused: a non-object spec, array bones, an unknown bone and strengths outside [0, 1]', () => {
  throwsCode(() => parseRagdollActivation(null), 'spec-invalid', 'reasonCode')
  throwsCode(() => parseRagdollActivation({ bones: [] }), 'bones-invalid', 'reasonCode')
  throwsCode(() => parseRagdollActivation({ bones: { tail: 1 } }), 'unknown-bone', 'reasonCode')
  throwsCode(() => parseRagdollActivation({ all: 2 }), 'strength-invalid', 'reasonCode')
  throwsCode(() => parseRagdollActivation({ bones: { head: { strength: '1' } } }), 'strength-invalid', 'reasonCode')
  assert.ok(new RagdollActivationError('a', 'b') instanceof Error)
})

gate('checkRagdollPlan returns spoint\'s refusal codes and null for a parsed plan', () => {
  assert.equal(checkRagdollPlan(null), 'plan-invalid')
  assert.equal(checkRagdollPlan({ strengths: {}, explicit: 'x' }), 'plan-invalid')
  assert.equal(checkRagdollPlan({ strengths: { tail: 1 }, explicit: [] }), 'unknown-bone')
  assert.equal(checkRagdollPlan({ strengths: { head: -1 }, explicit: [] }), 'strength-invalid')
  assert.equal(checkRagdollPlan(parseRagdollActivation({})), null)
})

gate('applyRagdollActivation skips implicit joints the pose lacks but throws for an explicit one', () => {
  const pose = new RagdollPose(humanoid(['Hips', 'Spine', 'Head']))
  applyRagdollActivation(pose, parseRagdollActivation({ all: 0.3, bones: { head: 0.9 } }))
  assert.equal(pose.getStrength('spine'), 0.3)
  assert.equal(pose.getStrength('head'), 0.9)
  throwsCode(() => applyRagdollActivation(pose, parseRagdollActivation({ bones: { leftHand: 1 } })), 'unknown-joint')
  throwsCode(() => applyRagdollActivation(pose, { strengths: { head: 3 }, explicit: [] }), 'strength-invalid', 'reasonCode')
})

gate('an inactive plan sets every joint limp', () => {
  const pose = new RagdollPose(humanoid(FULL))
  applyRagdollActivation(pose, parseRagdollActivation({ active: false, all: 1 }))
  assert.ok(pose.joints.every((j) => j.strength === 0))
})

gate('buildProceduralSkeleton places roots at their pivot and children at pivot minus the parent pivot', () => {
  const rig = buildProceduralSkeleton({ root: { pivot: [0, 1, 0] }, spine: { parent: 'root', pivot: [0, 1.5, 0] }, head: { parent: 'spine', pivot: [0, 2, 0.1] } })
  assert.deepEqual(rig.roots, ['root'])
  assert.deepEqual(boneOf(rig, 'root').position, [0, 1, 0])
  assert.deepEqual(boneOf(rig, 'spine').position, [0, 0.5, 0])
  assert.deepEqual(boneOf(rig, 'head').position, [0, 2 - 1.5, 0.1 - 0])
  assert.deepEqual(boneOf(rig, 'root').children, ['spine'])
  assert.deepEqual(rig.skeleton.bones.map((b) => b.name), ['root', 'spine', 'head'])
})

gate('refused: a parent declared later, a bad pivot, no bones, an array spec and an unknown bone lookup', () => {
  assert.throws(() => buildProceduralSkeleton({ a: { parent: 'b', pivot: [0, 0, 0] }, b: { pivot: [0, 0, 0] } }), /must be declared before it/)
  assert.throws(() => buildProceduralSkeleton({ a: { pivot: [0, NaN, 0] } }), /three finite numbers/)
  assert.throws(() => buildProceduralSkeleton({ a: null }), /three finite numbers/)
  assert.throws(() => buildProceduralSkeleton({}), /no bones/)
  assert.throws(() => buildProceduralSkeleton([]), /object keyed by bone name/)
  const rig = buildProceduralSkeleton({ a: { pivot: [0, 0, 0] } })
  assert.throws(() => boneOf(rig, 'z'), /no bone named z/)
})

gate('spoint quirk kept: an integer-like bone name is ordered first by Object.keys, so it cannot name an earlier parent', () => {
  assert.throws(() => buildProceduralSkeleton({ b: { pivot: [0, 0, 0] }, 1: { parent: 'b', pivot: [0, 1, 0] } }), /bone 1 names parent b/)
})

gate('skin weights are normalised per vertex in Float32, with joints given by name or index', () => {
  const rig = buildProceduralSkeleton({ root: { pivot: [0, 0, 0] }, arm: { parent: 'root', pivot: [1, 0, 0] } })
  const out = computeSkinBinding(2, rig.skeleton, { joints: ['root', 'arm', 0, 0, 0, 0, 0, 1], weights: [1, 2, 0, 0, 0, 0, 0, 3] })
  assert.ok(out.skinWeight instanceof Float32Array && out.skinIndex instanceof Uint16Array)
  assert.deepEqual(Array.from(out.skinIndex), [0, 1, 0, 0, 0, 0, 0, 1])
  assert.deepEqual(Array.from(out.skinWeight), [Math.fround(1 / 3), Math.fround(2 / 3), 0, 0, 0, 0, 0, 1])
})

gate('a zero weight takes joint index 0 without the joint being looked up, so a bogus joint name there passes', () => {
  const rig = buildProceduralSkeleton({ root: { pivot: [0, 0, 0] }, arm: { parent: 'root', pivot: [1, 0, 0] } })
  const out = computeSkinBinding(1, rig.skeleton, { joints: ['arm', 'nope', 99, 'x'], weights: [1, 0, 0, 0] })
  assert.deepEqual(Array.from(out.skinIndex), [1, 0, 0, 0])
})

gate('refused: an unknown joint, an index out of range, a negative weight, an all-zero vertex and a wrong length', () => {
  const rig = buildProceduralSkeleton({ root: { pivot: [0, 0, 0] } })
  assert.throws(() => computeSkinBinding(1, rig.skeleton, { joints: ['tail', 0, 0, 0], weights: [1, 0, 0, 0] }), /not a bone of the skeleton/)
  assert.throws(() => computeSkinBinding(1, rig.skeleton, { joints: [1, 0, 0, 0], weights: [1, 0, 0, 0] }), /outside 0..0/)
  assert.throws(() => computeSkinBinding(1, rig.skeleton, { joints: [0, 0, 0, 0], weights: [-1, 2, 0, 0] }), /at least 0/)
  assert.throws(() => computeSkinBinding(1, rig.skeleton, { joints: [0, 0, 0, 0], weights: [0, 0, 0, 0] }), /no weight/)
  assert.throws(() => computeSkinBinding(2, rig.skeleton, { joints: [0, 0, 0, 0], weights: [1, 0, 0, 0] }), /8 entries/)
  assert.throws(() => computeSkinBinding(0, rig.skeleton, { joints: [], weights: [] }), /no position attribute/)
})

gate('bindSkin reads the vertex count from the position attribute and sets skinIndex and skinWeight with four influences', () => {
  const rig = buildProceduralSkeleton({ root: { pivot: [0, 0, 0] } })
  const set = {}
  const geometry = { attributes: { position: { count: 1 } }, setAttribute: (name, attr) => { set[name] = attr } }
  assert.equal(bindSkin(geometry, rig.skeleton, { joints: [0, 0, 0, 0], weights: [2, 0, 0, 0] }), geometry)
  assert.deepEqual(Object.keys(set), ['skinIndex', 'skinWeight'])
  assert.equal(set.skinWeight.itemSize, 4)
  assert.deepEqual(Array.from(set.skinWeight.array), [1, 0, 0, 0])
})

const legSkeleton = (withHips = true) => humanoid([...(withHips ? ['Hips'] : []), 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot'])

gate('setupFootGrounding keeps spoint\'s defaults: ray 2 m, max drop 0.6 m, ankle 0, for unset or non-positive options', () => {
  const g = setupFootGrounding(legSkeleton(), { footRayDistance: 0, footMaxDrop: -1, footAnkleHeight: NaN })
  assert.deepEqual([g.rayDistance, g.maxDrop, g.ankleHeight], [2, 0.6, 0])
  assert.deepEqual(FOOT_GROUNDING_DEFAULTS, { rayDistance: 2, maxDrop: 0.6, ankleHeight: 0 })
  assert.deepEqual(g.legs.map((l) => l.side), ['left', 'right'])
  assert.equal(setupFootGrounding(humanoid(['Hips', 'LeftUpLeg', 'LeftLeg']), {}), null)
})

const groundScene = (hits, feet) => {
  const rays = []
  const moves = []
  const io = {
    readFootWorld: (bone) => feet[bone.name],
    raycast: (origin, dir, dist) => { rays.push([origin, [...dir], dist]); return hits[rays.length - 1] },
    moveHips: (hips, delta) => moves.push([hips.name, delta]),
  }
  return { io, rays, moves }
}

gate('groundFeet casts from half the ray above each foot and lowers the hips by the deepest capped drop', () => {
  const g = setupFootGrounding(legSkeleton(), { footAnkleHeight: 0.05 })
  const feet = { LeftFoot: [0.1, 0.1, 0], RightFoot: [-0.1, 0, 0] }
  const scene = groundScene([{ y: -0.2 }, { y: -1 }], feet)
  const out = groundFeet(g, scene.io)
  assert.deepEqual(scene.rays[0], [[0.1, 1.1, 0], [0, -1, 0], 2])
  assert.ok(close(g.legs[0].targetY, -0.15))
  assert.ok(close(g.legs[1].targetY, -0.95))
  assert.equal(out.drop, -0.6)
  assert.deepEqual(scene.moves, [['Hips', -0.6]])
  assert.equal(g.hipOffset, -0.6)
  assert.deepEqual(out.targets.map((t) => t.enabled), [true, true])
})

gate('a second identical pass moves the hips by nothing, since only the change from hipOffset is applied', () => {
  const g = setupFootGrounding(legSkeleton(), {})
  const feet = { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] }
  groundFeet(g, groundScene([{ y: -0.3 }, { y: -0.3 }], feet).io)
  const again = groundScene([{ y: -0.3 }, { y: -0.3 }], feet)
  const out = groundFeet(g, again.io)
  assert.equal(out.hipDelta, 0)
  assert.deepEqual(again.moves, [])
})

gate('control: a foot above the hit never raises the hips, because the drop starts at 0 and only goes down', () => {
  const g = setupFootGrounding(legSkeleton(), {})
  const scene = groundScene([{ y: 0.4 }, { y: 0.4 }], { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] })
  const out = groundFeet(g, scene.io)
  assert.equal(out.drop, 0)
  assert.deepEqual(scene.moves, [])
  assert.equal(out.targets[0].target.y, 0.4)
})

gate('a miss or a NaN hit disables that leg, and the foot target is read again after the hips move', () => {
  const g = setupFootGrounding(legSkeleton(), {})
  const feet = { LeftFoot: [0, 0, 0], RightFoot: [1, 0, 2] }
  const scene = groundScene([null, { y: -0.2 }], feet)
  scene.io.moveHips = (hips, delta) => { feet.RightFoot = [1.5, feet.RightFoot[1] + delta, 2.5] }
  const out = groundFeet(g, scene.io)
  assert.deepEqual(out.targets[0], { side: 'left', chain: 'leftLeg', enabled: false, target: null })
  assert.deepEqual(out.targets[1].target, { x: 1.5, y: -0.2, z: 2.5 })
  const nan = groundFeet(setupFootGrounding(legSkeleton(), {}), groundScene([{ y: NaN }, { y: NaN }], { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] }).io)
  assert.deepEqual(nan.targets.map((t) => t.enabled), [false, false])
})

gate('without a hips bone the drop is reported but never applied, and hipOffset stays 0', () => {
  const g = setupFootGrounding(legSkeleton(false), {})
  const scene = groundScene([{ y: -0.3 }, { y: -0.3 }], { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] })
  const out = groundFeet(g, scene.io)
  assert.ok(close(out.drop, -0.3))
  assert.equal(out.hipDelta, 0)
  assert.equal(g.hipOffset, 0)
})

const makeSystem = (options = {}, host = {}) => {
  const blender = fakeBlender()
  const clock = manualClock()
  const system = new AnimationSystem(humanoid(FULL), blender, options, { now: clock.now, ...host })
  return { blender, clock, system }
}

gate('initializeController returns one controller and refuses options on a second call, as spoint does', () => {
  const { system } = makeSystem({ runSpeed: 3 })
  const controller = system.initializeController()
  assert.equal(controller.config.runSpeed, 3)
  assert.equal(system.initializeController(), controller)
  assert.throws(() => system.initializeController({ walkSpeed: 1 }), /already initialized/)
})

gate('update without a controller only advances the blender, and with one it ticks the controller', () => {
  const a = makeSystem()
  a.system.update(0.1, { speed: 3 })
  assert.deepEqual(a.blender.log, [['blend', 0.1]])
  const b = makeSystem()
  b.system.initializeController()
  b.system.update(0.1, { speed: 3 })
  assert.equal(b.system.controller.getState(), 'walk')
})

gate('update runs the controller, then foot grounding and the IK rig, then the ragdoll, in spoint\'s order', () => {
  const order = []
  const rig = { getChain: () => null, update: () => order.push('ik') }
  const { system, blender } = makeSystem({ raycastCallback: () => { order.push('ray'); return null } }, {
    ikRig: rig,
    readFootWorld: () => [0, 0, 0],
    moveHips: () => order.push('hips'),
  })
  blender.updateBlend = () => order.push('blend')
  system.createRagdoll()
  const apply = system.ragdoll.apply.bind(system.ragdoll)
  system.ragdoll.apply = (dt) => { order.push('ragdoll'); return apply(dt) }
  system.update(0.016)
  assert.deepEqual(order, ['blend', 'ray', 'ray', 'ik', 'ragdoll'])
})

gate('foot targets reach the first solver of the leftLeg and rightLeg chains of a jayzee IKRig', () => {
  const rig = new IKRig(null)
  const left = new TwoBoneIKSolver([0, 1, 0], [0, 0.5, 0], [0, 0, 0])
  const right = new TwoBoneIKSolver([0, 1, 0], [0, 0.5, 0], [0, 0, 0])
  rig.createChain('leftLeg').addSolver(left)
  rig.createChain('rightLeg').addSolver(right)
  let call = 0
  const { system } = makeSystem({ raycastCallback: () => (call++ === 0 ? { y: -0.1 } : null) }, { ikRig: rig, readFootWorld: () => [0.2, 0, 0.3], moveHips: () => {} })
  system._groundFeet()
  assert.equal(left.enabled, true)
  assert.deepEqual(left.target, [0.2, -0.1, 0.3])
  assert.equal(right.enabled, false)
})

gate('control: enableIK false skips grounding, and enableIK(chain) then throws as spoint does', () => {
  let rays = 0
  const { system } = makeSystem({ enableIK: false, raycastCallback: () => { rays++; return null } }, { readFootWorld: () => [0, 0, 0] })
  system.update(0.016)
  assert.equal(rays, 0)
  assert.throws(() => system.enableIK('leftLeg'), /needs IK/)
})

gate('foot grounding without readFootWorld is refused, since the world position comes from the host', () => {
  assert.throws(() => makeSystem({ raycastCallback: () => null }), /readFootWorld/)
  assert.throws(() => new AnimationSystem(humanoid(FULL), fakeBlender(), {}, {}), /now\(\) clock/)
})

gate('improvement: a hips bone without moveHips is refused, where a skipped move would still advance hipOffset and the hips would never drop', () => {
  assert.throws(() => makeSystem({ raycastCallback: () => null }, { readFootWorld: () => [0, 0, 0] }), /host.moveHips/)
  const g = setupFootGrounding(legSkeleton(), {})
  const io = groundScene([{ y: -0.3 }, { y: -0.3 }], { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] }).io
  delete io.moveHips
  assert.throws(() => groundFeet(g, io), /io.moveHips/)
  assert.equal(g.hipOffset, 0)
  const flat = setupFootGrounding(legSkeleton(), {})
  const still = groundScene([{ y: 0 }, { y: 0 }], { LeftFoot: [0, 0, 0], RightFoot: [0, 0, 0] }).io
  delete still.moveHips
  assert.equal(groundFeet(flat, still).hipDelta, 0)
  const system = new AnimationSystem(legSkeleton(false), fakeBlender(), { raycastCallback: () => null }, { now: () => 0, readFootWorld: () => [0, 0, 0] })
  assert.ok(system._grounding && system._grounding.hips === null)
})

gate('setRagdollPlan creates a ragdoll on first use and applies the plan to it', () => {
  const { system } = makeSystem()
  system.setRagdollPlan(parseRagdollActivation({ all: 0.25 }))
  assert.equal(system.ragdoll.getStrength('head'), 0.25)
  system.removeRagdoll()
  assert.equal(system.ragdoll, null)
})

gate('getSkeletonBone looks up an exact name first and a humanoid alias second, and the blender calls pass through', () => {
  const { system, blender } = makeSystem()
  assert.equal(system.getSkeletonBone('LeftFoot').name, 'LeftFoot')
  assert.equal(system.getSkeletonBone('leftFoot').name, 'LeftFoot')
  assert.equal(system.getSkeletonBone('tail'), null)
  system.addClip('Wave', 7).playAnimation('Wave').crossFade('Idle', 'Wave').setBlendTree('t')
  assert.deepEqual(blender.log, [['register', 'Wave', 7], ['play', 'Wave', 0.3], ['cross', 'Idle', 'Wave', 0.3], ['tree', 't']])
})

gate('packSkeletonState round-trips the bone quaternions through skeletonUtils', () => {
  const { system } = makeSystem()
  system.skeleton.bones[1].quaternion.splice(0, 4, ...yRotation(0.5))
  const buffer = new Int16Array(FULL.length * 4)
  assert.equal(system.packSkeletonState(buffer), FULL.length * 4)
  system.skeleton.bones[1].quaternion.splice(0, 4, 0, 0, 0, 1)
  system.unpackSkeletonState(buffer)
  assert.ok(close(angleAboutY(system.skeleton.bones[1].quaternion), 0.5, 1e-4))
})

finish()
