import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { canonicalJSON } from '../src/rollback-pure/canonicalJSON.js'
import { ROLLBACK_DEFAULTS } from '../src/rollback-pure/rollbackGameLoop.js'
import { createFrameClock } from '../src/control-frame-pure/controlFrame.js'
import { LOCKSTEP_CTRL_PREFIX, dispatchLockstepFrame, encodeLockstepFrame, lockstepFrameArms, parseLockstepFrame } from '../src/lockstep-pure/lockstepFrame.js'
import { LockstepInputTransport } from '../src/lockstep-pure/lockstepInputTransport.js'
import { INPUT_RETAIN_TICKS, LOCKSTEP_DEFAULTS, createLockstepGameLoop } from '../src/lockstep-pure/lockstepGameLoop.js'
import { LOCKSTEP_TICK_ERROR_TAG, lockstepDtSeconds } from '../src/lockstep-pure/lockstepTickSystem.js'
import { buildLockstepPeerLoop } from '../src/lockstep-pure/peerLoops.js'
import { NETCODE_PROFILES, resolveNetcodeProfile } from '../src/lockstep-pure/netcodeProfile.js'
import { createPeerSimSession } from '../src/lockstep-pure/peerSimSession.js'

const here = dirname(fileURLToPath(import.meta.url))
const sourceDir = join(here, '..', 'src', 'lockstep-pure')

const refuses = (fn) => {
  try {
    fn()
  } catch {
    return true
  }
  return false
}

const errorOf = (fn) => {
  try {
    fn()
  } catch (error) {
    return error.message
  }
  return null
}

const fakeTickSystem = () => {
  let handler = null
  const state = { started: false, stopped: false }
  return {
    state,
    onTick(fn) { handler = fn },
    start() { state.started = true },
    stop() { state.stopped = true },
    fire(dt = 1 / 60) { handler(0, dt) },
  }
}

const fakeBridge = (pubkey) => {
  const sent = []
  const data = Object.assign(new EventTarget(), { broadcast(text) { sent.push(text); return 1 } })
  return { pubkey, data, sent }
}

const deliverText = (bridge, peerPubkey, text) => bridge.data.dispatchEvent(new CustomEvent('data', { detail: { data: text, peerPubkey } }))

const deliverFrame = (bridge, peerPubkey, frame) => deliverText(bridge, peerPubkey, LOCKSTEP_CTRL_PREFIX + JSON.stringify(frame))

const sentFrames = (bridge) => bridge.sent.filter(text => text.startsWith(LOCKSTEP_CTRL_PREFIX)).map(text => JSON.parse(text.slice(LOCKSTEP_CTRL_PREFIX.length)))

const feed = (env, peer, tick, input = null, adv = 1000) => deliverFrame(env.bridge, peer, { type: 'input', tick, input, adv })

const fire = (env, times = 1) => { for (let i = 0; i < times; i++) env.tickSystem.fire() }

const buildLoop = ({ roster = ['L', 'B'], options = {}, voter = null, getLocalInput = () => ({ buttons: 0 }), now = () => 0 } = {}) => {
  const bridge = fakeBridge('L')
  const tickSystem = fakeTickSystem()
  const transport = new LockstepInputTransport({ bridge })
  const calls = []
  const loop = createLockstepGameLoop({ tickSystem, transport, roster, localPeerId: 'L', simulate: (tick, dt, byPeer) => calls.push({ tick, dt, byPeer }), getLocalInput, now, voter, options })
  loop.start()
  return { bridge, tickSystem, transport, loop, calls }
}

const makeLoopWith = (overrides = {}) => {
  const bridge = fakeBridge('L')
  const base = {
    tickSystem: fakeTickSystem(),
    transport: new LockstepInputTransport({ bridge }),
    roster: ['L', 'B'],
    localPeerId: 'L',
    simulate: () => {},
    getLocalInput: () => null,
    now: () => 0,
  }
  return createLockstepGameLoop({ ...base, ...overrides })
}

const fakeCtx = ({ currentWorldDef = { netcode: { profile: 'lockstep' } }, worldSpawnPoints, entities = new Map() } = {}) => {
  const players = new Map()
  const queues = new Map()
  const log = { added: [], colliders: [], flushes: 0, simulated: [] }
  let nextId = 1
  const playerManager = {
    queues,
    addPlayer(socket, { position, health }) {
      const id = nextId++
      log.added.push({ id, position: [...position], health })
      players.set(id, { id, socket, state: { position: [...position], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] } })
      return id
    },
    getPlayer: (id) => players.get(id),
    getInputs: (id) => queues.get(id) ?? [],
    snapshotState: () => new Map([...players].map(([id, p]) => [id, { state: { position: [...p.state.position], velocity: [...p.state.velocity] } }])),
  }
  return {
    log,
    ctx: {
      currentWorldDef,
      worldSpawnPoints,
      playerManager,
      networkState: { addPlayer() {} },
      physicsIntegration: {
        addPlayerCollider(id, radius) { log.colliders.push({ id, radius }) },
        setPlayerPosition() {},
      },
      physics: { snapshotBodies: () => new Map() },
      lagCompensator: { recordPlayerPosition() {} },
      connections: { flushAll() { log.flushes++ } },
      handlerState: { fn(tick, dt, explicit) { log.simulated.push({ tick, dt, explicit }) } },
      appRuntime: { entities },
    },
  }
}

const sessionFixture = ({ ctxOptions = {}, roster = ['L', 'B'], localPubkey = 'L' } = {}) => {
  const { ctx, log } = fakeCtx(ctxOptions)
  const bridge = fakeBridge(localPubkey)
  const tickSystem = fakeTickSystem()
  const session = createPeerSimSession(ctx, { roster, localPubkey, bridge, tickSystem, now: () => 0 })
  return { ctx, log, bridge, tickSystem, session }
}

const consensusChecksum = (bridge, tick) => {
  for (const text of bridge.sent) {
    if (!text.startsWith('wwconsensus:')) continue
    const frame = JSON.parse(text.slice('wwconsensus:'.length))
    if (frame.tick === tick) return frame.checksum
  }
  return null
}

const SOURCE_FILES = ['lockstepFrame.js', 'lockstepGameLoop.js', 'lockstepInputTransport.js', 'lockstepTickSystem.js', 'netcodeProfile.js', 'peerLoops.js', 'peerSimSession.js']
const COMMENT_PATTERN = /\/\/|\/\*/
const EFFECT_PATTERN = /\b(setInterval|setTimeout|clearInterval|clearTimeout|Worker|WorkerBridgeProxy|postMessage|document|window|WebSocket|performance|Date)\b|node:fs|node:net/

