import * as THREE from 'three'
import { canon } from './canon.mjs'

export const VAT_GROUPS = [
  { name: 'phase', labels: [
    'idle phase at rest advances by the idle duration',
    'idle phase at nominal speed advances faster than at rest',
    'idle phase speed above 1.5 times nominal is capped',
    'move blend chases the target over one tick',
    'move blend snaps to the target within 0.001',
    'a blend window whose high speed is not above its low speed is a step',
    'a move clip advances its own phase and the idle phase keeps its own clock',
    'a NaN speed reaches the phase unchanged',
    'blend rates default from the nominal speed',
  ] },
  { name: 'webgl renderer', labels: [
    'WebGL single clip: two players at rest and then moving',
    'WebGL two clips: blend follows speed for two players',
    'WebGL release frees the instance for the next player',
    'WebGL dispose removes the mesh from the scene',
  ] },
  { name: 'webgpu renderer', labels: [
    'WebGPU single clip: two players at rest and then moving',
    'WebGPU two clips: blend follows speed for two players',
    'WebGPU release frees the instance for the next player',
    'WebGPU dispose removes the mesh from the scene',
  ] },
  { name: 'shader text', labels: [
    'WebGL shader, one clip',
    'WebGL shader, one clip with a normal map',
    'WebGL shader, two clips',
    'WebGL shader, two clips with normal maps',
  ] },
  { name: 'node material', labels: [
    'TSL material, one clip',
    'TSL material, one clip with a normal map',
    'TSL material, two clips',
    'TSL material, two clips with normal maps',
  ] },
]

const fill = (n, seed) => Float32Array.from({ length: n }, (_, i) => Math.sin((i + 1) * seed) * 0.5)
const clip = (duration, rows, frames, seed) => {
  const width = 4
  const texture = new THREE.DataTexture(fill(width * rows * frames * 4, seed), width, rows * frames, THREE.RGBAFormat, THREE.FloatType)
  texture.needsUpdate = true
  return { texture, width, rowsPerFrame: rows, frameCount: frames, duration }
}
const idleClip = () => clip(1.2, 2, 3, 0.7)
const moveClip = () => clip(0.8, 2, 2, 1.3)
const withNormal = (data, seed) => ({ ...data, normalTexture: clip(data.duration, data.rowsPerFrame, data.frameCount, seed).texture })

const makeScene = () => ({ children: [], add(o) { this.children.push(o) }, remove(o) { this.children = this.children.filter((c) => c !== o) } })

const phaseCase = (api, moved, start, opts, s, dt) => {
  const slot = { id: 0, phase: start.phase ?? 0, idlePhase: start.idlePhase ?? 0, blend: start.blend ?? 0 }
  const calls = []
  api.advance(slot, moved ? moveClip() : null, idleClip(), opts, s, dt, (name, value) => calls.push([name, value]))
  return { slot: { ...slot }, calls }
}

const matrixOf = (mesh, id) => {
  if (typeof mesh.getMatrixAt === 'function') {
    const m = new THREE.Matrix4()
    mesh.getMatrixAt(id, m)
    return m.toArray()
  }
  return Array.from(mesh.instanceMatrix.array.subarray(id * 16, id * 16 + 16))
}
const attrOf = (mesh, id, name) => {
  if (typeof mesh.getUniformAt === 'function') {
    try {
      const value = mesh.getUniformAt(id, name)
      return value === undefined ? null : value
    } catch (error) {
      return null
    }
  }
  const attr = mesh.geometry.attributes[name]
  return attr ? attr.array[id] : null
}
const readRenderer = (r, scene) => {
  const slots = r.debugSlots().slice().sort((a, b) => a.instanceId - b.instanceId)
  return {
    count: r.count(),
    sceneChildren: scene.children.length,
    instances: slots.map((slot) => ({
      playerId: slot.playerId,
      instanceId: slot.instanceId,
      phase: slot.phase,
      idlePhase: slot.idlePhase,
      blend: slot.blend,
      matrix: matrixOf(r.mesh, slot.instanceId),
      vatPhase: attrOf(r.mesh, slot.instanceId, 'vatPhase'),
      vatBlend: attrOf(r.mesh, slot.instanceId, 'vatBlend'),
      vatIdlePhase: attrOf(r.mesh, slot.instanceId, 'vatIdlePhase'),
    })),
  }
}
const pos = (x, z) => ({ x, y: 0, z })

const rendererCase = (api, kind, multi, script) => {
  const scene = makeScene()
  const vat = multi ? { idle: idleClip(), move: moveClip() } : idleClip()
  const opts = kind === 'webgpu' ? { renderer: { isWebGPURenderer: true }, capacity: 4 } : { capacity: 4 }
  const r = api.createRenderer(scene, new THREE.BoxGeometry(1, 1, 1), vat, opts)
  return script(r, scene)
}

