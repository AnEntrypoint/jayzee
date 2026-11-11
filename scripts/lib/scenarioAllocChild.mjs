import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Session } from 'node:inspector/promises'
import { SCENARIO_TIERS } from './scenarioTiers.mjs'
import { buildSettle, readBodyPositions, readBodyVelocities } from './scenarioWorlds.mjs'
import { createLockstepMatch, lockstepSchedule } from './lockstepMatch.mjs'
import { advanceBossFight, createBossFight } from './bossFight.mjs'
import { DEATHRUN_COURSES, advanceDeathrun, createDeathrun } from './deathrun.mjs'

const root = resolve(fileURLToPath(new URL('../..', import.meta.url)))
const LOOP_FILES = ['src/engine/EngineWorld.js', 'src/engine/bridge.js', 'src/world/options.js', 'scripts/lib/scenarioWorlds.mjs', 'scripts/lib/lockstepMatch.mjs', 'scripts/lib/bossFight.mjs', 'scripts/lib/deathrun.mjs', 'scripts/lib/seededRandom.mjs', 'scripts/lib/stateHash1024.mjs']
const LOOP_URLS = LOOP_FILES.map((file) => pathToFileURL(resolve(root, file)).href)
const CHILD_URL = pathToFileURL(fileURLToPath(import.meta.url)).href
const ENDLESS_HEALTH = 1e9
const ENDLESS_TICKS = 1e9
const SEED = 20261111
const TIER = SCENARIO_TIERS[0]

const [name, warmupArg, countedArg, worldsBeforeArg] = process.argv.slice(2)
const warmupTicks = Number(warmupArg)
const countedTicks = Number(countedArg)

const LOOPS = {
  settle: async () => {
    const { world, handles } = await buildSettle(TIER)
    const positions = new Float64Array(handles.length * 3)
    const velocities = new Float64Array(handles.length * 3)
    const scratch = [0, 0, 0]
    const hash = new Uint32Array(1)
    return {
      tick: () => {
        world.step()
        readBodyPositions(world, handles, positions, scratch)
        readBodyVelocities(world, handles, velocities, scratch)
        world.hashInto(hash, 0)
      },
      progress: () => ({ engineTick: world.tick, hash: hash[0] }),
    }
  },
  'lockstep-rts': async () => {
    const match = await createLockstepMatch(TIER, lockstepSchedule('delayed', SEED))
    const hash = new Uint32Array(1)
    return {
      tick: () => {
        match.advance()
        hash[0] = match.engineHash() ^ match.gameHash()
      },
      progress: () => ({ engineTick: match.world.tick, hash: hash[0] }),
    }
  },
  'boss-fight': async () => {
    const fight = await createBossFight(TIER, { moving: true, seed: SEED, bossHealth: ENDLESS_HEALTH, playerHealth: ENDLESS_HEALTH, tickLimit: ENDLESS_TICKS })
    return {
      tick: () => advanceBossFight(fight),
      progress: () => ({ engineTick: fight.world.tick, shotsFired: fight.state.shotsFired, shotsHit: fight.state.shotsHit, bossAttacks: fight.state.bossAttacks, waypointsReached: fight.state.waypointsReached }),
    }
  },
  deathrun: async () => {
    const run = await createDeathrun(TIER, { ...DEATHRUN_COURSES.surface, shuttle: true }, { tickLimit: ENDLESS_TICKS })
    return {
      tick: () => advanceDeathrun(run),
      progress: () => ({ engineTick: run.world.tick, steps: run.state.steps, laps: run.state.laps, fallCount: run.state.fallCount }),
    }
  },
}

for (let other = 0; other < Number(worldsBeforeArg); other++) {
  const earlier = await createLockstepMatch(TIER, lockstepSchedule('agreed'))
  for (let t = 0; t < 60; t++) earlier.advance()
}

const loop = await LOOPS[name]()
for (let t = 0; t < warmupTicks; t++) loop.tick()
const before = loop.progress()
const controlHold = []
const session = new Session()
session.connect()
await session.post('HeapProfiler.enable')
await session.post('HeapProfiler.startSampling', { samplingInterval: 1, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true })
for (let t = 0; t < countedTicks; t++) {
  loop.tick()
  controlHold.push({ tick: t })
}
const { profile } = await session.post('HeapProfiler.stopSampling')
session.disconnect()

const bytes = { own: 0, inherited: 0, control: 0, byFile: Object.fromEntries(LOOP_FILES.map((file) => [file, 0])), sites: [] }
const walk = (node, inLoop) => {
  const at = LOOP_URLS.indexOf(node.callFrame.url)
  const here = inLoop || at >= 0
  if (node.selfSize > 0) {
    if (at >= 0) {
      bytes.own += node.selfSize
      bytes.byFile[LOOP_FILES[at]] += node.selfSize
    } else if (here) {
      bytes.inherited += node.selfSize
    }
    if (here) bytes.sites.push({ file: at >= 0 ? LOOP_FILES[at] : node.callFrame.url.split('/').slice(-1)[0], fn: node.callFrame.functionName, line: node.callFrame.lineNumber + 1, bytes: node.selfSize })
    if (node.callFrame.url === CHILD_URL) bytes.control += node.selfSize
  }
  for (const child of node.children) walk(child, here)
}
walk(profile.head, false)

process.stdout.write(JSON.stringify({ name, tier: TIER.label, warmupTicks, countedTicks, controlCount: controlHold.length, before, after: loop.progress(), ...bytes }) + '\n')
process.exit(0)
