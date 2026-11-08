import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { makeScenarios, runScenario, runPoses, inputsDigest } from './lib/lodTierScenario.mjs'
import { classifyPlayerTiers, filterEncodedPlayersTiered, buildCrowdDots, reducedTickModFor } from '../src/snapshot-lod-pure/playerLod.js'
import { packReducedPlayerPose } from '../src/snapshot-lod-pure/records.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/lod-tiers.json', import.meta.url), 'utf8'))
const jayzeeLib = { classifyPlayerTiers, filterEncodedPlayersTiered, buildCrowdDots }
const { scenarios, poses } = makeScenarios()
const ran = scenarios.map((s) => ({ index: s.index, hz: s.hz, tick: s.tick, ...runScenario(jayzeeLib, s, reducedTickModFor(s.hz)) }))
const ranPoses = runPoses(packReducedPlayerPose, poses)
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

gate('the fixture was written from the same scenario inputs this gate regenerates, and covers every scenario and pose', () => {
  assert.equal(fixture.inputsSha256, inputsDigest())
  assert.equal(fixture.scenarioCount, scenarios.length)
  assert.equal(fixture.poseCount, poses.length)
  assert.equal(fixture.scenarios.length, scenarios.length)
  assert.equal(fixture.poses.length, poses.length)
})

gate('jayzee classifies every scenario into the same full, reduced and dot players as spoint', () => {
  const got = ran.map((s) => s.classify)
  const want = fixture.scenarios.map((s) => s.classify)
  assert.ok(same(got, want), 'tier classification differs from spoint')
})

gate('jayzee filters every scenario to the same records and dots as spoint, at the same tick and cadence', () => {
  const got = ran.map((s) => ({ players: s.players, dots: s.dots }))
  const want = fixture.scenarios.map((s) => ({ players: s.players, dots: s.dots }))
  assert.ok(same(got, want), 'filtered records or dots differ from spoint')
})

gate('jayzee crowd dots over every scenario match spoint, including mixed-sign cells', () => {
  assert.ok(same(ran.map((s) => s.dotsAll), fixture.scenarios.map((s) => s.dotsAll)), 'crowd dots differ from spoint')
})

gate('jayzee cadence modulus matches spoint for every snapshot rate used by the scenarios', () => {
  assert.ok(same(ran.map((s) => s.mod), fixture.scenarios.map((s) => s.mod)), 'reduced cadence modulus differs from spoint')
})

gate('the reduced pose records match spoint on 200 random poses and the edge poses, and a NaN position is refused by both', () => {
  assert.ok(same(ranPoses, fixture.poses), 'reduced pose records differ from spoint')
  assert.deepEqual(ranPoses.at(-1), { refused: 'RangeError' })
})

gate('the boundary scenario puts a player at exactly 120 m among the dots and one at 119.5 m among the reduced', () => {
  const boundary = ran.find((s) => s.index === 4)
  assert.ok(boundary.classify.dotIds.includes(600) && boundary.classify.dotIds.includes(602))
  assert.ok(boundary.classify.reduced.includes(601))
  assert.ok(!boundary.classify.reduced.includes(600))
})

gate('the scenarios exercise every tier: full, reduced and dot players, a count above the 30-player cap, and a cadence that drops reduced players', () => {
  const total = (key) => fixture.scenarios.reduce((n, s) => n + s.classify[key].length, 0)
  assert.ok(total('full') > 0 && total('reduced') > 0 && total('dotIds') > 0)
  assert.ok(fixture.scenarios.some((s) => s.classify.full.length === 30 && s.classify.reduced.length > 0))
  assert.ok(fixture.scenarios.some((s) => s.mod > 1 && s.tick % s.mod !== 0 && s.classify.reduced.length > 0))
})

finish()
