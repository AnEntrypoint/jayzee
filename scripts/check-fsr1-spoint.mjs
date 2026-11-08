import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { firstDivergence } from './lib/canon.mjs'
import { FSR1_CASE_LABELS, runFsr1Scenario } from './lib/fsr1Scenario.mjs'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/fsr1.json', import.meta.url), 'utf8'))
const port = await import('../src/client/fsr1.js').catch((error) => ({ loadError: error }))

const controlsOf = (store) => ({ get: (key) => store[key] })
let cache
const got = () => {
  if (port.loadError) throw port.loadError
  if (cache) return cache
  const store = { ...fixture.controls }
  cache = runFsr1Scenario({
    set: (key, value) => { store[key] = value },
    make: (renderer) => new port.FSR1(renderer, controlsOf(store)),
    buildNodes: (display) => port.buildFSR1Nodes(controlsOf(store), display),
    install: (ctx, renderer) => port.installFSR1(ctx, renderer, controlsOf(store)),
  }).rows
  return cache
}

gate('the FSR1 fixture was generated from spoint FSR1.js at a pinned commit', () => {
  assert.match(fixture.source.commit, /^[0-9a-f]{7,}$/)
  assert.deepEqual(fixture.source.files, ['client/core/FSR1.js'])
  assert.match(fixture.source.sha256['client/core/FSR1.js'], /^[0-9a-f]{64}$/)
})

gate('the fixture covers every FSR1 case in order', () => {
  assert.equal(fixture.rows.length, FSR1_CASE_LABELS.length)
  FSR1_CASE_LABELS.forEach((label, i) => assert.ok(fixture.rows[i].includes('s:' + JSON.stringify(label)), label))
})

gate('the FSR1 materials, compute and composite traces, the resize, dispose, graph nodes and installFSR1 equal spoint', () => {
  const divergence = firstDivergence(got(), fixture.rows)
  assert.equal(divergence, null, JSON.stringify(divergence))
})

gate('the fixture shows both compute sizes and the resize, so a dead size or a reordered pass would show', () => {
  assert.ok(fixture.rows[1].includes('[n:640,n:360]'), fixture.rows[1])
  assert.ok(fixture.rows[3].includes('[n:320,n:180]') && fixture.rows[3].includes('[n:640,n:360]'), fixture.rows[3])
})

gate('the fixture shows the sharpness control reach the RCAS uniform on the next compute', () => {
  assert.ok(fixture.rows[0].includes('n:0.5'), fixture.rows[0])
  assert.ok(fixture.rows[3].includes('n:0.8'), fixture.rows[3])
})

gate('the fixture shows a zero-size canvas at 4 by 4, so the clamp is witnessed', () => {
  assert.ok(fixture.rows[6].includes('[n:4,n:4]'), fixture.rows[6])
})

gate('the port source carries no comments, reads no host global and imports only three and relative modules', () => {
  const source = readFileSync(new URL('../src/client/fsr1.js', import.meta.url), 'utf8')
  assert.equal(source.includes('//') || source.includes('/*'), false, 'comment marker')
  assert.equal(/\b(window|document|navigator|globalThis|self|process)\b/.test(source), false, 'host global')
  const specifiers = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1])
  assert.ok(specifiers.every((s) => s === 'three' || s.startsWith('.')), specifiers.join(','))
})

gate('negative control: one changed number in the resize trace does not equal the port', () => {
  const tampered = fixture.rows.slice()
  const changed = tampered[3].replace('[n:320,n:180]', '[n:321,n:180]')
  assert.notEqual(changed, tampered[3])
  tampered[3] = changed
  assert.notEqual(firstDivergence(got(), tampered), null)
})

finish()
