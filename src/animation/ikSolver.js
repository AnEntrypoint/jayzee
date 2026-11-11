import {
  add3Into, addScaled3Into, applyMatrix4LinearInto, applyMatrix4PointInto, applyQuat3Into, copy3, cross3Into, describeValue,
  distance3, divide3Into, dot3, finiteTuple, finiteTupleInto, invertMatrix4Into, length3, lengthSq3, normalize3, normalize3Into,
  quatConjugateInto, quatFromUnitVectorsInto, quatMultiplyInto, quatSlerpInto, scale3Into, sub3Into,
} from './rigMath.js'

const DEFAULT_TOLERANCE = 0.001
const DEFAULT_RAY_DISTANCE = 10
const TWO_BONE_SOLVER = 'TwoBoneIKSolver'
const FOOT_SOLVER = 'FootIKSolver'
const DOWN = Object.freeze([0, -1, 0])
const AXIS_X = Object.freeze([1, 0, 0])
const AXIS_Y = Object.freeze([0, 1, 0])

const triple = () => [0, 0, 0]
const quad = () => [0, 0, 0, 1]
const sixteen = () => new Array(16).fill(0)

const held = {
  parentQuat: quad(),
  rootWorld: triple(),
  middleWorld: triple(),
  endWorld: triple(),
  rootQuat: quad(),
  middleQuat: quad(),
  rootLocal: quad(),
  middleLocal: quad(),
  matrix: sixteen(),
  inverse: sixteen(),
  goal: triple(),
  rootToGoal: triple(),
  rootDir: triple(),
  bend: triple(),
  middleGoal: triple(),
  endGoal: triple(),
  from: triple(),
  to: triple(),
  rootSwing: quad(),
  middleAfterRoot: triple(),
  endAfterRoot: triple(),
  middleSwing: quad(),
  rootWorldTarget: quad(),
  middleWorldTarget: quad(),
  product: quad(),
  conjugate: quad(),
  rootWorldNow: quad(),
  nextRoot: quad(),
  nextMiddle: quad(),
  foot: triple(),
}

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
const vecInto = (out, value, name, solver) => finiteTupleInto(out, value, 3, name, solver)
const quatInto = (out, value, name, solver) => finiteTupleInto(out, value, 4, name, solver)
const matrixInto = (out, value, name, solver) => finiteTupleInto(out, value, 16, name, solver)

const unsolved = () => ({ solved: false })

const unsolvedInto = (out) => {
  if (out === null) return unsolved()
  out.solved = false
  return out
}

