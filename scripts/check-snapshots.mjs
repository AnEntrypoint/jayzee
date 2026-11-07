import { World, StateSender, StateReceiver, encodeDelta, decodeDelta, encodeAck, decodeAck } from '../src/index.js'

const failures = []
const report = (label, ok, detail) => {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (detail === undefined ? '' : ' ' + JSON.stringify(detail)))
  if (!ok) failures.push(label)
}

const random = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 4294967296
  }
}

const sameState = (a, b) => {
  if (a.tick !== b.tick || a.count !== b.count) return false
  for (let i = 0; i < a.positions.length; i++) {
    if (!Object.is(a.positions[i], b.positions[i]) || !Object.is(a.velocities[i], b.velocities[i])) return false
  }
  return true
}

const channel = (rand, loss, maxDelay) => {
  let queue = []
  return {
    send(step, message) {
      if (rand() < loss) return
      queue.push({ at: step + Math.floor(rand() * (maxDelay + 1)), message })
    },
    due(step) {
      const ready = queue.filter((entry) => entry.at <= step).map((entry) => entry.message)
      queue = queue.filter((entry) => entry.at > step)
      return ready
    },
  }
}

const ackRoundTrip = () => {
  report('ack round trips a tick', decodeAck(encodeAck(123456)) === 123456)
  let refused = false
  try {
    decodeAck(encodeAck(1).slice(0, 3))
  } catch (error) {
    refused = error instanceof RangeError
  }
  report('ack rejects a truncated message', refused)
}

const deltaRoundTrip = () => {
  const world = new World({ capacity: 4, boxes: [[-5, 0, -5, 5, 1, 5]] })
  world.spawn([0, 3, 0])
  world.spawn([2, 0.35, 0])
  for (let i = 0; i < 80; i++) world.step()
  const first = world.exportState()
  world.step()
  const second = world.exportState()

  const full = decodeDelta(encodeDelta(second, null))
  report('a delta without a base decodes to the full state exactly', sameState(full, second))

  const withBase = decodeDelta(encodeDelta(second, first), (tick) => (tick === first.tick ? first : null))
  report('a delta against a base decodes to the state exactly', sameState(withBase, second))

  const sizeFull = encodeDelta(second, null).byteLength
  const sizeDelta = encodeDelta(second, first).byteLength
  report('a delta against a settled base is smaller than the full state', sizeDelta < sizeFull, { sizeFull, sizeDelta })

  let refused = false
  try {
    decodeDelta(encodeDelta(second, first), () => null)
  } catch (error) {
    refused = error instanceof RangeError
  }
  report('a delta whose base is missing is refused, not guessed', refused)

  refused = false
  try {
    decodeDelta(encodeDelta(second, first).slice(0, -1), () => first)
  } catch (error) {
    refused = error instanceof RangeError
  }
  report('a truncated delta is refused', refused)
}

const streamWitness = () => {
  const rand = random(7)
  const world = new World({ capacity: 260, boxes: [[-30, 0, -30, 30, 1, 30]] })
  for (let i = 0; i < 200; i++) world.spawn([(i % 20) * 1.2 - 12, 0.35, Math.floor(i / 20) * 1.2 - 6])
  for (let i = 0; i < 40; i++) world.spawn([rand() * 20 - 10, 8 + rand() * 10, rand() * 20 - 10], [rand() * 4 - 2, 0, rand() * 4 - 2])

  const sender = new StateSender({ depth: 64 })
  const receiver = new StateReceiver({ depth: 64 })
  const stateChannel = channel(rand, 0.2, 2)
  const ackChannel = channel(rand, 0.3, 2)
  const sent = new Map()
  let fullBytes = 0
  let deltaBytes = 0
  let mismatches = 0
  let delivered = 0
  let sendFailures = 0
  const TICKS = 400

  for (let step = 1; step <= TICKS; step++) {
    world.step()
    const state = world.exportState()
    sent.set(state.tick, state)
    fullBytes += encodeDelta(state, null).byteLength
    const message = sender.send(state)
    deltaBytes += message.byteLength
    stateChannel.send(step, message)
    for (const buffer of stateChannel.due(step)) {
      let decoded
      try {
        decoded = receiver.receive(buffer)
      } catch {
        sendFailures += 1
        continue
      }
      delivered += 1
      if (!sameState(decoded, sent.get(decoded.tick))) mismatches += 1
    }
    if (receiver.latest !== null) ackChannel.send(step, encodeAck(receiver.latest))
    for (const buffer of ackChannel.due(step)) sender.acknowledge(decodeAck(buffer))
  }

  for (let extra = 0; extra < 20; extra++) {
    const step = TICKS + extra
    for (const buffer of stateChannel.due(step)) {
      const decoded = receiver.receive(buffer)
      if (!sameState(decoded, sent.get(decoded.tick))) mismatches += 1
      delivered += 1
    }
    if (receiver.latest !== null) ackChannel.send(step, encodeAck(receiver.latest))
    for (const buffer of ackChannel.due(step)) sender.acknowledge(decodeAck(buffer))
  }

  report('every delivered state matches the authoritative state bit for bit', mismatches === 0 && sendFailures === 0, { mismatches, sendFailures, delivered, ticks: TICKS })
  report('the stream reaches the receiver despite loss', receiver.latest !== null && receiver.latest >= TICKS - 16, { latest: receiver.latest })
  report('acknowledgements moved the delta base forward', sender.acked !== null && sender.acked > 0, { acked: sender.acked })
  report('delta stream is well under the full-state stream', deltaBytes < fullBytes * 0.25, { deltaBytes, fullBytes, ratio: Number((deltaBytes / fullBytes).toFixed(4)) })
}

const fallbackWitness = () => {
  const world = new World({ capacity: 4 })
  world.spawn([0, 2, 0])
  const sender = new StateSender({ depth: 4 })
  const receiver = new StateReceiver({ depth: 4 })
  let allFullWithoutAck = true
  for (let i = 0; i < 6; i++) {
    world.step()
    const state = world.exportState()
    const buffer = sender.send(state)
    if (new DataView(buffer).getUint8(1) !== 0) allFullWithoutAck = false
    receiver.receive(buffer)
  }
  report('with no acknowledgement every delta is a full state', allFullWithoutAck)

  world.step()
  const first = world.exportState()
  sender.send(first)
  sender.acknowledge(first.tick)
  const acked = sender.acked
  for (let i = 0; i < 8; i++) {
    world.step()
    sender.send(world.exportState())
  }
  const late = world.exportState()
  const afterPrune = sender.send(late)
  report('an acknowledged base that has fallen out of history gives a full state', new DataView(afterPrune).getUint8(1) === 0 && acked === first.tick)
  report('a stale acknowledgement is ignored', sender.acknowledge(first.tick) === false)
}

ackRoundTrip()
deltaRoundTrip()
streamWitness()
fallbackWitness()
console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL ' + failures.join('; '))
process.exitCode = failures.length === 0 ? 0 : 1
