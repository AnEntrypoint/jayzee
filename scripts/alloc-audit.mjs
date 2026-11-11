import { PerformanceObserver } from 'node:perf_hooks'
import { getHeapSpaceStatistics } from 'node:v8'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { Scene } from 'three'
import { createPlayerLodPlanner } from '../src/client-pure/playerLodPlanner.js'
import { createVsyncMonitor, createPerfTracker } from '../src/client-pure/frameMetrics.js'
import { tickBatch } from '../src/client-pure/transformLerp.js'
import { crowdPoseBuffer, decodeCrowdDotPoses } from '../src/client/crowdDots.js'
import { installPlayerLodRenderer } from '../src/client/playerLodRenderer.js'
import { PredictionEngine } from '../src/client/PredictionEngine.js'
import { SnapshotTimeline } from '../src/client/SnapshotTimeline.js'
import { SnapshotProcessor } from '../src/client/SnapshotProcessor.js'
import { AnimationSystem } from '../src/animation/animationSystem.js'
import { FootIKSolver, IKRig, TwoBoneIKSolver, makeTwoBoneResult } from '../src/animation/ikSolver.js'
import { SpringBoneChain } from '../src/animation/springBones.js'
import { encodePlayer } from '../src/snapshot-lod-pure/playerLod.js'
import { encodeEntity } from '../src/snapshot-lod-pure/entityDelta.js'

const WARMUP_CALLS = 20000
const COLLECTION_ALLOWANCE = 1
const MEASURED_CALLS = 50000
const PLAYERS = 64

assert.equal(typeof globalThis.gc, 'function', 'run with node --expose-gc --max-semi-space-size=1')

const gcKinds = []
const observer = new PerformanceObserver((list) => {
  for (const entry of list.getEntries()) gcKinds.push(entry.detail ? entry.detail.kind : entry.kind)
})
observer.observe({ entryTypes: ['gc'] })
const settle = () => new Promise((done) => setTimeout(done, 20))

const newSpaceBytes = () => getHeapSpaceStatistics().find((space) => space.space_name === 'new_space').space_size / 2

const measure = async (name, tick) => {
  for (let i = 0; i < WARMUP_CALLS; i++) tick(i)
  globalThis.gc()
  globalThis.gc()
  await settle()
  gcKinds.length = 0
  for (let i = 0; i < MEASURED_CALLS; i++) tick(WARMUP_CALLS + i)
  await settle()
  const collections = gcKinds.length
  return { name, calls: MEASURED_CALLS, collections, bytesPerCallEstimate: Math.round((collections * newSpaceBytes()) / MEASURED_CALLS) }
}

const entries = Array.from({ length: PLAYERS }, (_, i) => ({ id: i + 1, x: 150 + i * 3, y: 0, z: (i % 8) * 4 }))
const viewer = { x: 0, y: 2, z: 0 }
const bucketDots = Array.from({ length: PLAYERS }, (_, i) => [i % 8, Math.floor(i / 8), (i % 5) + 1])

const planner = createPlayerLodPlanner()
const lod = installPlayerLodRenderer(new Scene(), {})
const vsync = createVsyncMonitor()
const frameStamps = ['boxed', ...Array.from({ length: WARMUP_CALLS + MEASURED_CALLS }, (_, i) => (i + 1) * 16.7)]
const sampleTimes = ['boxed', ...Array.from({ length: 50 }, (_, i) => 1250.5 + i)]
const perf = createPerfTracker()
const renderInfo = { calls: 10, triangles: 100 }
const lerpState = {}
const lerpRecords = Array.from({ length: PLAYERS }, (_, i) => ({ mesh: { position: { x: i, y: 0, z: 0 }, quaternion: { x: 0, y: 0, z: 0, w: 1 } }, target: { x: i + 1, y: 0, z: 0, vx: 0, vy: 0, vz: 0, rx: 0, ry: 0, rz: 0, rw: 1 }, last: { hasRot: true } }))
const poses = crowdPoseBuffer(PLAYERS)
const poseOptions = { viewerY: 0 }

let wall = 1000
let mono = 5000
const prediction = new PredictionEngine(60, { now: () => wall, renderNow: () => mono })
prediction.init('p1', { position: [0, 1, 0] })
const forward = { forward: true, yaw: 0 }

