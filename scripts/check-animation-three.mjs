import assert from 'node:assert/strict'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { createThreeAnimationSystem, createThreeGroundingIo, createMixerBlender, threeSkeletonView, QuaternionView } from '../src/animation/animationSystemThree.js'
import { createProceduralBody } from '../src/animation/proceduralBodyThree.js'
import { AnimationSystem } from '../src/animation/animationSystem.js'

const spec = {
  Hips: { pivot: [0, 1, 0] },
  Spine: { pivot: [0, 1.3, 0], parent: 'Hips' },
  LeftUpLeg: { pivot: [0.1, 0.9, 0], parent: 'Hips' },
  LeftLeg: { pivot: [0.1, 0.5, 0], parent: 'LeftUpLeg' },
  LeftFoot: { pivot: [0.1, 0.08, 0], parent: 'LeftLeg' },
  RightUpLeg: { pivot: [-0.1, 0.9, 0], parent: 'Hips' },
  RightLeg: { pivot: [-0.1, 0.5, 0], parent: 'RightUpLeg' },
  RightFoot: { pivot: [-0.1, 0.08, 0], parent: 'RightLeg' },
}
const near = (a, b, eps, label) => assert.ok(Math.abs(a - b) <= eps, `${label}: ${a} against ${b}`)
const quatTrack = (bone, axis, angle, duration) => {
  const q = new THREE.Quaternion().setFromAxisAngle(axis, angle)
  return new THREE.QuaternionKeyframeTrack(bone + '.quaternion', [0, duration], [0, 0, 0, 1, q.x, q.y, q.z, q.w])
}
const clips = () => ({
  Idle: new THREE.AnimationClip('Idle', 1, [quatTrack('Spine', new THREE.Vector3(0, 1, 0), 0.4, 1)]),
  WalkLoop: new THREE.AnimationClip('WalkLoop', 1, [quatTrack('Spine', new THREE.Vector3(1, 0, 0), 0.8, 1)]),
  RunLoop: new THREE.AnimationClip('RunLoop', 0.5, [quatTrack('Spine', new THREE.Vector3(0, 0, 1), 0.8, 0.5)]),
})
const floor = (y) => {
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshBasicMaterial())
  mesh.rotation.x = -Math.PI / 2
  mesh.position.y = y
  mesh.updateMatrixWorld(true)
  return mesh
}
const clock = () => {
  let t = 0
  const now = () => t
  now.advance = (ms) => { t += ms }
  return now
}
const rig = (over = {}) => {
  const body = createProceduralBody(THREE, spec)
  const now = clock()
  const made = createThreeAnimationSystem(THREE, { root: body.mesh, skeleton: body.skeleton, clips: clips(), now, ...over })
  return { body, now, ...made }
}

gate('the three binding builds an AnimationSystem over a real AnimationMixer and the skeleton of a SkinnedMesh', () => {
  const r = rig()
  assert.ok(r.system instanceof AnimationSystem)
  assert.ok(r.mixer instanceof THREE.AnimationMixer)
  assert.equal(r.mixer.getRoot(), r.body.mesh)
  assert.deepEqual(r.view.bones.map((b) => b.name), Object.keys(spec))
  assert.equal(r.view.bones[4].parent, r.view.bones[3])
  assert.equal(r.system.getSkeletonBone('leftFoot').three, r.body.bones.get('LeftFoot'))
  assert.deepEqual([r.blender.has('Idle'), r.blender.has('WalkLoop'), r.blender.has('Nope')], [true, true, false])
  assert.equal(r.blender.getClipDuration('RunLoop'), 0.5)
})

gate('playing a clip drives the three bone: half way through Idle the spine has turned half the keyed angle', () => {
  const r = rig()
  r.system.playAnimation('Idle', 0)
  r.update(0.5)
  const spine = r.body.bones.get('Spine')
  const want = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.2)
  assert.ok(spine.quaternion.angleTo(want) < 1e-6, `angle off by ${spine.quaternion.angleTo(want)}`)
  assert.ok(r.body.bones.get('LeftLeg').quaternion.angleTo(new THREE.Quaternion()) < 1e-12, 'negative control: an unkeyed bone stays at rest')
  assert.equal(r.blender.isPlaying('Idle'), true)
})

