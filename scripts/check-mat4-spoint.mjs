import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { canon, firstDivergence } from './lib/canon.mjs'
import { runMat4Scenario } from './lib/mat4Scenario.mjs'
import { TEXTURE_UNITS, Mat4 } from '../src/packages/mapspinner/mat4.js'

const fixture = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'spoint', 'gl-render-mat4.json'), 'utf8'))
const got = runMat4Scenario({ TU: TEXTURE_UNITS, M4: Mat4 })

gate('the fixture was generated from spoint packages/mapspinner/src/gl-render-mat4.js', () => {
  assert.equal(fixture.source.file, 'packages/mapspinner/src/gl-render-mat4.js')
  assert.match(fixture.source.sha256, /^[0-9a-f]{64}$/)
})

gate('the texture unit table equals spoint TU, slot for slot', () => {
  assert.deepEqual(firstDivergence(got.textureUnits, fixture.sections.textureUnits), null)
})

for (const name of ['mul', 'perspective', 'translate', 'lookAt']) {
  gate(`${name} equals spoint M4.${name} on every fixture case, including -0 and NaN, with and without an out buffer`, () => {
    assert.ok(fixture.sections[name].length >= 40, `${name} has ${fixture.sections[name].length} cases`)
    const divergence = firstDivergence(got[name], fixture.sections[name])
    assert.equal(divergence, null, JSON.stringify(divergence))
  })
}

gate('the fixture holds a case with a -0 entry, so the sign of zero is part of the comparison', () => {
  assert.ok(fixture.sections.translate.some((row) => row.includes('n:-0')) || fixture.sections.lookAt.some((row) => row.includes('n:-0')))
})

gate('negative control: a changed translation is a different canonical value', () => {
  assert.notEqual(canon(Mat4.translate([1, 2, 3])), canon(Mat4.translate([1, 2, 4])))
})

finish()
