import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { clearInputBucket, enforceMovementEnvelope, envelopeSpeedCap, isInputRateLimited } from '../src/anticheat/InputGuard.js'
import { clearOutlierWindow, recordHit } from '../src/anticheat/OutlierDetector.js'
import { DEFAULT_MOVEMENT } from '../src/motion-pure/movement.js'
import { createTickHost } from '../src/tick-host/tickHost.js'
import { createGroundCharacterWorld } from '../src/tick-host/groundCharacterWorld.js'

let nextClient = 0
const client = () => ({ client: ++nextClient })
const admitted = (id, times) => times.reduce((count, t) => count + (isInputRateLimited(id, t) ? 0 : 1), 0)
const every = (fromMs, toMs, stepMs) => {
  const times = []
  for (let t = fromMs; t < toMs; t += stepMs) times.push(t)
  return times
}

const referenceBucket = (capacity, refillPerSec) => {
  let tokens = capacity
  let last = null
  return (t) => {
    if (last === null) last = t
    if (t > last) {
      tokens = Math.min(capacity, tokens + ((t - last) / 1000) * refillPerSec)
      last = t
    }
    if (tokens < 1) return true
    tokens -= 1
    return false
  }
}

const seeded = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const logOf = () => {
  const events = []
  return { events, record: (kind, data, meta) => events.push({ kind, data, meta }) }
}

gate('the input bucket holds exactly 120: a burst of 500 inputs in one instant admits 120 and refuses 380', () => {
  const id = client()
  assert.equal(admitted(id, new Array(500).fill(5000)), 120)
  assert.equal(isInputRateLimited(id, 5000), true)
  assert.notEqual(admitted(client(), new Array(500).fill(5000)), 121)
})

gate('the bucket refills 90 a second: after the burst, a 1000 Hz flood is admitted 900 times in 10 s and 90 in each second', () => {
  const id = client()
  admitted(id, new Array(200).fill(0))
  let total = 0
  for (let second = 0; second < 10; second++) {
    const count = admitted(id, every(second * 1000 + 1, (second + 1) * 1000 + 1, 1))
    assert.ok(count === 90 || count === 89 || count === 91, 'second ' + second + ' admitted ' + count)
    total += count
  }
  assert.ok(Math.abs(total - 900) <= 1, 'admitted ' + total + ' in 10 s')
})

gate('a 90 Hz sender is never refused in a minute, and a 100 Hz sender is admitted 120 plus 90 a second', () => {
  const steady = client()
  const steadyTimes = []
  for (let i = 0; i < 90 * 60; i++) steadyTimes.push((i * 1000) / 90)
  assert.equal(admitted(steady, steadyTimes), 90 * 60)
  const fast = client()
  const fastCount = admitted(fast, every(0, 60000, 10))
  assert.ok(Math.abs(fastCount - (120 + 90 * 60)) <= 1, '100 Hz admitted ' + fastCount)
  assert.ok(fastCount < 6000, 'control: the 100 Hz sender was never refused')
})

gate('an hour of idle refills the bucket to 120 and no further', () => {
  const id = client()
  admitted(id, new Array(120).fill(0))
  assert.equal(admitted(id, new Array(500).fill(3600000)), 120)
  const partial = client()
  admitted(partial, new Array(120).fill(0))
  assert.equal(admitted(partial, new Array(500).fill(500)), 45)
})

gate('20000 seeded calls agree with an independent 120 and 90 a second bucket, and disagree with 119, 121, 89 and 91', () => {
  const random = seeded(11)
  const times = []
  let t = 100
  for (let i = 0; i < 20000; i++) {
    const draw = random()
    t += draw < 0.9 ? random() * 8 : draw < 0.998 ? random() * 100 : random() * 5000
    times.push(t)
  }
  const id = client()
  const got = times.map((at) => isInputRateLimited(id, at))
  const agreement = (capacity, refill) => {
    const reference = referenceBucket(capacity, refill)
    return times.reduce((count, at, i) => count + (reference(at) === got[i] ? 1 : 0), 0)
  }
  assert.equal(agreement(120, 90), 20000)
  assert.ok(got.filter(Boolean).length > 1000 && got.filter((x) => !x).length > 1000, 'the schedule must reach both outcomes')
  for (const [capacity, refill] of [[119, 90], [121, 90], [120, 89], [120, 91]]) assert.ok(agreement(capacity, refill) < 20000, capacity + ' and ' + refill + ' was not told apart')
})

