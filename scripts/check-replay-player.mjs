import { deepStrictEqual, doesNotThrow, ok, strictEqual, throws } from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { ReplayRecorder } from '../src/replay-pure/recorder.js'
import { ReplayPlayer } from '../src/replay-pure/player.js'
import { decodeReplay } from '../src/replay/file.js'

const FIXED_CLOCK = 1700000000000

const makeTickSystem = () => {
  const system = {
    currentTick: 0,
    callbacks: [],
    stopped: false,
    onTick(callback) { system.callbacks.push(callback) },
    stop() { system.stopped = true },
    fire(tick, dt) { for (const callback of system.callbacks) callback(tick, dt) },
  }
  return system
}

const makePlayerManager = () => {
  const received = []
  return {
    received,
    addInput(playerId, input, sequence) { received.push({ playerId, input, sequence }) },
  }
}

const recordSession = ({ firstTick = 3, lastTick = 8, collisionSteps = 2, fireTicks = true, eventLog = null } = {}) => {
  const playerManager = makePlayerManager()
  const tickSystem = makeTickSystem()
  const recorder = new ReplayRecorder({ playerManager, tickSystem, eventLog, worldName: 'arena', tickRate: 60, collisionSteps, clock: () => FIXED_CLOCK })
  recorder.registerPlayer('p1', 'Ana', { position: [1, 2, 3], rotation: [0, 0, 0, 1], health: 90 })
  recorder.start()
  for (let tick = firstTick; tick <= lastTick; tick++) {
    tickSystem.currentTick = tick
    if (fireTicks) tickSystem.fire(tick, 1 / 60)
    if (tick === firstTick + 1) playerManager.addInput('p1', { buttons: 1, x: 0.5 }, 1)
    if (tick === firstTick + 3) playerManager.addInput('p1', { buttons: 2, x: 2 ** 40 })
  }
  return recorder.stop()
}

const replayFor = (options) => recordSession(options)

const makeServer = ({ loadFails = false, stopThrows = false } = {}) => {
  const trace = []
  const players = new Map()
  const stepCalls = []
  let nextId = 100
  const tickSystem = {
    currentTick: 0,
    callbacks: [],
    stopped: false,
    stop() { tickSystem.stopped = true },
  }
  const physics = {
    step(dt, collisionSteps) { stepCalls.push({ dt, collisionSteps }) },
  }
  const server = {
    trace,
    stepCalls,
    tickSystem,
    physics,
    loadCalls: [],
    startCount: 0,
    stopCount: 0,
    async loadWorld(def) {
      server.loadCalls.push(def)
      if (loadFails) throw new Error('world load failed')
    },
    async start() { server.startCount++ },
    stop() {
      server.stopCount++
      if (stopThrows) throw new Error('stop broke')
    },
    playerManager: {
      addPlayer(socket, spec) {
        const id = nextId++
        players.set(id, { state: { position: [...spec.position], rotation: [...spec.rotation], velocity: [0, 0, 0], health: spec.health } })
        trace.push({ kind: 'addPlayer', id, name: spec.name })
        return id
      },
      addInput(id, data, sequence) { trace.push({ kind: 'input', id, tick: tickSystem.currentTick, data, sequence }) },
      getPlayer(id) { return players.get(id) },
    },
    networkState: {
      addPlayer(id, spec) { trace.push({ kind: 'net', id, position: spec.position }) },
    },
    physicsIntegration: {
      addPlayerCollider(id, radius) { trace.push({ kind: 'collider', id, radius }) },
      setPlayerPosition(id, position) { trace.push({ kind: 'setPosition', id, position }) },
    },
  }
  tickSystem.callbacks.push((tick, dt) => {
    trace.push({ kind: 'tick', tick, dt, currentTick: tickSystem.currentTick })
    if (tick === 5) for (const player of players.values()) player.state.position = [7, 8, 9]
    physics.step(dt)
  })
  return server
}

const makeHarness = ({ loadFails = false, stopThrows = false } = {}) => {
  const servers = []
  const configs = []
  const logged = []
  const createServer = async (config) => {
    configs.push(config)
    const server = makeServer({ loadFails, stopThrows })
    servers.push(server)
    return server
  }
  const scheduler = {
    immediate: (callback) => callback(),
    after: (callback) => {
      servers.at(-1).tickSystem.currentTick++
      callback()
    },
  }
  return { servers, configs, logged, createServer, scheduler, logError: (...args) => logged.push(args.join(' ')) }
}

