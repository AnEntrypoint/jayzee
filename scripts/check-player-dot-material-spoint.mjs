import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { createCrowdDotRenderer } from '../src/client/playerLodRenderer.js'
import { createDotMaterialTSL } from '../src/client/playerLodDotTSL.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-dot-material.json', import.meta.url), 'utf8'))
const props = (m) => ({ side: m.side, transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite })
const stubScene = () => ({ children: [], add() {}, remove() {} })
const webglDots = createCrowdDotRenderer(stubScene(), {}).instancedMesh

gate('the dot material fixture was generated from spoint at 4df338a, the commit that flipped the billboard', () => {
  assert.equal(fixture.source.commit, '4df338a')
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js'])
})

gate('the WebGL dot material has spoint 4df338a side, transparency, opacity and depth write', () => {
  assert.deepEqual(props(webglDots.material), fixture.webgl.material)
})

gate('the WebGL dot mesh is not frustum-culled and draws at spoint render order 3', () => {
  assert.deepEqual({ frustumCulled: webglDots.frustumCulled, renderOrder: webglDots.renderOrder }, fixture.webgl.mesh)
})

gate('the WebGPU dot material has spoint 4df338a side, transparency, opacity and depth write', () => {
  assert.deepEqual(props(createDotMaterialTSL()), fixture.tsl.material)
})

gate('spoint dots draw front faces only, so the port culls the back face as spoint does', () => {
  assert.equal(fixture.webgl.material.side, THREE.FrontSide)
  assert.equal(webglDots.material.side, THREE.FrontSide)
})

gate('negative control: a dot material that draws the back face would not equal spoint', () => {
  assert.notDeepEqual({ ...props(webglDots.material), side: THREE.BackSide }, fixture.webgl.material)
})

finish()
