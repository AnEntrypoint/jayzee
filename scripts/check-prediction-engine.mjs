import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { gate, finish } from './lib/gate.mjs'
import { PredictionEngine, INPUT_HISTORY_FLOOR, MOVE_STATE_KEYS } from '../src/client/PredictionEngine.js'
import { createStepTrail } from '../src/client/StepTrail.js'
import { separationPush, SEPARATION_PUSH_VELOCITY_CAP } from '../src/netcode/separationPush.js'

let wall = 1000
let mono = 5000
const engine = (rate = 60) => new PredictionEngine(rate, { now: () => wall, renderNow: () => mono })
const snap = (fields) => ({ players: [{ id: 'p1', rotation: [0, 0, 0, 1], onGround: true, ...fields }] })
const forward = { forward: true, yaw: 0 }

gate('a missing clock is refused, where spoint read Date.now and performance.now', () => {
  assert.throws(() => new PredictionEngine(60), /options\.now/)
  assert.throws(() => new PredictionEngine(60, { now: () => 0 }), /options\.renderNow/)
  assert.ok(new PredictionEngine(60, { now: () => 0, renderNow: () => 0 }))
})

gate('input history holds max(257, ceil(10000 ms / tick)) and only grows', () => {
  const e = engine(60)
  assert.equal(INPUT_HISTORY_FLOOR, 257)
  assert.deepEqual([e.inputHistory.capacity, e.inputHistoryHardCap()], [600, 600])
  e.setTickRate(20)
  assert.equal(e.inputHistory.capacity, 600)
  e.setTickRate(1000)
  assert.equal(e.inputHistory.capacity, 10000)
  e.setTickRate(0)
  assert.equal(e.tickRate, 1000)
})

const a = engine(60)
a.init('p1', { position: [0, 1, 0] })
for (let i = 0; i < 10; i++) a.addInput(forward)
const pos10 = [...a.localState.position]
const vel10 = [...a.localState.velocity]
const lead0 = a.predictionLeadSteps()
a.onServerSnapshot(snap({ position: [0, 1, 0.3], velocity: [0, 0, 5], inputSequence: 3 }), 1)
const afterFirst = [...a.localState.position]
const stats1 = { ...a.stats }
const lead1 = a.predictionLeadSteps()
const hist1 = a.inputHistory.length
const at6 = a.predictedAt(6)
a.onServerSnapshot(snap({ position: [...at6.position], velocity: [...at6.velocity], inputSequence: 6 }), 2)
const stats2 = { ...a.stats }
a.onServerSnapshot(snap({ position: [0.5, 1, at6.position[2]], velocity: [0, 0, 7], inputSequence: 8 }), 3)
const stats3 = { ...a.stats }
const afterCorr = [...a.localState.position]
const wedged3 = a.horizontallyWedged
const wedgeNormal3 = [...a.wedgeNormal]
mono += 16
const render1 = [...a.getRenderState(NaN).position]
mono += 100
const render2 = [...a.getRenderState(NaN).position]

gate('ten forward inputs at 60 Hz reach maxSpeed 7 and z 1.1666666666666667 as in spoint', () => {
  assert.deepEqual(pos10, [0, 1, 1.1666666666666667])
  assert.deepEqual(vel10, [0, 0, 7])
  assert.equal(lead0, 0)
})

gate('first contact rebases on the server state and replays seven inputs without counting a correction', () => {
  assert.deepEqual(afterFirst, [0, 1, 1.1166666666666667])
  assert.equal(stats1.acks, 1)
  assert.equal(stats1.corrections, 0)
  assert.equal(stats1.lastCorrectionM, 0)
  assert.equal(lead1, 7)
  assert.equal(hist1, 7)
})

gate('an ack that matches the prediction within 0.015 m is not a correction', () => {
  assert.equal(stats2.acks, 2)
  assert.equal(stats2.corrections, 0)
})

gate('a lateral server offset is a correction of 0.6839428176227731 m and wedges along normal [-0, -1]', () => {
  assert.equal(stats3.acks, 3)
  assert.equal(stats3.corrections, 1)
  assert.equal(stats3.lastCorrectionM, 0.6839428176227731)
  assert.equal(stats3.maxCorrectionM, 0.6839428176227731)
  assert.deepEqual(afterCorr, [0.5, 1, 0.65])
  assert.equal(wedged3, true)
  assert.ok(Object.is(wedgeNormal3[0], -0) && wedgeNormal3[1] === -1)
})

