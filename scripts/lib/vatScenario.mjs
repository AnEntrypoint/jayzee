import { createHash } from 'node:crypto'
import { canon } from './canon.mjs'

export const VAT_CASE_LABELS = [
  'bake the wave clip at the default sample rate',
  'bake the wave clip at 12 Hz with a 4 texel row cap',
  'bake without normals returns no normal texture',
  'multi clip from a Map bakes both clips by name',
  'multi clip from an object with one name bakes that clip only',
  'a null clip is refused',
  'multi clip with an unknown name bakes nothing',
]

const digest = (array) => createHash('sha256').update(Buffer.from(array.buffer, array.byteOffset, array.byteLength)).digest('hex')

function clips(THREE) {
  const wave = new THREE.AnimationClip('wave', 1, [
    new THREE.VectorKeyframeTrack('arm.position', [0, 0.5, 1], [0, 1, 0, 0, 1.2, 0.1, 0, 1, 0]),
    new THREE.QuaternionKeyframeTrack('hand.quaternion', [0, 1], [0, 0, 0, 1, 0, 0.2588, 0, 0.9659]),
  ])
  const idle = new THREE.AnimationClip('idle', 0.5, [
    new THREE.QuaternionKeyframeTrack('arm.quaternion', [0, 0.5], [0, 0, 0, 1, 0, 0, 0.1305, 0.9914]),
  ])
  return { wave, idle }
}

function rig(THREE, normals) {
  const root = new THREE.Group()
  const base = new THREE.Bone()
  base.name = 'base'
  const arm = new THREE.Bone()
  arm.name = 'arm'
  arm.position.set(0, 1, 0)
  const hand = new THREE.Bone()
  hand.name = 'hand'
  hand.position.set(0, 0.5, 0)
  base.add(arm)
  arm.add(hand)
  root.add(base)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.2, 0, 0, 0, 1, 0, 0.2, 1, 0, 0, 1.5, 0, 0.2, 1.5, 0], 3))
  if (normals) geometry.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3))
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 2, 0, 0, 2, 0, 0, 0], 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0, 0.5, 0.5, 0, 0, 1, 0, 0, 0], 4))
  root.updateMatrixWorld(true)
  const skeleton = new THREE.Skeleton([base, arm, hand])
  const mesh = new THREE.SkinnedMesh(geometry, new THREE.MeshBasicMaterial())
  root.add(mesh)
  root.updateMatrixWorld(true)
  mesh.bind(skeleton)
  return { root, mesh }
}

function summarize(res) {
  const data = res.texture.image.data
  let maxAbs = 0
  for (const v of data) maxAbs = Math.max(maxAbs, Math.abs(v))
  return {
    frameCount: res.frameCount,
    vertexCount: res.vertexCount,
    width: res.width,
    rowsPerFrame: res.rowsPerFrame,
    duration: res.duration,
    sampleHz: res.sampleHz,
    texture: { w: res.texture.image.width, h: res.texture.image.height, minFilter: res.texture.minFilter, wrapS: res.texture.wrapS, sha: digest(data), maxAbs, head: Array.from(data.slice(0, 8)) },
    normal: res.normalTexture ? { sha: digest(res.normalTexture.image.data), head: Array.from(res.normalTexture.image.data.slice(0, 8)) } : null,
  }
}

export function runVatScenario(THREE, api) {
  const rows = []
  const record = (label, value) => rows.push(canon({ label, value }))
  const phase = (label, fn) => {
    try { record(label, fn()) } catch (error) { record(label, { threw: error.message }) }
  }
  const { wave, idle } = clips(THREE)
  const withNormals = rig(THREE, true)
  phase(VAT_CASE_LABELS[0], () => summarize(api.bakeVAT(withNormals.mesh, withNormals.root, wave)))
  phase(VAT_CASE_LABELS[1], () => summarize(api.bakeVAT(withNormals.mesh, withNormals.root, wave, { sampleHz: 12, maxTexSize: 4 })))
  phase(VAT_CASE_LABELS[2], () => {
    const plain = rig(THREE, false)
    const res = api.bakeVAT(plain.mesh, plain.root, wave)
    return { hasNormals: res.normalTexture !== null, texture: summarize(res).texture }
  })
  phase(VAT_CASE_LABELS[3], () => {
    const m = rig(THREE, true)
    const res = api.bakeVATMultiClip(m.mesh, m.root, new Map([['idle', idle], ['wave', wave]]))
    return { names: res.names, idle: summarize(res.byName.idle), move: summarize(res.byName.wave) }
  })
  phase(VAT_CASE_LABELS[4], () => {
    const m = rig(THREE, true)
    const res = api.bakeVATMultiClip(m.mesh, m.root, { idle, wave }, { names: ['wave'] })
    return { names: res.names, bakedKeys: Object.keys(res.byName), idleIsMove: res.idle === res.move }
  })
  phase(VAT_CASE_LABELS[5], () => {
    const m = rig(THREE, true)
    return summarize(api.bakeVAT(m.mesh, m.root, null))
  })
  phase(VAT_CASE_LABELS[6], () => {
    const m = rig(THREE, true)
    const res = api.bakeVATMultiClip(m.mesh, m.root, { wave }, { names: ['run'] })
    return { idle: res.idle, move: res.move, bakedKeys: Object.keys(res.byName) }
  })
  return { rows }
}