gate('the locomotion controller cross-fades real mixer actions: idle to walk at speed 3, to run at speed 6', () => {
  const r = rig()
  const controller = r.system.initializeController()
  assert.equal(controller.getState(), 'idle')
  assert.equal(r.blender.current, 'Idle')
  r.update(0.016, { speed: 3 })
  assert.equal(controller.getState(), 'walk')
  assert.equal(r.blender.current, 'WalkLoop')
  for (let i = 0; i < 10; i++) r.update(0.016, { speed: 3 })
  const mid = [r.blender.weightOf('Idle'), r.blender.weightOf('WalkLoop')]
  assert.ok(mid[0] > 0.05 && mid[0] < 0.95 && mid[1] > 0.05 && mid[1] < 0.95, `mid fade weights ${mid}`)
  for (let i = 0; i < 30; i++) r.update(0.016, { speed: 3 })
  near(r.blender.weightOf('WalkLoop'), 1, 1e-6, 'walk weight after the fade')
  near(r.blender.weightOf('Idle'), 0, 1e-6, 'idle weight after the fade')
  r.update(0.016, { speed: 6 })
  assert.equal(controller.getState(), 'run')
  assert.equal(r.blender.current, 'RunLoop')
  const spine = r.body.bones.get('Spine').quaternion
  assert.ok(Math.abs(spine.x) > 1e-3, 'the walk clip turned the spine about x')
})

gate('foot grounding casts a real Raycaster at the ground mesh and lowers the three hips bone by the world drop', () => {
  const ground = floor(-0.15)
  const r = rig({ ground: [ground] })
  r.body.mesh.scale.setScalar(2)
  r.body.mesh.position.set(3, 0, -1)
  r.body.mesh.updateMatrixWorld(true)
  const hips = r.body.bones.get('Hips')
  const before = hips.getWorldPosition(new THREE.Vector3())
  near(before.y, 2, 1e-6, 'hips world height at twice scale')
  r.update(0.016)
  const after = hips.getWorldPosition(new THREE.Vector3())
  near(after.y, 2 - 0.31, 1e-5, 'hips dropped by foot height 0.16 plus the 0.15 the ground lies below')
  near(after.x, before.x, 1e-6, 'hips keep their x')
  near(hips.position.y, 1 - 0.155, 1e-5, 'the local move is the world drop over the parent scale')
  const foot = r.body.bones.get('LeftFoot').getWorldPosition(new THREE.Vector3())
  near(foot.y, -0.15, 1e-5, 'the foot now rests on the ground')
  assert.deepEqual(r.system.footTargets.map((t) => [t.side, t.enabled]), [['left', true], ['right', true]])
  near(r.system.footTargets[0].target.y, -0.15, 1e-6, 'left foot target height')
  for (let i = 0; i < 5; i++) r.update(0.016)
  near(hips.getWorldPosition(new THREE.Vector3()).y, 2 - 0.31, 1e-5, 'later frames hold the same drop and do not swing back')
  ground.position.y = 0.16
  ground.updateMatrixWorld(true)
  r.update(0.016)
  near(hips.getWorldPosition(new THREE.Vector3()).y, 2, 1e-5, 'ground raised to the feet brings the hips back to the animated height')
})

gate('negative control: with no ground under the feet the ray misses and the hips stay', () => {
  const far = floor(-50)
  const r = rig({ ground: [far] })
  r.update(0.016)
  near(r.body.bones.get('Hips').position.y, 1, 1e-12, 'hips local height')
  assert.deepEqual(r.system.footTargets.map((t) => t.enabled), [false, false])
  const none = rig()
  none.update(0.016)
  assert.equal(none.system.footTargets, null)
})

