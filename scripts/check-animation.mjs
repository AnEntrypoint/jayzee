import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { blendWeights1D, blendWeights2D } from '../src/animation/blend.js'
import { LAND_DELAY_MS, DEFAULT_SPEEDS, FADE_SECONDS, tickEvents, nextState, runTick, requestState, settledState } from '../src/animation/locomotion.js'

const near = (actual, expected) => actual.length === expected.length && actual.every((value, i) => Math.abs(value - expected[i]) < 1e-12)
const assertWeights = (actual, expected) => assert.ok(near(actual, expected), 'got ' + JSON.stringify(actual) + ' expected ' + JSON.stringify(expected))
const context = (overrides = {}) => ({ speed: 0, isGrounded: true, verticalVelocity: 0, timeInStateMs: 0, clipSeconds: 1, ...overrides })
const SAMPLES = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }]
const EVENTS = ['IDLE', 'WALK', 'RUN', 'SPRINT', 'JUMP', 'LAND', 'ATTACK', 'ATTACK_END', 'DIE']

gate('a 1D blend interpolates linearly between the two thresholds that bracket the parameter', () => {
  assertWeights(blendWeights1D([0, 1, 2], 0.25), [0.75, 0.25, 0])
})

gate('control: the 1D interpolation moves when the parameter moves', () => {
  assert.ok(!near(blendWeights1D([0, 1, 2], 0.75), [0.75, 0.25, 0]))
})

gate('a 1D blend clamps to the first and last clip outside the thresholds', () => {
  assertWeights(blendWeights1D([0, 1, 2], -5), [1, 0, 0])
  assertWeights(blendWeights1D([0, 1, 2], 9), [0, 0, 1])
})

gate('control: a parameter past the last threshold does not take the first clip', () => {
  assert.ok(!near(blendWeights1D([0, 1, 2], 9), [1, 0, 0]))
})

gate('a 1D blend exactly on a threshold gives that clip full weight', () => {
  assertWeights(blendWeights1D([0, 1, 2], 1), [0, 1, 0])
})

gate('control: a parameter between thresholds does not give a clip full weight', () => {
  assert.ok(!near(blendWeights1D([0, 1, 2], 1.5), [0, 1, 0]))
})

gate('a 1D blend with no clips has no weights and a single clip always has weight one', () => {
  assert.deepEqual(blendWeights1D([], 0), [])
  assertWeights(blendWeights1D([5], 0), [1])
})

gate('control: a tree with one clip is not empty', () => {
  assert.equal(blendWeights1D([0], 0).length, 1)
})

gate('the 1D blend weights sum to one across a sweep of parameters', () => {
  const thresholds = [0, 0.5, 2, 4]
  const distinct = new Set()
  for (let parameter = -1; parameter <= 5; parameter += 0.125) {
    const weights = blendWeights1D(thresholds, parameter)
    assert.ok(Math.abs(weights.reduce((sum, w) => sum + w, 0) - 1) < 1e-12, 'sum at ' + parameter)
    distinct.add(weights.join(','))
  }
  assert.ok(distinct.size > 5, 'sweep produced ' + distinct.size + ' weight vectors')
})

gate('control: the 1D sweep covers interior blends, not only the clip endpoints', () => {
  assert.ok(!near(blendWeights1D([0, 0.5, 2, 4], 1), [1, 0, 0, 0]))
})

gate('a 2D blend on a sample gives that sample full weight', () => {
  assertWeights(blendWeights2D(SAMPLES, 1, 0), [0, 1, 0, 0])
})

gate('control: a 2D query at another sample gives a different sample full weight', () => {
  assert.ok(!near(blendWeights2D(SAMPLES, 0, 0), [0, 1, 0, 0]))
  assertWeights(blendWeights2D(SAMPLES, 0, 0), [1, 0, 0, 0])
})

