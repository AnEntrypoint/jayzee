import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { createCrowdDotRenderer } from '../src/client/playerLodRenderer.js'
import { createDotMaterialTSL } from '../src/client/playerLodDotTSL.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-dot-shader.json', import.meta.url), 'utf8'))
const shaderOf = (material) => {
  const shader = { uniforms: {}, vertexShader: ['#include <common>', '#include <begin_vertex>', 'void main() {}'].join(String.fromCharCode(10)) }
  material.onBeforeCompile(shader)
  return shader.vertexShader
}

gate('the dot shader fixture was generated from spoint 4df338a, the commit that changed the billboard', () => {
  assert.equal(fixture.source.commit, '4df338a')
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['client/core/PlayerLOD.js', 'client/core/PlayerLODTSL.js'])
})

gate('the WebGL dot billboard, after onBeforeCompile, is spoint 4df338a text exactly', () => {
  const mesh = createCrowdDotRenderer({ children: [], add() {}, remove() {} }, {}).instancedMesh
  assert.equal(shaderOf(mesh.material), fixture.webglVertexShader)
})

gate('the WebGPU dot material function source is spoint 4df338a source exactly', () => {
  assert.equal(createDotMaterialTSL.toString(), fixture.tslSource)
})

finish()

