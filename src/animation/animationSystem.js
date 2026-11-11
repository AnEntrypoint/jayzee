import createAnimationController from './animationController.js'
import { RagdollPose } from './ragdollPose.js'
import { applyRagdollActivation } from './ragdollActivation.js'
import { findBoneByHumanoidName, findBoneByName, packSkeletonState, unpackSkeletonState } from './skeletonUtils.js'

const DOWN = Object.freeze([0, -1, 0])
const LEG_SIDES = Object.freeze(['left', 'right'])

export const FOOT_GROUNDING_DEFAULTS = Object.freeze({ rayDistance: 2, maxDrop: 0.6, ankleHeight: 0 })

export function setupFootGrounding(skeleton, options = {}) {
  const hips = findBoneByHumanoidName(skeleton, 'hips')
  const legs = []
  for (const side of LEG_SIDES) {
    const upper = findBoneByHumanoidName(skeleton, `${side}UpperLeg`)
    const lower = findBoneByHumanoidName(skeleton, `${side}LowerLeg`)
    const foot = findBoneByHumanoidName(skeleton, `${side}Foot`)
    if (!upper || !lower || !foot) continue
    legs.push({ side, chain: `${side}Leg`, upper, lower, foot, targetY: null })
  }
  if (legs.length === 0) return null
  return {
    hips: hips || null,
    legs,
    hipOffset: 0,
    rayDistance: options.footRayDistance > 0 ? options.footRayDistance : FOOT_GROUNDING_DEFAULTS.rayDistance,
    maxDrop: options.footMaxDrop > 0 ? options.footMaxDrop : FOOT_GROUNDING_DEFAULTS.maxDrop,
    ankleHeight: Number.isFinite(options.footAnkleHeight) ? options.footAnkleHeight : FOOT_GROUNDING_DEFAULTS.ankleHeight,
  }
}

class FootTargetPoint {
  constructor() {
    this.x = 0
    this.y = 0
    this.z = 0
  }
}

export const makeGroundingResult = () => ({ drop: 0, hipDelta: 0, targets: [], points: [] })

const fillHeldTargets = (grounding, readFootWorld, out) => {
  const targets = out.targets
  const points = out.points
  let count = 0
  for (const leg of grounding.legs) {
    if (count === targets.length) {
      targets[count] = { side: leg.side, chain: leg.chain, enabled: false, target: null }
      points[count] = new FootTargetPoint()
    }
    const entry = targets[count]
    entry.side = leg.side
    entry.chain = leg.chain
    if (leg.targetY === null) {
      entry.enabled = false
      entry.target = null
    } else {
      const foot = readFootWorld(leg.foot)
      const point = points[count]
      point.x = foot[0]
      point.y = leg.targetY
      point.z = foot[2]
      entry.enabled = true
      entry.target = point
    }
    count += 1
  }
  if (targets.length !== count) targets.length = count
}

export function groundFeet(grounding, io, out = null) {
  const { readFootWorld, raycast, moveHips } = io
  let drop = 0
  for (const leg of grounding.legs) {
    const foot = readFootWorld(leg.foot)
    const origin = [foot[0], foot[1] + grounding.rayDistance / 2, foot[2]]
    const hit = raycast(origin, DOWN, grounding.rayDistance)
    if (!hit || !Number.isFinite(hit.y)) {
      leg.targetY = null
      continue
    }
    leg.targetY = hit.y + grounding.ankleHeight
    drop = Math.min(drop, Math.max(leg.targetY - foot[1], -grounding.maxDrop))
  }

  let hipDelta = 0
  if (grounding.hips) {
    const delta = drop - grounding.hipOffset
    if (delta !== 0) {
      if (typeof moveHips !== 'function') throw new Error('[AnimationSystem] a hips bone needs io.moveHips(hips, worldDeltaY) so the drop is applied before hipOffset records it')
      moveHips(grounding.hips, delta)
      hipDelta = delta
      grounding.hipOffset = drop
    }
  }

  if (out !== null) {
    fillHeldTargets(grounding, readFootWorld, out)
    out.drop = drop
    out.hipDelta = hipDelta
    return out
  }

  const targets = []
  for (const leg of grounding.legs) {
    if (leg.targetY === null) {
      targets.push({ side: leg.side, chain: leg.chain, enabled: false, target: null })
      continue
    }
    const foot = readFootWorld(leg.foot)
    targets.push({ side: leg.side, chain: leg.chain, enabled: true, target: { x: foot[0], y: leg.targetY, z: foot[2] } })
  }
  return { drop, hipDelta, targets }
}

