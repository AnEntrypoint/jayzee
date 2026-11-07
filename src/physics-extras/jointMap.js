import { checkVec3, readQuat, refusal } from './math.js'

const JOINT = 'joint-map'
const JOINT_VEC3_CODE = 'quat-vec-invalid'

export const JOINT_TYPES = Object.freeze(['point', 'spherical', 'swingTwist', 'hinge', 'fixed'])

const readJointVec3 = (value, name) => checkVec3(value, name, JOINT_VEC3_CODE, 'quat')

const readJointSpec = (id, spec) => {
  if (typeof id !== 'string' || !id) throw refusal(JOINT, 'joint-id-invalid', 'id must be a non-empty string')
  if (!spec || typeof spec !== 'object') throw refusal(JOINT, 'joint-spec-invalid', 'spec must be an object')
  if (typeof spec.to !== 'string' || !spec.to) throw refusal(JOINT, 'joint-target-invalid', 'joint needs a non-empty to id')
  if (!JOINT_TYPES.includes(spec.type ?? 'point')) {
    throw refusal(JOINT, 'joint-type-invalid', `type must be one of ${JOINT_TYPES.join(', ')}`)
  }
  readJointVec3(spec.anchor ?? [0, 0, 0], 'anchor')
  readJointVec3(spec.targetAnchor ?? [0, 0, 0], 'targetAnchor')
  readJointVec3(spec.axis ?? [0, 1, 0], 'axis')
  if (spec.target !== undefined) readQuat(spec.target, 'target')
  if (spec.strength !== undefined && (!Number.isFinite(spec.strength) || spec.strength < 0)) {
    throw refusal(JOINT, 'joint-strength-invalid', 'strength must be a non-negative finite number')
  }
  return Object.freeze({
    id,
    to: spec.to,
    type: spec.type ?? 'point',
    anchor: (spec.anchor ?? [0, 0, 0]).slice(),
    targetAnchor: (spec.targetAnchor ?? [0, 0, 0]).slice(),
    axis: (spec.axis ?? [0, 1, 0]).slice(),
    target: spec.target === undefined ? null : spec.target.slice(),
    strength: spec.strength ?? 1,
    limits: spec.limits ?? {},
  })
}

export function createJointMap({ setConstraint = null, removeConstraint = null } = {}) {
  if (setConstraint !== null && typeof setConstraint !== 'function') {
    throw refusal(JOINT, 'joint-hook-invalid', 'setConstraint must be a function or null')
  }
  if (removeConstraint !== null && typeof removeConstraint !== 'function') {
    throw refusal(JOINT, 'joint-hook-invalid', 'removeConstraint must be a function or null')
  }
  const joints = new Map()
  return {
    set(id, spec) {
      const joint = readJointSpec(id, spec)
      const firstPose = joints.get(id)?.target ?? joint.target
      const stored = joints.get(id) ? { ...joint, target: firstPose } : joint
      joints.set(id, stored)
      if (setConstraint) setConstraint(id, stored)
      return stored
    },
    retuneLimits(id, limits) {
      const joint = joints.get(id)
      if (!joint) throw refusal(JOINT, 'joint-unknown', `no joint named ${id}`)
      if (!limits || typeof limits !== 'object' || Array.isArray(limits)) {
        throw refusal(JOINT, 'joint-limits-invalid', 'limits must be an object')
      }
      const stored = { ...joint, limits: { ...limits } }
      joints.set(id, stored)
      return stored
    },
    get: (id) => joints.get(id) ?? null,
    remove(id) {
      if (!joints.delete(id)) throw refusal(JOINT, 'joint-unknown', `no joint named ${id}`)
      if (removeConstraint) removeConstraint(id)
      return { ok: true, id }
    },
    ids: () => [...joints.keys()],
  }
}
