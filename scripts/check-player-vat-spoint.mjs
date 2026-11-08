import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { VAT_GROUPS, runPlayerVatScenario } from './lib/playerVatScenario.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-vat.json', import.meta.url), 'utf8'))
const phase = await import('../src/client-pure/playerVatPhase.js').catch(() => null)
const renderer = await import('../src/client/playerVatRenderer.js').catch(() => null)
const material = await import('../src/client/playerVatMaterial.js').catch(() => null)
const tsl = await import('../src/client/playerVatTSL.js').catch(() => null)
const api = {
  advance: phase && phase.advanceVatPhase,
  rates: phase && phase.vatBlendRates,
  createRenderer: renderer && renderer.createVATCrowdRenderer,
  createMaterial: material && material.createVATMaterial,
  createMaterialTSL: tsl && tsl.createVATMaterialTSL,
}
const got = runPlayerVatScenario(api)
const labels = VAT_GROUPS.flatMap((g) => g.labels)

gate('the fixture was generated from spoint 4df338a, with PlayerVAT, PlayerVATTSL and WebGPUInstancing', () => {
  assert.equal(fixture.source.commit, '4df338a')
  assert.deepEqual(Object.keys(fixture.source.sha256).sort(), ['client/core/PlayerVAT.js', 'client/core/PlayerVATTSL.js', 'client/core/WebGPUInstancing.js'])
  assert.equal(fixture.source.instancedMesh, '0.3.16')
})

gate('the fixture covers every VAT case in order', () => {
  assert.equal(fixture.rows.length, labels.length)
  labels.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

let offset = 0
for (const group of VAT_GROUPS) {
  const start = offset
  const end = offset + group.labels.length
  offset = end
  gate('the ' + group.name + ' cases equal spoint on every case', () => {
    assert.equal(firstDivergence(got.slice(start, end), fixture.rows.slice(start, end)), null)
  })
}

finish()

