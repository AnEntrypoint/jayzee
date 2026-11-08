import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { DOT_WEBGPU_STEP_LABELS, runDotWebGPUScenario } from './lib/dotWebGPUScenario.mjs'
import { createCrowdDotRenderer } from '../src/client/playerLodRenderer.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-lod-renderer-webgpu.json', import.meta.url), 'utf8'))
const crowdDots = JSON.parse(readFileSync(new URL('./fixtures/spoint/crowd-dots.json', import.meta.url), 'utf8')).crowd.dots
const instancing = await import('../src/client/webgpuInstancing.js').catch(() => null)
const dotTsl = await import('../src/client/playerLodDotTSL.js').catch(() => null)
const webgpu = await import('../src/client/playerLodRendererWebGPU.js').catch(() => null)

const makeScene = () => ({ children: [], add(o) { this.children.push(o) }, remove(o) { this.children = this.children.filter((c) => c !== o) } })

gate('the fixture was generated from spoint at 22dca25, with the PlayerLOD, PlayerLODTSL and WebGPUInstancing files', () => {
  assert.equal(fixture.source.commit, '22dca25')
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js', 'client/core/WebGPUInstancing.js'])
})

gate('the fixture covers every WebGPU dot step in order', () => {
  assert.equal(fixture.rows.length, DOT_WEBGPU_STEP_LABELS.length)
  DOT_WEBGPU_STEP_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('isWebGPUInstancingSupported is true only for a renderer that reports isWebGPURenderer', () => {
  assert.ok(instancing, 'src/client/webgpuInstancing.js is missing')
  assert.equal(instancing.isWebGPUInstancingSupported({ isWebGPURenderer: true }), true)
  assert.equal(instancing.isWebGPUInstancingSupported({ isWebGLRenderer: true }), false)
  assert.equal(instancing.isWebGPUInstancingSupported(null), false)
})

gate('the WebGPU instance record hands out ids in order, refuses a full record, and clears to zero', () => {
  assert.ok(instancing, 'src/client/webgpuInstancing.js is missing')
  const record = instancing.createWebGPUInstancedMesh(new THREE.BoxGeometry(1, 1, 1), new MeshBasicNodeMaterial(), 2)
  assert.equal(record.acquireId(), 0)
  assert.equal(record.acquireId(), 1)
  assert.equal(record.acquireId(), -1)
  record.clear()
  assert.equal(record.mesh.count, 0)
  assert.equal(record.acquireId(), 0)
})

gate('the dispatcher gives a WebGPU renderer when the renderer reports WebGPU, so its material is a node material', () => {
  const mesh = createCrowdDotRenderer(makeScene(), { renderer: { isWebGPURenderer: true } }).instancedMesh
  assert.equal(mesh.material.isMeshBasicNodeMaterial, true)
})

gate('the dispatcher keeps the WebGL renderer for a WebGL renderer', () => {
  const mesh = createCrowdDotRenderer(makeScene(), { renderer: { isWebGLRenderer: true } }).instancedMesh
  assert.equal(mesh.material.isMeshBasicMaterial, true)
  assert.equal(mesh.material.isMeshBasicNodeMaterial, undefined)
})

gate('the dot material is a node material with a billboard position node, colour 0xffcc66, opacity 0.85 and no depth writes', () => {
  assert.ok(dotTsl, 'src/client/playerLodDotTSL.js is missing')
  const material = dotTsl.createDotMaterialTSL()
  assert.equal(material.isMeshBasicNodeMaterial, true)
  assert.notEqual(material.positionNode, null)
  assert.equal(material.color.getHex(), 0xffcc66)
  assert.equal(material.opacity, 0.85)
  assert.equal(material.transparent, true)
  assert.equal(material.depthWrite, false)
})

gate('the WebGPU dot renderer equals spoint on every step, so a wrong dot pose or matrix would show', () => {
  const got = runDotWebGPUScenario((scene, opts) => createCrowdDotRenderer(scene, opts), crowdDots)
  assert.equal(firstDivergence(got, fixture.rows), null)
})

gate('growing past 512 instances keeps all 600 in the fixture, so a capped renderer would show', () => {
  assert.ok(fixture.rows[7].includes('"count":n:600'))
})

gate('growth replaces the mesh, and instancedMesh follows the live mesh rather than the first one', () => {
  assert.ok(webgpu, 'src/client/playerLodRendererWebGPU.js is missing')
  const scene = makeScene()
  const dots = webgpu.createCrowdDotRendererWebGPU(scene, { capacity: 4 })
  const first = dots.instancedMesh
  dots.update(Array.from({ length: 9 }, (_, i) => ({ x: i, y: 0, z: 0 })), 0, null)
  assert.equal(scene.children.length, 1)
  assert.notEqual(scene.children[0], first)
  assert.equal(dots.instancedMesh, scene.children[0])
})

gate('a WebGL renderer still reports its own instanced mesh after a WebGL growth', () => {
  const scene = makeScene()
  const dots = createCrowdDotRenderer(scene, { capacity: 2 })
  dots.update(Array.from({ length: 5 }, (_, i) => ({ x: i, y: 0, z: 0 })), 0, null)
  assert.equal(dots.instancedMesh, scene.children[0])
})

finish()
