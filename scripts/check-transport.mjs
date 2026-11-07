import { gate, finish } from './lib/gate.mjs'
import { createSimLink, createSeededRandom, normalizeSimProfile, NETWORK_SIM_PRESETS, SIM_MAX_DELAY_MS } from '../src/transport/index.js'

const MESSAGES = 20000
const LOSS_TRIALS = 100000
const LOSS_TOLERANCE_POINTS = 0.5
const LATENCY_EPSILON_MS = 1e-9

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}

const run = ({ seed, profile, messages = MESSAGES }) => {
  const link = createSimLink({ seed, profile })
  const records = []
  for (let i = 0; i < messages; i++) {
    link.send({ id: i }, i)
    records.push(...link.advance(i))
  }
  records.push(...link.advance(Infinity))
  return { records, stats: link.getStats() }
}

const idsOf = (records) => records.map((record) => record.payload.id)

const sequenceOf = (records) => JSON.stringify(records.map((record) => [record.index, record.payload.id, record.sentAt, record.deliveredAt]))

const assertWithinLatency = (record, profile) => {
  const transit = record.deliveredAt - record.sentAt
  const low = Math.max(0, profile.latencyMs - profile.jitterMs) - LATENCY_EPSILON_MS
  const high = profile.latencyMs + profile.jitterMs + LATENCY_EPSILON_MS
  assert(transit >= low && transit <= high, `message ${record.payload.id} transit ${transit} outside [${low}, ${high}]`)
}

const refuses = (partial) => {
  try {
    normalizeSimProfile(partial)
  } catch (error) {
    return error instanceof TypeError
  }
  return false
}

const inOrderIds = Array.from({ length: MESSAGES }, (_, i) => i)

gate('the same seed gives an identical delivery sequence', () => {
  const profile = NETWORK_SIM_PRESETS.roadmapTarget
  const first = run({ seed: 42, profile })
  const second = run({ seed: 42, profile })
  assert(first.records.length > 0, 'no deliveries recorded')
  assert(sequenceOf(first.records) === sequenceOf(second.records), 'seed 42 produced two different sequences')
})

gate('zero loss with no jitter and no reordering delivers every message in send order', () => {
  for (const profile of [NETWORK_SIM_PRESETS.clean, { latencyMs: 20 }]) {
    const { records, stats } = run({ seed: 3, profile })
    assert(JSON.stringify(idsOf(records)) === JSON.stringify(inOrderIds), `order differs for ${JSON.stringify(profile)}`)
    assert(stats.dropped === 0 && stats.reordered === 0, `unexpected drops or reorders for ${JSON.stringify(profile)}`)
  }
})

gate('zero loss delivers every message once, even with jitter and reordering', () => {
  const { records, stats } = run({ seed: 5, profile: { latencyMs: 40, jitterMs: 15, reorderPct: 5 } })
  assert(records.length === MESSAGES, `delivered ${records.length} of ${MESSAGES}`)
  assert(new Set(idsOf(records)).size === MESSAGES, 'a payload was delivered twice or lost')
  assert(stats.sent === stats.delivered + stats.dropped, 'sent does not equal delivered plus dropped')
})

gate('jitter alone can deliver out of send order, so the ordering claim is conditional', () => {
  const { stats } = run({ seed: 7, profile: { latencyMs: 20, jitterMs: 5 } })
  assert(stats.reordered > 0, 'jitter of 5 ms with 1 ms spacing produced no out-of-order delivery')
})

gate('a configured loss rate is respected over 100000 messages within 0.5 points', () => {
  const { stats } = run({ seed: 9, profile: { lossPct: 5 }, messages: LOSS_TRIALS })
  const observed = (stats.dropped / stats.sent) * 100
  assert(stats.sent === LOSS_TRIALS, `sent ${stats.sent}`)
  assert(stats.dropped + stats.delivered === stats.sent, 'drops and deliveries do not cover every send')
  assert(Math.abs(observed - 5) <= LOSS_TOLERANCE_POINTS, `observed loss ${observed.toFixed(3)} percent, expected 5 plus or minus ${LOSS_TOLERANCE_POINTS}`)
})