const settle = async (promise) => {
  try {
    return { value: await promise }
  } catch (error) {
    return { error }
  }
}

const worldDef = {}

const runReplay = async ({ bytes = replayFor(), def = worldDef, sdkConfig, clocked = false, loadFails = false, stopThrows = false, extraTicks }) => {
  const harness = makeHarness({ loadFails, stopThrows })
  const seenTicks = []
  const player = new ReplayPlayer({
    createServer: harness.createServer,
    worldDef: def,
    replayBuf: bytes,
    sdkConfig,
    scheduler: clocked ? harness.scheduler : undefined,
    logError: harness.logError,
  })
  const outcome = await settle(player.play({ extraTicks, onTick: (tick) => seenTicks.push(tick) }))
  return { harness, player, seenTicks, outcome, server: harness.servers[0] }
}

const exact = await runReplay({ extraTicks: 3 })
const sdk = await runReplay({ sdkConfig: { tickRate: 30, realm: 'x' }, extraTicks: 0 })
const capsule = await runReplay({ def: { player: { capsuleRadius: 0.7 } }, extraTicks: 0 })
const collision3 = await runReplay({ bytes: replayFor({ collisionSteps: 3 }), extraTicks: 0 })
const silent = await runReplay({ bytes: replayFor({ fireTicks: false }), clocked: true, extraTicks: 2 })
const failing = await runReplay({ loadFails: true, stopThrows: true, extraTicks: 0 })
const longRun = await runReplay({ bytes: replayFor({ firstTick: 0, lastTick: 99 }), extraTicks: 5 })

const stepsOfExact = exact.server.stepCalls.map((call) => call.collisionSteps)
const stepCountOfExact = exact.server.stepCalls.length
exact.server.physics.step(1)
const stepCallAfterRestore = exact.server.stepCalls.at(-1).collisionSteps

const stopsBeforePlayerStop = exact.server.stopCount
await exact.player.stop()
const stopsAfterFirstStop = exact.server.stopCount
await exact.player.stop()
const stopsAfterSecondStop = exact.server.stopCount

const failedLoad = await runReplay({ loadFails: true, extraTicks: 0 })
const failedLoadStopsAfterLoad = failedLoad.server.stopCount
await failedLoad.player.stop()
const failedLoadStopsAfterPlayerStop = failedLoad.server.stopCount

const tickEntriesOfExact = exact.server.trace.filter((entry) => entry.kind === 'tick')
const inputEntriesOfExact = exact.server.trace.filter((entry) => entry.kind === 'input')
const tickEntriesOfSilent = silent.server.trace.filter((entry) => entry.kind === 'tick')
const inputEntriesOfSilent = silent.server.trace.filter((entry) => entry.kind === 'input')

gate('recorder refuses a playerManager without addInput and a missing tickSystem', () => {
  const tickSystem = makeTickSystem()
  throws(() => new ReplayRecorder({ tickSystem }), /requires a real playerManager/)
  throws(() => new ReplayRecorder({ playerManager: {}, tickSystem }), /requires a real playerManager/)
  throws(() => new ReplayRecorder({ playerManager: makePlayerManager() }), /requires a real tickSystem/)
  doesNotThrow(() => new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem }))
})

gate('start records each input with its tick, sequence and data, and forwards it', () => {
  const playerManager = makePlayerManager()
  const tickSystem = makeTickSystem()
  const recorder = new ReplayRecorder({ playerManager, tickSystem, clock: () => FIXED_CLOCK })
  recorder.start()
  tickSystem.currentTick = 3
  playerManager.addInput('p1', { buttons: 1 }, 7)
  tickSystem.currentTick = 4
  playerManager.addInput('p2', { buttons: 2 }, 0)
  strictEqual(recorder.inputCount, 2)
  deepStrictEqual(playerManager.received, [
    { playerId: 'p1', input: { buttons: 1 }, sequence: 7 },
    { playerId: 'p2', input: { buttons: 2 }, sequence: 0 },
  ])
  const replay = decodeReplay(recorder.stop())
  deepStrictEqual(replay.inputs, [
    { tick: 3, playerId: 'p1', sequence: 7, data: { buttons: 1 } },
    { tick: 4, playerId: 'p2', sequence: 0, data: { buttons: 2 } },
  ])
})

