import * as THREE from 'three'
import { InstancedMesh2 } from '@three.ez/instanced-mesh'
import { advanceVatPhase } from '../client-pure/playerVatPhase.js'
import { createVATMaterial } from './playerVatMaterial.js'
import { createVATMaterialTSL } from './playerVatTSL.js'
import { createWebGPUInstancedMesh } from './webgpuInstancing.js'

export { bakeVAT, bakeVATMultiClip } from '../vat/vatBake.js'

export function createVATCrowdRenderer(scene, baseGeometry, vatData, opts = {}) {
  const capacity = opts.capacity || 64
  const isMultiClip = !!(vatData && vatData.idle && vatData.move && vatData.idle !== vatData.move)
  const idleData = isMultiClip ? vatData.idle : vatData
  const moveData = isMultiClip ? vatData.move : null
  const geo = baseGeometry.clone()
  const vCount = geo.attributes.position.count
  const idxArr = new Float32Array(vCount)
  for (let i = 0; i < vCount; i++) idxArr[i] = i
  geo.setAttribute('vatVertexIndex', new THREE.BufferAttribute(idxArr, 1))
  geo.computeBoundingSphere()
  if (geo.boundingSphere) geo.boundingSphere.radius = Math.max(geo.boundingSphere.radius, 1.2)

  const isWebGPU = !!(opts.renderer && opts.renderer.isWebGPURenderer)
  if (isWebGPU) return _createVATCrowdRendererWebGPU(scene, geo, idleData, moveData, opts, capacity)
  return _createVATCrowdRendererWebGL(scene, geo, idleData, moveData, opts, capacity)
}

function _disposeVatTextures(idleData, moveData) {
  idleData.texture.dispose()
  if (idleData.normalTexture) idleData.normalTexture.dispose()
  if (moveData) {
    moveData.texture.dispose()
    if (moveData.normalTexture) moveData.normalTexture.dispose()
  }
}

function _createVATCrowdRendererWebGL(scene, geo, idleData, moveData, opts, capacity) {
  const mat = createVATMaterial(idleData, { ...opts, moveVatData: moveData })
  const im = new InstancedMesh2(geo, mat, { capacity, renderer: opts.renderer })
  const uniformSpec = { vatPhase: 'float' }
  if (moveData) { uniformSpec.vatBlend = 'float'; uniformSpec.vatIdlePhase = 'float' }
  im.initUniformsPerInstance({ vertex: uniformSpec })
  im.perObjectFrustumCulled = true
  im.frustumCulled = false
  im.castShadow = opts.castShadow !== false
  im.receiveShadow = false
  scene.add(im)

  const _bySlot = new Map()
  let _updateId = -1
  const _setUniform = (name, value) => { try { im.setUniformAt(_updateId, name, value) } catch (_) {} }

  function ensureCapacity(n) {
    if (n <= im.capacity) return
    im.resizeBuffers(Math.max(n, im.capacity * 2))
  }

  function acquire(playerId) {
    let slot = _bySlot.get(playerId)
    if (slot) return slot.id
    ensureCapacity(_bySlot.size + 1)
    let id = -1
    im.addInstances(1, (e) => { id = e.id })
    slot = { id, phase: 0, idlePhase: 0, blend: 0 }
    _bySlot.set(playerId, slot)
    try { im.setUniformAt(id, 'vatPhase', 0) } catch (_) {}
    if (moveData) {
      try { im.setUniformAt(id, 'vatBlend', 0) } catch (_) {}
      try { im.setUniformAt(id, 'vatIdlePhase', 0) } catch (_) {}
    }
    return id
  }

  function release(playerId) {
    const slot = _bySlot.get(playerId)
    if (!slot) return
    try { im.removeInstances(slot.id) } catch (_) {}
    _bySlot.delete(playerId)
  }

  function update(playerId, position, rotY, speed, dt) {
    const id = acquire(playerId)
    const slot = _bySlot.get(playerId)
    _updateId = id
    advanceVatPhase(slot, moveData, idleData, opts, speed || 0, dt, _setUniform)
    im.setMatrixAt(id, _composeMatrix(position, rotY))
  }

  function has(playerId) { return _bySlot.has(playerId) }
  function count() { return _bySlot.size }
  function debugSlots() { return Array.from(_bySlot.entries()).map(([id, s]) => ({ playerId: id, instanceId: s.id, phase: s.phase, idlePhase: s.idlePhase, blend: s.blend })) }

  function dispose() {
    scene.remove(im)
    geo.dispose()
    mat.dispose()
    _disposeVatTextures(idleData, moveData)
    _bySlot.clear()
  }

  return { mesh: im, acquire, release, update, has, count, debugSlots, dispose }
}

