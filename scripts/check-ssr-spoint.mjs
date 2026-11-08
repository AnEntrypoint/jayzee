import { SSR, buildSSRNodes, installSSR, setWeatherWetness } from '../src/client/ssr.js'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { SSR_CASE_LABELS, runSsrScenario } from './lib/ssrScenario.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/ssr.json', import.meta.url), 'utf8'))
const store = { ...fixture.controls }
const controls = { get: (key) => store[key] }

const api = {
  make: (renderer, scene, camera) => new SSR(renderer, scene, camera, controls),
  buildSSRNodes: () => buildSSRNodes(controls),
  install: (ctx, renderer, scene, camera) => installSSR(ctx, renderer, scene, camera, controls),
  setWetness: setWeatherWetness,
  setControl: (key, value) => { store[key] = value },
}
const got = runSsrScenario(api)

gate('the ssr fixture was generated from spoint SSR.js at a pinned commit, with its helper files hashed', () => {
  assert.match(fixture.source.commit, /^[0-9a-f]{7,}$/)
  assert.deepEqual(fixture.source.files, ['client/core/SSR.js'])
  assert.match(fixture.source.sha256['client/core/SSR.js'], /^[0-9a-f]{64}$/)
  assert.deepEqual(fixture.dependencies.files, ['client/core/RenderControls.js', 'client/core/ProgramReadiness.js', 'client/core/WetnessTint.js', 'client/core/UnderwaterTint.js'])
  for (const file of fixture.dependencies.files) assert.match(fixture.dependencies.sha256[file], /^[0-9a-f]{64}$/, file)
})

gate('the fixture covers every ssr case in order', () => {
  assert.equal(fixture.rows.length, SSR_CASE_LABELS.length)
  SSR_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('the ssr uniforms, wetness pass, compute and composite traces, resize, dispose, graph nodes and install equal spoint', () => {
  assert.equal(firstDivergence(got.rows, fixture.rows), null)
})

gate('the fixture shows the wetness pass drawing the wet mesh at 0.4 and the half-size targets at 640x360 and 320x180', () => {
  assert.ok(fixture.rows[2].includes('"uWetness":n:0.4'), fixture.rows[2])
  assert.ok(fixture.rows[2].includes('[n:320,n:180]'), fixture.rows[2])
  assert.ok(fixture.rows[4].includes('[n:160,n:90]'), fixture.rows[4])
})

gate('negative control: one changed number in the compute trace does not equal the port', () => {
  const tampered = fixture.rows.slice()
  tampered[2] = tampered[2].replace(/n:(-?[0-9.]+)/, 'n:123456.5')
  assert.notEqual(tampered[2], fixture.rows[2])
  assert.notEqual(firstDivergence(got.rows, tampered), null)
})

gate('SSR refuses construction without controls.get', () => {
  assert.throws(() => new SSR(null, new THREE.Scene(), new THREE.PerspectiveCamera(), {}), TypeError)
})

gate('installSSR refuses a WebGPU renderer with the not-ported message', () => {
  assert.throws(() => installSSR({}, { isWebGPURenderer: true }, null, null, controls), /SSR WebGPU is not ported/)
})

gate('with ssr and ssao on, the compute node needs a ssr context and the composite node needs the compute of the same frame', () => {
  const on = buildSSRNodes({ get: (key) => (key === 'ssr' || key === 'ssao' ? true : fixture.controls[key]) })
  const [compute, composite] = on
  assert.equal(compute.shouldRun({ ssr: null, frameId: 2, res: {} }), false)
  assert.equal(compute.shouldRun({ ssr: {}, frameId: 2, res: {} }), true)
  assert.equal(composite.shouldRun({ ssr: {}, frameId: 2, res: { ssrComputed: 1 } }), false)
  assert.equal(composite.shouldRun({ ssr: {}, frameId: 2, res: { ssrComputed: 2 } }), true)
})

finish()
