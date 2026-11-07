import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { gate, finish } from './lib/gate.mjs'
import * as constants from '../src/tick-authority-pure/constants.js'
import { accrueStepBudget, neutralInput, sequenceGapAhead, takeNextInput, waitForSequenceGap } from '../src/tick-authority-pure/inputSequence.js'
import { buildMovementDeps, createMovementState, processPlayerMovement, recordPlayerTick, restoreMovementState, snapshotMovementState, stepPlayerMovement } from '../src/tick-authority-pure/movementStep.js'
import { createSnapshotRateController } from '../src/tick-authority-pure/snapshotRate.js'
import { planSnapshotGroups, restoreTrimmedBaselines, selectServedPlayers } from '../src/tick-authority-pure/snapshotPlan.js'
import { LagCompensator } from '../src/netcode/lagCompensation.js'

const here = dirname(fileURLToPath(import.meta.url))
const portDir = join(here, '..', 'src', 'tick-authority-pure')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const assertEqual = (actual, expected, label) => {
  if (!isDeepStrictEqual(actual, expected)) throw new Error(`${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
}

const assertClose = (actual, expected, label) => {
  assert(Math.abs(actual - expected) < 1e-9, `${label}: expected ${expected}, got ${actual}`)
}

const SPOINT_CONSTANTS = {
  DEFAULT_TICK_RATE_HZ: 60,
  INPUT_BUFFER_CATCHUP_DEPTH: 8,
  STARVE_HOLD_SECONDS: 0.25,
  INPUT_STEP_BANK: 16,
  GAP_WAIT_MAX_TICKS: 4,
  MAX_CATCHUP_STEPS_PER_TICK: 3,
  PHYSICS_PLAYER_DIVISOR: 3,
  PHYSICS_MAX_ACCUM_DT: 1 / 20,
  CROUCH_WIRE_BIT: 1,
  SWIMMING_WIRE_BIT: 2,
  PLAYERS_PER_SNAP_GROUP: 50,
  SNAP_ENTITY_VISITS_PER_TICK: 24000,
  SNAP_RATE_MIN_HZ: 8,
  SNAP_RATE_ADJUST_INTERVAL: 64,
  SNAP_COST_EMA_ALPHA: 0.2,
  SNAP_COST_LOW_FRAC: 0.15,
  SNAP_COST_HIGH_FRAC: 0.35,
  SNAP_STALL_ENTER: 0.08,
  SNAP_STALL_EXIT: 0.03,
  SNAP_STALL_EMA_ALPHA: 0.02,
  SNAP_STALL_MAX_INTERVAL: 2,
}

const constantDifferences = (expected, actual) => Object.keys(expected)
  .filter((name) => !Object.is(expected[name], actual[name]))
  .map((name) => `${name} spoint ${expected[name]} port ${actual[name]}`)

const COMMENT_PATTERN = /\/\/|\/\*/
const IMPORT_PATTERN = /^\s*import\s[^'"]*from\s+'([^']+)'/gm
const allowedImport = (specifier) => specifier.startsWith('./') || specifier === '../anticheat/InputGuard.js'
const importsOf = (source) => [...source.matchAll(IMPORT_PATTERN)].map((match) => match[1])

const portSources = () => readdirSync(portDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, source: readFileSync(join(portDir, name), 'utf8') }))

const makePlayer = (id, extra = {}) => ({
  id,
  state: {
    position: [0, 0, 0],
    rotation: [0, 0, 0, 1],
    velocity: [0, 0, 0],
    onGround: true,
    health: 100,
    crouch: 0,
    swimming: false,
    lookPitch: 0,
    lookYaw: 0,
    expr: 0,
    weapon: 0,
    groundNormal: null,
    wallNormals: null,
  },
  ...extra,
})

const queueOf = (count) => Array.from({ length: count }, (_, index) => ({ sequence: index + 1, data: { forward: true, yaw: 0 } }))

const makeEnv = (options = {}) => {
  const queues = options.queues ?? new Map()
  const log = { applied: [], physics: [], crouch: [], updates: [], ring: [], events: [], lag: [] }
  const lagCompensator = options.lagCompensator ?? { recordPlayerPosition: (...args) => log.lag.push(args) }
  const deps = buildMovementDeps({
    tickRate: options.tickRate ?? 60,
    playerManager: {
      getInputs: (id) => {
        if (!queues.has(id)) queues.set(id, [])
        return queues.get(id)
      },
      getMovementOverride: () => null,
    },
    physicsIntegration: {
      setCrouch: (id, crouch) => log.crouch.push([id, crouch]),
      updatePlayerPhysics: (id, state, dt) => log.physics.push([id, dt]),
    },
    lagCompensator,
    networkState: { updatePlayer: (...args) => log.updates.push(args) },
    applyMovement: (state) => log.applied.push(state),
    defaultMovement: options.defaultMovement ?? { maxSpeed: 10 },
    movementOverrides: options.movementOverrides ?? {},
    stepTeleportHold: options.stepTeleportHold ?? (() => false),
    eventLog: { record: (name, data, meta) => log.events.push([name, data, meta]) },
    transformRingWriter: options.withRing === false ? null : { write: (...args) => log.ring.push(args) },
    clock: options.clock ?? (() => 0),
  })
  return { deps, log, queues }
}

const runMovement = (env, players, tick, state, dt = 1 / 60, explicit = null) => {
  processPlayerMovement(players, env.deps, tick, dt, state.playerIdleCounts, state.playerAccumDt, explicit)
}

gate('constants match spoint TickHandler.js at d5e3860 (21 values)', () => {
  assertEqual(constantDifferences(SPOINT_CONSTANTS, constants), [])
})

gate('negative control: a constant that differs from spoint is reported', () => {
  assertEqual(constantDifferences({ ...SPOINT_CONSTANTS, GAP_WAIT_MAX_TICKS: 5 }, constants), ['GAP_WAIT_MAX_TICKS spoint 5 port 4'])
})

gate('ported source files carry no comments', () => {
  const offenders = portSources().filter(({ source }) => COMMENT_PATTERN.test(source)).map(({ name }) => name)
  assertEqual(offenders, [])
})

gate('negative control: the comment detector flags line and block comments', () => {
  assert(COMMENT_PATTERN.test('const a = 1 // note'), 'line comment not flagged')
  assert(COMMENT_PATTERN.test('/* block */ const b = 2'), 'block comment not flagged')
  assert(!COMMENT_PATTERN.test('const c = 3'), 'plain code flagged')
})

gate('ported modules import only sibling modules and the jayzee anticheat guard', () => {
  const refused = portSources().flatMap(({ name, source }) => importsOf(source).filter((specifier) => !allowedImport(specifier)).map((specifier) => `${name} ${specifier}`))
  assertEqual(refused, [])
  const guard = portSources().find(({ name }) => name === 'movementStep.js')
  assert(importsOf(guard.source).includes('../anticheat/InputGuard.js'), 'movementStep does not import the anticheat guard')
  assert(!/function\s+enforceMovementEnvelope/.test(guard.source), 'movementStep copies the envelope function')
})

gate('negative control: the import check refuses node built-ins and copied guards', () => {
  const sample = "import { readFileSync } from 'node:fs'\nimport { x } from './constants.js'"
  const refused = importsOf(sample).filter((specifier) => !allowedImport(specifier))
  assertEqual(refused, ['node:fs'])
})

gate('sequenceGapAhead is true only when the next sequence skips past the ack', () => {
  assertEqual(sequenceGapAhead({ ackSequence: 2 }, [{ sequence: 5 }]), true, 'gap 2 to 5')
  assertEqual(sequenceGapAhead({ ackSequence: 2 }, [{ sequence: 3 }]), false, 'contiguous 2 to 3')
  assertEqual(sequenceGapAhead({ ackSequence: 4 }, [{ sequence: null }]), false, 'no sequence')
})

gate('negative control: a falsy ack or a missing ack is never a gap', () => {
  assertEqual(sequenceGapAhead({ ackSequence: 0 }, [{ sequence: 5 }]), false, 'zero ack')
  assertEqual(sequenceGapAhead({}, [{ sequence: 9 }]), false, 'no ack')
})

gate('waitForSequenceGap waits GAP_WAIT_MAX_TICKS ticks, then skips and counts the missing sequences', () => {
  const player = { ackSequence: 2 }
  const inputs = [{ sequence: 6 }]
  const waits = [1, 2, 3, 4, 5].map(() => waitForSequenceGap(player, inputs))
  assertEqual(waits, [true, true, true, true, false], 'wait pattern')
  assertEqual(player.inputGapsSkipped, 3, 'missing sequences 3, 4, 5')
  assertEqual(player.gapWaitTicks, 0, 'wait counter reset')
})

gate('negative control: a contiguous sequence never waits or counts a skip', () => {
  const player = { ackSequence: 2 }
  const inputs = [{ sequence: 3 }]
  const waits = Array.from({ length: 10 }, () => waitForSequenceGap(player, inputs))
  assertEqual(waits.every((value) => value === false), true, 'waited on contiguous input')
  assertEqual(player.inputGapsSkipped, undefined, 'counted a skip')
  assertEqual(player.gapWaitTicks, 0, 'wait counter moved')
})

gate('takeNextInput moves the input and advances the ack only when a sequence exists', () => {
  const player = { ackSequence: 6 }
  const inputs = [{ sequence: 7, data: { a: 1 } }]
  takeNextInput(player, inputs)
  assertEqual(player.lastInput, { a: 1 }, 'lastInput')
  assertEqual(player.ackSequence, 7, 'ack')
  assertEqual(player.hasSentInput, true, 'hasSentInput')
  assertEqual(inputs.length, 0, 'queue drained')
})

gate('negative control: an input without a sequence leaves the ack in place', () => {
  const player = { ackSequence: 3 }
  takeNextInput(player, [{ sequence: null, data: { b: 2 } }])
  assertEqual(player.ackSequence, 3, 'ack moved')
  assertEqual(player.lastInput, { b: 2 }, 'lastInput')
})

gate('neutralInput keeps yaw, pitch, crouch and expression and drops movement keys', () => {
  assertEqual(neutralInput({ yaw: 1.5, pitch: -0.2, crouch: 1, expr: 3, forward: true }), { yaw: 1.5, pitch: -0.2, crouch: true, expr: 3 })
})

gate('negative control: an empty last input becomes zeros with no movement keys', () => {
  const neutral = neutralInput({})
  assertEqual(neutral, { yaw: 0, pitch: 0, crouch: false, expr: 0 })
  assertEqual('forward' in neutral, false, 'movement key carried')
})

gate('accrueStepBudget credits elapsed ticks, caps at INPUT_STEP_BANK and floors at -1 with an injected clock', () => {
  const player = {}
  accrueStepBudget(player, 10, 0, 1000)
  assertEqual(player.inputStepBudget, 1, 'first call counts one tick')
  accrueStepBudget(player, 10, 0, 1000 + 10 * 40)
  assertEqual(player.inputStepBudget, constants.INPUT_STEP_BANK, 'capped at the bank')
  accrueStepBudget(player, 10, 100, 1000 + 10 * 40 + 10)
  assertEqual(player.inputStepBudget, -1, 'floored at -1')
})

gate('negative control: a stalled clock credits nothing and still debits the step', () => {
  const player = {}
  accrueStepBudget(player, 10, 1, 500)
  assertEqual(player.inputStepBudget, 0, 'first call')
  accrueStepBudget(player, 10, 1, 500)
  assertEqual(player.inputStepBudget, -1, 'same clock reading')
})

gate('accrueStepBudget reads performance.now when no clock is passed, and uses a passed clock value', () => {
  const before = performance.now()
  const player = {}
  accrueStepBudget(player, 10, 0)
  const after = performance.now()
  assert(player.inputBudgetAt >= before && player.inputBudgetAt <= after, 'default clock is not performance.now')
  accrueStepBudget(player, 10, 0, 12345)
  assertEqual(player.inputBudgetAt, 12345, 'passed clock ignored')
})

gate('negative control: a clock argument overrides performance.now', () => {
  const player = {}
  accrueStepBudget(player, 10, 0, 777)
  assertEqual(player.inputBudgetAt, 777, 'argument not used')
})

gate('buildMovementDeps derives the starve hold and tick length and merges movement overrides', () => {
  const build = (tickRate) => buildMovementDeps({ tickRate, playerManager: {}, physicsIntegration: {}, lagCompensator: {}, networkState: {}, applyMovement: () => {}, defaultMovement: { maxSpeed: 5, sprintSpeed: 9 }, movementOverrides: { maxSpeed: 7 }, stepTeleportHold: () => false })
  const deps60 = build(60)
  assertEqual(deps60.starveHoldTicks, 15, 'starve hold at 60 Hz')
  assertEqual(build(20).starveHoldTicks, 5, 'starve hold at 20 Hz')
  assertEqual(build(1).starveHoldTicks, 1, 'starve hold floor')
  assertEqual(deps60.movement, { maxSpeed: 7, sprintSpeed: 9 }, 'merged movement')
  assertEqual(deps60.tickMs, 1000 / 60, 'tick length')
  assertEqual(deps60.transformRingWriter, null, 'absent ring writer')
})

gate('negative control: with no overrides the defaults are kept and the defaults object is not mutated', () => {
  const defaults = { maxSpeed: 5 }
  const deps = buildMovementDeps({ tickRate: 60, playerManager: {}, physicsIntegration: {}, lagCompensator: {}, networkState: {}, applyMovement: () => {}, defaultMovement: defaults, stepTeleportHold: () => false })
  assertEqual(deps.movement.maxSpeed, 5, 'default lost')
  deps.movement.maxSpeed = 99
  assertEqual(defaults, { maxSpeed: 5 }, 'defaults mutated')
})

gate('processPlayerMovement takes one queued input per tick and advances the ack', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(2)]]) })
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state)
  assertEqual(player.ackSequence, 1, 'ack after tick 1')
  assertEqual(player.inputBufferDepth, 1, 'depth after tick 1')
  assertEqual(player.hasSentInput, true, 'hasSentInput')
  runMovement(env, [player], 2, state)
  assertEqual(player.ackSequence, 2, 'ack after tick 2')
  assertEqual(player.inputBufferDepth, 0, 'depth after tick 2')
})

gate('negative control: explicit inputs bypass the queue, which is consumed only without them', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(3)]]) })
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state, 1 / 60, new Map([[1, { forward: true, yaw: 0 }]]))
  assertEqual(env.queues.get(1).length, 3, 'queue consumed with explicit inputs')
  assertEqual(player.ackSequence, undefined, 'ack moved with explicit inputs')
  runMovement(env, [player], 2, state)
  assertEqual(env.queues.get(1).length, 2, 'queue not consumed without explicit inputs')
})

gate('a gap holds movement through the starve window and skips after GAP_WAIT_MAX_TICKS', () => {
  const env = makeEnv({ queues: new Map([[1, [{ sequence: 1, data: { forward: true, yaw: 0 } }, { sequence: 3, data: { forward: true, yaw: 0 } }]]]) })
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state)
  for (let tick = 2; tick <= 5; tick++) runMovement(env, [player], tick, state)
  assertEqual(player.ackSequence, 1, 'ack during gap')
  assertEqual(env.log.applied.length, 1, 'movement during gap')
  runMovement(env, [player], 6, state)
  assertEqual(player.ackSequence, 3, 'ack after skip')
  assertEqual(player.inputGapsSkipped, 1, 'skipped sequences')
  assertEqual(env.log.applied.length, 2, 'movement after skip')
})

gate('negative control: a contiguous next input is taken on the next tick with no hold or skip', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(2)]]) })
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state)
  runMovement(env, [player], 2, state)
  assertEqual(player.ackSequence, 2, 'ack')
  assertEqual(player.inputGapsSkipped, undefined, 'skip counted')
  assertEqual(player.starvedTicks, 0, 'starved')
  assertEqual(env.log.applied.length, 2, 'movement held')
})

gate('starvation holds for starveHoldTicks, then neutralises the last input', () => {
  const env = makeEnv({ tickRate: 60 })
  const player = makePlayer(1, { hasSentInput: true, lastInput: { forward: true, yaw: 0.4, crouch: 1, expr: 2 } })
  const state = createMovementState()
  for (let tick = 1; tick <= 15; tick++) runMovement(env, [player], tick, state)
  assertEqual(env.log.applied.length, 0, 'stepped during the hold')
  assertEqual(player.starvedTicks, 15, 'starved ticks')
  runMovement(env, [player], 16, state)
  assertEqual(env.log.applied.length, 1, 'no step after the hold')
  assertEqual(player.lastInput, { yaw: 0.4, pitch: 0, crouch: true, expr: 2 }, 'neutralised input')
})

gate('negative control: a player who never sent input is stepped every tick with no starvation', () => {
  const env = makeEnv({ tickRate: 60 })
  const player = makePlayer(1)
  const state = createMovementState()
  for (let tick = 1; tick <= 3; tick++) runMovement(env, [player], tick, state)
  assertEqual(env.log.applied.length, 3, 'steps')
  assertEqual(player.starvedTicks, undefined, 'starved ticks counted')
})

gate('a resting player on the ground skips physics after its first idle tick', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  for (let tick = 1; tick <= 10; tick++) runMovement(env, [player], tick, state)
  assertEqual(env.log.physics.length, 0, 'physics calls')
  assertEqual(state.playerIdleCounts.get(1), 10, 'idle count')
})

gate('negative control: a moving player steps physics on every tick', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  const explicit = new Map([[1, { forward: true, yaw: 0 }]])
  for (let tick = 1; tick <= 10; tick++) runMovement(env, [player], tick, state, 1 / 60, explicit)
  assertEqual(env.log.physics.length, 10, 'physics calls')
})

gate('physics dt is capped at PHYSICS_MAX_ACCUM_DT', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state, 0.5, new Map([[1, { forward: true, yaw: 0 }]]))
  assertClose(env.log.physics[0][1], constants.PHYSICS_MAX_ACCUM_DT, 'capped dt')
})

gate('negative control: a dt below the cap reaches physics unchanged', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  runMovement(env, [player], 1, state, 0.01, new Map([[1, { forward: true, yaw: 0 }]]))
  assertClose(env.log.physics[0][1], 0.01, 'dt')
})

gate('a resting player on its first idle tick defers physics and keeps the accumulated dt', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  stepPlayerMovement(player, env.deps, 1, 0.02, state.playerIdleCounts, state.playerAccumDt)
  assertEqual(env.log.physics.length, 0, 'physics ran')
  assertClose(state.playerAccumDt.get(1), 0.02, 'accumulated dt')
  assertEqual(state.playerIdleCounts.get(1), 1, 'idle count')
})

gate('negative control: a resting player on a divisor tick with no idle history runs physics', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  const state = createMovementState()
  stepPlayerMovement(player, env.deps, 2, 0.02, state.playerIdleCounts, state.playerAccumDt)
  assertEqual(env.log.physics.length, 1, 'physics calls')
  assertClose(env.log.physics[0][1], 0.02, 'dt')
})

gate('a teleport hold suppresses movement and clears the idle and accumulator state', () => {
  const env = makeEnv({ stepTeleportHold: () => true })
  const player = makePlayer(1, { teleportHold: {} })
  const state = createMovementState()
  state.playerIdleCounts.set(1, 4)
  state.playerAccumDt.set(1, 0.01)
  stepPlayerMovement(player, env.deps, 1, 1 / 60, state.playerIdleCounts, state.playerAccumDt)
  assertEqual(env.log.applied.length, 0, 'movement applied')
  assertEqual(env.log.physics.length, 0, 'physics ran')
  assertEqual(state.playerIdleCounts.has(1), false, 'idle state kept')
  assertEqual(state.playerAccumDt.has(1), false, 'accumulator kept')
})

gate('negative control: a released teleport hold lets movement run', () => {
  const env = makeEnv({ stepTeleportHold: () => false })
  const player = makePlayer(1, { teleportHold: {} })
  const state = createMovementState()
  stepPlayerMovement(player, env.deps, 1, 1 / 60, state.playerIdleCounts, state.playerAccumDt)
  assertEqual(env.log.applied.length, 1, 'movement applied')
})

gate('rotation takes the half-angle sine and cosine of yaw and copies look, crouch and expression', () => {
  const env = makeEnv()
  const player = makePlayer(1, { lastInput: { yaw: 1, crouch: true, pitch: 0.3, expr: 2 } })
  stepPlayerMovement(player, env.deps, 1, 1 / 60, new Map(), new Map())
  const st = player.state
  assertClose(st.rotation[1], Math.sin(0.5), 'sine half')
  assertClose(st.rotation[3], Math.cos(0.5), 'cosine half')
  assertEqual([st.rotation[0], st.rotation[2]], [0, 0], 'pitch and roll axes')
  assertEqual([st.crouch, st.lookPitch, st.lookYaw, st.expr], [1, 0.3, 1, 2], 'look, crouch, expression')
})

gate('negative control: a player with no input keeps its rotation and crouch', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  stepPlayerMovement(player, env.deps, 1, 1 / 60, new Map(), new Map())
  assertEqual(player.state.rotation, [0, 0, 0, 1], 'rotation changed')
  assertEqual(player.state.crouch, 0, 'crouch changed')
})

gate('recordPlayerTick sets the crouch and swimming wire bits', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  player.state.crouch = 1
  player.state.swimming = true
  recordPlayerTick(player, env.deps, 1)
  assertEqual(env.log.updates[0][7], constants.CROUCH_WIRE_BIT | constants.SWIMMING_WIRE_BIT, 'flags')
})

gate('negative control: crouch alone and no flags give their own bits', () => {
  const env = makeEnv()
  const crouching = makePlayer(1)
  crouching.state.crouch = 1
  recordPlayerTick(crouching, env.deps, 1)
  const plain = makePlayer(2)
  recordPlayerTick(plain, env.deps, 1)
  assertEqual(env.log.updates[0][7], 1, 'crouch only')
  assertEqual(env.log.updates[1][7], 0, 'no flags')
})

gate('recordPlayerTick clamps velocity above the envelope and logs one clamp event', () => {
  const env = makeEnv({ defaultMovement: { maxSpeed: 10 } })
  const player = makePlayer(1)
  player.state.velocity = [100, 0, 0]
  recordPlayerTick(player, env.deps, 1)
  assertClose(player.state.velocity[0], 30, 'clamped speed')
  assertEqual(env.log.events.map(([name]) => name), ['anticheat_envelope_clamp'], 'events')
})

gate('negative control: velocity under the envelope is untouched and logs nothing', () => {
  const env = makeEnv({ defaultMovement: { maxSpeed: 10 } })
  const player = makePlayer(1)
  player.state.velocity = [5, 0, 0]
  recordPlayerTick(player, env.deps, 1)
  assertEqual(player.state.velocity, [5, 0, 0], 'velocity changed')
  assertEqual(env.log.events.length, 0, 'event logged')
})

gate('recordPlayerTick forwards position and pose to the lag compensator and ring writer', () => {
  const env = makeEnv()
  const player = makePlayer(1)
  player.state.position = [1, 2, 3]
  recordPlayerTick(player, env.deps, 9)
  assertEqual(env.log.lag[0], [1, [1, 2, 3], [0, 0, 0, 1], [0, 0, 0], 9], 'lag call')
  assertEqual(env.log.ring[0], [1, [1, 2, 3], [0, 0, 0, 1], [0, 0, 0]], 'ring write')
})

gate('negative control: without a ring writer nothing is written and no error is raised', () => {
  const env = makeEnv({ withRing: false })
  const player = makePlayer(1)
  recordPlayerTick(player, env.deps, 1)
  assertEqual(env.log.ring.length, 0, 'ring writes')
  assertEqual(env.log.lag.length, 1, 'lag calls')
})

gate('the real LagCompensator records a sample through processPlayerMovement', () => {
  const lagCompensator = new LagCompensator(1000, 60, () => 0)
  lagCompensator.beginTick(5)
  const env = makeEnv({ lagCompensator })
  const player = makePlayer(1)
  runMovement(env, [player], 5, createMovementState(), 1 / 60, new Map([[1, { forward: true, yaw: 0 }]]))
  assertEqual(lagCompensator.playerHistory.get(1).len, 1, 'samples recorded')
})

gate('negative control: the real LagCompensator refuses a non-finite tick', () => {
  const lagCompensator = new LagCompensator(1000, 60, () => 0)
  lagCompensator.beginTick(5)
  const env = makeEnv({ lagCompensator })
  let refused = null
  try {
    runMovement(env, [makePlayer(1)], Number.NaN, createMovementState(), 1 / 60, new Map([[1, { forward: true, yaw: 0 }]]))
  } catch (error) {
    refused = error
  }
  assert(refused instanceof RangeError, 'non-finite tick was accepted')
})

gate('catch-up runs while the buffer is deeper than INPUT_BUFFER_CATCHUP_DEPTH and the budget allows', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(10)]]), clock: () => 1000 })
  const player = makePlayer(1, { inputBudgetAt: 1000, inputStepBudget: 5 })
  runMovement(env, [player], 1, createMovementState())
  assertEqual(player.inputCatchUps, 1, 'catch-ups')
  assertEqual(player.inputBufferDepth, 8, 'depth')
  assertEqual(player.ackSequence, 2, 'ack')
  assertClose(player.inputStepBudget, 3, 'budget')
})

gate('negative control: a buffer at the catch-up depth or an exhausted budget takes no catch-up step', () => {
  const shallow = makeEnv({ queues: new Map([[1, queueOf(8)]]), clock: () => 1000 })
  const shallowPlayer = makePlayer(1, { inputBudgetAt: 1000, inputStepBudget: 10 })
  runMovement(shallow, [shallowPlayer], 1, createMovementState())
  assertEqual(shallowPlayer.inputCatchUps, undefined, 'catch-up at depth 8')
  const broke = makeEnv({ queues: new Map([[1, queueOf(10)]]), clock: () => 1000 })
  const brokePlayer = makePlayer(1, { inputBudgetAt: 1000, inputStepBudget: 0 })
  runMovement(broke, [brokePlayer], 1, createMovementState())
  assertEqual(brokePlayer.inputCatchUps, undefined, 'catch-up with no budget')
})

gate('catch-up is capped at MAX_CATCHUP_STEPS_PER_TICK per tick', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(20)]]), clock: () => 1000 })
  const player = makePlayer(1, { inputBudgetAt: 1000, inputStepBudget: 10 })
  runMovement(env, [player], 1, createMovementState())
  assertEqual(player.inputCatchUps, constants.MAX_CATCHUP_STEPS_PER_TICK, 'catch-ups')
  assertEqual(player.inputBufferDepth, 16, 'depth')
  assertEqual(player.ackSequence, 4, 'ack')
})

gate('negative control: a small budget limits catch-up below the per-tick cap', () => {
  const env = makeEnv({ queues: new Map([[1, queueOf(20)]]), clock: () => 1000 })
  const player = makePlayer(1, { inputBudgetAt: 1000, inputStepBudget: 2 })
  runMovement(env, [player], 1, createMovementState())
  assertEqual(player.inputCatchUps, 1, 'catch-ups')
  assertClose(player.inputStepBudget, 0, 'budget left')
})

gate('snapshotMovementState copies the idle and accumulator maps and restoreMovementState replaces them', () => {
  const state = createMovementState()
  state.playerIdleCounts.set(1, 3)
  state.playerAccumDt.set(1, 0.02)
  const snapshot = snapshotMovementState(state)
  state.playerIdleCounts.set(1, 9)
  state.playerAccumDt.delete(1)
  restoreMovementState(state, snapshot)
  assertEqual(state.playerIdleCounts.get(1), 3, 'idle count')
  assertEqual(state.playerAccumDt.get(1), 0.02, 'accumulator')
})

gate('negative control: a snapshot does not follow later live changes, and restoring null changes nothing', () => {
  const state = createMovementState()
  state.playerIdleCounts.set(1, 3)
  const snapshot = snapshotMovementState(state)
  state.playerIdleCounts.set(1, 9)
  assertEqual(snapshot.playerIdleCounts.get(1), 3, 'snapshot followed live map')
  restoreMovementState(state, null)
  assertEqual(state.playerIdleCounts.get(1), 9, 'null restore changed state')
})

gate('configuredHz takes the lower of the tick rate and a positive finite netcode snapshot rate', () => {
  const rate = (config) => createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => config }).configuredHz()
  assertEqual(rate({ snapshotRate: 20 }), 20, 'lower configured rate')
  assertEqual(rate({ snapshotRate: 120 }), 60, 'capped at tick rate')
  assertEqual(rate(undefined), 60, 'no config')
})

gate('negative control: a NaN, negative, zero or non-number snapshot rate is ignored', () => {
  const rate = (config) => createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => config }).configuredHz()
  assertEqual([rate({ snapshotRate: Number.NaN }), rate({ snapshotRate: -5 }), rate({ snapshotRate: 0 }), rate({ snapshotRate: '20' })], [60, 60, 60, 60], 'ignored values')
})

gate('the stall ladder rises to SNAP_STALL_MAX_INTERVAL after five fully starved ticks', () => {
  const controller = createSnapshotRateController({ tickRate: 60 })
  const starved = [{ id: 1, starvedTicks: 1 }]
  for (let tick = 0; tick < 4; tick++) controller.beginTick(tick, starved, true)
  assertEqual(controller.computeInterval(), 1, 'interval after four ticks')
  controller.beginTick(4, starved, true)
  assertEqual(controller.computeInterval(), constants.SNAP_STALL_MAX_INTERVAL, 'interval after five ticks')
})

gate('negative control: nobody starved keeps the stall at one, and adaptiveSnapshotRate false resets it', () => {
  const calm = createSnapshotRateController({ tickRate: 60 })
  for (let tick = 0; tick < 50; tick++) calm.beginTick(tick, [{ id: 1, starvedTicks: 0 }], true)
  assertEqual(calm.computeInterval(), 1, 'calm interval')
  const starved = [{ id: 1, starvedTicks: 1 }]
  const disabled = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ adaptiveSnapshotRate: false }) })
  for (let tick = 0; tick < 10; tick++) disabled.beginTick(tick, starved, true)
  assertEqual(disabled.computeInterval(), 1, 'disabled interval')
})

gate('the interval is recomputed every SNAP_RATE_ADJUST_INTERVAL ticks and publishes only with players and a connection', () => {
  const controller = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 20 }) })
  const players = [{ id: 1, starvedTicks: 0 }]
  assertEqual(controller.beginTick(63, players, true), null, 'early publish')
  assertEqual(controller.interval, 1, 'early interval')
  assertEqual(controller.beginTick(64, players, true), { rate: 20, tick: 64, interval: 3 }, 'published event')
  assertEqual(controller.rate, 20, 'rate')
  assertEqual(controller.beginTick(128, [], true), null, 'publish with no players')
  assertEqual(controller.interval, 3, 'interval kept')
})

gate('negative control: with no connection the interval is recomputed but the rate and event are not published', () => {
  const controller = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 20 }) })
  assertEqual(controller.beginTick(64, [{ id: 1, starvedTicks: 0 }], false), null, 'event without connection')
  assertEqual(controller.interval, 3, 'interval not recomputed')
  assertEqual(controller.rate, 60, 'rate changed without connection')
})

gate('a high snapshot cost halves the target rate and a low cost scales it by 0.75', () => {
  const high = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 20 }) })
  high.recordSnapshotCost(100)
  assertEqual(high.computeInterval(), 6, 'high cost interval')
  const low = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 20 }) })
  low.recordSnapshotCost(4)
  assertEqual(low.computeInterval(), 4, 'low cost interval')
})

gate('negative control: a zero snapshot cost keeps the configured rate', () => {
  const controller = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 20 }) })
  assertEqual(controller.computeInterval(), 3, 'interval')
})

gate('the snapshot interval never exceeds the SNAP_RATE_MIN_HZ floor', () => {
  const floor = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 1 }) })
  assertEqual(floor.computeInterval(), 8, 'floored interval')
  const starved = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 1 }) })
  for (let tick = 0; tick < 5; tick++) starved.beginTick(tick, [{ id: 1, starvedTicks: 1 }], true)
  assertEqual(starved.computeInterval(), 8, 'stalled interval')
})

gate('negative control: a full-rate configuration gives interval one', () => {
  const controller = createSnapshotRateController({ tickRate: 60, getNetcodeConfig: () => ({ snapshotRate: 60 }) })
  assertEqual(controller.computeInterval(), 1, 'interval')
})

gate('planSnapshotGroups sizes groups from the entity budget and the 50-player cap', () => {
  assertEqual(planSnapshotGroups(100, 1000, 7), { maxRecipients: 24, snapGroups: 5, curGroup: 2, clientSeq: 1 }, 'budgeted plan')
  assertEqual(planSnapshotGroups(10, 0, 3), { maxRecipients: 50, snapGroups: 1, curGroup: 0, clientSeq: 3 }, 'empty population plan')
})

gate('negative control: the 50-player cap holds at small populations, and no players gives one group', () => {
  assertEqual(planSnapshotGroups(120, 100, 0).snapGroups, 3, 'cap ignored')
  assertEqual(planSnapshotGroups(0, 1000, 5), { maxRecipients: 24, snapGroups: 1, curGroup: 0, clientSeq: 5 }, 'zero players plan')
})

gate('selectServedPlayers serves the group residue class, or everyone when asked', () => {
  const players = Array.from({ length: 10 }, (_, id) => ({ id }))
  assertEqual(selectServedPlayers(players, 3, 1, false).map((p) => p.id), [1, 4, 7], 'residue class')
  assertEqual(selectServedPlayers(players, 3, 1, true).length, 10, 'serve all')
})

gate('negative control: another group residue is not served', () => {
  const players = Array.from({ length: 10 }, (_, id) => ({ id }))
  assertEqual(selectServedPlayers(players, 3, 0, false).map((p) => p.id), [0, 3, 6, 9], 'residue class 0')
})

gate('restoreTrimmedBaselines restores each trimmed id from its previous state, or deletes it when none exists', () => {
  const sent = [[1, 'a'], [2, 'b'], [3, 'c']]
  const kept = [[1, 'a']]
  const entityMap = new Map([[1, 'a2'], [2, 'b2'], [3, 'c2']])
  restoreTrimmedBaselines(sent, kept, 0, entityMap, new Map([[2, 'b0']]))
  assertEqual([...entityMap], [[1, 'a2'], [2, 'b0']], 'restored map')
})

gate('negative control: static entries and kept ids are not restored', () => {
  const sent = [[1, 'a'], [2, 'b']]
  const entityMap = new Map([[1, 'a2'], [2, 'b2']])
  restoreTrimmedBaselines(sent, [], 1, entityMap, new Map([[1, 'a0'], [2, 'b0']]))
  assertEqual([...entityMap], [[1, 'a2'], [2, 'b0']], 'static entry restored')
})

finish()