gate('the render state hides the correction on the first decay and eases it on the injected render clock', () => {
  assert.deepEqual(render1, [0, 1, 1.1166666666666667])
  assert.deepEqual(render2, [0.3567476015699049, 1, 0.7837022385347554])
})

gate('negative control: a perturbed render clock changes the eased position', () => {
  const b = engine(60)
  b.init('p1', { position: [0, 1, 0] })
  for (let i = 0; i < 10; i++) b.addInput(forward)
  b.onServerSnapshot(snap({ position: [0, 1, 0.3], velocity: [0, 0, 5], inputSequence: 3 }), 1)
  const p6 = b.predictedAt(6)
  b.onServerSnapshot(snap({ position: [...p6.position], velocity: [...p6.velocity], inputSequence: 6 }), 2)
  b.onServerSnapshot(snap({ position: [0.5, 1, p6.position[2]], velocity: [0, 0, 7], inputSequence: 8 }), 3)
  mono = 5016
  b.getRenderState(NaN)
  mono = 5016 + 50
  assert.notDeepEqual([...b.getRenderState(NaN).position], render2)
})

gate('an ack that is not newer is ignored and a stale sequence is not counted', () => {
  const before = a.stats.acks
  a.onServerSnapshot(snap({ position: [0.5, 1, 0.65], velocity: [0, 0, 7], inputSequence: 8 }), 4)
  assert.equal(a.stats.acks, before)
})

gate('a peer 0.3 m away is pushed apart by half the overlap with the velocity capped at 3 m/s', () => {
  const e = engine(60)
  e.init('p1', { position: [0, 1, 0] })
  e.setPeers(new Map([['p2', { position: [0.3, 1, 0], velocity: [0, 0, 0] }], ['p1', { position: [0, 1, 0] }]]))
  e.addInput(null)
  assert.deepEqual([...e.localState.position], [-0.25, 1, 0])
  assert.deepEqual([...e.localState.velocity], [-3, 0, 0])
  assert.equal(e.separationDistM, 0.8)
  e.setPlayerRadius(-1)
  assert.equal(e.separationDistM, 0.8)
})

gate('separationPush refuses a peer at or beyond the minimum distance and a coincident peer', () => {
  const out = [9, 9, 9, 9]
  assert.equal(separationPush(0.8, 0, 0, 0.8, 1 / 60, out), false)
  assert.equal(separationPush(0, 0, 0, 0.8, 1 / 60, out), false)
  assert.deepEqual(out, [9, 9, 9, 9])
  assert.equal(separationPush(0.6, 0, 0, 0.8, 1, out), true)
  assert.ok(Math.abs(out[0] - 0.1) < 1e-12 && Math.abs(out[2] - 0.1) < 1e-12)
  assert.equal(SEPARATION_PUSH_VELOCITY_CAP, 3)
})

gate('timed inputs render from the step trail between steps', () => {
  const e = engine(60)
  e.init('p1', { position: [0, 1, 0] })
  e.addInput(forward, 100, 16)
  e.addInput(forward, 116, 16)
  assert.deepEqual([...e.getRenderState(116).position], [0, 1, 0.11666666666666667])
  assert.deepEqual([...e.localState.position], [0, 1, 0.23333333333333334])
})

gate('the step trail resets on a non-increasing time and samples nothing below two points', () => {
  const trail = createStepTrail()
  const out = [0, 0, 0]
  trail.push(10, 0, 0, 0)
  assert.equal(trail.sample(10, out), false)
  trail.push(20, 10, 0, 0)
  assert.equal(trail.sample(15, out), true)
  assert.deepEqual(out, [5, 0, 0])
  trail.push(20, 1, 1, 1)
  assert.equal(trail.length, 1)
  for (let i = 0; i < 6; i++) trail.push(30 + i, i, 0, 0)
  assert.equal(trail.length, 4)
  assert.equal(trail.sample(NaN, out), false)
})

gate('knockback inside its 200 ms window raises velocity along the push, read from the injected clock', () => {
  const run = (laterMs) => {
    wall = 1000
    const e = engine(60)
    e.init('p1', { position: [0, 1, 0] })
    e.addInput({})
    e.addInput({})
    e.onServerSnapshot(snap({ position: [0, 1, 0], velocity: [0, 0, 0], inputSequence: 1 }), 1)
    e.recordKnockback([1, 0, 0], 4)
    wall += laterMs
    e.onServerSnapshot(snap({ position: [1, 1, 0], velocity: [0, 0, 0], inputSequence: 2 }), 2)
    return [...e.localState.velocity]
  }
  assert.deepEqual(run(0), [4, 0, 0])
  assert.deepEqual(run(201), [0, 0, 0])
})

