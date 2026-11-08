import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runGameSystems, runQuestWithoutContext, serialiseValue } from './lib/gameSystemsScenario.mjs'
import { createAbilityTree } from '../src/game/AbilityTree.js'
import { CURVE_LINEAR, CURVE_EXPONENTIAL, CURVE_QUADRATIC, createProgressionSystem, getStatScaling } from '../src/game/ProgressionSystem.js'
import { defineStatsSystem } from '../src/game/StatsSystem.js'
import { defineQuestSystem } from '../src/game/QuestSystem.js'
import { EventChainManager } from '../src/game/EventChainManager.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/game-systems.json', import.meta.url), 'utf8'))
const lib = {
  createAbilityTree,
  createProgressionSystem,
  getStatScaling,
  CURVE_LINEAR,
  CURVE_EXPONENTIAL,
  CURVE_QUADRATIC,
  defineStatsSystem,
  defineQuestSystem,
  EventChainManager,
}
const ran = runGameSystems(lib)

const sameSection = (name) => {
  const got = ran.sections[name]
  const want = fixture.sections[name]
  assert.equal(got.length, want.length, `${name}: jayzee logs ${got.length} lines, spoint logs ${want.length}`)
  got.forEach((line, index) => {
    assert.equal(line, want[index], `${name} line ${index}`)
  })
}

gate('the AbilityTree log matches spoint on the table, unlock rule, casts, cooldowns, hotkeys and definition refusals', () => {
  sameSection('ability')
})

gate('the ProgressionSystem log matches spoint on the curve thresholds, scaling, refusals, XP, snapshot and level-up events', () => {
  sameSection('progression')
})

gate('the StatsSystem log matches spoint on XP, bonuses, equipment, loadouts, the snapshot and the injected effects', () => {
  sameSection('stats')
})

gate('the QuestSystem log matches spoint on start, objectives, claim, repeatable restart, snapshot and the injected effects', () => {
  sameSection('quest')
})

gate('the EventChainManager log matches spoint on triggers, conditions, inventory, delays, actions and logs', () => {
  sameSection('chain')
})

gate('a quest run with a recording context matches spoint, and a quest run without one completes to the same state on jayzee', () => {
  sameSection('noContext')
  assert.equal(fixture.nullContext.threw, 'TypeError', 'spoint should refuse a missing appCtx with TypeError')
  const nullRun = runQuestWithoutContext(lib, null, () => ran.finalTime)
  const withContext = JSON.parse(ran.sections.noContext[0])[1]
  assert.equal(serialiseValue(nullRun), serialiseValue(withContext), 'the context-less run differs from the recording run')
})

gate('the fixture holds the send, warn, progression and inventory effects, at least one refusal and the six spoint source hashes', () => {
  const lines = Object.values(fixture.sections).flat()
  for (const label of ['effect.send', 'effect.warn', 'effect.progression.addXP', 'effect.inventory.add']) {
    assert.ok(lines.some((line) => line.startsWith(`["${label}",`)), `no ${label} line in the fixture`)
  }
  assert.ok(lines.some((line) => line.includes('"ok":false')), 'no refusal line in the fixture')
  const hashes = Object.values(fixture.source.files)
  assert.equal(hashes.length, 6)
  for (const hash of hashes) assert.match(hash, /^[0-9a-f]{64}$/)
})

finish()