gate('a cleared bucket starts full again, each client has its own bucket, and a non-finite time is refused', () => {
  const a = client()
  const b = client()
  admitted(a, new Array(120).fill(0))
  assert.equal(isInputRateLimited(a, 0), true)
  assert.equal(isInputRateLimited(b, 0), false)
  clearInputBucket(a)
  assert.equal(admitted(a, new Array(500).fill(0)), 120)
  assert.throws(() => isInputRateLimited(a, NaN), TypeError)
  assert.throws(() => isInputRateLimited(a, undefined), TypeError)
})

gate('the envelope cap is three times the fastest movement speed with a floor of 20, and 60 when no speed is given: 21 for the default movement', () => {
  assert.equal(DEFAULT_MOVEMENT.maxSpeed, 7)
  assert.equal(envelopeSpeedCap(DEFAULT_MOVEMENT), 21)
  assert.equal(envelopeSpeedCap({ maxSpeed: 7, sprintSpeed: 12.25 }), 36.75)
  assert.equal(envelopeSpeedCap({ maxSpeed: 7, airSpeedCap: 30, slideMinSpeed: 8 }), 90)
  assert.equal(envelopeSpeedCap({ maxSpeed: 2 }), 20)
  assert.equal(envelopeSpeedCap({ maxSpeed: 6.5 }), 20)
  assert.equal(envelopeSpeedCap({}), 60)
  assert.equal(envelopeSpeedCap(undefined), 60)
  assert.equal(envelopeSpeedCap({ maxSpeed: NaN, sprintSpeed: -5 }), 60)
  assert.notEqual(envelopeSpeedCap(DEFAULT_MOVEMENT), 7)
})

gate('a velocity at the cap is kept, one above it is scaled to the cap along its own direction, and a non-finite one is left alone', () => {
  const atCap = { velocity: [21, 0, 0] }
  assert.equal(enforceMovementEnvelope(atCap, DEFAULT_MOVEMENT), false)
  assert.deepEqual(atCap.velocity, [21, 0, 0])
  const above = { velocity: [30, 40, 0] }
  assert.equal(enforceMovementEnvelope(above, DEFAULT_MOVEMENT), true)
  assert.ok(Math.abs(Math.hypot(...above.velocity) - 21) < 1e-9)
  assert.ok(Math.abs(above.velocity[0] - 12.6) < 1e-9 && Math.abs(above.velocity[1] - 16.8) < 1e-9 && above.velocity[2] === 0)
  const barely = { velocity: [0, 0, 21.001] }
  assert.equal(enforceMovementEnvelope(barely, DEFAULT_MOVEMENT), true)
  assert.ok(Math.abs(barely.velocity[2] - 21) < 1e-9)
  const broken = { velocity: [NaN, 0, 0] }
  assert.equal(enforceMovementEnvelope(broken, DEFAULT_MOVEMENT), false)
  assert.equal(enforceMovementEnvelope({}, DEFAULT_MOVEMENT), false)
})

gate('the headshot ratio flag needs 10 samples and a ratio of 0.75 over the last 20 hits: 15 of 20 flags, 14 of 20 does not', () => {
  const run = (pattern) => {
    const shooter = client()
    const log = logOf()
    pattern.forEach((headshot, i) => recordHit(log, shooter, { headshot, timestampMs: 1000000 + i * 1000 }))
    clearOutlierWindow(shooter)
    return log.events.filter((e) => e.data.kind === 'high_headshot_ratio')
  }
  const spread = (heads, total) => {
    const pattern = new Array(total).fill(false)
    for (let i = 0; i < heads; i++) pattern[total - 1 - i] = true
    return pattern
  }
  assert.equal(run(new Array(9).fill(true)).length, 0)
  const tenth = run(new Array(10).fill(true))
  assert.equal(tenth.length, 1)
  assert.equal(tenth[0].data.ratio, 1)
  assert.equal(tenth[0].data.sampleSize, 10)
  assert.equal(tenth[0].meta.reason, 'statistical_outlier')
  assert.equal(run(spread(14, 20)).length, 0)
  const fifteen = run([...new Array(5).fill(false), ...new Array(15).fill(true)])
  assert.equal(fifteen.length, 1)
  assert.equal(fifteen[0].data.ratio, 0.75)
  assert.equal(fifteen[0].data.sampleSize, 20)
  assert.equal(run([...new Array(3).fill(false), ...new Array(7).fill(true)]).length, 0)
})

