import assert from 'node:assert/strict'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { SCENARIO_TIERS } from './lib/scenarioTiers.mjs'
import { BOSS_FIGHT, createBossFight } from './lib/bossFight.mjs'

const SETTLE_TICKS = 60
const RADIAL_TOLERANCE_M = 0.1
const PATH_SEED = 20261111
const OTHER_SEED = 99
const SLOW_SHOT_M_S = 8
const MIN_TARGET_PATH_M = 10
const HITS_TO_KILL = Math.ceil(BOSS_FIGHT.bossHealth / BOSS_FIGHT.playerDamage)
const TIERS = SCENARIO_TIERS

const scenario = async (tier, options) => {
  const fight = await createBossFight(tier, options)
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const radial = []
  const bossHealth = []
  const playerTrail = []
  while (fight.decide()) {
    timer.start()
    fight.step()
    timer.stop()
    fight.record()
    radial.push({ tick: fight.state.tick - 1, error: fight.state.bossRadialError, supported: fight.state.bossSupported, playerError: fight.state.playerRadialError, playerSupported: fight.state.playerSupported })
    bossHealth.push(fight.state.bossHealth)
    playerTrail.push(fight.playerBody[0], fight.playerBody[1], fight.playerBody[2])
  }
  await releaseWorld(fight.world)
  return { ...fight.state, boss: { health: fight.state.bossHealth }, player: { health: fight.state.playerHealth }, radial, bossHealth, playerTrail, tickMs, final: [...fight.bossBody, ...fight.playerBody] }
}

const bits = (values) => new Uint32Array(new Float64Array(values).buffer)

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, {
    first: await scenario(tier, { moving: false }),
    second: await scenario(tier, { moving: false }),
    moving: await scenario(tier, { moving: true, seed: PATH_SEED }),
    movingAgain: await scenario(tier, { moving: true, seed: PATH_SEED }),
    otherSeed: await scenario(tier, { moving: true, seed: OTHER_SEED }),
    slowShots: await scenario(tier, { moving: true, seed: PATH_SEED, shotSpeedMS: SLOW_SHOT_M_S }),
  })
}

