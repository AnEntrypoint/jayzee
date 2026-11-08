import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runAnticheat, jayzeeApi } from './lib/anticheatScenario.mjs'
import * as guard from '../src/anticheat/InputGuard.js'
import * as outliers from '../src/anticheat/OutlierDetector.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/anticheat.json', import.meta.url), 'utf8'))
const ran = runAnticheat(jayzeeApi({ ...guard, ...outliers }))

const SECTIONS = ['rate', 'sanitize', 'envelope', 'outlier']

const firstDiff = (name) => {
  const want = fixture.sections[name]
  const got = ran[name]
  const at = want.findIndex((line, i) => got[i] !== line)
  if (at === -1 && got.length === want.length) return name + ' matches'
  const i = at === -1 ? Math.min(got.length, want.length) : at
  return name + ' line ' + i + ': spoint ' + want[i] + ' | jayzee ' + got[i]
}
const same = (name) => JSON.stringify(ran[name]) === JSON.stringify(fixture.sections[name])
const flagKinds = () => fixture.sections.outlier.flatMap((line) => JSON.parse(line).flags.map((flag) => flag.data.kind))

gate('the fixture was generated from spoint InputGuard.js and OutlierDetector.js, with their sha256', () => {
  assert.equal(fixture.source.files.length, 2)
  for (const file of fixture.source.files) assert.match(file.sha256, /^[0-9a-f]{64}$/, file.file)
})

gate('the rate limiter matches spoint on every admission, refusal, refill and capacity case', () => {
  assert.equal(fixture.sections.rate.length, 6 * 81, 'rate cases')
  assert.ok(same('rate'), firstDiff('rate'))
})

gate('the input sanitizer matches spoint on every value in every angle and analog field, and on non-object input', () => {
  assert.ok(same('sanitize'), firstDiff('sanitize'))
})

gate('the movement envelope matches spoint on every movement shape and velocity, including NaN and non-array velocity', () => {
  assert.ok(same('envelope'), firstDiff('envelope'))
})

gate('the outlier detector matches spoint on every headshot ratio, streak, cooldown and null-shooter case', () => {
  assert.ok(same('outlier'), firstDiff('outlier'))
})

gate('the fixture reaches a ratio flag, a streak flag, a refused call, a clamped velocity and a cooled-down repeat', () => {
  const kinds = flagKinds()
  assert.ok(kinds.includes('high_headshot_ratio'), 'no ratio flag in the fixture')
  assert.ok(kinds.includes('suspiciously_fast_headshot_streak'), 'no streak flag in the fixture')
  assert.ok(fixture.sections.rate.some((line) => JSON.parse(line).calls.includes('1')), 'no refused call')
  assert.ok(fixture.sections.envelope.some((line) => JSON.parse(line).clamped === 'true'), 'no clamped velocity')
  assert.ok(fixture.sections.outlier.some((line) => JSON.parse(line).flags.length > 1), 'no shooter flagged twice')
})

finish()
