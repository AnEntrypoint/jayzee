import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { DEATHRUN, DEATHRUN_COURSES, DEATHRUN_STATUS, createDeathrun } from './lib/deathrun.mjs'

const CHECKPOINTS = DEATHRUN.checkpointArcM.length
const SETTLE_TICKS = 30
const FINISH_LIMIT_TICKS = 900
const RADIAL_TOLERANCE_M = 0.1
const DECK_EDGE_TOLERANCE_M = 0.2
const RESPAWN_TOLERANCE_M = 0.6
const TIERS = SCENARIO_TIERS

const scenario = async (tier, courseName) => {
  const run = await createDeathrun(tier, courseName)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const height = []
  const supported = []
  const sinceSpawn = []
  while (!run.over) {
    if (!run.decide()) continue
    timer.start()
    run.step()
    timer.stop()
    run.record()
    height.push(run.feetHeightM)
    supported.push(run.state.supported)
    sinceSpawn.push(run.state.tick - run.state.spawnedAtTick)
  }
  const falls = []
  for (let i = 0; i < Math.min(run.state.fallCount, run.fallTick.length); i++) {
    falls.push({ tick: run.fallTick[i], x: run.falls[i * 4], z: run.falls[i * 4 + 2], feetHeightM: run.falls[i * 4 + 3], spawn: run.respawnSpawn[i], respawnAt: Array.from(run.respawnAt.subarray(i * 4, i * 4 + 3)) })
  }
  await releaseWorld(run.world)
  return {
    course: run.course,
    floorM: run.floorM,
    killHeightM: run.killHeightM,
    status: run.state.status,
    reached: Array.from(run.reached),
    finishTick: run.state.finishTick,
    fallCount: run.state.fallCount,
    respawnCount: run.state.respawnCount,
    falls,
    spawnPoints: Array.from(run.spawnPoints),
    body: Array.from(run.position.subarray(0, 3)),
    tickMs,
    height,
    supported,
    sinceSpawn,
  }
}

const bits = (values) => new Uint32Array(new Float64Array(values).buffer)

const reachedInOrder = (run) => {
  assert.equal(run.status, DEATHRUN_STATUS.finished, 'status ' + run.status)
  assert.ok(run.reached.every((tick) => tick >= 0), 'reached ' + run.reached)
  for (let i = 1; i < run.reached.length; i++) assert.ok(run.reached[i] > run.reached[i - 1], 'checkpoints out of order')
}

const respawnedAt = (run, spawn) => {
  assert.equal(run.fallCount, 1, 'falls ' + run.fallCount)
  assert.equal(run.respawnCount, 1)
  const fall = run.falls[0]
  assert.ok(fall.x > run.course.gap[0] && fall.x < run.course.gap[1], 'fell at x ' + fall.x)
  assert.ok(fall.feetHeightM < run.killHeightM && fall.feetHeightM > 0, 'feet at ' + fall.feetHeightM + ' m when reset')
  assert.equal(fall.spawn, spawn)
  const offset = Math.hypot(fall.respawnAt[0] - run.spawnPoints[spawn * 3], fall.respawnAt[1] - run.spawnPoints[spawn * 3 + 1], fall.respawnAt[2] - run.spawnPoints[spawn * 3 + 2])
  assert.ok(offset <= RESPAWN_TOLERANCE_M, 'respawned ' + offset + ' m from spawn point ' + spawn)
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, {
    first: await scenario(tier, 'surface'),
    second: await scenario(tier, 'surface'),
    pit: await scenario(tier, 'pit'),
    pitAgain: await scenario(tier, 'pit'),
    earlyPit: await scenario(tier, 'early-pit'),
    noBridge: await scenario(tier, 'no-bridge'),
  })
}

