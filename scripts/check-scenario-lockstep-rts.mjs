import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { LOCKSTEP, createLockstepMatch, lockstepSchedule } from './lib/lockstepMatch.mjs'
import { stateHash } from './lib/stateHash1024.mjs'

const TIERS = SCENARIO_TIERS
const DELAY_SEED = 20261111
const VARIANTS = Object.freeze(['agreed', 'delayed', 'diverged', 'dropped', 'reordered', 'late'])
const CONTROLS = Object.freeze([
  { variant: 'diverged', what: 'given one extra order at tick ' + LOCKSTEP.divergeIssueTick, changedAt: LOCKSTEP.divergeIssueTick + LOCKSTEP.inputDelay },
  { variant: 'dropped', what: 'that never receives the tick 60 order', changedAt: 60 + LOCKSTEP.inputDelay },
  { variant: 'reordered', what: 'that applies the two squad 0 orders in the opposite order', changedAt: LOCKSTEP.inputDelay },
  { variant: 'late', what: 'whose tick 60 order arrives late, at tick ' + LOCKSTEP.lateArrivalTick + ',', changedAt: 60 + LOCKSTEP.inputDelay },
])

const firstCheckpointAfter = (tick) => (Math.floor(tick / LOCKSTEP.checkpointTicks) + 1) * LOCKSTEP.checkpointTicks

const play = async (tier, variant) => {
  const schedule = lockstepSchedule(variant, DELAY_SEED)
  const match = await createLockstepMatch(tier, schedule)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  for (let tick = 0; tick < LOCKSTEP.matchTicks; tick++) {
    match.decide()
    timer.start()
    match.step()
    timer.stop()
    match.record()
  }
  const finalEngine = match.engineHash()
  return {
    schedule,
    applied: match.applied(),
    tickMs,
    hp: Array.from(match.hp),
    positions: Array.from(match.positions),
    engine: Array.from(match.checkpointEngine),
    game: Array.from(match.checkpointGame),
    checkpoints: match.checkpoints,
    finalEngine,
    finalEngineByStateHash: stateHash(Array.from(match.engineState())),
    engineTick: match.world.tick,
    bodyHash: match.world.hash(),
  }
}

const firstMismatch = (peer, reference) => {
  for (let i = 0; i < reference.engine.length; i++) {
    if (peer.engine[i] !== reference.engine[i]) return (i + 1) * LOCKSTEP.checkpointTicks
  }
  return null
}

const runs = new Map()
for (const tier of TIERS) {
  const peers = {}
  for (const variant of VARIANTS) peers[variant] = await play(tier, variant)
  runs.set(tier.label, peers)
}

for (const tier of TIERS) {
  const peers = runs.get(tier.label)
  const peerA = peers.agreed
  const peerB = peers.delayed
  gate(tier.label + ': every order applies exactly the input delay after it is issued, on both peers', () => {
    for (const peer of [peerA, peerB]) {
      assert.ok(peer.applied.length > 0, 'no orders were applied')
      for (const entry of peer.applied) assert.equal(entry.applied - entry.issued, LOCKSTEP.inputDelay, 'order issued at ' + entry.issued + ' applied at ' + entry.applied)
    }
  })
  gate(tier.label + ': the second peer receives its orders in transit, in a different order, with at least one arriving after its issue tick', () => {
    assert.ok(peerB.schedule.some((order) => order.arrives > order.tick), 'no order was delayed')
    assert.ok(peerB.schedule.every((order) => order.arrives <= order.tick + LOCKSTEP.inputDelay), 'an order arrived after its apply tick')
    assert.notDeepEqual(peerB.schedule.map((order) => order.tick + ':' + order.squad), peerA.schedule.map((order) => order.tick + ':' + order.squad))
  })
  gate(tier.label + ': the squads engage: units take damage within the match', () => {
    const damage = peerA.hp.reduce((sum, hp) => sum + (LOCKSTEP.maxHp - hp), 0)
    assert.ok(damage > 0, 'no damage was dealt')
  })
  gate(tier.label + ': the checkpoint hash is the engine state (body-frame and world-frame character positions, support and the engine control tick) and equals stateHash from stateHash1024 over the same reads', () => {
    assert.equal(peerA.engineTick, LOCKSTEP.matchTicks)
    assert.equal(peerA.finalEngine.toString(16).padStart(8, '0'), peerA.finalEngineByStateHash)
    assert.equal(new Set(peerA.engine).size, peerA.engine.length, 'two checkpoints share an engine hash, so the hash does not follow the state')
  })
  gate(tier.label + ': two peers with differently delayed orders agree on the engine state hash and the game hash at every checkpoint', () => {
    assert.equal(peerA.checkpoints, LOCKSTEP.matchTicks / LOCKSTEP.checkpointTicks)
    assert.equal(peerB.checkpoints, peerA.checkpoints)
    for (let i = 0; i < peerA.checkpoints; i++) {
      assert.equal(peerB.engine[i], peerA.engine[i], 'engine hash at checkpoint ' + (i + 1) * LOCKSTEP.checkpointTicks)
      assert.equal(peerB.game[i], peerA.game[i], 'game hash at checkpoint ' + (i + 1) * LOCKSTEP.checkpointTicks)
    }
  })
  for (const control of CONTROLS) {
    gate(tier.label + ': a peer ' + control.what + ' is caught by the engine state hash at tick ' + firstCheckpointAfter(control.changedAt) + ', the first checkpoint after the change', () => {
      const mismatch = firstMismatch(peers[control.variant], peerA)
      assert.ok(mismatch !== null, 'no checkpoint caught the change')
      assert.equal(mismatch, firstCheckpointAfter(control.changedAt), 'first mismatch at tick ' + mismatch)
    })
  }
  gate(tier.label + ': two peers agree bit for bit on every unit position and health at the end', () => {
    assert.deepEqual(new Uint32Array(new Float64Array(peerB.positions).buffer), new Uint32Array(new Float64Array(peerA.positions).buffer))
    assert.deepEqual(peerB.hp, peerA.hp)
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, all peers)', () => {
    const trace = writeTickTrace('lockstep-rts', tier.label, VARIANTS.map((variant) => peers[variant].tickMs))
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

if (process.env.SCENARIO_DEBUG) {
  for (const tier of TIERS) {
    const peers = runs.get(tier.label)
    console.log(JSON.stringify({ tier: tier.label, checkpoints: peers.agreed.engine.map((h) => h.toString(16).padStart(8, '0')), hp: peers.agreed.hp, firstMismatch: Object.fromEntries(CONTROLS.map((c) => [c.variant, firstMismatch(peers[c.variant], peers.agreed)])), delayed: peers.delayed.schedule }))
  }
}

finish()
