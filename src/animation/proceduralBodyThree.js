import { buildProceduralSkeleton, computeSkinBinding, SKIN_INFLUENCES } from './proceduralSkeleton.js'

const THREE_CLASSES = ['Bone', 'Skeleton', 'SkinnedMesh', 'BufferGeometry', 'BufferAttribute', 'MeshStandardMaterial']
const RING = 4
const SEGMENT_VERTICES = RING * 2
const SEGMENT_INDICES = 36
const DEFAULT_THICKNESS = 0.05
const BOX_FACES = Object.freeze([0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7, 0, 3, 2, 0, 2, 1, 4, 5, 6, 4, 6, 7])

function fail(message) {
  throw new Error(`[ProceduralBody] ${message}`)
}

function basisFor(ax, ay, az, out) {
  const len = Math.hypot(ax, ay, az)
  const dx = len > 0 ? ax / len : 0
  const dy = len > 0 ? ay / len : 1
  const dz = len > 0 ? az / len : 0
  const useX = Math.abs(dx) < 0.9
  const rx = useX ? 1 : 0
  const ry = useX ? 0 : 1
  let ux = dy * 0 - dz * ry
  let uy = dz * rx - dx * 0
  let uz = dx * ry - dy * rx
  const ul = Math.hypot(ux, uy, uz)
  ux /= ul
  uy /= ul
  uz /= ul
  out[0] = ux
  out[1] = uy
  out[2] = uz
  out[3] = dy * uz - dz * uy
  out[4] = dz * ux - dx * uz
  out[5] = dx * uy - dy * ux
}

export function planProceduralBody(spec, shape = {}) {
  const rig = buildProceduralSkeleton(spec)
  const thickness = shape.thickness ?? DEFAULT_THICKNESS
  if (typeof thickness !== 'number' || !Number.isFinite(thickness) || thickness <= 0) fail(`thickness must be a positive finite number, got ${thickness}`)
  const segments = rig.bones.length
  const positions = new Float32Array(segments * SEGMENT_VERTICES * 3)
  const indices = new Uint16Array(segments * SEGMENT_INDICES)
  const joints = new Array(segments * SEGMENT_VERTICES * SKIN_INFLUENCES).fill(0)
  const weights = new Array(segments * SEGMENT_VERTICES * SKIN_INFLUENCES).fill(0)
  const basis = [0, 0, 0, 0, 0, 0]
  rig.bones.forEach((bone, s) => {
    const end = rig.pivots.get(bone.name)
    const hasParent = bone.parent !== null
    const start = hasParent ? rig.pivots.get(bone.parent) : [end[0], end[1] - thickness, end[2]]
    const tip = hasParent ? end : [end[0], end[1] + thickness, end[2]]
    basisFor(tip[0] - start[0], tip[1] - start[1], tip[2] - start[2], basis)
    for (let ring = 0; ring < 2; ring++) {
      const centre = ring === 0 ? start : tip
      for (let corner = 0; corner < RING; corner++) {
        const su = corner === 0 || corner === 3 ? -1 : 1
        const sv = corner < 2 ? -1 : 1
        const v = s * SEGMENT_VERTICES + ring * RING + corner
        positions[v * 3] = centre[0] + thickness * (su * basis[0] + sv * basis[3])
        positions[v * 3 + 1] = centre[1] + thickness * (su * basis[1] + sv * basis[4])
        positions[v * 3 + 2] = centre[2] + thickness * (su * basis[2] + sv * basis[5])
        const w = v * SKIN_INFLUENCES
        if (!hasParent) {
          joints[w] = bone.name
          weights[w] = 1
        } else if (ring === 0) {
          joints[w] = bone.parent
          weights[w] = 1
        } else {
          joints[w] = bone.parent
          weights[w] = 0.5
          joints[w + 1] = bone.name
          weights[w + 1] = 0.5
        }
      }
    }
    for (let i = 0; i < SEGMENT_INDICES; i++) indices[s * SEGMENT_INDICES + i] = s * SEGMENT_VERTICES + BOX_FACES[i]
  })
  const binding = computeSkinBinding(segments * SEGMENT_VERTICES, rig.skeleton, { joints, weights })
  return { rig, positions, indices, skinIndex: binding.skinIndex, skinWeight: binding.skinWeight, vertexCount: segments * SEGMENT_VERTICES, thickness }
}

export function createProceduralBody(THREE, spec, options = {}) {
  if (!THREE || typeof THREE !== 'object') fail('createProceduralBody needs the three namespace as its first argument')
  for (const name of THREE_CLASSES) if (typeof THREE[name] !== 'function') fail(`the three namespace has no ${name}`)
  const plan = planProceduralBody(spec, options)
  const bones = new Map()
  const ordered = []
  for (const entry of plan.rig.bones) {
    const bone = new THREE.Bone()
    bone.name = entry.name
    bone.position.set(entry.position[0], entry.position[1], entry.position[2])
    bones.set(entry.name, bone)
    ordered.push(bone)
    if (entry.parent !== null) bones.get(entry.parent).add(bone)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(plan.positions, 3))
  geometry.setAttribute('skinIndex', new THREE.BufferAttribute(plan.skinIndex, SKIN_INFLUENCES))
  geometry.setAttribute('skinWeight', new THREE.BufferAttribute(plan.skinWeight, SKIN_INFLUENCES))
  geometry.setIndex(new THREE.BufferAttribute(plan.indices, 1))
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const material = options.material ?? new THREE.MeshStandardMaterial()
  const mesh = new THREE.SkinnedMesh(geometry, material)
  mesh.name = options.name ?? 'procedural-body'
  for (const root of plan.rig.roots) mesh.add(bones.get(root))
  mesh.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton(ordered)
  mesh.bind(skeleton)
  return { mesh, skeleton, bones, geometry, material, rig: plan.rig, vertexCount: plan.vertexCount }
}
