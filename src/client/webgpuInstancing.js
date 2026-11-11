import * as THREE from 'three'
import { mat4, instancedBufferAttribute } from 'three/tsl'

const ITEM_SIZE = { float: 1, vec2: 2, vec3: 3, vec4: 4 }
const MATRIX_FLOATS = 16
const _zeroMatrix = new THREE.Matrix4().makeScale(0, 0, 0)

export function isWebGPUInstancingSupported(renderer) {
  return !!(renderer && renderer.isWebGPURenderer)
}

export function instanceMatrixNodeFor(object) {
  const interleaved = object.userData.instanceMatrixInterleaved
  if (!interleaved) throw new Error(`instanceMatrixNodeFor: ${object.name || object.type} was not built by createWebGPUInstancedMesh (no userData.instanceMatrixInterleaved)`)
  return mat4(...[0, 4, 8, 12].map((offset) => instancedBufferAttribute(interleaved, 'vec4', MATRIX_FLOATS, offset)))
}

export function createSlotRangeUploader(buffer, stride) {
  let lo = 0, hi = -1
  return function markSlotDirty(slot) {
    const ranges = buffer.updateRanges
    buffer.needsUpdate = true
    if (ranges.length === 0) { lo = slot; hi = slot; buffer.addUpdateRange(lo * stride, stride); return }
    if (slot >= lo && slot <= hi) return
    if (slot < lo) lo = slot; else hi = slot
    ranges[0].start = lo * stride
    ranges[0].count = (hi - lo + 1) * stride
  }
}

export function createWebGPUInstancedMesh(geometry, material, capacity, attributeSchema = {}) {
  const mesh = new THREE.InstancedMesh(geometry, material, capacity)
  mesh.frustumCulled = false
  mesh.count = 0
  const interleaved = new THREE.InstancedInterleavedBuffer(mesh.instanceMatrix.array, MATRIX_FLOATS, 1)
  mesh.userData.instanceMatrixInterleaved = interleaved
  const markInterleavedDirty = createSlotRangeUploader(interleaved, MATRIX_FLOATS)
  const markInstanceMatrixDirty = createSlotRangeUploader(mesh.instanceMatrix, MATRIX_FLOATS)
  const markMatricesDirty = (slot) => { markInterleavedDirty(slot); markInstanceMatrixDirty(slot) }

  const shadowMatrices = new Float32Array(capacity * 16)

  const attributeArrays = {}
  for (const name in attributeSchema) {
    const type = attributeSchema[name]
    const itemSize = ITEM_SIZE[type]
    if (!itemSize) throw new Error(`WebGPUInstancing: unsupported attribute type "${type}" for "${name}"`)
    const array = new Float32Array(capacity * itemSize)
    const attr = new THREE.InstancedBufferAttribute(array, itemSize)
    geometry.setAttribute(name, attr)
    attributeArrays[name] = { array, itemSize, attr, markSlotDirty: createSlotRangeUploader(attr, itemSize) }
  }

  const inUse = new Uint8Array(capacity)
  const hidden = new Uint8Array(capacity)
  const recycledIds = []
  let neverUsedFrom = 0
  let highWatermark = 0
  let acquiredCount = 0

  function takeFreeId() {
    while (recycledIds.length) { const id = recycledIds.pop(); if (!inUse[id]) return id }
    return neverUsedFrom < capacity ? neverUsedFrom++ : -1
  }

  function acquireId() {
    const id = takeFreeId()
    if (id < 0) return -1
    inUse[id] = 1
    acquiredCount++
    if (id + 1 > highWatermark) highWatermark = id + 1
    mesh.count = highWatermark
    _zeroMatrix.toArray(shadowMatrices, id * 16)
    hidden[id] = 0
    mesh.setMatrixAt(id, _zeroMatrix)
    markMatricesDirty(id)
    return id
  }

  function releaseId(id) {
    _zeroMatrix.toArray(shadowMatrices, id * 16)
    hidden[id] = 0
    mesh.setMatrixAt(id, _zeroMatrix)
    markMatricesDirty(id)
    if (inUse[id]) { inUse[id] = 0; acquiredCount--; recycledIds.push(id) }
    while (highWatermark > 0 && !inUse[highWatermark - 1]) highWatermark--
    mesh.count = highWatermark
  }

  function setMatrixAt(id, matrix) {
    if (hidden[id]) matrix.toArray(shadowMatrices, id * 16)
    mesh.setMatrixAt(id, matrix)
    markMatricesDirty(id)
  }

  function setTranslatedAt(id, basis, x, y, z) {
    const a = mesh.instanceMatrix.array, o = id * 16
    a[o] = basis[0]; a[o + 1] = basis[1]; a[o + 2] = basis[2]; a[o + 3] = 0
    a[o + 4] = basis[4]; a[o + 5] = basis[5]; a[o + 6] = basis[6]; a[o + 7] = 0
    a[o + 8] = basis[8]; a[o + 9] = basis[9]; a[o + 10] = basis[10]; a[o + 11] = 0
    a[o + 12] = x; a[o + 13] = y; a[o + 14] = z; a[o + 15] = 1
    if (hidden[id]) shadowMatrices.set(a.subarray(o, o + 16), o)
    markMatricesDirty(id)
  }

  function setScaledTranslationFrom(id, source, at) {
    const a = mesh.instanceMatrix.array, o = id * 16
    const size = source[at + 3]
    a[o] = size; a[o + 1] = 0; a[o + 2] = 0; a[o + 3] = 0
    a[o + 4] = 0; a[o + 5] = size; a[o + 6] = 0; a[o + 7] = 0
    a[o + 8] = 0; a[o + 9] = 0; a[o + 10] = size; a[o + 11] = 0
    a[o + 12] = source[at]; a[o + 13] = source[at + 1]; a[o + 14] = source[at + 2]; a[o + 15] = 1
    if (hidden[id]) shadowMatrices.set(a.subarray(o, o + 16), o)
    markMatricesDirty(id)
  }

  function setVisibleAt(id, visible) {
    const a = mesh.instanceMatrix.array, o = id * 16
    if (visible) {
      if (hidden[id]) a.set(shadowMatrices.subarray(o, o + 16), o)
      hidden[id] = 0
    } else {
      if (!hidden[id]) shadowMatrices.set(a.subarray(o, o + 16), o)
      hidden[id] = 1
      mesh.setMatrixAt(id, _zeroMatrix)
    }
    markMatricesDirty(id)
  }

  function setAttributeAt(id, name, value) {
    const rec = attributeArrays[name]
    if (!rec) throw new Error(`WebGPUInstancing: unknown attribute "${name}"`)
    const off = id * rec.itemSize
    if (rec.itemSize === 1) rec.array[off] = value
    else for (let i = 0; i < rec.itemSize; i++) rec.array[off + i] = value[i]
    rec.markSlotDirty(id)
  }

  function clear() {
    inUse.fill(0)
    recycledIds.length = 0
    neverUsedFrom = 0
    highWatermark = 0
    acquiredCount = 0
    mesh.count = 0
  }

  function dispose() {
    material.dispose()
  }

  return {
    mesh,
    shadowMatrices,
    acquireId,
    releaseId,
    setMatrixAt,
    setTranslatedAt,
    setScaledTranslationFrom,
    setVisibleAt,
    setAttributeAt,
    clear,
    dispose,
    get capacity() { return capacity },
    get activeCount() { return acquiredCount }
  }
}
