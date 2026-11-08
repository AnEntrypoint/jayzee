import {
  add3, addScaled3, applyMatrix4Linear, applyMatrix4Point, applyQuat3, cross3, describeValue, distance3, divide3, dot3,
  finiteTuple, invertMatrix4, length3, lengthSq3, normalize3, quatConjugate, quatFromUnitVectors, quatMultiply,
  quatSlerp, scale3, sub3,
} from './rigMath.js'

const DEFAULT_TOLERANCE = 0.001
const DEFAULT_RAY_DISTANCE = 10
const TWO_BONE_SOLVER = 'TwoBoneIKSolver'
const FOOT_SOLVER = 'FootIKSolver'
const DOWN = Object.freeze([0, -1, 0])

const positiveOptionOf = (value, fallback, name, solver) => {
  if (value === undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error('[' + solver + '] ' + name + ' needs a finite number greater than 0; got ' + describeValue(value))
  }
  return value
}

const booleanOptionOf = (value, fallback, name, solver) => {
  if (value === undefined) return fallback
  if (typeof value !== 'boolean') throw new Error('[' + solver + '] ' + name + ' needs a boolean; got ' + describeValue(value))
  return value
}

const vec = (value, name, solver) => finiteTuple(value, 3, name, solver)
const quat = (value, name, solver) => finiteTuple(value, 4, name, solver)
const matrix = (value, name, solver) => finiteTuple(value, 16, name, solver)

const unsolved = () => ({ solved: false })

export class TwoBoneIKSolver {
  constructor(rootWorld, middleWorld, endWorld, options = {}) {
    this.target = [0, 0, 0]
    this.poleVector = [1, 0, 0]
    this.enabled = true
    this.weight = 1
    this.rootLength = 0
    this.middleLength = 0
    this.tolerance = positiveOptionOf(options.tolerance, DEFAULT_TOLERANCE, 'options.tolerance', TWO_BONE_SOLVER)
    this.useWorldSpace = booleanOptionOf(options.useWorldSpace, true, 'options.useWorldSpace', TWO_BONE_SOLVER)
    this.solved = false
    this.measureBoneLengths(rootWorld, middleWorld, endWorld)
  }

  measureBoneLengths(rootWorld, middleWorld, endWorld) {
    const root = vec(rootWorld, 'root position', TWO_BONE_SOLVER)
    const middle = vec(middleWorld, 'middle position', TWO_BONE_SOLVER)
    const end = vec(endWorld, 'end position', TWO_BONE_SOLVER)
    this.rootLength = distance3(root, middle)
    this.middleLength = distance3(middle, end)
    return this
  }

  setTarget(position) {
    this.target = vec(position, 'setTarget', TWO_BONE_SOLVER)
    return this
  }

  setPoleVector(vector) {
    const direction = vec(vector, 'setPoleVector', TWO_BONE_SOLVER)
    if (lengthSq3(direction) === 0) {
      throw new Error('[' + TWO_BONE_SOLVER + '] setPoleVector needs a direction of non-zero length; got zero')
    }
    this.poleVector = normalize3(direction)
    return this
  }