gate('the grounding io reads world positions and hits through three, reusing its outputs', () => {
  const io = createThreeGroundingIo(THREE, [floor(0.5)])
  const bone = new THREE.Bone()
  const parent = new THREE.Object3D()
  parent.position.set(1, 2, 3)
  parent.add(bone)
  bone.position.set(0.5, 0, 0)
  const a = io.readFootWorld(bone)
  assert.deepEqual([a[0], a[1], a[2]], [1.5, 2, 3])
  assert.equal(io.readFootWorld({ three: bone }), a)
  const hit = io.raycast([1.5, 3, 3], [0, -1, 0], 5)
  near(hit.y, 0.5, 1e-9, 'hit height')
  near(hit.distance, 2.5, 1e-9, 'hit distance')
  assert.equal(io.raycast([1.5, 3, 3], [0, -1, 0], 2), null, 'a ray shorter than the gap misses')
  assert.equal(io.raycast([100, 3, 3], [0, -1, 0], 5), null)
  assert.equal(io.raycast([1.5, 3, 3], [0, -1, 0], 5), hit)
  io.moveHips(bone, -0.25)
  near(bone.getWorldPosition(new THREE.Vector3()).y, 1.75, 1e-9, 'world height after the move')
  assert.equal(io.restoreHips(), true)
  near(bone.getWorldPosition(new THREE.Vector3()).y, 2, 1e-9, 'restore puts the bone back where the pose had it')
  assert.equal(io.restoreHips(), false)
  io.moveHips(bone, -0.25)
  bone.position.set(9, 9, 9)
  assert.equal(io.restoreHips(), false, 'a pose written since the move is left alone')
  assert.equal(bone.position.y, 9)
  const loose = new THREE.Bone()
  io.moveHips(loose, 0.5)
  assert.equal(loose.position.y, 0.5)
  assert.throws(() => createThreeGroundingIo(THREE, null), /ground must be a list/)
})

gate('the skeleton view gives jayzee rig code array access to three quaternions, so packed state round-trips into the bones', () => {
  const r = rig()
  const spine = r.body.bones.get('Spine')
  spine.quaternion.setFromAxisAngle(new THREE.Vector3(0, 0, 1), 0.7)
  const view = r.view.bones[1].quaternion
  assert.ok(view instanceof QuaternionView)
  assert.deepEqual([view[0], view[1], view[2], view[3], view.length], [spine.quaternion.x, spine.quaternion.y, spine.quaternion.z, spine.quaternion.w, 4])
  const packed = new Int16Array(r.view.bones.length * 4)
  r.system.packSkeletonState(packed)
  spine.quaternion.identity()
  near(spine.rotation.z, 0, 0, 'the bone is back at rest')
  r.system.unpackSkeletonState(packed)
  near(spine.rotation.z, 0.7, 1e-3, 'the bone rotation follows a write through the view')
  const ragdoll = r.system.createRagdoll({ joints: ['spine'], anchor: null })
  assert.ok(ragdoll)
})

gate('a missing namespace, root, clock or skeleton is refused, and dispose releases the mixer', () => {
  const body = createProceduralBody(THREE, spec)
  const now = clock()
  assert.throws(() => createThreeAnimationSystem(null, {}), /three namespace/)
  assert.throws(() => createThreeAnimationSystem({ AnimationMixer: THREE.AnimationMixer }, {}), /has no Raycaster/)
  assert.throws(() => createThreeAnimationSystem(THREE, { skeleton: body.skeleton, now }), /root must be/)
  assert.throws(() => createThreeAnimationSystem(THREE, { root: body.mesh, skeleton: body.skeleton }), /now\(\) clock/)
  assert.throws(() => createThreeAnimationSystem(THREE, { root: body.mesh, skeleton: { bones: [] }, now }), /Skeleton with bones/)
  assert.throws(() => threeSkeletonView({ bones: [{ name: 'x', quaternion: [0, 0, 0, 1] }] }), /no three quaternion/)
  const mixerBlender = createMixerBlender(new THREE.AnimationMixer(body.mesh))
  assert.throws(() => mixerBlender.crossFade('A', 'B', 0.1), /not registered/)
  const r = rig()
  r.system.playAnimation('Idle', 0)
  r.update(0.1)
  r.dispose()
  assert.throws(() => r.blender.playClip('Idle', 0), (e) => e.code === 'animation-blender-disposed')
})

finish()
