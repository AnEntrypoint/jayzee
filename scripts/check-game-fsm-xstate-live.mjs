import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { runGameFsmScenarios, GAME_FSM_SCENARIO_NAMES } from './lib/gameFsmScenario.mjs'
import { defineGameFSM } from '../src/behaviours/game-fsm.js'
import { createXstateGameFSM } from '../src/behaviours/fsmXstate.js'

const xstateDir = resolve(process.argv[2] ?? process.env.XSTATE_DIR ?? 'node_modules/xstate')
const manifest = JSON.parse(readFileSync(join(xstateDir, 'package.json'), 'utf8'))
const entry = manifest.exports?.['.']?.import ?? manifest.exports?.['.']?.default ?? manifest.module ?? manifest.main
const xstate = await import(pathToFileURL(join(xstateDir, typeof entry === 'string' ? entry : entry.default)).href)
const fixture = JSON.parse(readFileSync(new URL('./fixtures/xstate/game-fsm.json', import.meta.url), 'utf8'))

const live = runGameFsmScenarios((spec, appCtx, now) => createXstateGameFSM(spec, appCtx, { xstate, now }))
const native = runGameFsmScenarios((spec, appCtx, now) => defineGameFSM(spec, appCtx, { now }))

gate('the installed xstate is the version the fixture was written from', () => {
  assert.equal(manifest.version, fixture.source.version)
})

for (const name of GAME_FSM_SCENARIO_NAMES) {
  gate('a live xstate actor behind the jayzee runtime surface reproduces the committed fixture on: ' + name, () => {
    assert.deepEqual(live[name], fixture.sections[name])
  })
  gate('the live xstate actor and the jayzee interpreter agree step for step on: ' + name, () => {
    assert.deepEqual(live[name], native[name])
  })
}

gate('the live runtime holds a started xstate actor whose state value follows the runtime state', () => {
  let nowMs = 0
  const fsm = createXstateGameFSM({ initial: 'a', states: { a: { on: { GO: 'b' } }, b: { after: { 100: 'a' } } } }, {}, { xstate, now: () => nowMs })
  assert.equal(fsm.actor.getSnapshot().value, 'a')
  fsm.send('GO')
  assert.equal(fsm.actor.getSnapshot().value, 'b')
  nowMs = 100
  fsm.tick(0.1)
  assert.equal(fsm.actor.getSnapshot().value, 'a')
  assert.equal(fsm.state, 'a')
})

finish()