gate('the fast streak flag needs four headshots each under 100 ms after the last: a 100 ms gap resets it and a body hit clears it', () => {
  const run = (shots) => {
    const shooter = client()
    const log = logOf()
    for (const [timestampMs, headshot] of shots) recordHit(log, shooter, { headshot, timestampMs, targetId: 9 })
    clearOutlierWindow(shooter)
    return log.events.filter((e) => e.data.kind === 'suspiciously_fast_headshot_streak')
  }
  const fast = run([[101000, true], [101099, true], [101198, true], [101297, true]])
  assert.equal(fast.length, 1)
  assert.equal(fast[0].data.streakLength, 4)
  assert.equal(fast[0].data.intervalMs, 99)
  assert.equal(fast[0].data.targetId, 9)
  assert.equal(run([[101000, true], [101099, true], [101198, true]]).length, 0)
  assert.equal(run([[101000, true], [101100, true], [101200, true], [101300, true]]).length, 0)
  assert.equal(run([[101000, true], [101050, true], [101100, false], [101150, true], [101200, true]]).length, 0)
})

gate('a shooter is flagged again only more than 5000 ms after the last flag', () => {
  const flagsAt = (secondAt) => {
    const shooter = client()
    const log = logOf()
    for (let i = 0; i < 10; i++) recordHit(log, shooter, { headshot: true, timestampMs: 100000 + i * 1000 })
    recordHit(log, shooter, { headshot: true, timestampMs: 109000 + secondAt })
    clearOutlierWindow(shooter)
    return log.events.length
  }
  assert.equal(flagsAt(5000), 1)
  assert.equal(flagsAt(5001), 2)
  assert.equal(flagsAt(1), 1)
  assert.throws(() => recordHit(logOf(), client(), { headshot: true, timestampMs: NaN }), TypeError)
})

gate('the tick host applies the limits: a flood is cut at 120 inputs, a bad angle is zeroed, and an over-speed velocity is clamped and logged', () => {
  const clock = { t: 1000 }
  const log = logOf()
  const host = createTickHost({ now: () => clock.t, physicsWorld: createGroundCharacterWorld(), eventLog: log })
  const socket = { isOpen: true, send: () => true }
  const id = host.addPlayer(socket, { position: [0, host.physicsIntegration.standingCentreY(0), 0] })
  let accepted = 0
  for (let i = 1; i <= 300; i++) if (host.receiveInput(id, { forward: true, yaw: i === 1 ? Infinity : 0 }, i)) accepted++
  assert.equal(accepted, 120)
  assert.equal(host.stats.inputsRateLimited, 180)
  assert.equal(host.playerManager.getInputs(id).length, 120)
  assert.equal(host.playerManager.getInputs(id)[0].data.yaw, 0)
  clock.t += 1000
  let refilled = 0
  for (let i = 301; i <= 500; i++) if (host.receiveInput(id, { forward: true, yaw: 0 }, i)) refilled++
  assert.equal(refilled, 90)
  const player = host.playerManager.getPlayer(id)
  host.playerManager.setMovementOverride(id, { maxSpeed: 500, groundAccel: 100000 })
  for (let i = 0; i < 30; i++) {
    clock.t += 1000 / 60
    host.tick()
    assert.ok(Math.hypot(...player.state.velocity) <= 21 + 1e-9, 'speed ' + Math.hypot(...player.state.velocity))
  }
  const clamps = log.events.filter((e) => e.kind === 'anticheat_envelope_clamp')
  assert.ok(clamps.length > 0, 'no clamp was logged')
  assert.equal(clamps[0].meta.reason, 'movement_envelope')
  assert.equal(host.receiveInput(999, {}, 1), false)
})

finish()
