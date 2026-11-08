import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { BLOOM_CASE_LABELS, runBloomScenario } from './lib/bloomScenario.mjs'
import { Bloom, buildBloomNodes } from '../src/client/bloom.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/bloom.json', import.meta.url), 'utf8'))
const controls = { get: (key) => fixture.controls[key] }

const got = runBloomScenario({
  make: (renderer) => new Bloom(renderer, controls),
  buildBloomNodes: () => buildBloomNodes(controls),
})

gate('the bloom fixture was generated from spoint Bloom.js at a pinned commit', () => {
  assert.match(fixture.source.commit, /^[0-9a-f]{7,}$/)
  assert.deepEqual(fixture.source.files, ['client/core/Bloom.js'])
})

gate('the fixture covers every bloom case in order', () => {
  assert.equal(fixture.rows.length, BLOOM_CASE_LABELS.length)
  BLOOM_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('the bloom materials, the compute and composite call traces, the resize, dispose and graph nodes equal spoint', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture shows a half-size threshold target, so a dead resolution scale would show', () => {
  assert.ok(fixture.rows[1].includes('[n:320,n:180]'), fixture.rows[1])
})

gate('negative control: one changed number in the composite trace does not equal the port', () => {
  const tampered = fixture.rows.slice()
  tampered[2] = tampered[2].replace(/n:(-?[0-9.]+)/, 'n:123456.5')
  assert.notEqual(firstDivergence(got.rows, tampered), null)
})

gate('with bloom on, the compute node needs a bloom context and the composite node needs the compute of the same frame', () => {
  const on = buildBloomNodes({ get: (key) => (key === 'bloom' ? true : fixture.controls[key]) })
  const [compute, composite] = on
  assert.equal(compute.shouldRun({ bloom: null, frameId: 2, res: {} }), false)
  assert.equal(compute.shouldRun({ bloom: {}, frameId: 2, res: {} }), true)
  assert.equal(composite.shouldRun({ bloom: {}, frameId: 2, res: { bloomComputed: 1 } }), false)
  assert.equal(composite.shouldRun({ bloom: {}, frameId: 2, res: { bloomComputed: 2 } }), true)
})

finish()
