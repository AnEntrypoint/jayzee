import * as THREE from 'three'
import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'
import { CROWD_DOT_SIZE, CROWD_POSE_STRIDE, crowdPoseBuffer, crowdPoseBufferFor, decodeCrowdDotPoses } from './crowdDots.js'
import { makeDotGeometry } from './dotGeometry.js'
import { createDotMaterialTSL } from './playerLodDotTSL.js'
import { createWebGPUInstancedMesh } from './webgpuInstancing.js'

const DOT_RENDER_ORDER = 3
const DOT_CAPACITY = 512

export function createCrowdDotRendererWebGPU(scene, opts = {}) {
  const dotCellM = opts.dotCellM || CROWD_DOT_CELL_M
  const dotSize = opts.dotSize || CROWD_DOT_SIZE
  let capacity = opts.capacity || DOT_CAPACITY
  const geo = makeDotGeometry(dotSize)
  const position = new THREE.Vector3()
  const scale = new THREE.Vector3()
  const quaternion = new THREE.Quaternion()
  const matrix = new THREE.Matrix4()
  let inst = buildInstance(capacity)
  let activeCount = 0
  const decodeOptions = { dotCellM, dotSize, viewerY: 0, groundHeightFn: null }
  let poses = crowdPoseBuffer(capacity)

  function buildInstance(cap) {
    const rec = createWebGPUInstancedMesh(geo, createDotMaterialTSL(), cap)
    rec.mesh.renderOrder = DOT_RENDER_ORDER
    scene.add(rec.mesh)
    return rec
  }

  function ensureCapacity(n) {
    if (n <= capacity) return
    capacity = Math.max(n, capacity * 2)
    scene.remove(inst.mesh)
    inst.dispose()
    inst = buildInstance(capacity)
  }

  function update(dots, viewerY, groundHeightFn) {
    if (!dots || dots.length === 0) {
      if (activeCount > 0) { inst.clear(); activeCount = 0 }
      return
    }
    decodeOptions.viewerY = viewerY
    decodeOptions.groundHeightFn = groundHeightFn
    poses = crowdPoseBufferFor(poses, dots.length)
    const count = decodeCrowdDotPoses(dots, decodeOptions, poses)
    ensureCapacity(count)
    inst.clear()
    for (let i = 0; i < count; i++) {
      const at = i * CROWD_POSE_STRIDE
      const size = poses[at + 3]
      const id = inst.acquireId()
      position.set(poses[at], poses[at + 1], poses[at + 2])
      scale.set(size, size, size)
      inst.setMatrixAt(id, matrix.compose(position, quaternion, scale))
    }
    activeCount = count
  }

  function dispose() {
    scene.remove(inst.mesh)
    geo.dispose()
    inst.dispose()
  }

  return {
    get instancedMesh() {
      return inst.mesh
    },
    update,
    dispose,
    get count() {
      return activeCount
    },
  }
}
