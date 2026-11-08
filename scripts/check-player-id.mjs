import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { parsePlayerId, tryParsePlayerId } from '../src/game/playerId.js'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = JSON.parse(readFileSync(join(here, 'fixtures', 'spoint', 'player-id.json'), 'utf8'))

const decode = (value) => {
  if (Array.isArray(value)) return value.map(decode)
  if (value !== null && typeof value === 'object' && '$undef' in value) return undefined
  if (value !== null && typeof value === 'object' && '$num' in value) return Number(value.$num)
  return value
}

gate('the fixture covers keys that parse and refusals that throw', () => {
  assert.ok(fixture.cases.some((item) => item.expect.tryReturns !== null))
  assert.ok(fixture.cases.some((item) => item.expect.tryReturns === null))
})

gate('control: a decoded -0 is negative zero, so the -0 case is not vacuous', () => {
  assert.ok(Object.is(decode({ $num: '-0' }), -0))
})

for (const item of fixture.cases) {
  const args = () => item.args.map(decode)
  gate('tryParsePlayerId: ' + item.label, () => {
    assert.equal(tryParsePlayerId(...args()), item.expect.tryReturns, 'key differs from spoint')
  })
  gate('parsePlayerId: ' + item.label, () => {
    if ('returns' in item.expect.parse) {
      assert.equal(parsePlayerId(...args()), item.expect.parse.returns, 'key differs from spoint')
      return
    }
    assert.throws(
      () => parsePlayerId(...args()),
      (error) => error instanceof TypeError && error.message === item.expect.parse.message,
      'refusal differs from spoint',
    )
  })
}

finish()