gate('an input without a sequence is recorded as null and sequence zero is kept', () => {
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  recorder.start()
  playerManager.addInput('p1', {})
  playerManager.addInput('p1', {}, 0)
  const replay = decodeReplay(recorder.stop())
  deepStrictEqual(replay.inputs.map((input) => input.sequence), [null, 0])
})

gate('addInput is forwarded but not recorded outside a recording', () => {
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  playerManager.addInput('p1', { buttons: 1 }, 1)
  strictEqual(recorder.inputCount, 0)
  recorder.start()
  playerManager.addInput('p1', { buttons: 2 }, 2)
  recorder.stop()
  playerManager.addInput('p1', { buttons: 3 }, 3)
  strictEqual(recorder.inputCount, 1)
  strictEqual(playerManager.received.length, 3)
})

gate('a second start while recording does not record an input twice', () => {
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  recorder.start()
  recorder.start()
  playerManager.addInput('p1', {}, 1)
  strictEqual(recorder.inputCount, 1)
  strictEqual(playerManager.received.length, 1)
})

gate('ticks are recorded only while recording', () => {
  const tickSystem = makeTickSystem()
  const recorder = new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem, clock: () => FIXED_CLOCK })
  tickSystem.fire(1, 1 / 60)
  strictEqual(recorder.tickCount, 0)
  recorder.start()
  tickSystem.fire(2, 1 / 60)
  tickSystem.fire(3, 1 / 60)
  strictEqual(recorder.tickCount, 2)
  const bytes = recorder.stop()
  tickSystem.fire(4, 1 / 60)
  strictEqual(recorder.tickCount, 2)
  deepStrictEqual(decodeReplay(bytes).ticks.map((entry) => entry.tick), [2, 3])
})

gate('header start and end ticks come from the first and last recorded input', () => {
  const header = decodeReplay(replayFor()).header
  strictEqual(header.startTick, 4)
  strictEqual(header.endTick, 6)
  const emptyRecorder = new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  emptyRecorder.start()
  const emptyHeader = decodeReplay(emptyRecorder.stop()).header
  deepStrictEqual([emptyHeader.startTick, emptyHeader.endTick], [0, 0])
})

gate('stop writes the constructor options and the clock read at start', () => {
  let now = 42
  const recorder = new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem: makeTickSystem(), worldName: 'arena', tickRate: 30, collisionSteps: 3, clock: () => now })
  recorder.start()
  now = 99
  const header = decodeReplay(recorder.stop()).header
  deepStrictEqual(
    { worldName: header.worldName, tickRate: header.tickRate, collisionSteps: header.collisionSteps, recordedAt: header.recordedAt },
    { worldName: 'arena', tickRate: 30, collisionSteps: 3, recordedAt: 42 },
  )
})

gate('the defaults are unknown, 60, 2 and a Date.now reading taken at start', () => {
  const before = Date.now()
  const recorder = new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem: makeTickSystem() })
  recorder.start()
  const header = decodeReplay(recorder.stop()).header
  const after = Date.now()
  deepStrictEqual({ worldName: header.worldName, tickRate: header.tickRate, collisionSteps: header.collisionSteps }, { worldName: 'unknown', tickRate: 60, collisionSteps: 2 })
  ok(header.recordedAt >= before && header.recordedAt <= after)
})

gate('a registered player keeps a copy of its spawn and gets the defaults', () => {
  const recorder = new ReplayRecorder({ playerManager: makePlayerManager(), tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  const spawn = { position: [1, 2, 3], rotation: [0, 1, 0, 0], health: 55 }
  recorder.registerPlayer('p1')
  recorder.registerPlayer('p2', 'Ana', spawn)
  spawn.position[0] = 9
  recorder.start()
  const header = decodeReplay(recorder.stop()).header
  deepStrictEqual(header.players, [
    { id: 'p1', name: 'Player p1', spawn: { position: [0, 0, 0], rotation: [0, 0, 0, 1], health: 100 } },
    { id: 'p2', name: 'Ana', spawn: { position: [1, 2, 3], rotation: [0, 1, 0, 0], health: 55 } },
  ])
})

gate('events come from an event log that has _toArray and are empty otherwise', () => {
  const withLog = decodeReplay(recordSession({ eventLog: { _toArray: () => [{ tick: 2, kind: 'spawn' }] } }))
  deepStrictEqual(withLog.events, [{ tick: 2, kind: 'spawn' }])
  const withoutToArray = decodeReplay(recordSession({ eventLog: { other: 1 } }))
  deepStrictEqual(withoutToArray.events, [])
  const withoutLog = decodeReplay(recordSession())
  deepStrictEqual(withoutLog.events, [])
})

gate('stop returns null when not recording and restores addInput', () => {
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem: makeTickSystem(), clock: () => FIXED_CLOCK })
  strictEqual(recorder.stop(), null)
  recorder.start()
  playerManager.addInput('p1', {}, 1)
  const bytes = recorder.stop()
  ok(bytes instanceof Uint8Array)
  strictEqual(recorder.stop(), null)
  playerManager.addInput('p1', {}, 2)
  strictEqual(recorder.inputCount, 1)
  strictEqual(playerManager.received.length, 2)
})

