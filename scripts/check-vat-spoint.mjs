import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { VAT_CASE_LABELS, runVatScenario } from './lib/vatScenario.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/vat-bake.json', import.meta.url), 'utf8'))
const loaded = await import('../src/vat/vatBake.js').then((m) => m, (error) => ({ importError: error.message }))
const unavailable = (name) => () => { throw new Error('src/render/vatBake.js has no ' + name + ': ' + (loaded.importError ?? 'export missing')) }
const got = runVatScenario(THREE, {
  bakeVAT: loaded.bakeVAT ?? unavailable('bakeVAT'),
  bakeVATMultiClip: loaded.bakeVATMultiClip ?? unavailable('bakeVATMultiClip'),
})

gate('the fixture was generated from spoint client/core/PlayerVATBake.js with three 0.185.1', () => {
  assert.equal(fixture.source.file, 'client/core/PlayerVATBake.js')
  assert.equal(fixture.source.three, '0.185.1')
  assert.equal(THREE.REVISION, '185')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the fixture covers every VAT case in order, including the refusal and the unknown name', () => {
  assert.equal(fixture.rows.length, VAT_CASE_LABELS.length)
  VAT_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('bakeVAT and bakeVATMultiClip equal spoint on every case: texel bytes, normals, sizes and refusals', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture shows the wave clip moving the mesh, so a dead bake would show', () => {
  const m = fixture.rows[0].match(/"maxAbs":n:([0-9.e+-]+)/)
  assert.ok(m && Number(m[1]) > 0.1, 'maxAbs ' + (m ? m[1] : 'missing'))
})

gate('negative control: a 12 Hz bake of the same clip is a different texture from the default bake', () => {
  assert.notEqual(fixture.rows[1], fixture.rows[0])
})

finish()