gate('LOCKSTEP_DEFAULTS holds the spoint values and is frozen, with the retain window at 240', () => {
  assert.deepEqual({ ...LOCKSTEP_DEFAULTS }, { inputDelayTicks: 3, checksumIntervalTicks: 30, stallTicks: 600, maxCatchUpTicks: 4 })
  assert.equal(Object.isFrozen(LOCKSTEP_DEFAULTS), true)
  assert.equal(INPUT_RETAIN_TICKS, 240)
})

gate('control: a stallTicks of 599 does not match the spoint defaults', () => {
  assert.equal(refuses(() => assert.deepEqual({ ...LOCKSTEP_DEFAULTS, stallTicks: 599 }, { inputDelayTicks: 3, checksumIntervalTicks: 30, stallTicks: 600, maxCatchUpTicks: 4 })), true)
})

gate('the loop refuses a missing tick system, a bad input delay, a bad catch-up cap and a missing clock', () => {
  assert.equal(errorOf(() => makeLoopWith({ tickSystem: null })), '[LockstepGameLoop] tickSystem is required')
  assert.equal(errorOf(() => makeLoopWith({ options: { inputDelayTicks: 0 } })), '[LockstepGameLoop] inputDelayTicks must be >= 1: tick t can only run once every peer input for t has arrived')
  assert.match(errorOf(() => makeLoopWith({ options: { inputDelayTicks: 241 } })), /^\[LockstepGameLoop\] inputDelayTicks \(241\) must be <= INPUT_RETAIN_TICKS \(240\)/)
  assert.equal(errorOf(() => makeLoopWith({ options: { maxCatchUpTicks: 0 } })), '[LockstepGameLoop] maxCatchUpTicks must be >= 1')
  assert.equal(errorOf(() => makeLoopWith({ now: undefined })), '[LockstepGameLoop] now() clock is required')
})

gate('control: an input delay of exactly 240 is accepted', () => {
  assert.equal(errorOf(() => makeLoopWith({ options: { inputDelayTicks: 240 } })), null)
})

gate('the transport refuses a bridge without a data channel', () => {
  assert.equal(refuses(() => new LockstepInputTransport({ bridge: { pubkey: 'L' } })), true)
})

gate('control: a bridge with a data channel is accepted by the transport', () => {
  assert.equal(refuses(() => new LockstepInputTransport({ bridge: fakeBridge('L') })), false)
})

gate('NETCODE_PROFILES lists authoritative, rollback and lockstep in spoint order', () => {
  assert.deepEqual([...NETCODE_PROFILES], ['authoritative', 'rollback', 'lockstep'])
})

gate('control: a profile list without rollback does not match', () => {
  assert.equal(refuses(() => assert.deepEqual([...NETCODE_PROFILES], ['authoritative', 'lockstep'])), true)
})

gate('the default profile is authoritative, not peer-simulated, with two minimum peers', () => {
  assert.deepEqual(resolveNetcodeProfile(undefined), { name: 'authoritative', options: {}, peerSimulated: false, minPeers: 2 })
})

gate('control: the lockstep profile reads as peer-simulated', () => {
  assert.equal(resolveNetcodeProfile({ netcode: { profile: 'lockstep' } }).peerSimulated, true)
})

gate('the lockstep profile merges a per-profile override over LOCKSTEP_DEFAULTS', () => {
  const resolved = resolveNetcodeProfile({ netcode: { profile: 'lockstep', lockstep: { stallTicks: 900 } } })
  assert.deepEqual(resolved.options, { ...LOCKSTEP_DEFAULTS, stallTicks: 900 })
  assert.equal(resolved.peerSimulated, true)
})

gate('control: an override does not change the shared defaults for the next resolve', () => {
  resolveNetcodeProfile({ netcode: { profile: 'lockstep', lockstep: { stallTicks: 900 } } })
  assert.deepEqual(resolveNetcodeProfile({ netcode: { profile: 'lockstep' } }).options, LOCKSTEP_DEFAULTS)
  assert.equal(LOCKSTEP_DEFAULTS.stallTicks, 600)
})

gate('a negative lockstep knob is refused with the netcode message', () => {
  assert.throws(() => resolveNetcodeProfile({ netcode: { profile: 'lockstep', lockstep: { inputDelayTicks: -1 } } }), { message: '[netcode] lockstep.inputDelayTicks must be a non-negative integer, got -1' })
})

gate('control: an input delay of 0 passes the profile check (the loop applies its own floor)', () => {
  assert.equal(resolveNetcodeProfile({ netcode: { profile: 'lockstep', lockstep: { inputDelayTicks: 0 } } }).options.inputDelayTicks, 0)
})

gate('an unknown profile name is refused and the message lists the known names', () => {
  assert.throws(() => resolveNetcodeProfile({ netcode: { profile: 'lockstepp' } }), { message: "[netcode] unknown netcode.profile 'lockstepp' (expected one of authoritative, rollback, lockstep)" })
})

gate('control: the lockstep profile name is accepted', () => {
  assert.equal(refuses(() => resolveNetcodeProfile({ netcode: { profile: 'lockstep' } })), false)
})

gate('a non-object netcode declaration is refused, and null counts as absent', () => {
  assert.throws(() => resolveNetcodeProfile({ netcode: 'lockstep' }), { message: '[netcode] netcode must be an object declaring profile and per-profile options, got "lockstep"' })
  assert.equal(resolveNetcodeProfile({ netcode: null }).name, 'authoritative')
})

gate('peers must be a non-negative integer, and 0 is accepted', () => {
  assert.throws(() => resolveNetcodeProfile({ netcode: { profile: 'lockstep', peers: -1 } }), { message: '[netcode] netcode.peers must be a non-negative integer, got -1' })
  assert.equal(resolveNetcodeProfile({ netcode: { profile: 'lockstep', peers: 0 } }).minPeers, 0)
})

gate('control: a fractional peer count is refused', () => {
  assert.equal(refuses(() => resolveNetcodeProfile({ netcode: { profile: 'lockstep', peers: 2.5 } })), true)
})

gate('the lockstep control prefix is wwlockstep: and encodes a tick-tagged input frame', () => {
  assert.equal(LOCKSTEP_CTRL_PREFIX, 'wwlockstep:')
  assert.equal(encodeLockstepFrame({ type: 'input', tick: 4, input: null, adv: 0 }), 'wwlockstep:{"type":"input","tick":4,"input":null,"adv":0}')
})

