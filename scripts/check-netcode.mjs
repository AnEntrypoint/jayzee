import { World, InputBuffer, Predictor, Authority, canonicalInput, encodeInputs, encodeState, decodeState } from '../src/index.js'

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

const SPEED = 6
const BOXES = [[-10, 0, -10, 10, 1, 10]]

const setup = () => {
  const world = new World({ capacity: 8, boxes: BOXES })
  world.spawn([0, 3, 0])
  world.spawn([1, 6, 0.2], [-1, 0, 0])
  world.spawn([-1, 8, 0], [0.5, 0, 0.5])
  return world
}

const stateSection = () => {
  const world = setup()
  for (let i = 0; i < 30; i++) world.step()
  const state = world.exportState()
  const decoded = decodeState(encodeState(state))
  report('state round trip keeps tick and count', decoded.tick === state.tick && decoded.count === state.count)
  report('state round trip keeps every float64 bit', decoded.positions.every((v, i) => Object.is(v, state.positions[i])) && decoded.velocities.every((v, i) => Object.is(v, state.velocities[i])))

  const other = setup()
  other.importState(decoded)
  report('importState reproduces the hash exactly', other.hash() === world.hash(), { hash: world.hash() })
  for (let i = 0; i < 10; i++) {
    world.step()
    other.step()
  }
  report('restored world stays identical after further steps', other.hash() === world.hash() && other.tick === world.tick)

  let rejected = false
  try {
    setup().importState({ ...state, count: 2 })
  } catch (error) {
    rejected = error instanceof RangeError
  }
  report('importState rejects a state with the wrong body count', rejected)
  rejected = false
  try {
    decodeState(encodeState(state).slice(0, 20))
  } catch (error) {
    rejected = error instanceof RangeError
  }
  report('decodeState rejects a truncated state', rejected)
}

const bufferSection = () => {
  const record = (sequence, moveX = 0) => ({ sequence, moveX, moveZ: 0, yaw: 0.5, buttons: 0 })
  const buffer = new InputBuffer({ window: 8, maxHold: 2 })

  const ordered = new InputBuffer({ window: 8, maxHold: 2 })
  ordered.push(record(1, 1))
  ordered.push(record(2, 0.5))
  ordered.push(record(3, -1))
  const taken = [ordered.take(), ordered.take(), ordered.take()]
  report('inputs taken in sequence order', taken.map((t) => t.source).join() === 'input,input,input' && taken.map((t) => t.input.moveX).join() === '1,' + canonicalInput(record(2, 0.5)).moveX + ',-1')

  const reordered = new InputBuffer({ window: 8, maxHold: 2 })
  reordered.push(record(2, 0.5))
  reordered.push(record(1, 1))
  const first = reordered.take()
  report('out-of-order arrival is re-sorted before it is taken', first.input.sequence === 1 && first.input.moveX === 1 && reordered.take().input.sequence === 2)

  const dup = new InputBuffer({ window: 8, maxHold: 2 })
  const outcomes = [dup.push(record(1)), dup.push(record(1))]
  report('duplicate packets are counted and ignored', outcomes.join() === 'accepted,duplicate' && dup.pending === 1 && dup.stats.duplicate === 1)

  const late = new InputBuffer({ window: 8, maxHold: 2 })
  late.push(record(1))
  late.take()
  report('a packet for an already taken tick is stale', late.push(record(1)) === 'stale' && late.stats.stale === 1)

  const gap = new InputBuffer({ window: 8, maxHold: 2 })
  gap.push(record(1, 0.75))
  gap.take()
  const holds = [gap.take(), gap.take(), gap.take(), gap.take()].map((t) => t.source)
  report('a gap holds the last movement for maxHold ticks, then goes neutral', holds.join() === 'held,held,neutral,neutral', holds)
  const held = gap.take()
  report('a neutral tick carries no movement but keeps the last yaw', held.input.moveX === 0 && held.input.yaw === canonicalInput(record(1, 0.75)).yaw)

  const far = new InputBuffer({ window: 4, maxHold: 0 })
  far.push(record(1))
  far.push(record(40, 1))
  report('a sequence far ahead of the window skips the missing ticks', far.next >= 37 && far.pending === 1, { next: far.next, pending: far.pending })

  const wire = canonicalInput({ sequence: 5, moveX: 0.3, moveZ: -0.7, yaw: 4, buttons: 2 })
  report('canonical input is the wire value and is stable under re-encoding', canonicalInput(wire).moveX === wire.moveX && canonicalInput(wire).yaw === wire.yaw)
  let refused = false
  try {
    encodeInputs([{ sequence: 1, moveX: 2, moveZ: 0, yaw: 0, buttons: 0 }])
  } catch (error) {
    refused = error instanceof RangeError
  }
  report('an out-of-range input is refused rather than clamped', refused)
}

