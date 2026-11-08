import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { readVec3 } from '../src/physics-extras/math.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'vec3-read.json'), 'utf8'))

const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object' && '$undef' in value) return undefined
  if (value !== null && typeof value === 'object' && '$num' in value) return Number(value.$num)
  return value
}

gate('the fixture covers both returned and refused inputs', () => {
  assert.ok(fixture.cases.some((item) => item.expect.returns))
  assert.ok(fixture.cases.some((item) => !item.expect.returns))
})

gate('control: a decoded NaN component is NaN, so the NaN case is not vacuous', () => {
  assert.ok(Number.isNaN(decode({ $num: 'NaN' })))
})

for (const item of fixture.cases) {
  gate('readVec3: ' + item.label, () => {
    const args = item.args.map(decode)
    if (item.expect.returns) {
      const out = readVec3(...args)
      assert.deepEqual(out, args[0])
      assert.equal(out === args[0], item.expect.same, 'identity differs from spoint')
      return
    }
    assert.throws(
      () => readVec3(...args),
      (error) => error instanceof TypeError && error.message === item.expect.message && error.reasonCode === item.expect.reasonCode,
      'refusal differs from spoint',
    )
  })
}

finish()
