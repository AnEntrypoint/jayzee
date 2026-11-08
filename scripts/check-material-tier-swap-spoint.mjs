import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { canon, firstDivergence } from './lib/canon.mjs'
import { runMaterialTierSwapScenario } from './lib/materialTierSwapScenario.mjs'
import * as port from '../src/packages/streaming-gltf/material-tier-swap.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'material-tier-swap.json'), 'utf8'))
const got = runMaterialTierSwapScenario(port)

gate('the fixture was generated from spoint packages/streaming-gltf/src/material-tier-swap.js', () => {
  assert.equal(fixture.source.file, 'packages/streaming-gltf/src/material-tier-swap.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the device decisions equal spoint for every device, including null, undefined, 0 and a string', () => {
  assert.ok(fixture.sections.decisions.length >= 11)
  assert.equal(firstDivergence(got.decisions, fixture.sections.decisions), null)
})

gate('applyLowTierMaterials before setThreeRef throws the spoint message on a low-tier device and does nothing on a high-tier one', () => {
  assert.equal(firstDivergence(got.beforeRef, fixture.sections.beforeRef), null)
  assert.ok(fixture.sections.beforeRef.some((row) => row.includes('setThreeRef(THREE) must be called')))
})

gate('applyLowTierMaterials equals spoint on every device and scene: swap counts, normal-map stripping, shared materials and copied fields', () => {
  assert.ok(fixture.sections.apply.length >= 44)
  assert.equal(firstDivergence(got.apply, fixture.sections.apply), null)
})

gate('the fixture covers a material shared by two meshes, which the mixed scene reports under one identity', () => {
  const mixed = fixture.sections.apply.filter((row) => row.includes('"scene":s:"mixed"'))
  assert.ok(mixed.length > 0)
  assert.ok(mixed.some((row) => row.split('"id":n:0').length - 1 >= 2))
})

gate('the fixture covers a pass over an already swapped material that swaps nothing', () => {
  assert.ok(fixture.sections.apply.some((row) => row.includes('"scene":s:"alreadySwapped"') && row.includes('"swapped":n:0')))
})

gate('negative control: a high-tier device read as low changes its decision row away from the spoint fixture', () => {
  const lowed = canon([6, port.shouldSwapMaterials({ gpuTier: 'low', isMobile: true }), port.shouldStripNormalMaps({ gpuTier: 'low', isMobile: true })])
  assert.notEqual(lowed, fixture.sections.decisions[6])
})

finish()
