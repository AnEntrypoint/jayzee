import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { runGameFsmScenarios, GAME_FSM_SCENARIO_NAMES } from './lib/gameFsmScenario.mjs'
import { defineGameFSM, validateGameFSMSpec, GameFSMError } from '../src/behaviours/game-fsm.js'
import { createXstateGameFSM } from '../src/behaviours/fsmXstate.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/xstate/game-fsm.json', import.meta.url), 'utf8'))
const native = runGameFsmScenarios((spec, appCtx, now) => defineGameFSM(spec, appCtx, { now }))

const firstDiff = (name, got) => {
  const want = fixture.sections[name]
  const at = want.findIndex((line, i) => got[i] !== line)
  if (at === -1 && got.length === want.length) return null
  const i = at === -1 ? Math.min(got.length, want.length) : at
  return name + ' step ' + i + ': xstate ' + want[i] + ' | jayzee ' + got[i]
}

gate('the fixture is a run on real xstate 5 and covers every scenario of the shared scenario file', () => {
  assert.equal(fixture.source.package, 'xstate')
  assert.match(fixture.source.version, /^5\./)
  assert.deepEqual(Object.keys(fixture.sections), GAME_FSM_SCENARIO_NAMES)
})

for (const name of GAME_FSM_SCENARIO_NAMES) {
  gate('the jayzee interpreter matches xstate step for step on: ' + name, () => {
    assert.equal(firstDiff(name, native[name]), null)
  })
}

gate('the scenarios reach a guarded refusal, a timer transition, a self-target, a final state and a stop', () => {
  const all = Object.values(fixture.sections).flat().map((line) => JSON.parse(line))
  assert.ok(all.some((line) => line.log.includes('start refused')), 'no guarded refusal')
  assert.ok(all.some((line) => line.step[0] === 'advance' && line.transitions.includes('playing')), 'no timer transition')
  assert.ok(all.some((line) => line.step[1] === 'RESTART' && line.log.join() === 'exit countdown,enter countdown 2'), 'no self-target re-entry')
  assert.ok(all.some((line) => line.state === 'closed' && line.result && line.result.reason === 'unhandled'), 'no event refused in the final state')
  assert.ok(all.some((line) => line.result && line.result.reason === 'stopped'), 'no stopped reply')
  assert.ok(all.some((line) => line.log.includes('time up')), 'no second-candidate delayed transition')
})

gate('stated difference: plain xstate does not re-enter a state that targets itself; jayzee does, as xstate does with reenter true', () => {
  assert.deepEqual(fixture.selfTarget.xstateDefault, ['enter a'])
  assert.deepEqual(fixture.selfTarget.reenterTrue, ['enter a', 'exit a', 'enter a'])
  const log = []
  const fsm = defineGameFSM({ initial: 'a', states: { a: { enter: () => log.push('enter a'), exit: () => log.push('exit a'), on: { AGAIN: 'a' } } } }, {}, { now: () => 0 })
  fsm.send('AGAIN')
  assert.deepEqual(log, fixture.selfTarget.reenterTrue)
})

gate('negative control: an interpreter that runs the transition action before the exit hook no longer matches xstate', () => {
  const swapped = runGameFsmScenarios((spec, appCtx, now) => {
    const lobby = spec.states.lobby
    const accepted = lobby.on.START[0]
    const exit = (app, fsm) => { accepted.action(app, fsm, null); lobby.exit(app, fsm) }
    const states = { ...spec.states, lobby: { ...lobby, exit, on: { ...lobby.on, START: [{ target: accepted.target, guard: accepted.guard }, lobby.on.START[1]] } } }
    return defineGameFSM({ ...spec, states }, appCtx, { now })
  })
  assert.ok(GAME_FSM_SCENARIO_NAMES.some((name) => firstDiff(name, swapped[name]) !== null), 'the swapped order still matched')
})

gate('negative control: a clock that runs 1 ms slow misses the 3000 ms countdown and the fixture comparison fails', () => {
  const slow = runGameFsmScenarios((spec, appCtx, now) => defineGameFSM(spec, appCtx, { now: () => now() - (now() > 1000 ? 1 : 0) }))
  assert.ok(GAME_FSM_SCENARIO_NAMES.some((name) => firstDiff(name, slow[name]) !== null), 'the slow clock still matched')
})

gate('the xstate runtime runs on an injected module only: a stand-in with createMachine and createActor receives the compiled states and a clock', () => {
  const seen = {}
  const xstate = {
    createMachine: (config) => { seen.config = config; return { config } },
    createActor: (machine, options) => {
      seen.clock = options.clock
      return { start() { machine.config.states[machine.config.initial].entry() }, getSnapshot: () => ({ can: () => false }), send() {}, stop() {} }
    },
  }
  const fsm = createXstateGameFSM({ initial: 'a', states: { a: { on: { GO: 'b', AGAIN: 'a' }, after: { 500: 'b' } }, b: { type: 'final' } } }, {}, { xstate, now: () => 0 })
  assert.equal(fsm.state, 'a')
  assert.equal(seen.config.initial, 'a')
  assert.deepEqual(Object.keys(seen.config.states), ['a', 'b'])
  assert.equal(seen.config.states.a.on.GO[0].target, 'b')
  assert.equal(seen.config.states.a.on.GO[0].reenter, false)
  assert.equal(seen.config.states.a.on.AGAIN[0].reenter, true)
  assert.equal(seen.config.states.a.after['500'][0].target, 'b')
  assert.equal(seen.config.states.b.type, 'final')
  assert.equal(typeof seen.clock.setTimeout, 'function')
})

gate('the xstate runtime refuses a missing xstate module, a missing clock and a bad spec with the game FSM error codes', () => {
  const codeOf = (fn) => { try { fn() } catch (error) { return error instanceof GameFSMError ? error.code : String(error) } return null }
  const spec = { initial: 'a', states: { a: {} } }
  assert.equal(codeOf(() => createXstateGameFSM(spec, {}, { now: () => 0 })), 'game-fsm-xstate-missing')
  assert.equal(codeOf(() => createXstateGameFSM(spec, {}, { xstate: { createMachine() {}, createActor() {} } })), 'game-fsm-clock-not-function')
  assert.equal(codeOf(() => createXstateGameFSM({ initial: 'z', states: { a: {} } }, {}, { now: () => 0 })), 'game-fsm-initial-undeclared')
  assert.equal(codeOf(() => validateGameFSMSpec({ initial: 'a', states: { a: { on: { GO: 'nowhere' } } } })), 'game-fsm-transition-unknown-target')
})

gate('the xstate runtime source names no xstate import, so the module is injected, and carries no comment', () => {
  const source = readFileSync(new URL('../src/behaviours/fsmXstate.js', import.meta.url), 'utf8')
  assert.equal(/from 'xstate/.test(source), false)
  assert.equal(source.includes('//') || source.includes('/*'), false)
  for (const host of ['Date', 'performance', 'process', 'console', 'globalThis', 'Math.random']) assert.equal(source.includes(host), false, host)
})

finish()