for (const tier of TIERS) {
  const { first, second, moving, movingAgain, otherSeed, slowShots } = runs.get(tier.label)
  gate(tier.label + ': the boss is defeated within the tick limit and the player survives', () => {
    assert.ok(first.boss.health <= 0, 'boss health ' + first.boss.health + ' after ' + first.tick + ' ticks')
    assert.ok(first.player.health > 0, 'player health ' + first.player.health)
  })
  gate(tier.label + ': the boss closes to its attack range before it dies (the chase and attack phases ran)', () => {
    assert.ok(first.closest <= BOSS_FIGHT.bossStopM, 'closest approach ' + first.closest + ' m')
  })
  gate(tier.label + ': the boss stays on the planet surface within tolerance and supported after the settle window', () => {
    for (const sample of first.radial) {
      if (sample.tick < SETTLE_TICKS) continue
      assert.ok(Math.abs(sample.error) <= RADIAL_TOLERANCE_M, 'tick ' + sample.tick + ' radial error ' + sample.error)
      assert.equal(sample.supported, true, 'tick ' + sample.tick + ' is not supported')
    }
  })
  gate(tier.label + ': two runs agree bit for bit on the boss health trail and the final positions', () => {
    assert.equal(second.tick, first.tick)
    assert.deepEqual(second.bossHealth, first.bossHealth)
    assert.deepEqual(bits(second.final), bits(first.final))
  })
  gate(tier.label + ': moving target: the player walks its own seeded path (at least ' + MIN_TARGET_PATH_M + ' m, at least one waypoint reached) and stays on the surface and supported', () => {
    assert.ok(moving.playerPathM >= MIN_TARGET_PATH_M, 'player walked ' + moving.playerPathM + ' m')
    assert.ok(moving.waypointsReached >= 1, 'no waypoint was reached')
    for (const sample of moving.radial) {
      if (sample.tick < SETTLE_TICKS) continue
      assert.ok(Math.abs(sample.playerError) <= RADIAL_TOLERANCE_M, 'tick ' + sample.tick + ' player radial error ' + sample.playerError)
      assert.equal(sample.playerSupported, true, 'tick ' + sample.tick + ' player is not supported')
      assert.ok(Math.abs(sample.error) <= RADIAL_TOLERANCE_M, 'tick ' + sample.tick + ' boss radial error ' + sample.error)
      assert.equal(sample.supported, true, 'tick ' + sample.tick + ' boss is not supported')
    }
  })
  gate(tier.label + ': moving target: the chaser still reaches the moving player (inside ' + BOSS_FIGHT.bossStopM + ' m) and lands at least one attack', () => {
    assert.ok(moving.closest <= BOSS_FIGHT.bossStopM, 'closest approach ' + moving.closest + ' m')
    assert.ok(moving.bossAttacks >= 1, 'the boss never attacked')
    assert.equal(moving.player.health, BOSS_FIGHT.playerHealth - moving.bossAttacks * BOSS_FIGHT.bossAttackDamage)
  })
  gate(tier.label + ': moving target: the shooter kills the moving boss with shots that travel at ' + BOSS_FIGHT.shotSpeedMS + ' m/s, each hit within ' + BOSS_FIGHT.shotHitRadiusM + ' m of the boss, and the player survives', () => {
    assert.ok(moving.boss.health <= 0, 'boss health ' + moving.boss.health + ' after ' + moving.tick + ' ticks')
    assert.ok(moving.player.health > 0, 'player health ' + moving.player.health)
    assert.equal(moving.shotsHit, HITS_TO_KILL)
    assert.equal(moving.shotsDropped, 0)
    assert.ok(moving.worstHitM > 0 && moving.worstHitM <= BOSS_FIGHT.shotHitRadiusM, 'worst hit ' + moving.worstHitM + ' m')
    assert.equal(BOSS_FIGHT.bossHealth - moving.shotsHit * BOSS_FIGHT.playerDamage, moving.boss.health)
  })
  gate(tier.label + ': moving target: shots slowed to ' + SLOW_SHOT_M_S + ' m/s miss at least once, so a hit is a test against the boss position and not granted by range', () => {
    assert.ok(slowShots.shotsMissed >= 1, 'no slow shot missed')
    assert.ok(slowShots.shotsFired > slowShots.shotsHit, 'every slow shot hit')
  })
  gate(tier.label + ': moving target: another seed gives another player path, and the same seed repeats bit for bit', () => {
    assert.notDeepEqual(bits(otherSeed.playerTrail.slice(0, 600)), bits(moving.playerTrail.slice(0, 600)))
    assert.equal(movingAgain.tick, moving.tick)
    assert.deepEqual(movingAgain.bossHealth, moving.bossHealth)
    assert.deepEqual(bits(movingAgain.playerTrail), bits(moving.playerTrail))
    assert.deepEqual(bits(movingAgain.final), bits(moving.final))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, all six runs)', () => {
    const trace = writeTickTrace('boss-fight', tier.label, [first, second, moving, movingAgain, otherSeed, slowShots].map((run) => run.tickMs))
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

if (process.env.SCENARIO_DEBUG) {
  for (const tier of TIERS) {
    const summary = {}
    for (const [name, run] of Object.entries(runs.get(tier.label))) summary[name] = { ticks: run.tick, boss: run.boss.health, player: run.player.health, closestM: run.closest, attacks: run.bossAttacks, fired: run.shotsFired, hit: run.shotsHit, missed: run.shotsMissed, worstHitM: run.worstHitM, waypoints: run.waypointsReached, pathM: run.playerPathM }
    console.log(JSON.stringify({ tier: tier.label, ...summary }))
  }
}

finish()