  solve(pose) {
    this.solved = false
    if (!this.enabled) return unsolved()
    if (!pose || pose.parentWorldQuat == null) return unsolved()

    const parentQuat = quat(pose.parentWorldQuat, 'pose.parentWorldQuat', TWO_BONE_SOLVER)
    const rootWorld = vec(pose.rootWorld, 'pose.rootWorld', TWO_BONE_SOLVER)
    const middleWorld = vec(pose.middleWorld, 'pose.middleWorld', TWO_BONE_SOLVER)
    const endWorld = vec(pose.endWorld, 'pose.endWorld', TWO_BONE_SOLVER)
    const rootQuat = quat(pose.rootWorldQuat, 'pose.rootWorldQuat', TWO_BONE_SOLVER)
    const middleQuat = quat(pose.middleWorldQuat, 'pose.middleWorldQuat', TWO_BONE_SOLVER)
    const rootLocal = quat(pose.rootLocal, 'pose.rootLocal', TWO_BONE_SOLVER)
    const middleLocal = quat(pose.middleLocal, 'pose.middleLocal', TWO_BONE_SOLVER)
    const a = this.rootLength
    const b = this.middleLength
    const reach = a + b

    const goal = this.useWorldSpace
      ? this.target.slice()
      : applyMatrix4Point(matrix(pose.parentMatrixWorld, 'pose.parentMatrixWorld', TWO_BONE_SOLVER), this.target)

    let rootToGoal = sub3(goal, rootWorld)
    if (length3(rootToGoal) > reach) rootToGoal = scale3(normalize3(rootToGoal), reach)
    const d = length3(rootToGoal)

    if (d < this.tolerance || a <= 0 || b <= 0) return unsolved()

    const rootDir = divide3(rootToGoal, d)
    const cosAtRoot = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)))
    const sinAtRoot = Math.sqrt(1 - cosAtRoot * cosAtRoot)

    let bend = applyQuat3(this.poleVector, parentQuat)
    bend = addScaled3(bend, rootDir, -dot3(bend, rootDir))
    if (lengthSq3(bend) < 1e-12) {
      const reference = Math.abs(rootDir[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0]
      bend = cross3(rootDir, reference)
    }
    bend = normalize3(bend)

    const middleGoal = addScaled3(addScaled3(rootWorld, rootDir, a * cosAtRoot), bend, a * sinAtRoot)
    const endGoal = add3(rootWorld, rootToGoal)

    const rootSwing = quatFromUnitVectors(
      normalize3(sub3(middleWorld, rootWorld)),
      normalize3(sub3(middleGoal, rootWorld)),
    )
    const middleAfterRoot = add3(applyQuat3(sub3(middleWorld, rootWorld), rootSwing), rootWorld)
    const endAfterRoot = add3(applyQuat3(sub3(endWorld, rootWorld), rootSwing), rootWorld)

    const middleSwing = quatFromUnitVectors(
      normalize3(sub3(endAfterRoot, middleAfterRoot)),
      normalize3(sub3(endGoal, middleGoal)),
    )

    const rootWorldTarget = quatMultiply(rootSwing, rootQuat)
    const middleWorldTarget = quatMultiply(quatMultiply(middleSwing, rootSwing), middleQuat)

    const nextRoot = quatSlerp(rootLocal, quatMultiply(quatConjugate(parentQuat), rootWorldTarget), this.weight)
    const rootWorldNow = quatMultiply(parentQuat, nextRoot)
    const nextMiddle = quatSlerp(middleLocal, quatMultiply(quatConjugate(rootWorldNow), middleWorldTarget), this.weight)

    this.solved = true
    return { solved: true, rootLocal: nextRoot, middleLocal: nextMiddle }
  }
}

export class FootIKSolver {
  constructor(raycastCallback, options = {}) {
    if (typeof raycastCallback !== 'function') {
      throw new Error('[' + FOOT_SOLVER + '] needs a raycast callback function; got ' + describeValue(raycastCallback))
    }
    this.raycastCallback = raycastCallback
    this.enabled = true
    this.weight = 1
    this.rayDistance = positiveOptionOf(options.rayDistance, DEFAULT_RAY_DISTANCE, 'options.rayDistance', FOOT_SOLVER)
    this.solved = false
  }

  solve(footWorld, parentMatrixWorld = null) {
    this.solved = false
    if (!this.enabled) return unsolved()

    const foot = vec(footWorld, 'footWorld', FOOT_SOLVER)
    const rayOrigin = [foot[0], foot[1] + this.rayDistance / 2, foot[2]]
    const hitPoint = this.raycastCallback(rayOrigin, DOWN.slice(), this.rayDistance)

    if (!hitPoint || !Number.isFinite(hitPoint[1])) return unsolved()

    const worldHeightAdjustment = (hitPoint[1] - foot[1]) * this.weight
    let delta = [0, worldHeightAdjustment, 0]
    if (parentMatrixWorld != null) {
      delta = applyMatrix4Linear(invertMatrix4(matrix(parentMatrixWorld, 'parentMatrixWorld', FOOT_SOLVER)), delta)
    }

    this.solved = true
    return { solved: true, delta }
  }
}

export class IKChain {
  constructor(name = '') {
    this.name = name
    this.solvers = []
    this.refusals = []
    this.enabled = true
  }

  addSolver(solver) {
    if (!solver || typeof solver.solve !== 'function') {
      this.refusals.push(solver)
      return this
    }
    this.solvers.push(solver)
    return this
  }

  solve() {
    if (!this.enabled) return this
    for (const solver of this.solvers) solver.solve()
    return this
  }

  enable() {
    this.enabled = true
    return this
  }

  disable() {
    this.enabled = false
    return this
  }
}

export class IKRig {
  constructor(skeleton) {
    this.skeleton = skeleton
    this.chains = new Map()
    this.enabled = true
  }

  createChain(name) {
    if (typeof name !== 'string' || name.length === 0) {
      throw new Error('[IKRig] createChain needs a non-empty chain name; got ' + describeValue(name))
    }
    if (this.chains.has(name)) throw new Error('[IKRig] createChain cannot replace the chain already named "' + name + '"')
    const chain = new IKChain(name)
    this.chains.set(name, chain)
    return chain
  }

  getChain(name) {
    return this.chains.get(name)
  }

  update() {
    if (!this.enabled) return
    for (const chain of this.chains.values()) chain.solve()
  }

  enable() {
    this.enabled = true
    return this
  }

  disable() {
    this.enabled = false
    return this
  }
}