gate('a 2D blend weights the three nearest samples by inverse distance and drops the fourth', () => {
  const weights = blendWeights2D(SAMPLES, 0.25, 0.25)
  const inverse = [0, 1, 2].map((i) => 1 / Math.hypot(SAMPLES[i].x - 0.25, SAMPLES[i].y - 0.25))
  const total = inverse.reduce((sum, value) => sum + value, 0)
  assertWeights(weights.slice(0, 3), inverse.map((value) => value / total))
  assert.equal(weights[3], 0)
})

gate('control: moving the 2D query onto the fourth sample gives it full weight', () => {
  assertWeights(blendWeights2D(SAMPLES, 1, 1), [0, 0, 0, 1])
})

gate('a 2D blend floors the sample distance at 0.01 so a near sample cannot take all the weight', () => {
  const weights = blendWeights2D(SAMPLES, 0.001, 0)
  const inverse = [100, 1 / 0.999, 1 / Math.hypot(0.001, 1)]
  const expected = inverse[0] / inverse.reduce((sum, value) => sum + value, 0)
  assert.ok(Math.abs(weights[0] - expected) < 1e-12, 'weight ' + weights[0])
})

gate('control: without the 0.01 floor the near sample would take nearly all the weight', () => {
  const unfloored = 1000 / (1000 + 1 / 0.999 + 1 / Math.hypot(0.001, 1))
  const weights = blendWeights2D(SAMPLES, 0.001, 0)
  assert.ok(Math.abs(weights[0] - unfloored) > 0.01, 'weight ' + weights[0])
})

gate('an idle character that is airborne and fast goes to jump, not run', () => {
  assert.deepEqual(tickEvents('idle', context({ speed: 6, isGrounded: false })), ['RUN', 'JUMP'])
  assert.equal(runTick('idle', context({ speed: 6, isGrounded: false })), 'jump')
})

gate('control: a grounded idle character at run speed goes to run', () => {
  assert.equal(runTick('idle', context({ speed: 6 })), 'run')
})

gate('an idle character starts walking above the walk speed and stays idle at it', () => {
  assert.equal(runTick('idle', context({ speed: 2 })), 'walk')
  assert.equal(runTick('idle', context({ speed: DEFAULT_SPEEDS.walkSpeed })), 'idle')
})

gate('control: an idle character just above the walk speed is walking, not idle', () => {
  assert.equal(runTick('idle', context({ speed: 1.6 })), 'walk')
})

gate('a walking character stops below 0.1 m/s and runs above the run speed', () => {
  assert.equal(runTick('walk', context({ speed: 0.05 })), 'idle')
  assert.equal(runTick('walk', context({ speed: 3 })), 'walk')
  assert.equal(runTick('walk', context({ speed: 6 })), 'run')
})

gate('control: a walking character at 0.2 m/s keeps walking', () => {
  assert.equal(runTick('walk', context({ speed: 0.2 })), 'walk')
})

gate('a running character steps down to idle or walk, and up to sprint only above the sprint speed', () => {
  assert.equal(runTick('run', context({ speed: 1 })), 'idle')
  assert.equal(runTick('run', context({ speed: 3 })), 'walk')
  assert.equal(runTick('run', context({ speed: 7 })), 'run')
  assert.equal(runTick('run', context({ speed: 11 })), 'sprint')
})

gate('control: a running character at 7 m/s is not sprinting', () => {
  assert.notEqual(runTick('run', context({ speed: 7 })), 'sprint')
})

gate('a sprinting character drops to run below the run speed and holds above it', () => {
  assert.equal(runTick('sprint', context({ speed: 4 })), 'run')
  assert.equal(runTick('sprint', context({ speed: 8 })), 'sprint')
})

gate('control: a sprinting character at 8 m/s is not running', () => {
  assert.notEqual(runTick('sprint', context({ speed: 8 })), 'run')
})

