import * as THREE from 'three'
import { mat4, instancedBufferAttribute } from 'three/tsl'

const MATRIX_FLOATS = 16
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0)

export function isWebGPUInstancingSupported(renderer) {
  return !!(renderer && renderer.isWebGPURenderer)
}

export function instanceMatrixNodeFor(object) {
  const interleaved = object.userData.instanceMatrixInterleaved
  if (!interleaved) throw new Error('instanceMatrixNodeFor: ' + (object.name || object.type) + ' was not built by createWebGPUInstancedMesh (no userData.instanceMatrixInterleaved)')
  return mat4(...[0, 4, 8, 12].map((offset) => instancedBufferAttribute(interleaved, 'vec4', MATRIX_FLOATS, offset)))
}

export function createSlotRangeUploader(buffer, stride) {
  let lo = 0
  let hi = -1
  return function markSlotDirty(slot) {
    const ranges = buffer.updateRanges
    buffer.needsUpdate = true
    if (ranges.length === 0) {
      lo = slot
      hi = slot
      buffer.addUpdateRange(lo * stride, stride)
      return
    }
    if (slot >= lo && slot <= hi) return
    if (slot < lo) lo = slot
    else hi = slot
    ranges[0].start = lo * stride
    ranges[0].count = (hi - lo + 1) * stride
  }
}

export function createWebGPUInstancedMesh(geometry, material, capacity) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.frustumCulled = false
  mesh.count = 0
  const interleaved = new THREE.InstancedInterleavedBuffer(mesh.instanceMatrix.array, MATRIX_FLOATS, 1)
  mesh.userData.instanceMatrixInterleaved = interleaved
  const markInterleavedDirty = createSlotRangeUploader(interleaved, MATRIX_FLOATS)
  const markInstanceMatrixDirty = createSlotRangeUploader(mesh.instanceMatrix, MATRIX_FLOATS)
  const markMatricesDirty = (slot) => { markInterleavedDirty(slot); markInstanceMatrixDirty(slot) }

  let nextId = 0
  let highWatermark = 0

  function acquireId() {
    if (nextId >= capacity) return -1
    const id = nextId++
    highWatermark = nextId
    mesh.count = highWatermark
    mesh.setMatrixAt(id, _zeroMatrix)
    markMatricesDirty(id)
    return id
  }

  function setMatrixAt(id, matrix) {
    mesh.setMatrixAt(id, matrix)
    markMatricesDirty(id)
  }

  function clear() {
    nextId = 0
    highWatermark = 0
    mesh.count = 0
  }

  function dispose() {
    material.dispose()
  }

  return { mesh, acquireId, setMatrixAt, clear, dispose }
}