gate('the getters report recording, inputCount and tickCount', () => {
  const tickSystem = makeTickSystem()
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem, clock: () => FIXED_CLOCK })
  strictEqual(recorder.recording, false)
  recorder.start()
  strictEqual(recorder.recording, true)
  playerManager.addInput('p1', {}, 1)
  tickSystem.fire(1, 1 / 60)
  strictEqual(recorder.inputCount, 1)
  strictEqual(recorder.tickCount, 1)
  recorder.stop()
  strictEqual(recorder.recording, false)
})

gate('player refuses a missing createServer, a missing worldDef and bytes that are not a replay', () => {
  const bytes = replayFor()
  const { createServer } = makeHarness()
  throws(() => new ReplayPlayer({ worldDef, replayBuf: bytes }), /requires createServer/)
  throws(() => new ReplayPlayer({ createServer, replayBuf: bytes }), /requires worldDef/)
  throws(() => new ReplayPlayer({ createServer, worldDef, replayBuf: Uint8Array.from([1, 2, 3]) }), RangeError)
  const corrupt = Uint8Array.from(bytes)
  const at = Buffer.from(corrupt).indexOf(Buffer.from('spointreplay'))
  ok(at >= 0)
  corrupt[at] ^= 1
  throws(() => new ReplayPlayer({ createServer, worldDef, replayBuf: corrupt }), /bad magic/)
  doesNotThrow(() => new ReplayPlayer({ createServer, worldDef, replayBuf: bytes }))
})

gate('player header is the header the recorder wrote', () => {
  const player = new ReplayPlayer({ createServer: makeHarness().createServer, worldDef, replayBuf: replayFor() })
  strictEqual(player.header.worldName, 'arena')
  strictEqual(player.header.startTick, 4)
  strictEqual(player.header.endTick, 6)
  strictEqual(player.header.recordedAt, FIXED_CLOCK)
  deepStrictEqual(player.header.players, [{ id: 'p1', name: 'Ana', spawn: { position: [1, 2, 3], rotation: [0, 0, 0, 1], health: 90 } }])
})

gate('createServer gets the replay tick rate, and sdkConfig overrides it', () => {
  deepStrictEqual(exact.harness.configs, [{ tickRate: 60 }])
  deepStrictEqual(sdk.harness.configs, [{ tickRate: 30, realm: 'x' }])
})

gate('loadWorld gets the worldDef object and each player is re-added with its spawn and name', () => {
  strictEqual(exact.server.loadCalls.length, 1)
  ok(exact.server.loadCalls[0] === worldDef)
  deepStrictEqual(exact.server.trace.filter((entry) => entry.kind === 'addPlayer' || entry.kind === 'net'), [
    { kind: 'addPlayer', id: 100, name: 'Ana' },
    { kind: 'net', id: 100, position: [1, 2, 3] },
  ])
})

gate('the collider radius comes from worldDef.player.capsuleRadius with the spoint default 0.4', () => {
  deepStrictEqual(exact.server.trace.filter((entry) => entry.kind === 'collider'), [{ kind: 'collider', id: 100, radius: 0.4 }])
  deepStrictEqual(capsule.server.trace.filter((entry) => entry.kind === 'collider'), [{ kind: 'collider', id: 100, radius: 0.7 }])
})

gate('inputs are delivered before the tick they were recorded at sets currentTick, a null sequence is passed as undefined', () => {
  deepStrictEqual(inputEntriesOfExact, [
    { kind: 'input', id: 100, tick: 3, data: { buttons: 1, x: 0.5 }, sequence: 1 },
    { kind: 'input', id: 100, tick: 5, data: { buttons: 2, x: 2 ** 40 }, sequence: undefined },
  ])
})