gate('control: a lockstep frame never carries the rollback prefix', () => {
  assert.equal(encodeLockstepFrame({ type: 'input', tick: 4, input: null, adv: 0 }).startsWith('wwrollback:'), false)
})

gate('encodeLockstepFrame refuses a kind outside the lockstep protocol', () => {
  assert.equal(refuses(() => encodeLockstepFrame({ type: 'checksum', tick: 1 })), true)
})

gate('control: an input kind is accepted by the encoder', () => {
  assert.equal(refuses(() => encodeLockstepFrame({ type: 'input', tick: 1 })), false)
})

gate('parse accepts a well-formed input frame and a well-formed drop frame', () => {
  assert.equal(parseLockstepFrame('wwlockstep:{"type":"input","tick":1,"input":null,"adv":0}').status, 'accepted')
  assert.equal(parseLockstepFrame('wwlockstep:{"type":"drop","peer":"B","have":3,"tail":[]}').status, 'accepted')
})

gate('control: a rollback-prefixed frame is a foreign prefix to the lockstep parser', () => {
  assert.deepEqual(parseLockstepFrame('wwrollback:{"type":"input","tick":1}'), { status: 'foreign-prefix' })
})

gate('an input tick of 0 is refused as an invalid tick field', () => {
  assert.deepEqual(parseLockstepFrame('wwlockstep:{"type":"input","tick":0}'), { status: 'invalid-field', kind: 'input', field: 'tick' })
})

gate('control: an input tick of 1 is the smallest accepted tick', () => {
  assert.equal(parseLockstepFrame('wwlockstep:{"type":"input","tick":1}').status, 'accepted')
})

gate('a drop frame with a non-list tail is refused', () => {
  assert.deepEqual(parseLockstepFrame('wwlockstep:{"type":"drop","peer":"B","have":3,"tail":"x"}'), { status: 'invalid-field', kind: 'drop', field: 'tail' })
})

gate('control: a drop frame with an empty tail list is accepted', () => {
  assert.equal(parseLockstepFrame('wwlockstep:{"type":"drop","peer":"B","have":3,"tail":[]}').status, 'accepted')
})

gate('a checksum kind and a malformed payload are refused without throwing', () => {
  assert.deepEqual(parseLockstepFrame('wwlockstep:{"type":"checksum","tick":30}'), { status: 'unknown-kind', kind: 'checksum' })
  assert.deepEqual(parseLockstepFrame('wwlockstep:{bad'), { status: 'malformed-payload' })
  assert.deepEqual(parseLockstepFrame('wwlockstep:null'), { status: 'malformed-payload' })
})

gate('control: a well-formed input payload is not malformed', () => {
  assert.equal(parseLockstepFrame('wwlockstep:{"type":"input","tick":2}').status, 'accepted')
})

gate('handler arms must cover exactly the input and drop kinds', () => {
  assert.equal(refuses(() => lockstepFrameArms({ input() {} })), true)
  assert.equal(refuses(() => lockstepFrameArms({ input() {}, drop() {}, checksum() {} })), true)
  assert.equal(lockstepFrameArms({ input() {}, drop() {} }).size, 2)
})

gate('dispatch refuses an unattributed frame and a self-echo, and counts each reason', () => {
  const rejects = []
  const arms = lockstepFrameArms({ input() {}, drop() {} })
  const data = 'wwlockstep:{"type":"input","tick":2,"input":null,"adv":0}'
  const clock = createFrameClock()
  assert.equal(dispatchLockstepFrame(arms, data, { from: null, selfId: 'L', clock, onReject: (r) => rejects.push(r.status) }), null)
  assert.equal(dispatchLockstepFrame(arms, data, { from: 'L', selfId: 'L', clock, onReject: (r) => rejects.push(r.status) }), null)
  assert.deepEqual(rejects, ['unattributed-sender', 'self-echo'])
})

gate('control: a frame from another peer is dispatched to its arm', () => {
  const arms = lockstepFrameArms({ input() {}, drop() {} })
  const dispatched = dispatchLockstepFrame(arms, 'wwlockstep:{"type":"input","tick":2,"input":null,"adv":0}', { from: 'B', selfId: 'L', clock: createFrameClock() })
  assert.equal(dispatched.from, 'B')
  assert.equal(dispatched.order, 'in-order')
})

gate('the frame clock orders input frames per sender and never advances on a drop frame', () => {
  const arms = lockstepFrameArms({ input() {}, drop() {} })
  const clock = createFrameClock()
  const orderOf = (text) => dispatchLockstepFrame(arms, text, { from: 'B', selfId: 'L', clock }).order
  assert.equal(orderOf('wwlockstep:{"type":"input","tick":5,"input":null,"adv":0}'), 'in-order')
  assert.equal(orderOf('wwlockstep:{"type":"input","tick":5,"input":null,"adv":0}'), 'duplicate-frame')
  assert.equal(orderOf('wwlockstep:{"type":"input","tick":4,"input":null,"adv":0}'), 'stale-frame')
  assert.equal(orderOf('wwlockstep:{"type":"drop","peer":"C","have":1,"tail":[]}'), null)
  assert.equal(clock.get('B'), 5)
})

gate('control: a higher tick from the same sender is in order and moves the clock', () => {
  const arms = lockstepFrameArms({ input() {}, drop() {} })
  const clock = createFrameClock()
  dispatchLockstepFrame(arms, 'wwlockstep:{"type":"input","tick":5,"input":null,"adv":0}', { from: 'B', selfId: 'L', clock })
  assert.equal(dispatchLockstepFrame(arms, 'wwlockstep:{"type":"input","tick":6,"input":null,"adv":0}', { from: 'B', selfId: 'L', clock }).order, 'in-order')
  assert.equal(clock.get('B'), 6)
})

gate('submitLocalInput broadcasts an input frame and counts it', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  transport.submitLocalInput(4, { buttons: 1 }, 2)
  assert.deepEqual(sentFrames(bridge), [{ type: 'input', tick: 4, input: { buttons: 1 }, adv: 2 }])
  assert.equal(transport.getStats().sent, 1)
})

gate('control: a bridge with no pubkey refuses submitLocalInput', () => {
  const transport = new LockstepInputTransport({ bridge: fakeBridge('') })
  assert.equal(refuses(() => transport.submitLocalInput(4, null)), true)
})