gate('a snapshot at or before the teleport tick is ignored, and a malformed player is not acked', () => {
  const e = engine(60)
  e.init('p1', { position: [0, 1, 0] })
  e.teleport([9, 9, 9], null, 10)
  e.onServerSnapshot(snap({ position: [1, 1, 0], velocity: [0, 0, 0], inputSequence: 2 }), 10)
  assert.deepEqual([...e.localState.position], [9, 9, 9])
  assert.equal(e.stats.acks, 0)
  e.onServerSnapshot({ players: [{ id: 'p1', position: [NaN, 0, 0], rotation: [0, 0, 0, 1], velocity: [0, 0, 0] }] }, 11)
  assert.equal(e.stats.acks, 0)
  e.onServerSnapshot(snap({ position: [1, 1, 0], velocity: [0, 0, 0], inputSequence: 0 }), 11)
  assert.equal(e.stats.acks, 1)
})

gate('wall planes are cached as nx, nz, d triples and a wall behind the player is forgotten', () => {
  const e = engine(60)
  e.init('p1', { position: [0, 1, 0] })
  e.onServerSnapshot(snap({ position: [0, 1, 0], velocity: [0, 0, 0], inputSequence: 0, wallPlanes: [0, -1, -0.5, 1, 0, -3] }), 1)
  assert.deepEqual(e.walls.map((w) => ({ ...w })), [{ nx: 0, nz: -1, d: -0.5, ay: 1, tMin: 0, tMax: 0 }, { nx: 1, nz: 0, d: -3, ay: 1, tMin: 0, tMax: 0 }])
  e.onServerSnapshot(snap({ position: [0, 1, 1], velocity: [0, 0, 0], inputSequence: 0 }), 2)
  assert.equal(e.walls.length, 1)
  assert.equal(e.walls[0].nx, 1)
})

gate('a chart transfer re-expresses state and replays the two inputs past the ack from the server base', () => {
  const e = engine(60)
  const shift = (p, o) => { o[0] = p[0] + 10; o[1] = p[1]; o[2] = p[2]; return o }
  const looks = []
  const pass = { transfer: { tiltRad: 0, point: shift, vec: (v, o) => o }, point: (p) => shift(p, p), vector() {}, yawRotation() {}, look: (d) => looks.push(d) }
  e.init('p1', { position: [0, 1, 0] })
  for (let i = 0; i < 4; i++) e.addInput(forward)
  e.onServerSnapshot(snap({ position: [0, 1, 0.1], velocity: [0, 0, 6], inputSequence: 2 }), 1)
  assert.deepEqual([...e.localState.position], [0, 1, 0.33333333333333337])
  e.applyChartTransfer(pass, 2)
  assert.deepEqual([...e.localState.position], [10, 1, 0.33333333333333337])
  assert.deepEqual([...e.lastServerState.position], [10, 1, 0.1])
  assert.equal(e.stats.chartReanchors, 1)
  assert.equal(e.stats.chartReplayInputs, 2)
  assert.equal(e.stats.chartReplayBase, 'server')
  assert.equal(e.stats.chartReplayShiftM, 0)
  assert.equal(looks.length, 2)
})

gate('resyncToServer without history drops every unacked input', () => {
  const e = engine(60)
  e.init('p1', { position: [0, 1, 0] })
  e.addInput(forward)
  e.addInput(forward)
  e.resyncToServer({ keepHistory: true })
  assert.equal(e.inputHistory.length, 2)
  e.resyncToServer({ keepHistory: false })
  assert.equal(e.inputHistory.length, 0)
  assert.equal(e.predictionLeadSteps(), 0)
  assert.equal(MOVE_STATE_KEYS.length, 8)
})

gate('the ported sources carry no comments and read no host globals', () => {
  for (const path of ['../src/client/PredictionEngine.js', '../src/client/StepTrail.js', '../src/netcode/separationPush.js']) {
    const text = readFileSync(new URL(path, import.meta.url), 'utf8')
    assert.doesNotMatch(text, /\/\/|\/\*/, path)
    assert.doesNotMatch(text, /Date\.now|performance\.|globalThis|Math\.random|console\.|process\.|setTimeout|window\./, path)
  }
})

finish()