for (const tier of TIERS) {
  const { first, second, pit, pitAgain, earlyPit, noBridge } = runs.get(tier.label)
  gate(tier.label + ': the runner reaches all checkpoints in order within the tick limit', () => {
    assert.equal(first.reached.filter((tick) => tick >= 0).length, CHECKPOINTS, 'reached ' + first.reached)
    assert.ok(first.finishTick >= 0 && first.finishTick < FINISH_LIMIT_TICKS, 'finish tick ' + first.finishTick)
    reachedInOrder(first)
  })
  gate(tier.label + ': the runner stays on the planet surface within tolerance once it has landed, and the minimum-height reset never fires on solid ground', () => {
    for (let i = SETTLE_TICKS; i < first.height.length; i++) {
      assert.ok(Math.abs(first.height[i]) <= RADIAL_TOLERANCE_M, 'tick ' + i + ' radial error ' + first.height[i])
      assert.equal(first.supported[i], true, 'tick ' + i + ' is not supported')
    }
    assert.equal(first.fallCount, 0)
    assert.equal(first.respawnCount, 0)
  })
  gate(tier.label + ': two runs agree bit for bit on the finish tick and the final runner position', () => {
    assert.equal(second.finishTick, first.finishTick)
    assert.deepEqual(bits(second.body), bits(first.body))
  })
  gate(tier.label + ': pit course: the runner walks off the deck into the ' + DEATHRUN_COURSES.pit.gap.join(' to ') + ' m gap, drops below the ' + DEATHRUN.deckKillHeightM + ' m kill height and respawns at checkpoint 1, the last one it reached', () => {
    assert.equal(pit.reached[0] >= 0 && pit.reached[0] < pit.falls[0].tick, true, 'checkpoint 1 at ' + pit.reached[0] + ', fall at ' + pit.falls[0].tick)
    respawnedAt(pit, 1)
  })
  gate(tier.label + ': early pit course: a fall before the first checkpoint respawns at the start, so the respawn point follows the last checkpoint', () => {
    assert.ok(earlyPit.reached[0] > earlyPit.falls[0].tick, 'checkpoint 1 at ' + earlyPit.reached[0] + ', fall at ' + earlyPit.falls[0].tick)
    respawnedAt(earlyPit, 0)
  })
  gate(tier.label + ': pit courses: after the respawn the runner takes the bridge and still finishes all checkpoints in order within ' + DEATHRUN.tickLimit + ' ticks', () => {
    for (const run of [pit, earlyPit]) {
      reachedInOrder(run)
      assert.ok(run.finishTick < DEATHRUN.tickLimit, 'finish tick ' + run.finishTick)
      assert.ok(Math.abs(run.height[run.height.length - 1] - run.floorM) <= RADIAL_TOLERANCE_M, 'finished at height ' + run.height[run.height.length - 1])
    }
  })
  gate(tier.label + ': pit courses: a supported runner is on the deck within ' + DECK_EDGE_TOLERANCE_M + ' m, and never lower than the kill height for more than the tick that resets it', () => {
    for (const run of [pit, earlyPit]) {
      for (let i = 0; i < run.height.length; i++) {
        if (run.sinceSpawn[i] > SETTLE_TICKS && run.supported[i]) assert.ok(Math.abs(run.height[i] - run.floorM) <= DECK_EDGE_TOLERANCE_M, 'step ' + i + ' supported at height ' + run.height[i])
        if (i > 0 && run.height[i] < run.killHeightM) assert.ok(run.height[i - 1] >= run.killHeightM, 'step ' + i + ' stayed below the kill height')
      }
    }
  })
  gate(tier.label + ': with the bridge removed the runner falls on every attempt, uses both lives at checkpoint 1 and the run ends as out of respawns, not as finished', () => {
    assert.equal(noBridge.status, DEATHRUN_STATUS.outOfRespawns)
    assert.equal(noBridge.fallCount, DEATHRUN.livesPerSpawn + 1)
    assert.equal(noBridge.respawnCount, DEATHRUN.livesPerSpawn)
    assert.equal(noBridge.finishTick, -1)
    assert.deepEqual(noBridge.falls.map((fall) => fall.spawn), [1, 1, 1])
  })
  gate(tier.label + ': pit course: two runs agree bit for bit on the fall tick, the finish tick and the final runner position', () => {
    assert.equal(pitAgain.falls[0].tick, pit.falls[0].tick)
    assert.equal(pitAgain.finishTick, pit.finishTick)
    assert.deepEqual(bits(pitAgain.body), bits(pit.body))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, all six runs)', () => {
    const trace = writeTickTrace('deathrun', tier.label, [first, second, pit, pitAgain, earlyPit, noBridge].map((run) => run.tickMs))
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

if (process.env.SCENARIO_DEBUG) {
  for (const tier of TIERS) {
    const summary = {}
    for (const [name, run] of Object.entries(runs.get(tier.label))) summary[name] = { status: run.status, reached: run.reached, finishTick: run.finishTick, steps: run.height.length, falls: run.falls.map((fall) => ({ tick: fall.tick, x: Math.round(fall.x * 100) / 100, feetHeightM: Math.round(fall.feetHeightM * 1000) / 1000, spawn: fall.spawn, respawnAt: fall.respawnAt.map((v) => Math.round(v * 1000) / 1000) })) }
    console.log(JSON.stringify({ tier: tier.label, ...summary }))
  }
}

finish()
