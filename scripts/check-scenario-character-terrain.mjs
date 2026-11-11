import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { releaseWorld } from './lib/releaseWorld.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { createTickTimer, writeTickTrace } from './lib/tickTrace.mjs'
import { PLANET } from '../src/engine/sceneSetup.js'
import { createPoleTerrain } from './lib/polePages.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const CHARACTER_RADIUS = 0.4
const CHARACTER_HALF_HEIGHT = 0.6
const CHARACTER_REST_M = CHARACTER_RADIUS + CHARACTER_HALF_HEIGHT
const MAX_SLOPE_DEGREES = 50
const STEP_UP_M = 0.4
const STICK_DOWN_M = 0.5
const WALK_SPEED_M_S = 2
const SETTLE_TICKS = 60
const WALK_TICKS = 960
const PAGE_CELLS = 3
const RAMP_START_M = 4
const RAMP_TOP_M = 12
const PLATEAU_END_M = 16
const DESCENT_END_M = 24
const GENTLE_GRADIENT = 0.5
const STEEP_GRADIENT = Math.tan((60 * Math.PI) / 180)
const HILL_M = GENTLE_GRADIENT * (RAMP_TOP_M - RAMP_START_M)
const STEP_START_M = 6
const STEP_END_M = 10
const LOW_STEP_M = 0.3
const TALL_STEP_M = 0.8
const CLEARANCE_LOW_M = -0.06
const CLEARANCE_HIGH_M = 0.15
const LANES = Object.freeze({ gentle: 0, steep: 1, lowStep: -1, tallStep: -2 })
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const gentleProfile = (alongU) => {
  if (alongU <= RAMP_START_M) return 0
  if (alongU <= RAMP_TOP_M) return GENTLE_GRADIENT * (alongU - RAMP_START_M)
  if (alongU <= PLATEAU_END_M) return HILL_M
  if (alongU <= DESCENT_END_M) return HILL_M - GENTLE_GRADIENT * (alongU - PLATEAU_END_M)
  return 0
}

const steepProfile = (alongU) => {
  if (alongU <= RAMP_START_M) return 0
  if (alongU <= RAMP_TOP_M) return STEEP_GRADIENT * (alongU - RAMP_START_M)
  return STEEP_GRADIENT * (RAMP_TOP_M - RAMP_START_M)
}

const terrainHeight = (alongU, alongV, cx, cy) => {
  if (cy === LANES.gentle) return gentleProfile(alongU)
  if (cy === LANES.steep) return steepProfile(alongU)
  return 0
}

const scenario = async (tier, tuning) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const terrain = createPoleTerrain(world, PLANET, { cells: PAGE_CELLS, heightOf: terrainHeight })
  const origin = [0, PLANET.radius, 0]
  world.follow(origin)
  world.tuneCharacters(tuning)
  const laneV = (row) => (row + 0.5) * terrain.cellMetres
  const stepBox = (row, top) => {
    const near = terrain.point(STEP_START_M, laneV(row) - 3, 0)
    const far = terrain.point(STEP_END_M, laneV(row) + 3, 0)
    world.addBox([near[0], PLANET.radius - 1, Math.min(near[2], far[2]), far[0], PLANET.radius + top, Math.max(near[2], far[2])])
  }
  stepBox(LANES.lowStep, LOW_STEP_M)
  stepBox(LANES.tallStep, TALL_STEP_M)

  const walkers = Object.entries(LANES).map(([name, row]) => {
    const start = terrain.point(0, laneV(row), CHARACTER_REST_M + 0.05)
    return { name, row, index: world.addCharacter({ position: start, radius: CHARACTER_RADIUS, halfHeight: CHARACTER_HALF_HEIGHT }), samples: [] }
  })
  const heightProbe = terrain.point(8, laneV(LANES.gentle), 0)
  const engineHeightOnRamp = world.height(heightProbe[0], heightProbe[1], heightProbe[2])
  const residentPages = world.residentPages()

  const body = [0, 0, 0]
  const timer = createTickTimer()
  const tickMs = timer.tickMs
  const read = (walker) => {
    world.characterBodyPosition(walker.index, body)
    const position = [body[0] + origin[0], body[1] + origin[1], body[2] + origin[2]]
    const [alongU, alongV] = terrain.along(position)
    const altitude = terrain.altitudeOf(position)
    return { position, alongU, alongV, altitude, supported: world.characterSupported(walker.index) }
  }
  const step = () => {
    timer.start()
    world.step()
    timer.stop()
  }
  for (let t = 0; t < SETTLE_TICKS; t++) step()
  const settled = walkers.map((walker) => read(walker))
  world.markWarmup()
  for (let t = 0; t < WALK_TICKS; t++) {
    for (const walker of walkers) {
      const { position } = read(walker)
      const distance = Math.hypot(position[0], position[1], position[2])
      const up = [position[0] / distance, position[1] / distance, position[2] / distance]
      const east = [1 - up[0] * up[0], -up[0] * up[1], -up[0] * up[2]]
      const length = Math.hypot(east[0], east[1], east[2])
      world.setCharacterVelocity(walker.index, east.map((v) => (v / length) * WALK_SPEED_M_S))
    }
    step()
    for (const walker of walkers) {
      const sample = read(walker)
      const ground = walker.name === 'gentle' || walker.name === 'steep' ? terrain.height(sample.alongU, sample.alongV) : 0
      walker.samples.push({ alongU: sample.alongU, altitude: sample.altitude, supported: sample.supported, clearance: sample.altitude - ground - CHARACTER_REST_M })
    }
  }
  const finalBody = []
  for (const walker of walkers) {
    world.characterBodyPosition(walker.index, body)
    finalBody.push(...body)
  }
  await releaseWorld(world)
  return {
    walkers: Object.fromEntries(walkers.map((walker) => [walker.name, walker.samples])),
    settled, finalBody, tickMs, engineHeightOnRamp, residentPages, pageCount: terrain.pageCount,
    allocations: world.allocationsSinceWarmup(), failures: world.allocationFailures(),
  }
}

