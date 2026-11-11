import { createEngineWorld } from '../../src/engine/EngineWorld.js'
import { PLANET } from '../../src/engine/sceneSetup.js'
import { glueUrl, tierWorldOptions } from './scenarioTiers.mjs'

const bowlBoxes = (half, wall, top) => [
  [-half, -wall, -half, half, 0, half],
  [-half - wall, 0, -half - wall, -half, top, half + wall],
  [half, 0, -half - wall, half + wall, top, half + wall],
  [-half - wall, 0, -half - wall, half + wall, top, -half],
  [-half - wall, 0, half, half + wall, top, half + wall],
]

export const SETTLE = Object.freeze({ bodies: 256, radius: 0.5, ticks: 240 })
export const MARBLE_BOWL = Object.freeze({ radius: 0.3, columns: 16, rows: 32, bodies: 16 * 32, ticks: 600, half: 6, wall: 0.5, wallTop: 4 })
export const PROJECTILE_VOLLEY = Object.freeze({ radius: 0.2, shots: 128, columns: 16, speed: 40, launchY: 6, wallX: 40, wallHalfZ: 6, wallTop: 6, ticks: 120, gravity: 9.8 })
export const PLANET_LANDING = Object.freeze({ radius: 0.5, bodies: 256, dropM: 3, ticks: 480, patchSide: 16, patchSpacingM: 2 })

const spawnAll = (world, count, pointOf, velocity) => {
  const handles = []
  for (let i = 0; i < count; i++) handles.push(velocity === undefined ? world.spawn(pointOf(i)) : world.spawn(pointOf(i), velocity))
  return handles
}

const settlePoint = (i) => [(i % 16) * 2 - 15, 2 + (i % 7) * 0.6, Math.floor(i / 16) * 2 - 15]

const marblePoint = (i) => {
  const col = i % MARBLE_BOWL.columns
  const row = Math.floor(i / MARBLE_BOWL.columns)
  return [-5 + col * (10 / (MARBLE_BOWL.columns - 1)), 8 + (i % 3) * 0.7, -5 + row * (10 / (MARBLE_BOWL.rows - 1))]
}

const launchPoint = (i) => [0, PROJECTILE_VOLLEY.launchY + Math.floor(i / PROJECTILE_VOLLEY.columns) * 0.5, -5.625 + (i % PROJECTILE_VOLLEY.columns) * 0.75]

const landingPoint = (i) => {
  const col = i % PLANET_LANDING.patchSide
  const row = Math.floor(i / PLANET_LANDING.patchSide)
  const across = (col - (PLANET_LANDING.patchSide - 1) / 2) * PLANET_LANDING.patchSpacingM
  const along = (row - (PLANET_LANDING.patchSide - 1) / 2) * PLANET_LANDING.patchSpacingM
  const p = [PLANET.radius, across, along]
  const len = Math.hypot(...p)
  return p.map((c) => (c / len) * (PLANET.radius + PLANET_LANDING.dropM))
}

export const buildSettle = async (tier) => {
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: SETTLE.radius }), glueUrl(tier.glue))
  return { world, handles: spawnAll(world, SETTLE.bodies, settlePoint) }
}

export const buildMarbleBowl = async (tier) => {
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: MARBLE_BOWL.radius, boxes: bowlBoxes(MARBLE_BOWL.half, MARBLE_BOWL.wall, MARBLE_BOWL.wallTop) }), glueUrl(tier.glue))
  return { world, handles: spawnAll(world, MARBLE_BOWL.bodies, marblePoint) }
}

export const buildProjectileVolley = async (tier) => {
  const boxes = [
    [-2, -1, -20, 120, 0, 20],
    [PROJECTILE_VOLLEY.wallX, 0, -PROJECTILE_VOLLEY.wallHalfZ, PROJECTILE_VOLLEY.wallX + 1, PROJECTILE_VOLLEY.wallTop, PROJECTILE_VOLLEY.wallHalfZ],
  ]
  const world = await createEngineWorld(tierWorldOptions(tier, { gravity: -PROJECTILE_VOLLEY.gravity, radius: PROJECTILE_VOLLEY.radius, boxes }), glueUrl(tier.glue))
  return { world, handles: spawnAll(world, PROJECTILE_VOLLEY.shots, launchPoint, [PROJECTILE_VOLLEY.speed, 0, 0]) }
}

export const buildPlanetLanding = async (tier) => {
  const world = await createEngineWorld(tierWorldOptions(tier, { radius: PLANET_LANDING.radius }), glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  return { world, handles: spawnAll(world, PLANET_LANDING.bodies, landingPoint) }
}

export const BODY_SCENARIOS = Object.freeze({
  settle: Object.freeze({ build: buildSettle, ticks: SETTLE.ticks, bodies: SETTLE.bodies }),
  'marble-bowl': Object.freeze({ build: buildMarbleBowl, ticks: MARBLE_BOWL.ticks, bodies: MARBLE_BOWL.bodies }),
  'projectile-volley': Object.freeze({ build: buildProjectileVolley, ticks: PROJECTILE_VOLLEY.ticks, bodies: PROJECTILE_VOLLEY.shots }),
  'planet-landing': Object.freeze({ build: buildPlanetLanding, ticks: PLANET_LANDING.ticks, bodies: PLANET_LANDING.bodies }),
})

export const readBodyPositions = (world, handles, out, scratch) => {
  for (let i = 0; i < handles.length; i++) {
    world.position(handles[i], scratch)
    out[i * 3] = scratch[0]
    out[i * 3 + 1] = scratch[1]
    out[i * 3 + 2] = scratch[2]
  }
  return out
}

export const readBodyVelocities = (world, handles, out, scratch) => {
  for (let i = 0; i < handles.length; i++) {
    world.velocity(handles[i], scratch)
    out[i * 3] = scratch[0]
    out[i * 3 + 1] = scratch[1]
    out[i * 3 + 2] = scratch[2]
  }
  return out
}
