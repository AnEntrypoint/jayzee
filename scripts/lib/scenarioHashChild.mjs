import { BODY_SCENARIOS, readBodyPositions, readBodyVelocities } from './scenarioWorlds.mjs'
import { LOCKSTEP, createLockstepMatch, lockstepSchedule } from './lockstepMatch.mjs'
import { createDeathrun } from './deathrun.mjs'
import { createBossFight } from './bossFight.mjs'
import { FNV_OFFSET, fnvWords, stateHash } from './stateHash1024.mjs'

const TRAIL_TICKS = 30
const SEED = 20261111
const hex = (word) => (word >>> 0).toString(16).padStart(8, '0')
const trailHash = (trail) => hex(fnvWords(FNV_OFFSET, Uint32Array.from(trail)))
const wordOf = (values) => parseInt(stateHash(Array.from(values)), 16)

const [name, glue, workers, players, budgetBytes, tickLimit] = process.argv.slice(2)
const tier = { label: name, glue, players: Number(players), workers: Number(workers), budgetBytes: Number(budgetBytes) }
const limit = Number(tickLimit)

const bodyRun = async (scenario) => {
  const { world, handles } = await scenario.build(tier)
  const ticks = Math.min(scenario.ticks, limit)
  const positions = new Float64Array(handles.length * 3)
  const velocities = new Float64Array(handles.length * 3)
  const scratch = [0, 0, 0]
  const trail = []
  for (let t = 1; t <= ticks; t++) {
    world.step()
    if (t % TRAIL_TICKS === 0) trail.push(wordOf(readBodyPositions(world, handles, positions, scratch)))
  }
  readBodyPositions(world, handles, positions, scratch)
  readBodyVelocities(world, handles, velocities, scratch)
  return {
    ticks,
    engineTick: world.tick,
    entities: handles.length,
    hashes: { position: stateHash(Array.from(positions)), velocity: stateHash(Array.from(velocities)), world: hex(world.hash()), trail: trailHash(trail) },
    trailPoints: trail.length,
    first: Array.from(positions.subarray(0, 3)),
  }
}

const lockstepRun = async () => {
  const match = await createLockstepMatch(tier, lockstepSchedule('delayed', SEED))
  const ticks = Math.min(LOCKSTEP.matchTicks, limit)
  for (let t = 0; t < ticks; t++) match.advance()
  return {
    ticks,
    engineTick: match.world.tick,
    entities: LOCKSTEP.units,
    hashes: { position: hex(match.engineHash()), game: hex(match.gameHash()), trail: hex(fnvWords(FNV_OFFSET, match.checkpointEngine.subarray(0, match.checkpoints))) },
    trailPoints: match.checkpoints,
    first: Array.from(match.positions.subarray(0, 3)),
  }
}

const deathrunRun = async (course) => {
  const run = await createDeathrun(tier, course)
  const trail = []
  while (!run.over && run.state.steps < limit) {
    if (!run.decide()) continue
    run.step()
    run.record()
    if (run.state.steps % TRAIL_TICKS === 0) trail.push(wordOf(run.position.subarray(0, 3)))
  }
  return {
    ticks: run.state.steps,
    engineTick: run.world.tick,
    entities: 1,
    hashes: { position: stateHash(Array.from(run.position.subarray(0, 3))), game: stateHash([run.state.status, run.state.finishTick, run.state.fallCount, run.state.respawnCount, ...run.reached, ...run.fallTick]), trail: trailHash(trail) },
    trailPoints: trail.length,
    first: Array.from(run.position.subarray(0, 3)),
  }
}

const bossRun = async () => {
  const fight = await createBossFight(tier, { moving: true, seed: SEED })
  const trail = []
  while (fight.state.tick < limit && fight.advance()) {
    if (fight.state.tick % TRAIL_TICKS === 0) trail.push(wordOf([...fight.bossBody, ...fight.playerBody]))
  }
  return {
    ticks: fight.state.tick,
    engineTick: fight.world.tick,
    entities: 2,
    hashes: { position: stateHash([...fight.bossBody, ...fight.playerBody]), game: stateHash([fight.state.bossHealth, fight.state.playerHealth, fight.state.shotsFired, fight.state.shotsHit, fight.state.bossAttacks, fight.state.worstHitM]), trail: trailHash(trail) },
    trailPoints: trail.length,
    first: Array.from(fight.bossBody),
  }
}

const RUNS = {
  'lockstep-rts': lockstepRun,
  'deathrun-pit': () => deathrunRun('pit'),
  'deathrun-early-pit': () => deathrunRun('early-pit'),
  'boss-fight-moving': bossRun,
}

const result = RUNS[name] === undefined ? await bodyRun(BODY_SCENARIOS[name]) : await RUNS[name]()
process.stdout.write(JSON.stringify(result) + '\n')
process.exit(0)