gate('submitDropReport broadcasts a drop frame carrying the tail, and counts it', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  transport.submitDropReport('B', 3, [[4, null]])
  assert.deepEqual(sentFrames(bridge), [{ type: 'drop', peer: 'B', have: 3, tail: [[4, null]] }])
  assert.equal(transport.getStats().dropReportsSent, 1)
})

gate('control: no drop report is counted before one is submitted', () => {
  assert.equal(new LockstepInputTransport({ bridge: fakeBridge('L') }).getStats().dropReportsSent, 0)
})

gate('a remote input reaches onRemoteInput, and a non-numeric advantage becomes 0', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  const received = []
  transport.onRemoteInput = (...args) => received.push(args)
  deliverFrame(bridge, 'B', { type: 'input', tick: 7, input: { buttons: 2 }, adv: 3 })
  deliverFrame(bridge, 'B', { type: 'input', tick: 8, input: null, adv: 'x' })
  assert.deepEqual(received, [['B', 7, { buttons: 2 }, 3], ['B', 8, null, 0]])
})

gate('control: a numeric advantage of 3 is kept, not replaced with 0', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  const received = []
  transport.onRemoteInput = (...args) => received.push(args)
  deliverFrame(bridge, 'B', { type: 'input', tick: 7, input: null, adv: 3 })
  assert.equal(received[0][3], 3)
})

gate('a remote drop reaches onRemoteDrop with the reporter, the peer, the have tick and the tail', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  const received = []
  transport.onRemoteDrop = (...args) => received.push(args)
  deliverFrame(bridge, 'C', { type: 'drop', peer: 'B', have: 2, tail: [[2, null]] })
  assert.deepEqual(received, [['C', 'B', 2, [[2, null]]]])
  assert.equal(transport.getStats().dropReportsReceived, 1)
})

gate('control: a drop report from a peer that is not the reporter is not forwarded to a different transport', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  let calls = 0
  transport.onRemoteDrop = () => { calls++ }
  deliverFrame(bridge, 'C', { type: 'drop', peer: 'B', have: 2, tail: [] })
  assert.equal(calls, 1)
})

gate('peer-close and peer-closed both reach onPeerClosed, but only with a pubkey', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  const closed = []
  transport.onPeerClosed = (pk) => closed.push(pk)
  bridge.data.dispatchEvent(new CustomEvent('peer-close', { detail: { peerPubkey: 'B' } }))
  bridge.data.dispatchEvent(new CustomEvent('peer-closed', { detail: { peerPubkey: 'C' } }))
  bridge.data.dispatchEvent(new CustomEvent('peer-closed', { detail: {} }))
  assert.deepEqual(closed, ['B', 'C'])
})

gate('control: a close event without a pubkey is not forwarded', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  let calls = 0
  transport.onPeerClosed = () => { calls++ }
  bridge.data.dispatchEvent(new CustomEvent('peer-close', { detail: {} }))
  assert.equal(calls, 0)
})

gate('destroy detaches the data listeners, so later frames are not received', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: null, adv: 0 })
  transport.destroy()
  deliverFrame(bridge, 'B', { type: 'input', tick: 2, input: null, adv: 0 })
  assert.equal(transport.getStats().received, 1)
})

gate('control: before destroy the same frame is received', () => {
  const bridge = fakeBridge('L')
  const transport = new LockstepInputTransport({ bridge })
  deliverFrame(bridge, 'B', { type: 'input', tick: 2, input: null, adv: 0 })
  assert.equal(transport.getStats().received, 1)
})

gate('the lockstep tick tag is [lockstep-tick] and a 60 Hz tick is 1/60 of a second', () => {
  assert.equal(LOCKSTEP_TICK_ERROR_TAG, '[lockstep-tick]')
  assert.ok(Math.abs(lockstepDtSeconds(1000 / 60) - 1 / 60) < 1e-12)
})

gate('control: a 16 ms tick is not a 60 Hz tick', () => {
  assert.ok(Math.abs(lockstepDtSeconds(16) - 1 / 60) > 1e-6)
})

gate('start submits inputDelayTicks null frames for ticks 1 to 3 and starts the tick system', () => {
  const env = buildLoop()
  assert.deepEqual(sentFrames(env.bridge).map(f => [f.type, f.tick, f.input]), [['input', 1, null], ['input', 2, null], ['input', 3, null]])
  assert.equal(env.tickSystem.state.started, true)
})

gate('control: an input delay of 2 sends only ticks 1 and 2 at start', () => {
  const env = buildLoop({ options: { inputDelayTicks: 2 } })
  assert.deepEqual(sentFrames(env.bridge).map(f => f.tick), [1, 2])
})

gate('a tick waits for every peer input, then simulates with the tick and dt it was given', () => {
  const env = buildLoop()
  fire(env)
  assert.equal(env.calls.length, 0)
  feed(env, 'B', 1, { buttons: 1 })
  fire(env)
  assert.equal(env.calls.length, 1)
  assert.equal(env.calls[0].tick, 1)
  assert.equal(env.calls[0].dt, 1 / 60)
})

gate('control: a tick with a missing peer input never simulates', () => {
  const env = buildLoop()
  feed(env, 'B', 2, { buttons: 1 })
  fire(env, 5)
  assert.equal(env.calls.length, 0)
})

gate('the local input is sent inputDelayTicks ahead of the tick it drives', () => {
  const env = buildLoop({ getLocalInput: () => ({ buttons: 7 }) })
  feed(env, 'B', 1)
  fire(env)
  const last = sentFrames(env.bridge).at(-1)
  assert.equal(last.tick, 4)
  assert.deepEqual(last.input, { buttons: 7 })
})

gate('control: the local input frame is not labelled with the tick being simulated', () => {
  const env = buildLoop({ getLocalInput: () => ({ buttons: 7 }) })
  feed(env, 'B', 1)
  fire(env)
  assert.notEqual(sentFrames(env.bridge).at(-1).tick, 1)
})

gate('the simulated inputs are keyed by peer, with the confirmed input or null', () => {
  const env = buildLoop()
  feed(env, 'B', 1, { buttons: 1 })
  fire(env)
  assert.deepEqual(env.calls[0].byPeer.get('B'), { buttons: 1 })
  assert.equal(env.calls[0].byPeer.get('L'), null)
})

