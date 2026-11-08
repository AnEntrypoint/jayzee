import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { runPoolParamsScenario, HOST_LABELS } from './lib/poolParamsScenario.mjs'
import { resolvePoolParams, resolveWetness } from '../src/packages/mapspinner/pool-params.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'pool-params.json'), 'utf8'))
const got = runPoolParamsScenario({ resolvePoolParams, resolveWetness })

gate('the fixture was generated from spoint packages/mapspinner/src/pool-params.js', () => {
  assert.equal(fixture.source.file, 'packages/mapspinner/src/pool-params.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the fixture covers every host case in the scenario, including no host, null and a number', () => {
  assert.deepEqual(fixture.sections.poolParams.map(([label]) => label), HOST_LABELS)
  assert.ok(HOST_LABELS.includes('no host') && HOST_LABELS.includes('null host') && HOST_LABELS.includes('a host that is a number'))
})

gate('resolvePoolParams equals spoint on every host case: valid, malformed, non-finite, coerced and negative-zero knobs', () => {
  assert.deepEqual(got.poolParams, fixture.sections.poolParams)
})

gate('resolveWetness equals spoint on every host case, including clamps below zero and above one, and NaN', () => {
  assert.deepEqual(got.wetness, fixture.sections.wetness)
})

gate('negative control: a changed cover knob is read, and the default cover is the spoint 0.18', () => {
  const changed = JSON.stringify(resolvePoolParams({ __poolCover: 0.31 }))
  const defaults = JSON.stringify(resolvePoolParams(undefined))
  assert.equal(JSON.parse(changed).cover, 0.31)
  assert.equal(JSON.parse(defaults).cover, 0.18)
})

finish()