gate('a jump lands once grounded and falling or level, and holds while rising or airborne', () => {
  assert.equal(runTick('jump', context({ verticalVelocity: -1 })), 'land')
  assert.equal(runTick('jump', context({ verticalVelocity: 0 })), 'land')
  assert.equal(runTick('jump', context({ verticalVelocity: 2 })), 'jump')
  assert.equal(runTick('jump', context({ isGrounded: false, verticalVelocity: -1 })), 'jump')
})

gate('control: a grounded jump that is still rising does not land', () => {
  assert.notEqual(runTick('jump', context({ verticalVelocity: 2 })), 'land')
})

gate('a landing settles to idle, walk or run by speed (the host waits LAND_DELAY_MS)', () => {
  assert.equal(LAND_DELAY_MS, 500)
  assert.equal(settledState(0.2, DEFAULT_SPEEDS.runSpeed), 'idle')
  assert.equal(settledState(0.5, DEFAULT_SPEEDS.runSpeed), 'walk')
  assert.equal(settledState(5, DEFAULT_SPEEDS.runSpeed), 'walk')
  assert.equal(settledState(6, DEFAULT_SPEEDS.runSpeed), 'run')
  assert.equal(settledState(Number.NaN, DEFAULT_SPEEDS.runSpeed), null)
})

gate('control: the settle bands are not shifted, so 0.49 m/s is idle and 5 m/s is walk', () => {
  assert.notEqual(settledState(0.49, DEFAULT_SPEEDS.runSpeed), 'walk')
  assert.notEqual(settledState(5, DEFAULT_SPEEDS.runSpeed), 'run')
})

gate('an attack ends only after the clip duration has passed, then settles by speed', () => {
  assert.equal(runTick('attack', context({ timeInStateMs: 1000, clipSeconds: 1, speed: 2 })), 'attack')
  assert.equal(runTick('attack', context({ timeInStateMs: 1001, clipSeconds: 1, speed: 2 })), 'walk')
  assert.equal(runTick('attack', context({ timeInStateMs: 1001, clipSeconds: 1, speed: 0 })), 'idle')
})

gate('control: an attack past its clip at 6 m/s settles to run, not walk', () => {
  assert.equal(runTick('attack', context({ timeInStateMs: 1001, clipSeconds: 1, speed: 6 })), 'run')
})

gate('die is final and ignores every event', () => {
  for (const event of EVENTS) {
    assert.equal(nextState('die', event, context()), null, event)
  }
  assert.equal(runTick('die', context({ speed: 9, isGrounded: false })), 'die')
})

gate('control: idle accepts JUMP, so the die result is not a blanket refusal', () => {
  assert.equal(nextState('idle', 'JUMP', context()), 'jump')
})

gate('requestState moves to a state the current one can enter and refuses the rest', () => {
  assert.equal(requestState('idle', 'attack', context()), 'attack')
  assert.equal(requestState('jump', 'attack', context()), null)
  assert.equal(requestState('idle', 'land', context()), null)
  assert.equal(requestState('idle', 'nope', context()), null)
})

gate('control: requestState honours die from idle', () => {
  assert.equal(requestState('idle', 'die', context()), 'die')
})

gate('every locomotion state has an enter fade and the table values hold', () => {
  for (const state of ['idle', 'walk', 'run', 'sprint', 'jump', 'land', 'attack', 'die']) {
    assert.ok(Number.isFinite(FADE_SECONDS[state]) && FADE_SECONDS[state] > 0, state)
  }
  assert.equal(FADE_SECONDS.sprint, 0.2)
  assert.equal(FADE_SECONDS.jump, 0.1)
})

gate('control: the jump fade is not the idle fade', () => {
  assert.notEqual(FADE_SECONDS.jump, FADE_SECONDS.idle)
})

gate('runTick uses the speeds it is given instead of the defaults', () => {
  const custom = { walkSpeed: 4, runSpeed: 5, sprintSpeed: 10 }
  assert.equal(runTick('idle', context({ speed: 3 }), custom), 'idle')
})

gate('control: under the default speeds the same idle input walks', () => {
  assert.equal(runTick('idle', context({ speed: 3 })), 'walk')
})

finish()