const TUNED = Object.freeze({ stepUp: STEP_UP_M, stickDown: STICK_DOWN_M })
const UNTUNED = Object.freeze({ stepUp: 0, stickDown: 0 })
const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier, TUNED), second: await scenario(tier, TUNED), control: await scenario(tier, UNTUNED) })
}

const last = (samples) => samples[samples.length - 1]
const farthest = (samples) => samples.reduce((max, s) => Math.max(max, s.alongU), -Infinity)
const highest = (samples) => samples.reduce((max, s) => Math.max(max, s.altitude), -Infinity)
const within = (samples, from, to) => samples.filter((s) => s.alongU >= from && s.alongU <= to)

for (const tier of TIERS) {
  const { first, second, control } = runs.get(tier.label)
  const { gentle, steep, lowStep, tallStep } = first.walkers

  gate(tier.label + ': the pages are resident and the engine height on the ramp is the written ramp, not 0', () => {
    assert.equal(first.residentPages, first.pageCount)
    assert.ok(Math.abs(first.engineHeightOnRamp - GENTLE_GRADIENT * (8 - RAMP_START_M)) <= 1e-3, 'engine height on the ramp is ' + first.engineHeightOnRamp)
    for (const walker of first.settled) assert.equal(walker.supported, true, 'a walker is not supported after the settle ticks')
  })
  gate(tier.label + ': the character walks up the 26.6 degree slope (below the ' + MAX_SLOPE_DEGREES + ' degree limit), over the ' + HILL_M + ' m hill and down the far side', () => {
    const reached = farthest(gentle)
    const top = highest(gentle)
    console.log('  ' + tier.label + ' gentle slope: reached ' + reached.toFixed(3) + ' m, highest centre ' + top.toFixed(3) + ' m, ended at ' + last(gentle).alongU.toFixed(3) + ' m')
    assert.ok(reached >= DESCENT_END_M + 2, 'walker reached ' + reached + ' m')
    assert.ok(Math.abs(top - (HILL_M + CHARACTER_REST_M)) <= 0.1, 'highest centre altitude ' + top)
  })
  gate(tier.label + ': on the slopes and the hill the capsule stays on the ground: clearance within ' + CLEARANCE_LOW_M + ' to ' + CLEARANCE_HIGH_M + ' m at every tick', () => {
    let low = Infinity
    let high = -Infinity
    for (const sample of gentle) {
      low = Math.min(low, sample.clearance)
      high = Math.max(high, sample.clearance)
    }
    console.log('  ' + tier.label + ' gentle slope: clearance ' + low.toFixed(4) + ' to ' + high.toFixed(4) + ' m over ' + gentle.length + ' ticks')
    assert.ok(low >= CLEARANCE_LOW_M && high <= CLEARANCE_HIGH_M, 'clearance ' + low + ' to ' + high)
  })
  gate(tier.label + ': walking downhill the character is supported at every tick (stick to floor), and with stick to floor off the same walk leaves the ground', () => {
    const descent = within(gentle, PLATEAU_END_M + 0.5, DESCENT_END_M - 0.5)
    assert.ok(descent.length > 30, 'only ' + descent.length + ' ticks on the descent')
    const airborne = descent.filter((s) => !s.supported).length
    const controlDescent = within(control.walkers.gentle, PLATEAU_END_M + 0.5, DESCENT_END_M - 0.5)
    const controlAirborne = controlDescent.filter((s) => !s.supported).length
    const controlHigh = controlDescent.reduce((max, s) => Math.max(max, s.clearance), -Infinity)
    console.log('  ' + tier.label + ' descent: ' + airborne + ' of ' + descent.length + ' ticks unsupported; control without stick to floor ' + controlAirborne + ' of ' + controlDescent.length + ' unsupported, clearance up to ' + controlHigh.toFixed(3) + ' m')
    assert.equal(airborne, 0)
    assert.ok(controlAirborne > 0, 'the control walk never left the ground')
  })
  gate(tier.label + ': the 60 degree slope (above the ' + MAX_SLOPE_DEGREES + ' degree limit) stops the character at its foot', () => {
    const reached = farthest(steep)
    const top = highest(steep)
    console.log('  ' + tier.label + ' steep slope: reached ' + reached.toFixed(3) + ' m, highest centre ' + top.toFixed(3) + ' m, ended at ' + last(steep).alongU.toFixed(3) + ' m')
    assert.ok(reached >= RAMP_START_M - CHARACTER_RADIUS - 0.1, 'walker never reached the slope: ' + reached)
    assert.ok(reached <= RAMP_START_M + 0.5, 'walker got ' + reached + ' m along, past the foot at ' + RAMP_START_M)
    assert.ok(top <= CHARACTER_REST_M + 0.5, 'walker climbed to ' + top)
  })
  gate(tier.label + ': the character climbs the ' + LOW_STEP_M + ' m step (under the ' + STEP_UP_M + ' m step height), and with stair stepping off the same step blocks it', () => {
    const reached = farthest(lowStep)
    const top = highest(lowStep)
    const controlReached = farthest(control.walkers.lowStep)
    console.log('  ' + tier.label + ' low step: reached ' + reached.toFixed(3) + ' m, highest centre ' + top.toFixed(3) + ' m; control without stair stepping reached ' + controlReached.toFixed(3) + ' m')
    assert.ok(reached >= STEP_END_M + 2, 'walker reached ' + reached + ' m')
    assert.ok(Math.abs(top - (LOW_STEP_M + CHARACTER_REST_M)) <= 0.1, 'highest centre altitude ' + top)
    assert.ok(controlReached <= STEP_START_M, 'the control walker passed the step: ' + controlReached)
  })
  gate(tier.label + ': the ' + TALL_STEP_M + ' m step (over the step height) blocks the character', () => {
    const reached = farthest(tallStep)
    const top = highest(tallStep)
    console.log('  ' + tier.label + ' tall step: reached ' + reached.toFixed(3) + ' m, highest centre ' + top.toFixed(3) + ' m')
    assert.ok(reached >= STEP_START_M - CHARACTER_RADIUS - 0.1, 'walker never reached the step: ' + reached)
    assert.ok(reached <= STEP_START_M, 'walker passed the step face: ' + reached)
    assert.ok(top <= CHARACTER_REST_M + 0.1, 'walker rose to ' + top)
  })
  gate(tier.label + ': ' + WALK_TICKS + ' walking ticks carve nothing from the arena after warm-up and no allocation fails', () => {
    assert.equal(first.allocations, 0)
    assert.equal(first.failures, 0)
  })
  gate(tier.label + ': two runs agree bit for bit on the final position of every walker', () => {
    assert.deepEqual(new Uint32Array(new Float32Array(second.finalBody).buffer), new Uint32Array(new Float32Array(first.finalBody).buffer))
  })
  gate(tier.label + ': no tick runs over 25 ms or over the 16.7 ms budget (measured inside the step call, both runs)', () => {
    const trace = writeTickTrace('character-terrain', tier.label, [first.tickMs, second.tickMs])
    assert.equal(trace.over25, 0, 'ticks over 25 ms: ' + trace.over25)
    assert.equal(trace.overBudget, 0, 'ticks over the 16.7 ms budget: ' + trace.overBudget)
  })
}

finish()
