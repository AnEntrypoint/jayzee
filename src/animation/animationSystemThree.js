import { AnimationSystem } from './animationSystem.js'
import { AnimationBlender } from './animationBlender.js'

const THREE_CLASSES = ['AnimationMixer', 'Raycaster', 'Vector3']
const QUAT_KEYS = ['x', 'y', 'z', 'w']

function fail(message) {
  throw new Error(`[AnimationSystemThree] ${message}`)
}

export class QuaternionView {
  constructor(quaternion) {
    this.q = quaternion
    this.length = 4
  }

  get 0() { return this.q.x }

  set 0(v) { this.q.x = v }

  get 1() { return this.q.y }

  set 1(v) { this.q.y = v }

  get 2() { return this.q.z }

  set 2(v) { this.q.z = v }

  get 3() { return this.q.w }

  set 3(v) { this.q.w = v }
}

export function threeSkeletonView(skeleton) {
  if (!skeleton || !Array.isArray(skeleton.bones) || skeleton.bones.length === 0) fail('a three Skeleton with bones is required')
  const byThree = new Map()
  const bones = skeleton.bones.map((bone) => {
    for (const key of QUAT_KEYS) if (typeof bone.quaternion?.[key] !== 'number') fail(`bone ${bone.name} has no three quaternion`)
    const view = { name: bone.name, quaternion: new QuaternionView(bone.quaternion), three: bone, parent: null }
    byThree.set(bone, view)
    return view
  })
  for (const view of bones) view.parent = byThree.get(view.three.parent) ?? null
  return { bones, three: skeleton }
}

export function createMixerBlender(mixer, options = {}) {
  const blender = new AnimationBlender(mixer, options)
  const durationOf = new Map()
  return {
    blender,
    registerClip(name, clip, clipOptions) {
      blender.addClip(name, clip, clipOptions)
      durationOf.set(name, Number.isFinite(clip.duration) ? clip.duration : 0)
      return this
    },
    playClip(name, fade) {
      blender.play(name, fade)
      return this
    },
    crossFade(fromName, toName, fade) {
      if (!blender.has(fromName)) fail(`crossFade from ${fromName}, which is not registered`)
      blender.play(toName, fade)
      return this
    },
    setBlendTree(tree, treeOptions) {
      blender.playTree(tree, treeOptions)
      return this
    },
    updateBlend(dt) {
      blender.update(dt)
      return this
    },
    getClipDuration(name) {
      return durationOf.get(name) ?? 0
    },
    stop(name, fade) {
      blender.stop(name, fade)
      return this
    },
    stopAll() {
      blender.stop()
      return this
    },
    has: (name) => blender.has(name),
    weightOf: (name) => blender.weightOf(name),
    isPlaying: (name) => blender.isPlaying(name),
    get current() { return blender.current },
    dispose: () => blender.dispose(),
  }
}

export function createThreeGroundingIo(THREE, ground = []) {
  if (!Array.isArray(ground)) fail('ground must be a list of three objects to cast against')
  const raycaster = new THREE.Raycaster()
  const origin = new THREE.Vector3()
  const direction = new THREE.Vector3()
  const world = new THREE.Vector3()
  const base = new THREE.Vector3()
  const placed = new THREE.Vector3()
  const foot = [0, 0, 0]
  let moved = null
  const hit = { y: 0, object: null, distance: 0 }
  const hits = []

  function readFootWorld(bone) {
    const three = bone.three ?? bone
    three.getWorldPosition(world)
    foot[0] = world.x
    foot[1] = world.y
    foot[2] = world.z
    return foot
  }

  function raycast(from, dir, distance) {
    origin.set(from[0], from[1], from[2])
    direction.set(dir[0], dir[1], dir[2]).normalize()
    raycaster.set(origin, direction)
    raycaster.near = 0
    raycaster.far = distance
    hits.length = 0
    raycaster.intersectObjects(ground, true, hits)
    if (hits.length === 0) return null
    hit.y = hits[0].point.y
    hit.object = hits[0].object
    hit.distance = hits[0].distance
    return hit
  }

  function moveHips(bone, worldDeltaY) {
    const three = bone.three ?? bone
    const parent = three.parent
    base.copy(three.position)
    if (!parent) {
      three.position.y += worldDeltaY
    } else {
      parent.updateWorldMatrix(true, false)
      three.getWorldPosition(world)
      world.y += worldDeltaY
      parent.worldToLocal(world)
      three.position.copy(world)
    }
    three.updateMatrixWorld(true)
    placed.copy(three.position)
    moved = three
  }

  function restoreHips() {
    if (moved === null) return false
    const three = moved
    moved = null
    if (!three.position.equals(placed)) return false
    three.position.copy(base)
    three.updateMatrixWorld(true)
    return true
  }

  return { readFootWorld, raycast, moveHips, restoreHips, ground }
}

export function createThreeAnimationSystem(THREE, opts = {}) {
  if (!THREE || typeof THREE !== 'object') fail('the three namespace is the first argument')
  for (const name of THREE_CLASSES) if (typeof THREE[name] !== 'function') fail(`the three namespace has no ${name}`)
  const { root, skeleton, now } = opts
  if (!root || typeof root.updateMatrixWorld !== 'function') fail('root must be the three object the clips animate')
  if (typeof now !== 'function') fail('a now() clock in milliseconds is required')
  const view = threeSkeletonView(skeleton)
  const mixer = new THREE.AnimationMixer(root)
  const blender = createMixerBlender(mixer, opts.blender)
  const io = createThreeGroundingIo(THREE, opts.ground ?? [])
  const grounded = Array.isArray(opts.ground) && opts.ground.length > 0
  const system = new AnimationSystem(view, blender, { ...opts.options, raycastCallback: grounded ? io.raycast : null }, { now, ikRig: opts.ikRig ?? null, readFootWorld: io.readFootWorld, moveHips: io.moveHips })
  for (const [name, clip] of Object.entries(opts.clips ?? {})) blender.registerClip(name, clip, opts.clipOptions?.[name])

  function update(dt, motionState) {
    io.restoreHips()
    system.resetFootGrounding()
    system.update(dt, motionState)
    root.updateMatrixWorld(true)
    return system
  }

  function dispose() {
    system.dispose()
    blender.dispose()
    mixer.stopAllAction()
    mixer.uncacheRoot(root)
  }

  return { system, mixer, blender, view, io, update, dispose }
}