const timeline = new SnapshotTimeline({ tickRate: 10 })
const playerAt = (id, tick) => ({ id, position: [tick, 0, id], velocity: [0, 0, 0], rotation: [0, 0, 0, 1], onGround: false, health: 100, crouch: 0, expr: 0, weapon: 0 })
for (let tick = 10; tick < 14; tick++) timeline.addSnapshot({ tick, players: Array.from({ length: 16 }, (_, i) => playerAt(i + 1, tick)) }, 1000 + (tick - 10) * 100)

const HUMANOID = ['Hips', 'Spine', 'Chest', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'RightUpLeg', 'RightLeg', 'RightFoot']
const quietBlender = { playClip() {}, updateBlend() {}, getClipDuration: () => 1, stop() {}, registerClip() {}, crossFade() {}, setBlendTree() {}, stopAll() {} }
let animationClock = 0
const legRig = new IKRig(null)
legRig.createChain('leftLeg').addSolver(new TwoBoneIKSolver([0, 1, 0], [0, 0.5, 0.05], [0, 0, 0]))
legRig.createChain('rightLeg').addSolver(new TwoBoneIKSolver([0, 1, 0], [0, 0.5, 0.05], [0, 0, 0]))
const groundHit = { y: -0.05 }
const footWorld = [0.2, 0, 0.3]
const animation = new AnimationSystem(
  { bones: HUMANOID.map((name) => ({ name, quaternion: [0, 0, 0, 1] })) },
  quietBlender,
  { raycastCallback: () => groundHit },
  { now: () => animationClock, ikRig: legRig, readFootWorld: () => footWorld, moveHips() {} },
)
animation.initializeController()
const motionStates = [
  { speed: 0, direction: [0, 0, 1], isGrounded: true, verticalVelocity: 0 },
  { speed: 2, direction: [0, 0, 1], isGrounded: true, verticalVelocity: 0 },
  { speed: 5, direction: [1, 0, 0], isGrounded: true, verticalVelocity: 0 },
]

const SPRING_BONES = 6
const spring = new SpringBoneChain(
  Array.from({ length: SPRING_BONES }, (_, k) => [0, 1.6 - k * 0.1, 0]),
  Array.from({ length: SPRING_BONES }, () => [0, 0, 0, 1]),
  [0, 0, 0, 1],
  { amount: 0.5, bounce: 0.5, gravity: 0.3, wind: { force: 0.4 }, limit: 60, colliders: [{ index: 0, radius: 0.08, offset: [0, -0.05, 0] }] },
)
const springRoots = Array.from({ length: 64 }, (_, i) => [Math.sin(i / 10) * 0.2, 1.6, Math.cos(i / 10) * 0.2])
const windDirection = [1, 0, 0]
const heldSpring = new SpringBoneChain(
  Array.from({ length: SPRING_BONES }, (_, k) => [0, 1.6 - k * 0.1, 0]),
  Array.from({ length: SPRING_BONES }, () => [0, 0, 0, 1]),
  [0, 0, 0, 1],
  { amount: 0.5, bounce: 0.5, gravity: 0.3, wind: { force: 0.4 }, limit: 60, colliders: [{ index: 0, radius: 0.08, offset: [0, -0.05, 0] }] },
)
const heldSpringQuats = []

const halfTurn = Math.SQRT1_2
const legPose = {
  parentWorldQuat: [0, 0, 0, 1],
  parentMatrixWorld: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
  rootWorld: [0, 1, 0],
  middleWorld: [0, 0.5, 0.05],
  endWorld: [0, 0, 0],
  rootWorldQuat: [0, 0, 0, 1],
  middleWorldQuat: [0, halfTurn, 0, halfTurn],
  rootLocal: [0, 0, 0, 1],
  middleLocal: [0, halfTurn, 0, halfTurn],
}
const twoBone = new TwoBoneIKSolver(legPose.rootWorld, legPose.middleWorld, legPose.endWorld)
const heldIkResult = makeTwoBoneResult()
const ikTargets = Array.from({ length: 64 }, (_, i) => [0.1 + (i % 8) * 0.02, 0.2 + (i % 5) * 0.03, 0.15])
const footHit = [0, -0.1, 0]
const footSolver = new FootIKSolver(() => footHit)
const footParent = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.5, 1, -2, 1]