const runPrediction = (LEAD) => {
  const K = 900
  const REDUNDANCY = 16
  const rand = random(20260423)

  const intents = Array.from({ length: K }, () => ({ moveX: rand() * 2 - 1, moveZ: rand() * 2 - 1, yaw: rand() * 6.283 }))

  const offline = setup()
  const truth = [offline.hash()]
  for (let k = 1; k <= K; k++) {
    applyPlayer(offline, canonicalInput({ ...intents[k - 1], sequence: k, buttons: 0 }))
    offline.step()
    truth.push(offline.hash())
  }

  const client = setup()
  const predictor = new Predictor({ world: client, body: 0, speed: SPEED })
  const server = setup()
  const authority = new Authority({ world: server, speed: SPEED })
  authority.addPlayer(0, 0, { window: 64, maxHold: 4 })

  const channel = (loss, maxDelay) => {
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
  const inputs = channel(0.3, 3)
  const states = channel(0.1, 2)

  const history = []
  let reconciles = 0
  let maxRewind = 0
  let divergences = 0

  for (let step = 1; step <= K + LEAD; step++) {
    if (step <= K) {
      history.push(predictor.predict(intents[step - 1]))
      inputs.send(step, encodeInputs(history.slice(-REDUNDANCY)))
    }
    for (const packet of inputs.due(step)) authority.receive(0, packet)
    if (step > LEAD) states.send(step, encodeState(authority.state()))
    for (const message of states.due(step)) {
      const before = client.tick
      if (predictor.reconcile(decodeState(message))) {
        reconciles += 1
        maxRewind = Math.max(maxRewind, before - predictor.acked)
      }
    }
    if (step <= K && (client.tick !== step || client.hash() !== truth[step])) divergences += 1
    if (step > LEAD) authority.step()
  }

  for (let extra = 0; extra < 40 && predictor.acked < K; extra++) {
    const step = K + LEAD + extra
    states.send(step, encodeState(authority.state()))
    for (const message of states.due(step)) predictor.reconcile(decodeState(message))
  }

  return {
    stats: authority.stats(0),
    serverTick: server.tick,
    divergences,
    converged: predictor.acked === K && client.tick === K && client.hash() === truth[K] && server.hash() === truth[K],
    reconciles,
    maxRewind,
    pendingAfter: predictor.pending,
  }
}

const predictionSection = () => {
  const shallow = runPrediction(4)
  report('control: a 4-tick playout delay leaves gaps under loss', shallow.stats.held + shallow.stats.neutral > 0, shallow.stats)

  const run = runPrediction(12)
  report('playout delay 12 gives the server every input with no gaps', run.stats.held === 0 && run.stats.neutral === 0, run.stats)
  report('the server reached the final tick', run.serverTick === 900)
  report('prediction matched the offline trajectory at every tick', run.divergences === 0, { divergences: run.divergences, ticks: 900 })
  report('the client converged to the authoritative final state', run.converged)
  report('reconciliation ran and rewound the client', run.reconciles > 0 && run.maxRewind > 0, { reconciles: run.reconciles, maxRewind: run.maxRewind, pendingAfter: run.pendingAfter })
}

const applyPlayer = (world, input) => {
  const sin = Math.sin(input.yaw)
  const cos = Math.cos(input.yaw)
  const length = Math.hypot(input.moveX, input.moveZ)
  const scale = length > 1 ? SPEED / length : SPEED
  const dx = (cos * input.moveX - sin * input.moveZ) * scale
  const dz = (-sin * input.moveX - cos * input.moveZ) * scale
  const [, vy] = world.velocity(0)
  world.setVelocity(0, [dx, vy, dz])
}

stateSection()
bufferSection()
predictionSection()
console.log(failures.length === 0 ? 'RESULT: PASS' : 'RESULT: FAIL ' + failures.join('; '))
process.exitCode = failures.length === 0 ? 0 : 1