gate('the loss tolerance refuses a 10 percent expectation for a 5 percent link (control)', () => {
  const { stats } = run({ seed: 9, profile: { lossPct: 5 }, messages: LOSS_TRIALS })
  const observed = (stats.dropped / stats.sent) * 100
  assert(!(Math.abs(observed - 10) <= LOSS_TOLERANCE_POINTS), 'the 5 percent link also passed as 10 percent')
})

gate('no delivery arrives before its minimum latency without reordering', () => {
  for (const profile of [{ latencyMs: 50, jitterMs: 30 }, { latencyMs: 150, jitterMs: 20 }]) {
    const { records } = run({ seed: 11, profile })
    assert(records.length === MESSAGES, `delivered ${records.length} of ${MESSAGES} for ${JSON.stringify(profile)}`)
    for (const record of records) assertWithinLatency(record, profile)
  }
})

gate('a delivery 1 ms before the minimum latency is refused by the checker (control)', () => {
  const early = { index: 1, payload: { id: 0 }, sentAt: 0, deliveredAt: 19 }
  let refused = false
  try {
    assertWithinLatency(early, { latencyMs: 50, jitterMs: 30 })
  } catch {
    refused = true
  }
  assert(refused, 'an early delivery was accepted')
})

gate('reordering moves messages but keeps every payload exactly once', () => {
  const { records, stats } = run({ seed: 13, profile: { latencyMs: 20, jitterMs: 5, reorderPct: 10 } })
  assert(records.length === MESSAGES, `delivered ${records.length} of ${MESSAGES}`)
  assert(new Set(idsOf(records)).size === MESSAGES, 'a payload was delivered twice or lost')
  assert(stats.reordered > 0, 'reordering at 10 percent produced no out-of-order delivery')
})

gate('the same seed and a different seed produce different sequences (control)', () => {
  const profile = NETWORK_SIM_PRESETS.roadmapTarget
  const first = run({ seed: 42, profile })
  const other = run({ seed: 43, profile })
  assert(sequenceOf(first.records) !== sequenceOf(other.records), 'seeds 42 and 43 produced the same sequence')
})

gate('the seeded generator repeats for a seed and stays within [0, 1)', () => {
  const first = createSeededRandom(77)
  const second = createSeededRandom(77)
  const values = Array.from({ length: 10000 }, () => first())
  assert(values.every((value) => value >= 0 && value < 1), 'a value fell outside [0, 1)')
  assert(values.every((value) => value === second()), 'two generators with one seed diverged')
})

gate('profiles outside their ranges or with unknown fields are refused', () => {
  const refused = [
    { lossPct: 101 },
    { lossPct: -1 },
    { latencyMs: Number.NaN },
    { jitterMs: Infinity },
    { latencyMs: SIM_MAX_DELAY_MS + 1 },
    { latencyMs: SIM_MAX_DELAY_MS, jitterMs: 1 },
    { reorderPct: '5' },
    { bogus: 1 },
    { toString: 1 }
  ]
  const missed = refused.filter((partial) => !refuses(partial))
  assert(missed.length === 0, `accepted ${JSON.stringify(missed)}`)
  for (const [name, preset] of Object.entries(NETWORK_SIM_PRESETS)) {
    normalizeSimProfile(preset, name)
  }
  const link = createSimLink({ seed: 1, profile: NETWORK_SIM_PRESETS.clean })
  let configureRefused = false
  try {
    link.configure({ lossPct: 101 })
  } catch {
    configureRefused = true
  }
  assert(configureRefused, 'configure accepted lossPct 101')
})

gate('close drops in-flight messages and refuses later sends', () => {
  const link = createSimLink({ seed: 2, profile: { latencyMs: 100 } })
  link.send({ id: 0 }, 0)
  link.close()
  assert(link.advance(Infinity).length === 0, 'a message survived close')
  assert(link.send({ id: 1 }, 1) === false, 'send was accepted after close')
  assert(link.isOpen() === false, 'link reports open after close')
})

finish()