const shaderCase = (create, vat, opts) => {
  const mat = create(vat, opts)
  const shader = { uniforms: {}, vertexShader: ['#include <common>', '#include <begin_vertex>', '#include <beginnormal_vertex>', 'void main() {}'].join(String.fromCharCode(10)) }
  mat.onBeforeCompile(shader)
  return { key: mat.customProgramCacheKey(), hasNormal: mat._vatHasNormal, uniforms: Object.keys(shader.uniforms).sort(), vertexShader: shader.vertexShader }
}
const nodeCase = (create, vat, opts) => {
  const mat = create(vat, opts)
  return { lambert: mat.isMeshLambertNodeMaterial === true, positionNode: mat.positionNode !== null && mat.positionNode !== undefined, normalNode: !!mat.normalNode, hasNormal: mat._vatHasNormal, color: mat.color.getHex() }
}

const variants = () => ({
  one: idleClip(),
  oneNormal: withNormal(idleClip(), 2.1),
  two: { idle: idleClip(), move: moveClip() },
  twoNormal: { idle: withNormal(idleClip(), 2.1), move: withNormal(moveClip(), 3.3) },
})
const shaderArgs = (v, key) => (key === 'one' || key === 'oneNormal' ? [v[key], {}] : [v[key].idle, { moveVatData: v[key].move }])

export function runPlayerVatScenario(api) {
  const rows = []
  const step = (group, label, action) => {
    let value
    try { value = action() } catch (error) { value = { threw: error.message } }
    rows.push(canon({ label, value }))
  }
  const [p1, p2, p3, p4, p5, p6, p7, p8, p9] = VAT_GROUPS[0].labels
  step('phase', p1, () => phaseCase(api, false, {}, {}, 0, 0.6))
  step('phase', p2, () => phaseCase(api, false, {}, {}, 4, 0.6))
  step('phase', p3, () => phaseCase(api, false, {}, {}, 100, 0.6))
  step('phase', p4, () => phaseCase(api, true, {}, {}, 3, 0.1))
  step('phase', p5, () => phaseCase(api, true, { blend: 0.9995 }, {}, 10, 0.1))
  step('phase', p6, () => phaseCase(api, true, {}, { blendLowSpeed: 2, blendHighSpeed: 1 }, 3, 1))
  step('phase', p7, () => phaseCase(api, true, { idlePhase: 0.25 }, {}, 2, 0.2))
  step('phase', p8, () => phaseCase(api, false, {}, {}, NaN, 0.1))
  step('phase', p9, () => api.rates({ nominalSpeed: 6 }))
  const [w1, w2, w3, w4] = VAT_GROUPS[1].labels
  const walk = (r, scene, multi) => {
    const snaps = []
    r.update('a', pos(0, 0), 0, 0, 0.1)
    r.update('b', pos(2, 0), 0.5, 0, 0.1)
    snaps.push(readRenderer(r, scene))
    r.update('a', pos(0, 1), 0.3, 3, 0.1)
    r.update('b', pos(2, 1), 0.3, 3, 0.1)
    snaps.push(readRenderer(r, scene))
    return snaps
  }
  const releaseWalk = (r, scene) => {
    r.update('a', pos(0, 0), 0, 2, 0.1)
    r.update('b', pos(2, 0), 0, 2, 0.1)
    r.release('a')
    r.update('c', pos(4, 0), 0, 1, 0.1)
    return readRenderer(r, scene)
  }
  const disposeWalk = (r, scene) => {
    r.update('a', pos(0, 0), 0, 1, 0.1)
    r.dispose()
    return { sceneChildren: scene.children.length, count: r.count() }
  }
  step('webgl renderer', w1, () => rendererCase(api, 'webgl', false, walk))
  step('webgl renderer', w2, () => rendererCase(api, 'webgl', true, walk))
  step('webgl renderer', w3, () => rendererCase(api, 'webgl', false, releaseWalk))
  step('webgl renderer', w4, () => rendererCase(api, 'webgl', false, disposeWalk))
  const [g1, g2, g3, g4] = VAT_GROUPS[2].labels
  step('webgpu renderer', g1, () => rendererCase(api, 'webgpu', false, walk))
  step('webgpu renderer', g2, () => rendererCase(api, 'webgpu', true, walk))
  step('webgpu renderer', g3, () => rendererCase(api, 'webgpu', false, releaseWalk))
  step('webgpu renderer', g4, () => rendererCase(api, 'webgpu', false, disposeWalk))
  const [s1, s2, s3, s4] = VAT_GROUPS[3].labels
  const [t1, t2, t3, t4] = VAT_GROUPS[4].labels
  const keys = ['one', 'oneNormal', 'two', 'twoNormal']
  const labelsS = [s1, s2, s3, s4]
  const labelsT = [t1, t2, t3, t4]
  keys.forEach((key, i) => {
    step('shader text', labelsS[i], () => { const v = variants(); return shaderCase(api.createMaterial, ...shaderArgs(v, key)) })
  })
  keys.forEach((key, i) => {
    step('node material', labelsT[i], () => { const v = variants(); return nodeCase(api.createMaterialTSL, ...shaderArgs(v, key)) })
  })
  return rows
}