gate('control: a different peer input is not what the loop simulated', () => {
  const env = buildLoop()
  feed(env, 'B', 1, { buttons: 1 })
  fire(env)
  assert.notDeepEqual(env.calls[0].byPeer.get('B'), { buttons: 2 })
})

gate('catch-up runs at most maxCatchUpTicks ticks per driver tick and counts the extra ticks', () => {
  const env = buildLoop({ options: { maxCatchUpTicks: 4 } })
  feed(env, 'B', 1)
  fire(env)
  assert.equal(env.loop.simTick, 1)
  fire(env, 5)
  assert.equal(env.loop.simTick, 1)
  for (let t = 2; t <= 10; t++) feed(env, 'B', t)
  fire(env)
  assert.equal(env.loop.simTick, 5)
  assert.equal(env.loop.getStats().catchUpTicks, 3)
})

gate('control: a catch-up cap of 1 advances one tick on the same schedule', () => {
  const env = buildLoop({ options: { maxCatchUpTicks: 1 } })
  feed(env, 'B', 1)
  fire(env)
  fire(env, 5)
  for (let t = 2; t <= 10; t++) feed(env, 'B', t)
  fire(env)
  assert.equal(env.loop.simTick, 2)
  assert.equal(env.loop.getStats().catchUpTicks, 0)
})

gate('a silent peer is cut as no-first-input on the 600th connecting tick, not before', () => {
  const env = buildLoop()
  fire(env, 599)
  assert.deepEqual(env.loop.getStats().cuts, {})
  fire(env)
  assert.deepEqual(env.loop.getStats().cuts, { B: 0 })
  assert.equal(env.loop.getStats().dropLog[0].reason, 'no-first-input')
})

gate('control: a peer whose first input arrives before the 600th connecting tick is not cut', () => {
  const env = buildLoop()
  feed(env, 'B', 1)
  fire(env, 599)
  assert.deepEqual(env.loop.getStats().cuts, {})
})

gate('a peer that goes silent mid-run is cut as stall at its confirmed prefix, and the run continues without it', () => {
  const env = buildLoop()
  for (let t = 1; t <= 3; t++) feed(env, 'B', t)
  fire(env, 3)
  assert.equal(env.loop.simTick, 3)
  fire(env, 599)
  assert.deepEqual(env.loop.getStats().cuts, {})
  fire(env)
  assert.deepEqual(env.loop.getStats().cuts, { B: 3 })
  assert.equal(env.loop.getStats().dropLog[0].reason, 'stall')
  fire(env)
  assert.equal(env.loop.simTick, 7)
  assert.deepEqual(env.calls.slice(3).map(c => c.byPeer.get('B')), [null, null, null, null])
})

gate('control: a silent peer is not cut at 602 stalled ticks, one tick before the stall limit', () => {
  const env = buildLoop()
  for (let t = 1; t <= 3; t++) feed(env, 'B', t)
  fire(env, 3)
  fire(env, 599)
  assert.deepEqual(env.loop.getStats().cuts, {})
})

gate('a drop needs every surviving peer to report before the cut is set, and the cut is the largest report', () => {
  const env = buildLoop({ roster: ['L', 'B', 'C'] })
  env.loop.dropPeer('B', 'manual')
  assert.deepEqual(env.loop.getStats().dropping, ['B'])
  assert.deepEqual(env.loop.getStats().cuts, {})
  deliverFrame(env.bridge, 'C', { type: 'drop', peer: 'B', have: 2, tail: [] })
  assert.deepEqual(env.loop.getStats().cuts, { B: 2 })
  assert.deepEqual(env.loop.getStats().dropLog[0], { peer: 'B', reason: 'manual', cutTick: 2, reports: { L: 0, C: 2 }, startedAtSimTick: 0, finishedAtSimTick: 0 })
})

gate('control: a cut of 0 is not what the two reports produce', () => {
  const env = buildLoop({ roster: ['L', 'B', 'C'] })
  env.loop.dropPeer('B', 'manual')
  deliverFrame(env.bridge, 'C', { type: 'drop', peer: 'B', have: 2, tail: [] })
  assert.notEqual(env.loop.getStats().cuts.B, 0)
})

gate('a drop report naming the local peer evicts it, and the loop then only counts stalls', () => {
  const env = buildLoop()
  feed(env, 'B', 1)
  fire(env)
  deliverFrame(env.bridge, 'B', { type: 'drop', peer: 'L', have: 0, tail: [] })
  assert.deepEqual(env.loop.getStats().evicted, { by: 'B', atSimTick: 1 })
  fire(env, 3)
  assert.equal(env.loop.simTick, 1)
  assert.ok(env.loop.getStats().stalls >= 3)
})

gate('control: a drop report from an unknown pubkey does not evict the local peer', () => {
  const env = buildLoop()
  deliverFrame(env.bridge, 'Z', { type: 'drop', peer: 'L', have: 0, tail: [] })
  assert.equal(env.loop.getStats().evicted, null)
})

gate('an input for a pruned tick is counted as late, and one beyond the retain window as future', () => {
  const env = buildLoop()
  for (let k = 1; k <= 300; k++) {
    feed(env, 'B', k)
    fire(env)
  }
  feed(env, 'B', 1)
  feed(env, 'B', 300 + INPUT_RETAIN_TICKS + 1)
  const stats = env.loop.getStats()
  assert.equal(stats.lateInputsIgnored, 1)
  assert.equal(stats.futureInputsIgnored, 1)
})

gate('control: an input exactly at the retain horizon is accepted, not counted as future', () => {
  const env = buildLoop()
  for (let k = 1; k <= 300; k++) {
    feed(env, 'B', k)
    fire(env)
  }
  feed(env, 'B', 300 + INPUT_RETAIN_TICKS)
  assert.equal(env.loop.getStats().futureInputsIgnored, 0)
})

gate('an input exactly INPUT_RETAIN_TICKS past the simulated tick is kept', () => {
  const env = buildLoop()
  for (let t = 1; t <= INPUT_RETAIN_TICKS; t++) feed(env, 'B', t)
  assert.equal(env.loop.getStats().lastConfirmed.B, INPUT_RETAIN_TICKS)
  assert.equal(env.loop.getStats().futureInputsIgnored, 0)
})

gate('control: an input one tick further than the retain window is dropped, and the prefix stops short', () => {
  const env = buildLoop()
  for (let t = 1; t < INPUT_RETAIN_TICKS; t++) feed(env, 'B', t)
  feed(env, 'B', INPUT_RETAIN_TICKS + 1)
  assert.equal(env.loop.getStats().lastConfirmed.B, INPUT_RETAIN_TICKS - 1)
  assert.equal(env.loop.getStats().futureInputsIgnored, 1)
})

