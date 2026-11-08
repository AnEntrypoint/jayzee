import { lerp3, quatNormalize, quatSlerp } from './rigMath.js'

const QUAT_STRIDE = 4
const QUAT_SCALE = 32767
const MIN_PACK_LENGTH = 0.001

export const HUMANOID_BONE_NAMES = Object.freeze({
  hips: Object.freeze(['Hips', 'hips', 'armature|hips', 'root']),
  spine: Object.freeze(['Spine', 'spine', 'armature|spine']),
  chest: Object.freeze(['Chest', 'chest', 'armature|chest']),
  neck: Object.freeze(['Neck', 'neck', 'armature|neck']),
  head: Object.freeze(['Head', 'head', 'armature|head']),
  leftShoulder: Object.freeze(['LeftShoulder', 'shoulder.l', 'armature|shoulder.l']),
  rightShoulder: Object.freeze(['RightShoulder', 'shoulder.r', 'armature|shoulder.r']),
  leftUpperArm: Object.freeze(['LeftArm', 'upper_armL', 'armature|upper_arm.l']),
  rightUpperArm: Object.freeze(['RightArm', 'upper_armR', 'armature|upper_arm.r']),
  leftLowerArm: Object.freeze(['LeftForeArm', 'lower_armL', 'armature|forearm.l']),
  rightLowerArm: Object.freeze(['RightForeArm', 'lower_armR', 'armature|forearm.r']),
  leftHand: Object.freeze(['LeftHand', 'handL', 'armature|hand.l']),
  rightHand: Object.freeze(['RightHand', 'handR', 'armature|hand.r']),
  leftUpperLeg: Object.freeze(['LeftUpLeg', 'upper_legL', 'armature|upper_leg.l']),
  rightUpperLeg: Object.freeze(['RightUpLeg', 'upper_legR', 'armature|upper_leg.r']),
  leftLowerLeg: Object.freeze(['LeftLeg', 'lower_legL', 'armature|lower_leg.l']),
  rightLowerLeg: Object.freeze(['RightLeg', 'lower_legR', 'armature|lower_leg.r']),
  leftFoot: Object.freeze(['LeftFoot', 'footL', 'armature|foot.l']),
  rightFoot: Object.freeze(['RightFoot', 'footR', 'armature|foot.r']),
})

const bonesOf = (skeleton) => (skeleton && skeleton.bones ? skeleton.bones : null)

export function findBoneByName(skeleton, boneName) {
  const bones = bonesOf(skeleton)
  if (!bones) return null
  for (const bone of bones) if (bone.name === boneName) return bone
  return null
}

export function findBoneByHumanoidName(skeleton, humanoidName) {
  const bones = bonesOf(skeleton)
  if (!bones) return null
  const candidates = Object.hasOwn(HUMANOID_BONE_NAMES, humanoidName) ? HUMANOID_BONE_NAMES[humanoidName] : [humanoidName]
  for (const candidate of candidates) {
    const bone = bones.find((b) => b.name === candidate)
    if (bone) return bone
  }
  return null
}

export function getRootBone(skeleton) {
  const bones = bonesOf(skeleton)
  if (!bones) return null
  const hips = findBoneByHumanoidName(skeleton, 'hips')
  if (hips) return hips
  if (bones.length > 0) return bones[0]
  return null
}

export function buildBoneMap(skeleton) {
  const map = new Map()
  const bones = bonesOf(skeleton)
  if (!bones) return map
  for (const bone of bones) map.set(bone.name, bone)
  return map
}

export const interpolateQuaternion = (q1, q2, t) => quatSlerp(q1, q2, t)

export const interpolateVector3 = (v1, v2, t) => lerp3(v1, v2, t)

export function packQuaternion(quat, buffer, offset = 0) {
  const n = Math.sqrt(quat[0] * quat[0] + quat[1] * quat[1] + quat[2] * quat[2] + quat[3] * quat[3])
  const divisor = Math.max(n, MIN_PACK_LENGTH)
  buffer[offset] = Math.round((quat[0] / divisor) * QUAT_SCALE)
  buffer[offset + 1] = Math.round((quat[1] / divisor) * QUAT_SCALE)
  buffer[offset + 2] = Math.round((quat[2] / divisor) * QUAT_SCALE)
  buffer[offset + 3] = Math.round((quat[3] / divisor) * QUAT_SCALE)
}

export function unpackQuaternion(buffer, offset = 0) {
  return quatNormalize([
    buffer[offset] / QUAT_SCALE,
    buffer[offset + 1] / QUAT_SCALE,
    buffer[offset + 2] / QUAT_SCALE,
    buffer[offset + 3] / QUAT_SCALE,
  ])
}

const requireRoom = (bones, buffer, offset) => {
  const needed = offset + bones.length * QUAT_STRIDE
  if (buffer.length < needed) {
    throw new Error('[SkeletonUtils] skeleton state buffer too short: need ' + needed + ' slots, got ' + buffer.length)
  }
}

export function packSkeletonState(skeleton, buffer, offset = 0) {
  const bones = bonesOf(skeleton)
  if (!bones) return offset
  requireRoom(bones, buffer, offset)
  let cursor = offset
  for (const bone of bones) {
    packQuaternion(bone.quaternion, buffer, cursor)
    cursor += QUAT_STRIDE
  }
  return cursor
}

export function unpackSkeletonState(skeleton, buffer, offset = 0) {
  const bones = bonesOf(skeleton)
  if (!bones) return offset
  requireRoom(bones, buffer, offset)
  let cursor = offset
  for (const bone of bones) {
    const q = unpackQuaternion(buffer, cursor)
    for (let i = 0; i < QUAT_STRIDE; i++) bone.quaternion[i] = q[i]
    cursor += QUAT_STRIDE
  }
  return cursor
}