export class AnimationSystem {
  constructor(skeleton, blender, options = {}, host = {}) {
    if (!blender || typeof blender.updateBlend !== 'function') throw new Error('[AnimationSystem] a blender with updateBlend is required')
    if (typeof host.now !== 'function') throw new Error('[AnimationSystem] a now() clock in milliseconds is required')
    this.skeleton = skeleton
    this.blender = blender
    this.now = host.now
    this.ikRig = host.ikRig || null
    this.readFootWorld = host.readFootWorld || null
    this.moveHips = host.moveHips || null
    this.controller = null
    this.ragdoll = null
    this.footTargets = null
    this._grounding = null
    this._groundingIo = { readFootWorld: null, raycast: null, moveHips: null }
    this._groundingResult = makeGroundingResult()

    this.options = {
      enableIK: options.enableIK !== false,
      enableFootIK: options.enableFootIK !== false,
      blendMode: options.blendMode || '1d',
      raycastCallback: options.raycastCallback || null,
      ...options,
    }

    if (this.options.enableIK && this.options.enableFootIK && this.options.raycastCallback) {
      if (typeof this.readFootWorld !== 'function') throw new Error('[AnimationSystem] foot grounding needs host.readFootWorld(bone) returning a world position')
      this._grounding = setupFootGrounding(this.skeleton, this.options)
      if (this._grounding && this._grounding.hips && typeof this.moveHips !== 'function') {
        throw new Error('[AnimationSystem] foot grounding with a hips bone needs host.moveHips(hips, worldDeltaY)')
      }
    }
  }

  _groundFeet() {
    const g = this._grounding
    if (!g) return
    const io = this._groundingIo
    io.readFootWorld = this.readFootWorld
    io.raycast = this.options.raycastCallback
    io.moveHips = this.moveHips
    const result = groundFeet(g, io, this._groundingResult)
    this.footTargets = result.targets
    for (const entry of result.targets) {
      const chain = this.ikRig ? this.ikRig.getChain(entry.chain) : null
      const solver = chain && chain.solvers ? chain.solvers[0] : null
      if (!solver) continue
      solver.enabled = entry.enabled
      if (entry.enabled && solver.setTarget) solver.setTarget([entry.target.x, entry.target.y, entry.target.z])
    }
  }

  initializeController(options = {}) {
    if (this.controller) {
      if (Object.keys(options).length > 0) {
        throw new Error('[AnimationSystem] controller already initialized; options apply only to the first initializeController call')
      }
      return this.controller
    }
    this.controller = createAnimationController(this.blender, { ...this.options, ...options }, { now: this.now })
    return this.controller
  }

  addClip(name, clip) {
    this.blender.registerClip(name, clip)
    return this
  }

  playAnimation(name, fadeTime = 0.3) {
    this.blender.playClip(name, fadeTime)
    return this
  }

  crossFade(fromName, toName, fadeTime = 0.3) {
    this.blender.crossFade(fromName, toName, fadeTime)
    return this
  }

  setBlendTree(tree) {
    this.blender.setBlendTree(tree)
    return this
  }

  update(dt, motionState = {}) {
    if (this.controller) this.controller.update(dt, motionState)
    else this.blender.updateBlend(dt)

    if (this.options.enableIK) {
      this._groundFeet()
      if (this.ikRig) this.ikRig.update()
    }

    if (this.ragdoll) this.ragdoll.apply(dt)
    return this
  }

  createRagdoll(options = {}) {
    this.ragdoll = new RagdollPose(this.skeleton, options)
    return this.ragdoll
  }

  removeRagdoll() {
    this.ragdoll = null
    return this
  }

  setRagdollPlan(plan) {
    if (!this.ragdoll) this.createRagdoll()
    applyRagdollActivation(this.ragdoll, plan)
    return this
  }

  setIKTarget(chainName, position, poleVector = null) {
    const chain = this.ikRig ? this.ikRig.getChain(chainName) : null
    if (!chain || !chain.solvers[0]) return this
    const solver = chain.solvers[0]
    if (solver.setTarget) solver.setTarget(position)
    if (poleVector && solver.setPoleVector) solver.setPoleVector(poleVector)
    return this
  }

  enableIK(chainName) {
    if (!this.options.enableIK) {
      throw new Error('[AnimationSystem] enableIK(chain) needs IK: construct the system with enableIK: true')
    }
    const chain = this.ikRig ? this.ikRig.getChain(chainName) : null
    if (chain) chain.enable()
    return this
  }

  disableIK(chainName) {
    const chain = this.ikRig ? this.ikRig.getChain(chainName) : null
    if (chain) chain.disable()
    return this
  }

  getSkeletonBone(boneName) {
    return findBoneByName(this.skeleton, boneName) || findBoneByHumanoidName(this.skeleton, boneName)
  }

  packSkeletonState(buffer, offset = 0) {
    return packSkeletonState(this.skeleton, buffer, offset)
  }

  unpackSkeletonState(buffer, offset = 0) {
    return unpackSkeletonState(this.skeleton, buffer, offset)
  }

  dispose() {
    if (this.controller) this.controller.dispose()
    if (typeof this.blender.stopAll === 'function') this.blender.stopAll()
  }
}

export default AnimationSystem