const SNAPSHOT_ENTITIES = 32
const SNAPSHOT_VARIANTS = 8
const snapshots = Array.from({ length: SNAPSHOT_VARIANTS }, (_, v) => ({
  tick: v + 1,
  timestamp: 1000 + v * 50,
  players: Array.from({ length: PLAYERS }, (_, i) => encodePlayer({ id: i + 1, position: [i + v * 0.1, 1, i % 8], rotation: [0, 0, 0, 1], velocity: [0.5, 0, 0], onGround: true, health: 100 })),
  entities: Array.from({ length: SNAPSHOT_ENTITIES }, (_, i) => encodeEntity({ id: 'e' + i, model: 'crate', position: [i, v * 0.1, 2], rotation: [0, 0, 0, 1], velocity: [0, 0, 0], bodyType: 'dynamic', custom: null, scale: [1, 1, 1] })),
}))
const snapshotProcessor = new SnapshotProcessor()

const cases = [
  ['player LOD planner, plan() over 64 remote players', () => planner.plan(entries, viewer, null)],
  ['player LOD renderer, tick() with fallback dots', () => lod.tick(entries, viewer, null, null)],
  ['player LOD renderer, tick() with server dots', () => lod.tick(entries, viewer, bucketDots, null)],
  ['vsync monitor, tick()', (i) => vsync.tick(frameStamps[i + 1], 4)],
  ['perf tracker, sample()', (i) => perf.sample(16 + (i % 3), renderInfo, PLAYERS, 10)],
  ['transform lerp, tickBatch() over 64 records', () => tickBatch(lerpState, lerpRecords, 0.5, 0.016)],
  ['crowd dots, decodeCrowdDotPoses() into a held buffer', () => decodeCrowdDotPoses(bucketDots, poseOptions, poses)],
  ['prediction engine, predict() and getRenderState()', (i) => {
    wall += 16
    mono += 16
    prediction.predict(forward)
    prediction.getRenderState(mono)
  }],
  ['snapshot timeline, sample()', (i) => timeline.sample(sampleTimes[(i % 50) + 1])],
]

const measuredCases = [
  ['animation system, update() with a controller, foot grounding and a two-leg IK rig', (i) => {
    animationClock += 16
    animation.update(0.016, motionStates[(i >> 6) % 3])
  }, 40],
  ['spring bones, update() returning a fresh list over a 6-bone chain with wind and one collider', (i) => spring.update(0.016, springRoots[i & 63], windDirection), 90],
  ['spring bones, update() into a held list over a 6-bone chain with wind and one collider', (i) => heldSpring.update(0.016, springRoots[i & 63], windDirection, heldSpringQuats), 70],
  ['two-bone IK solver, solve() returning a fresh result', (i) => {
    twoBone.target = ikTargets[i & 63]
    twoBone.solve(legPose)
  }, 45],
  ['two-bone IK solver, solve() into a held result', (i) => {
    twoBone.target = ikTargets[i & 63]
    twoBone.solve(legPose, heldIkResult)
  }, 30],
  ['foot IK solver, solve() under a parent matrix', () => footSolver.solve(footWorld, footParent), 22],
  ['snapshot processor, processSnapshot() over 64 players and 32 entities', (i) => snapshotProcessor.processSnapshot(snapshots[i & 7], i, 1), 8],
]

const onlyArg = process.argv.slice(2).find((arg) => arg.startsWith('--only='))
const wanted = ([name]) => !onlyArg || name.includes(onlyArg.slice(7))
const rows = []
for (const [name, tick] of cases.filter(wanted)) rows.push(await measure(name, tick))
const measuredRows = []
for (const [name, tick, ceiling] of measuredCases.filter(wanted)) measuredRows.push({ ...(await measure(name, tick)), measured: true, ceiling })
observer.disconnect()
const outArg = process.argv.slice(2).find((arg) => arg.startsWith('--out='))
if (outArg) writeFileSync(outArg.slice(6), JSON.stringify([...rows, ...measuredRows], null, 1) + '\n')
for (const row of [...rows, ...measuredRows]) console.log(String(row.collections).padStart(5) + ' collections in ' + row.calls + ' calls, about ' + String(row.bytesPerCallEstimate).padStart(5) + ' bytes per call  ' + row.name)
for (const row of rows) {
  gate(row.name + ' runs ' + row.calls + ' calls with at most ' + COLLECTION_ALLOWANCE + ' garbage collection after warm-up', () => {
    assert.ok(row.collections <= COLLECTION_ALLOWANCE, row.collections + ' collections, about ' + row.bytesPerCallEstimate + ' bytes per call')
  })
}
for (const row of measuredRows) {
  gate(row.name + ' is a measured row that allocates per call: at most ' + row.ceiling + ' garbage collections in ' + row.calls + ' calls after warm-up', () => {
    assert.ok(row.collections <= row.ceiling, row.collections + ' collections, about ' + row.bytesPerCallEstimate + ' bytes per call')
  })
}
finish()