gate('every recorded tick and extra tick runs once with its dt, and onTick sees each tick', () => {
  deepStrictEqual(tickEntriesOfExact.map((entry) => entry.tick), [3, 4, 5, 6, 7, 8, 9])
  ok(tickEntriesOfExact.every((entry) => entry.dt === 1 / 60 && entry.currentTick === entry.tick))
  deepStrictEqual(exact.seenTicks, [3, 4, 5, 6, 7, 8, 9])
})

gate('the exact path stops the tick system and runs the physics step with the recorded collision steps, then restores it', () => {
  ok(exact.server.tickSystem.stopped === true)
  strictEqual(stepCountOfExact, 7)
  deepStrictEqual(stepsOfExact, [2, 2, 2, 2, 2, 2, 2])
  deepStrictEqual(collision3.server.stepCalls.map((call) => call.collisionSteps), [3, 3, 3, 3, 3, 3])
  strictEqual(stepCallAfterRestore, undefined)
})

gate('finalStates reads each live player state by original id, and ticksRun is the end tick plus extra ticks', () => {
  const result = exact.outcome.value
  deepStrictEqual(result.finalStates.get('p1'), { position: [7, 8, 9], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], health: 90 })
  strictEqual(result.ticksRun, 9)
  strictEqual(result.idMap.get('p1'), 100)
  strictEqual(result.dtExact, true)
  strictEqual(sdk.outcome.value.ticksRun, 8)
})

gate('with no tick records the play runs on the scheduler and does not call the tick callbacks', () => {
  const result = silent.outcome.value
  strictEqual(result.dtExact, false)
  deepStrictEqual(silent.seenTicks, [0, 1, 2, 3, 4, 5, 6, 7, 8])
  strictEqual(result.ticksRun, 8)
  deepStrictEqual(tickEntriesOfSilent, [])
  deepStrictEqual(inputEntriesOfSilent.map((entry) => entry.tick), [4, 6])
  ok(silent.server.tickSystem.stopped === false)
})

gate('the default scheduler completes a 100-tick replay with its tick callbacks', () => {
  const result = longRun.outcome.value
  strictEqual(result.dtExact, true)
  strictEqual(result.ticksRun, 99)
  strictEqual(longRun.server.trace.filter((entry) => entry.kind === 'tick').length, 100)
  strictEqual(longRun.seenTicks.length, 100)
})

gate('a failed world load stops the server, logs a failing stop and rethrows the load error', () => {
  ok(failing.outcome.error instanceof Error)
  strictEqual(failing.outcome.error.message, 'world load failed')
  strictEqual(failing.server.stopCount, 1)
  deepStrictEqual(failing.harness.logged, ['[replay] stop after a failed world load failed: stop broke'])
})

gate('player stop calls the server stop once and clears the server', () => {
  strictEqual(stopsBeforePlayerStop, 0)
  strictEqual(stopsAfterFirstStop, 1)
  strictEqual(stopsAfterSecondStop, 1)
})

gate('a failed world load stops the server once in play, and a later player stop stops it again', () => {
  strictEqual(failedLoadStopsAfterLoad, 1)
  strictEqual(failedLoadStopsAfterPlayerStop, 2)
})

gate('a restarted recording keeps the first session start tick and seen players', () => {
  const tickSystem = makeTickSystem()
  const playerManager = makePlayerManager()
  const recorder = new ReplayRecorder({ playerManager, tickSystem, clock: () => FIXED_CLOCK })
  recorder.start()
  tickSystem.currentTick = 4
  tickSystem.fire(4, 1 / 60)
  playerManager.addInput('p1', {}, 1)
  recorder.registerPlayer('p1', 'one', null)
  recorder.stop()
  recorder.start()
  tickSystem.currentTick = 20
  tickSystem.fire(20, 1 / 60)
  playerManager.addInput('p2', {}, 1)
  recorder.registerPlayer('p2', 'two', null)
  const restarted = decodeReplay(recorder.stop())
  strictEqual(restarted.header.startTick, 4)
  strictEqual(restarted.header.endTick, 20)
  deepStrictEqual(restarted.inputs.map((entry) => entry.tick), [20])
  deepStrictEqual(restarted.header.players.map((player) => player.id), ['p1', 'p2'])
})

gate('a successful play logs nothing and reports no error', () => {
  strictEqual(exact.outcome.error, undefined)
  deepStrictEqual(exact.harness.logged, [])
})

finish()
