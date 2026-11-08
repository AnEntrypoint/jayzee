import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { makeScenarios, runAll, EXACT_INDEX, COINCIDENT_INDEX } from './lib/playerCollisionScenario.mjs'
import { applyPlayerCollisions } from '../src/netcode/playerCollisions.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-collisions.json', import.meta.url), 'utf8'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
const scenarios = makeScenarios()
const ran = runAll(applyPlayerCollisions)
const byIndex = (list, index) => list.find((s) => s.index === index)

gate('the fixture was written from the scenarios this gate regenerates, and covers every scenario', () => {
  assert.equal(fixture.inputsSha256, createHash('sha256').update(JSON.stringify(scenarios)).digest('hex'))
  assert.equal(fixture.scenarios.length, scenarios.length)
})

gate('jayzee applyPlayerCollisions leaves every player at the same position and velocity as spoint, frame by frame', () => {
  const got = ran.map((s) => s.frames.map((f) => f.state))
  const want = fixture.scenarios.map((s) => s.frames.map((f) => f.state))
  assert.ok(same(got, want), 'player states differ from spoint')
})

gate('jayzee issues the same setPlayerPosition calls as spoint, in the same order, on every frame', () => {
  const got = ran.map((s) => s.frames.map((f) => f.calls))
  const want = fixture.scenarios.map((s) => s.frames.map((f) => f.calls))
  assert.ok(same(got, want), 'physics position calls differ from spoint')
})

gate('a pair at exactly the minimum distance, and a coincident pair, are left alone by jayzee as by spoint', () => {
  for (const index of [EXACT_INDEX, COINCIDENT_INDEX]) {
    const want = byIndex(fixture.scenarios, index)
    const got = byIndex(ran, index)
    assert.equal(want.frames[0].calls.length, 0, 'spoint pushed a pair it should refuse')
    assert.ok(same(got.frames, want.frames), `targeted scenario ${index} differs from spoint`)
  }
})

gate('the random scenarios push pairs, so the separation path is exercised, not only the refusals', () => {
  const writes = fixture.scenarios.reduce((n, s) => n + s.frames.reduce((m, f) => m + f.calls.length, 0), 0)
  assert.ok(writes > 500)
})

gate('control: the scenarios include a multi-frame run that reuses the grid across frames', () => {
  assert.ok(fixture.scenarios.some((s) => s.frames.length > 1))
})

finish()