gate('the time-sync rule yields one driver tick in four while the remote is far behind', () => {
  const env = buildLoop()
  for (let t = 1; t <= 50; t++) feed(env, 'B', t, null, -1000)
  fire(env, 40)
  assert.equal(env.loop.getStats().timeSyncYields, 10)
  assert.equal(env.loop.simTick, 30)
})

gate('control: with no advantage skew the same run yields nothing and simulates every driver tick', () => {
  const env = buildLoop()
  for (let t = 1; t <= 50; t++) feed(env, 'B', t)
  fire(env, 40)
  assert.equal(env.loop.getStats().timeSyncYields, 0)
  assert.equal(env.loop.simTick, 40)
})

gate('input latency is the time from sending a tick input to simulating that tick', () => {
  let clock = 100
  const env = buildLoop({ now: () => clock })
  for (let t = 1; t <= 10; t++) feed(env, 'B', t)
  fire(env, 3)
  clock = 140
  fire(env, 3)
  const latencyMs = env.loop.getStats().inputLatencyMs
  assert.equal(latencyMs.max, 40)
  assert.equal(latencyMs.avg, 40)
})

gate('control: a clock that never moves reads zero input latency', () => {
  const env = buildLoop({ now: () => 100 })
  for (let t = 1; t <= 10; t++) feed(env, 'B', t)
  fire(env, 6)
  assert.equal(env.loop.getStats().inputLatencyMs.max, 0)
})

gate('prune drops simulated records older than the retain window and keeps the boundary tick', () => {
  const env = buildLoop()
  for (let k = 1; k <= 300; k++) {
    feed(env, 'B', k, { buttons: k })
    fire(env)
  }
  assert.equal(env.loop.inspectTick(59).used, null)
  assert.equal(env.loop.inspectTick(60).used.B, canonicalJSON({ buttons: 60 }))
  assert.equal(env.loop.inspectTick(300).used.B, canonicalJSON({ buttons: 300 }))
})

gate('control: a record inside the window is not pruned', () => {
  const env = buildLoop()
  for (let k = 1; k <= 300; k++) {
    feed(env, 'B', k, { buttons: k })
    fire(env)
  }
  assert.notEqual(env.loop.inspectTick(241).used, null)
})

gate('a drop report carries the inputs after the drop floor up to the confirmed prefix', () => {
  const env = buildLoop()
  for (let t = 1; t <= 12; t++) feed(env, 'B', t, { buttons: t })
  fire(env, 10)
  env.loop.dropPeer('B', 'manual')
  const drop = sentFrames(env.bridge).at(-1)
  assert.equal(drop.type, 'drop')
  assert.equal(drop.have, 12)
  assert.deepEqual(drop.tail.map(row => row[0]), [8, 9, 10, 11, 12])
})

gate('control: a tail that started at tick 7 would be six rows long, which is not what is sent', () => {
  const env = buildLoop()
  for (let t = 1; t <= 12; t++) feed(env, 'B', t, { buttons: t })
  fire(env, 10)
  env.loop.dropPeer('B', 'manual')
  assert.notEqual(sentFrames(env.bridge).at(-1).tail.length, 6)
})

gate('dropPeer ignores the local peer and an unknown peer, and acts on a known one', () => {
  const env = buildLoop()
  env.loop.dropPeer('L')
  env.loop.dropPeer('Z')
  assert.deepEqual(env.loop.getStats().dropping, [])
  assert.deepEqual(env.loop.getStats().cuts, {})
  env.loop.dropPeer('B', 'manual')
  assert.deepEqual(env.loop.getStats().cuts, { B: 0 })
})

gate('a voter is ticked on every simulated tick and told to forget a peer that is dropped', () => {
  const voter = {
    ticks: [],
    removed: [],
    tick(t) { this.ticks.push(t) },
    removePeer(pk) { this.removed.push(pk) },
    getStats() { return { verified: 0, desyncsDetected: 0, firstDesyncTick: null } },
  }
  const env = buildLoop({ voter })
  feed(env, 'B', 1)
  feed(env, 'B', 2)
  fire(env, 2)
  assert.deepEqual(voter.ticks, [1, 2])
  env.loop.dropPeer('B', 'manual')
  assert.deepEqual(voter.removed, ['B'])
})

gate('control: a voter is not told to remove a peer that was never dropped', () => {
  const voter = { ticks: [], removed: [], tick() {}, removePeer(pk) { this.removed.push(pk) }, getStats() { return { verified: 0, desyncsDetected: 0, firstDesyncTick: null } } }
  buildLoop({ voter })
  assert.deepEqual(voter.removed, [])
})

gate('stop stops the tick system', () => {
  const env = buildLoop()
  assert.equal(env.tickSystem.state.stopped, false)
  env.loop.stop()
  assert.equal(env.tickSystem.state.stopped, true)
})

gate('the lockstep peer loop passes resim false to simulate and wires the transport and voter to the bridge', () => {
  const bridge = fakeBridge('L')
  const tickSystem = fakeTickSystem()
  const calls = []
  const { loop, transport, voter } = buildLockstepPeerLoop({
    bridge,
    tickSystem,
    roster: ['L', 'B'],
    localPeerId: 'L',
    simulate: (t, dt, byPeer, resim) => calls.push({ t, resim, byPeer }),
    getLocalInput: () => null,
    liveChecksum: () => 'abc',
    options: { ...LOCKSTEP_DEFAULTS },
    now: () => 0,
  })
  assert.equal(transport instanceof LockstepInputTransport, true)
  assert.equal(voter.bridge, bridge)
  loop.start()
  feed({ bridge, tickSystem }, 'B', 1)
  tickSystem.fire()
  assert.equal(calls[0].t, 1)
  assert.equal(calls[0].resim, false)
})

gate('control: the peer loop does not report resim true', () => {
  const bridge = fakeBridge('L')
  const tickSystem = fakeTickSystem()
  const calls = []
  const { loop } = buildLockstepPeerLoop({ bridge, tickSystem, roster: ['L', 'B'], localPeerId: 'L', simulate: (t, dt, byPeer, resim) => calls.push(resim), getLocalInput: () => null, liveChecksum: () => 'abc', options: { ...LOCKSTEP_DEFAULTS }, now: () => 0 })
  loop.start()
  feed({ bridge, tickSystem }, 'B', 1)
  tickSystem.fire()
  assert.notEqual(calls[0], true)
})