export const makeTwoBoneResult = () => ({ solved: false, rootLocal: quad(), middleLocal: quad() })

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

  solve(pose, out = null) {
    this.solved = false
    if (!this.enabled) return unsolvedInto(out)
    if (!pose || pose.parentWorldQuat == null) return unsolvedInto(out)

    const parentQuat = quatInto(held.parentQuat, pose.parentWorldQuat, 'pose.parentWorldQuat', TWO_BONE_SOLVER)
    const rootWorld = vecInto(held.rootWorld, pose.rootWorld, 'pose.rootWorld', TWO_BONE_SOLVER)
    const middleWorld = vecInto(held.middleWorld, pose.middleWorld, 'pose.middleWorld', TWO_BONE_SOLVER)
    const endWorld = vecInto(held.endWorld, pose.endWorld, 'pose.endWorld', TWO_BONE_SOLVER)
    const rootQuat = quatInto(held.rootQuat, pose.rootWorldQuat, 'pose.rootWorldQuat', TWO_BONE_SOLVER)
    const middleQuat = quatInto(held.middleQuat, pose.middleWorldQuat, 'pose.middleWorldQuat', TWO_BONE_SOLVER)
    const rootLocal = quatInto(held.rootLocal, pose.rootLocal, 'pose.rootLocal', TWO_BONE_SOLVER)
    const middleLocal = quatInto(held.middleLocal, pose.middleLocal, 'pose.middleLocal', TWO_BONE_SOLVER)
    const a = this.rootLength
    const b = this.middleLength
    const reach = a + b

    const goal = this.useWorldSpace
      ? copy3(held.goal, this.target)
      : applyMatrix4PointInto(held.goal, matrixInto(held.matrix, pose.parentMatrixWorld, 'pose.parentMatrixWorld', TWO_BONE_SOLVER), this.target)

    const rootToGoal = sub3Into(held.rootToGoal, goal, rootWorld)
    if (length3(rootToGoal) > reach) scale3Into(rootToGoal, normalize3Into(rootToGoal, rootToGoal), reach)
    const d = length3(rootToGoal)

    if (d < this.tolerance || a <= 0 || b <= 0) return unsolvedInto(out)

    const rootDir = divide3Into(held.rootDir, rootToGoal, d)
    const cosAtRoot = Math.max(-1, Math.min(1, (a * a + d * d - b * b) / (2 * a * d)))
    const sinAtRoot = Math.sqrt(1 - cosAtRoot * cosAtRoot)

    const bend = applyQuat3Into(held.bend, this.poleVector, parentQuat)
    addScaled3Into(bend, bend, rootDir, -dot3(bend, rootDir))
    if (lengthSq3(bend) < 1e-12) cross3Into(bend, rootDir, Math.abs(rootDir[0]) < 0.9 ? AXIS_X : AXIS_Y)
    normalize3Into(bend, bend)

    const middleGoal = addScaled3Into(held.middleGoal, addScaled3Into(held.middleGoal, rootWorld, rootDir, a * cosAtRoot), bend, a * sinAtRoot)
    const endGoal = add3Into(held.endGoal, rootWorld, rootToGoal)

    const rootSwing = quatFromUnitVectorsInto(
      held.rootSwing,
      normalize3Into(held.from, sub3Into(held.from, middleWorld, rootWorld)),
      normalize3Into(held.to, sub3Into(held.to, middleGoal, rootWorld)),
    )
    const middleAfterRoot = add3Into(held.middleAfterRoot, applyQuat3Into(held.middleAfterRoot, sub3Into(held.middleAfterRoot, middleWorld, rootWorld), rootSwing), rootWorld)
    const endAfterRoot = add3Into(held.endAfterRoot, applyQuat3Into(held.endAfterRoot, sub3Into(held.endAfterRoot, endWorld, rootWorld), rootSwing), rootWorld)

    const middleSwing = quatFromUnitVectorsInto(
      held.middleSwing,
      normalize3Into(held.from, sub3Into(held.from, endAfterRoot, middleAfterRoot)),
      normalize3Into(held.to, sub3Into(held.to, endGoal, middleGoal)),
    )

    const rootWorldTarget = quatMultiplyInto(held.rootWorldTarget, rootSwing, rootQuat)
    const middleWorldTarget = quatMultiplyInto(held.middleWorldTarget, quatMultiplyInto(held.product, middleSwing, rootSwing), middleQuat)

    const nextRoot = quatSlerpInto(held.nextRoot, rootLocal, quatMultiplyInto(held.product, quatConjugateInto(held.conjugate, parentQuat), rootWorldTarget), this.weight)
    const rootWorldNow = quatMultiplyInto(held.rootWorldNow, parentQuat, nextRoot)
    const nextMiddle = quatSlerpInto(held.nextMiddle, middleLocal, quatMultiplyInto(held.product, quatConjugateInto(held.conjugate, rootWorldNow), middleWorldTarget), this.weight)

    this.solved = true
    if (out === null) {
      return {
        solved: true,
        rootLocal: [nextRoot[0], nextRoot[1], nextRoot[2], nextRoot[3]],
        middleLocal: [nextMiddle[0], nextMiddle[1], nextMiddle[2], nextMiddle[3]],
      }
    }
    out.solved = true
    out.rootLocal[0] = nextRoot[0]
    out.rootLocal[1] = nextRoot[1]
    out.rootLocal[2] = nextRoot[2]
    out.rootLocal[3] = nextRoot[3]
    out.middleLocal[0] = nextMiddle[0]
    out.middleLocal[1] = nextMiddle[1]
    out.middleLocal[2] = nextMiddle[2]
    out.middleLocal[3] = nextMiddle[3]
    return out
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

    const foot = vecInto(held.foot, footWorld, 'footWorld', FOOT_SOLVER)
    const footY = foot[1]
    const rayOrigin = [foot[0], footY + this.rayDistance / 2, foot[2]]
    const hitPoint = this.raycastCallback(rayOrigin, DOWN.slice(), this.rayDistance)

    if (!hitPoint || !Number.isFinite(hitPoint[1])) return unsolved()

    const worldHeightAdjustment = (hitPoint[1] - footY) * this.weight
    const delta = [0, worldHeightAdjustment, 0]
    if (parentMatrixWorld != null) {
      applyMatrix4LinearInto(delta, invertMatrix4Into(held.inverse, matrixInto(held.matrix, parentMatrixWorld, 'parentMatrixWorld', FOOT_SOLVER)), delta)
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