function _createVATCrowdRendererWebGPU(scene, geo, idleData, moveData, opts, capacity) {
  const mat = createVATMaterialTSL(idleData, { ...opts, moveVatData: moveData })
  const attributeSchema = { vatPhase: 'float' }
  if (moveData) { attributeSchema.vatBlend = 'float'; attributeSchema.vatIdlePhase = 'float' }
  const rec = createWebGPUInstancedMesh(geo, mat, capacity, attributeSchema)
  rec.mesh.castShadow = opts.castShadow !== false
  rec.mesh.receiveShadow = false
  scene.add(rec.mesh)

  const _bySlot = new Map()
  let _updateId = -1
  const _setAttribute = (name, value) => rec.setAttributeAt(_updateId, name, value)

  function acquire(playerId) {
    let slot = _bySlot.get(playerId)
    if (slot) return slot.id
    const id = rec.acquireId()
    if (id < 0) return -1
    slot = { id, phase: 0, idlePhase: 0, blend: 0 }
    _bySlot.set(playerId, slot)
    rec.setAttributeAt(id, 'vatPhase', 0)
    if (moveData) {
      rec.setAttributeAt(id, 'vatBlend', 0)
      rec.setAttributeAt(id, 'vatIdlePhase', 0)
    }
    return id
  }

  function release(playerId) {
    const slot = _bySlot.get(playerId)
    if (!slot) return
    rec.releaseId(slot.id)
    _bySlot.delete(playerId)
  }

  function update(playerId, position, rotY, speed, dt) {
    const id = acquire(playerId)
    if (id < 0) return
    const slot = _bySlot.get(playerId)
    _updateId = id
    advanceVatPhase(slot, moveData, idleData, opts, speed || 0, dt, _setAttribute)
    rec.setMatrixAt(id, _composeMatrix(position, rotY))
  }

  function has(playerId) { return _bySlot.has(playerId) }
  function count() { return _bySlot.size }
  function debugSlots() { return Array.from(_bySlot.entries()).map(([id, s]) => ({ playerId: id, instanceId: s.id, phase: s.phase, idlePhase: s.idlePhase, blend: s.blend })) }

  function dispose() {
    scene.remove(rec.mesh)
    geo.dispose()
    rec.dispose()
    _disposeVatTextures(idleData, moveData)
    _bySlot.clear()
  }

  return { mesh: rec.mesh, acquire, release, update, has, count, debugSlots, dispose }
}

const _mtx = new THREE.Matrix4()
const _q = new THREE.Quaternion()
const _euler = new THREE.Euler()
const _pos = new THREE.Vector3()
const _scale1 = new THREE.Vector3(1, 1, 1)
function _composeMatrix(position, rotY) {
  _euler.set(0, rotY || 0, 0)
  _q.setFromEuler(_euler)
  _pos.set(position.x, position.y, position.z)
  _mtx.compose(_pos, _q, _scale1)
  return _mtx
}

export function installPlayerVATDebug(renderer) {
  if (typeof window === 'undefined') return
  window.__playerVAT = {
    stats() { return renderer ? { count: renderer.count(), capacity: renderer.mesh.capacity } : null },
    slots() { return renderer ? renderer.debugSlots() : [] },
    hasNormalVAT() { return (renderer && renderer.mesh) ? !!renderer.mesh.material._vatHasNormal : null }
  }
}

export function playerVatDisabled() {
  return typeof window !== 'undefined' && window.__playerVatOff === true
}