gate('the peer loop broadcasts a consensus checksum on each checksum tick and nowhere else in the first 30 ticks', () => {
  const bridge = fakeBridge('L')
  const tickSystem = fakeTickSystem()
  buildLockstepPeerLoop({ bridge, tickSystem, roster: ['L', 'B'], localPeerId: 'L', simulate: () => {}, getLocalInput: () => null, liveChecksum: () => 'abc', options: { ...LOCKSTEP_DEFAULTS }, now: () => 0 }).loop.start()
  for (let t = 1; t <= 30; t++) {
    feed({ bridge, tickSystem }, 'B', t)
    tickSystem.fire()
  }
  const consensusTicks = bridge.sent.filter(text => text.startsWith('wwconsensus:')).map(text => JSON.parse(text.slice('wwconsensus:'.length)).tick)
  assert.deepEqual(consensusTicks, [30])
  assert.equal(consensusChecksum(bridge, 30), 'abc')
})

gate('control: a peer loop with a checksum interval of 10 broadcasts at tick 10', () => {
  const bridge = fakeBridge('L')
  const tickSystem = fakeTickSystem()
  buildLockstepPeerLoop({ bridge, tickSystem, roster: ['L', 'B'], localPeerId: 'L', simulate: () => {}, getLocalInput: () => null, liveChecksum: () => 'abc', options: { ...LOCKSTEP_DEFAULTS, checksumIntervalTicks: 10 }, now: () => 0 }).loop.start()
  for (let t = 1; t <= 10; t++) {
    feed({ bridge, tickSystem }, 'B', t)
    tickSystem.fire()
  }
  assert.equal(consensusChecksum(bridge, 10), 'abc')
})

gate('a cheat ejection drops the offending peer through the loop, with reason desync', () => {
  const bridge = fakeBridge('L')
  const { loop, voter } = buildLockstepPeerLoop({ bridge, tickSystem: fakeTickSystem(), roster: ['L', 'B'], localPeerId: 'L', simulate: () => {}, getLocalInput: () => null, liveChecksum: () => 'abc', options: { ...LOCKSTEP_DEFAULTS }, now: () => 0 })
  voter.onCheatingPeer('B', {})
  assert.deepEqual(loop.getStats().dropLog.map(d => [d.peer, d.reason]), [['B', 'desync']])
})

gate('control: an ejection naming a peer outside the roster drops nothing', () => {
  const bridge = fakeBridge('L')
  const { loop, voter } = buildLockstepPeerLoop({ bridge, tickSystem: fakeTickSystem(), roster: ['L', 'B'], localPeerId: 'L', simulate: () => {}, getLocalInput: () => null, liveChecksum: () => 'abc', options: { ...LOCKSTEP_DEFAULTS }, now: () => 0 })
  voter.onCheatingPeer('Z', {})
  assert.deepEqual(loop.getStats().dropLog, [])
})

gate('a session refuses a world whose netcode profile is not peer-simulated', () => {
  for (const profile of ['authoritative']) {
    const { ctx } = fakeCtx({ currentWorldDef: { netcode: { profile } } })
    assert.throws(() => createPeerSimSession(ctx, { roster: ['L', 'B'], localPubkey: 'L', bridge: fakeBridge('L'), tickSystem: fakeTickSystem(), now: () => 0 }), { message: `[PeerSimSession] world netcode profile '${profile}' is not peer-simulated` })
  }
})

gate('control: a lockstep world builds a session', () => {
  assert.equal(sessionFixture().session.getStats().profile, 'lockstep')
})

gate('a session refuses a roster that does not list the local pubkey', () => {
  const { ctx } = fakeCtx()
  assert.throws(() => createPeerSimSession(ctx, { roster: ['A', 'B'], localPubkey: 'L', bridge: fakeBridge('L'), tickSystem: fakeTickSystem(), now: () => 0 }), { message: '[PeerSimSession] roster must be an array of peer pubkeys including localPubkey' })
})

gate('control: a roster that lists the local pubkey builds a session with that pubkey as the local player', () => {
  const { session } = sessionFixture({ roster: ['L', 'B'], localPubkey: 'B' })
  assert.equal(session.localPlayerId, session.playerIdByPeer.get('B'))
  assert.equal(session.localPlayerId, 1)
})

gate('player ids follow sorted pubkeys, and spawn points cycle over the roster', () => {
  const { session, log } = sessionFixture({ ctxOptions: { worldSpawnPoints: [[1, 0, 0], [2, 0, 0]] }, roster: ['L', 'A', 'B'], localPubkey: 'B' })
  assert.deepEqual(Object.fromEntries(session.playerIdByPeer), { A: 1, B: 2, L: 3 })
  assert.equal(session.localPlayerId, 2)
  assert.deepEqual(log.added.map(a => a.position), [[1, 0, 0], [2, 0, 0], [1, 0, 0]])
})

gate('control: the local player does not take the first spawn point', () => {
  const { session, log } = sessionFixture({ ctxOptions: { worldSpawnPoints: [[1, 0, 0], [2, 0, 0]] }, roster: ['L', 'A', 'B'], localPubkey: 'B' })
  assert.notDeepEqual(log.added.find(a => a.id === session.localPlayerId).position, [1, 0, 0])
})

gate('a player takes the world health, and the collider defaults to the spoint capsule radius', () => {
  const { log } = sessionFixture({ ctxOptions: { currentWorldDef: { netcode: { profile: 'lockstep' }, player: { health: 77 } } } })
  assert.deepEqual(log.added.map(a => a.health), [77, 77])
  assert.deepEqual(log.colliders.map(c => c.radius), [0.4, 0.4])
})

gate('control: a world capsule radius of 0.6 is used instead of the default', () => {
  const { log } = sessionFixture({ ctxOptions: { currentWorldDef: { netcode: { profile: 'lockstep' }, player: { capsuleRadius: 0.6 } } } })
  assert.deepEqual(log.colliders.map(c => c.radius), [0.6, 0.6])
})

gate('the local input is taken from the player queue and held while the queue is empty', () => {
  const { session, tickSystem, bridge, ctx } = sessionFixture()
  ctx.playerManager.queues.set(session.localPlayerId, [{ data: { buttons: 3 } }])
  session.start()
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: { buttons: 1 }, adv: 1000 })
  tickSystem.fire()
  assert.deepEqual(sentFrames(bridge).at(-1), { type: 'input', tick: 4, input: { buttons: 3 }, adv: sentFrames(bridge).at(-1).adv })
  deliverFrame(bridge, 'B', { type: 'input', tick: 2, input: { buttons: 1 }, adv: 1000 })
  tickSystem.fire()
  assert.deepEqual(sentFrames(bridge).at(-1).input, { buttons: 3 })
})

