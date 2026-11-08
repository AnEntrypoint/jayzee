import * as THREE from 'three'
import { CROWD_DOT_CELL_M } from '../snapshot-lod-pure/constants.js'
import { CROWD_DOT_SIZE, decodeCrowdDots } from './crowdDots.js'
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
    const poses = decodeCrowdDots(dots, { dotCellM, dotSize, viewerY, groundHeightFn })
    ensureCapacity(poses.length)
    inst.clear()
    poses.forEach((pose) => {
      const id = inst.acquireId()
      position.set(pose.x, pose.y, pose.z)
      scale.set(pose.scale, pose.scale, pose.scale)
      inst.setMatrixAt(id, matrix.compose(position, quaternion, scale))
    })
    activeCount = poses.length
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
