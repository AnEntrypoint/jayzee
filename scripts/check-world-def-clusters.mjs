import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parseClusterFlag } from '../src/world-def/clusterFlag.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'world-def-clusters.json'), 'utf8'))

const verdictOf = (fn) => {
  try {
    fn()
    return { ok: true }
  } catch (error) {
    return { code: error.code, message: error.message }
  }
}

gate('the fixture holds accepted flags and the malformed-flag refusals', () => {
  assert.ok(fixture.synthetic.some((item) => item.expect.ok === true))
  assert.ok(fixture.synthetic.some((item) => item.expect.code === 'world-clusters-not-declared'))
  assert.ok(fixture.synthetic.some((item) => item.expect.code === 'world-clusters-enabled-without-terrain-radius'))
})

for (const item of fixture.synthetic) {
  gate('clusterFlag: ' + item.label, () => {
    assert.deepEqual(verdictOf(() => parseClusterFlag('w', item.def)), item.expect, 'verdict differs from spoint parseWorldDef')
  })
}

for (const item of fixture.shipped) {
  const route = item.routed ? 'routed through parseWorldDef' : 'not routed through parseWorldDef'
  gate('shipped world ' + item.world + ' (' + route + '): the cluster verdict matches spoint', () => {
    assert.deepEqual(verdictOf(() => parseClusterFlag(item.world, item.def)), item.expect, 'verdict differs from spoint parseWorldDef')
  })
}

finish()