gate('control: a local player with no queued input sends null', () => {
  const { session, tickSystem, bridge } = sessionFixture()
  session.start()
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: { buttons: 1 }, adv: 1000 })
  tickSystem.fire()
  assert.equal(sentFrames(bridge).at(-1).input, null)
})

gate('simulate receives inputs keyed by player id and flushes connections once per tick', () => {
  const { session, tickSystem, bridge, log } = sessionFixture()
  session.start()
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: { buttons: 1 }, adv: 1000 })
  tickSystem.fire()
  const explicit = log.simulated[0].explicit
  assert.equal(log.simulated[0].tick, 1)
  assert.deepEqual(explicit.get(1), { buttons: 1 })
  assert.equal(explicit.get(session.localPlayerId), null)
  assert.equal(log.flushes, 1)
})

gate('control: each simulated tick flushes connections once, so two ticks flush twice', () => {
  const { session, tickSystem, bridge, log } = sessionFixture()
  session.start()
  for (let t = 1; t <= 2; t++) {
    deliverFrame(bridge, 'B', { type: 'input', tick: t, input: null, adv: 1000 })
    tickSystem.fire()
  }
  assert.equal(log.flushes, 2)
})

gate('the live checksum at tick 30 repeats for identical worlds and moves with a player position', () => {
  const run = (spawn) => {
    const { session, tickSystem, bridge } = sessionFixture({ ctxOptions: { worldSpawnPoints: [spawn] }, roster: ['L', 'B'], localPubkey: 'L' })
    session.start()
    for (let t = 1; t <= 30; t++) {
      deliverFrame(bridge, 'B', { type: 'input', tick: t, input: null, adv: 1000 })
      tickSystem.fire()
    }
    return consensusChecksum(bridge, 30)
  }
  const first = run([0, 0, 0])
  assert.match(first, /^[0-9a-f]{16}$/)
  assert.equal(run([0, 0, 0]), first)
  assert.notEqual(run([5, 0, 0]), first)
})

gate('control: a spawn point that differs in one axis changes the checksum', () => {
  const run = (spawn) => {
    const { session, tickSystem, bridge } = sessionFixture({ ctxOptions: { worldSpawnPoints: [spawn] }, roster: ['L', 'B'], localPubkey: 'L' })
    session.start()
    for (let t = 1; t <= 30; t++) {
      deliverFrame(bridge, 'B', { type: 'input', tick: t, input: null, adv: 1000 })
      tickSystem.fire()
    }
    return consensusChecksum(bridge, 30)
  }
  assert.notEqual(run([0, 0, 0]), run([0, 0, 1e-9]))
})

gate('stop ends the tick system and detaches the data listeners of the transport and voter', () => {
  const { session, tickSystem, bridge } = sessionFixture()
  session.start()
  assert.equal(tickSystem.state.started, true)
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: null, adv: 1000 })
  assert.equal(session.getStats().transport.received, 1)
  session.stop()
  deliverFrame(bridge, 'B', { type: 'input', tick: 2, input: null, adv: 1000 })
  assert.equal(session.getStats().transport.received, 1)
  assert.equal(tickSystem.state.stopped, true)
})

gate('control: before stop the same frame is received by the session transport', () => {
  const { session, bridge } = sessionFixture()
  session.start()
  deliverFrame(bridge, 'B', { type: 'input', tick: 1, input: null, adv: 1000 })
  assert.equal(session.getStats().transport.received, 1)
})

gate('claimLocalPlayer attaches a socket to the local player only', () => {
  const { session, ctx } = sessionFixture()
  assert.equal(ctx.playerManager.getPlayer(session.localPlayerId).socket, null)
  assert.equal(session.claimLocalPlayer('T'), session.localPlayerId)
  assert.equal(ctx.playerManager.getPlayer(session.localPlayerId).socket, 'T')
  const other = [...session.playerIdByPeer.values()].find(id => id !== session.localPlayerId)
  assert.equal(ctx.playerManager.getPlayer(other).socket, null)
})

gate('control: a session reports its own local player id, not another', () => {
  const { session } = sessionFixture({ roster: ['L', 'B'], localPubkey: 'L' })
  assert.equal(session.getStats().localPlayerId, session.playerIdByPeer.get('L'))
})

gate('getStats reports the profile and the spoint defaults, and no correction counters', () => {
  const { session } = sessionFixture()
  const stats = session.getStats()
  assert.equal(stats.profile, 'lockstep')
  assert.deepEqual(stats.options, LOCKSTEP_DEFAULTS)
  assert.equal('corrections' in stats, false)
})

gate('the lockstep-pure directory holds exactly the seven ported modules', () => {
  assert.deepEqual(readdirSync(sourceDir).sort(), [...SOURCE_FILES].sort())
})

gate('the lockstep-pure sources carry no comments', () => {
  for (const file of SOURCE_FILES) {
    assert.equal(COMMENT_PATTERN.test(readFileSync(join(sourceDir, file), 'utf8')), false, `${file} contains a comment`)
  }
})

gate('control: the comment scan flags a line with a line comment', () => {
  assert.equal(COMMENT_PATTERN.test('const x = 1 // note'), true)
  assert.equal(COMMENT_PATTERN.test('/* block */'), true)
})

gate('the lockstep-pure sources use no timers, workers, DOM, clock defaults or fs', () => {
  for (const file of SOURCE_FILES) {
    assert.equal(EFFECT_PATTERN.test(readFileSync(join(sourceDir, file), 'utf8')), false, `${file} reaches a host API`)
  }
})

gate('control: the effect scan flags a timer call and a worker reference', () => {
  assert.equal(EFFECT_PATTERN.test('setInterval(fn, 1000)'), true)
  assert.equal(EFFECT_PATTERN.test('import { WorkerBridgeProxy } from "./WorkerBridgeProxy.js"'), true)
})

gate('the rollback defaults the profile table reuses are the jayzee values', () => {
  assert.deepEqual({ ...ROLLBACK_DEFAULTS }, { inputDelayTicks: 1, maxRollbackTicks: 12, checksumIntervalTicks: 30 })
})

finish()
