import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { bodyPoolCapacity } from '../src/engine/poolPlan.js'
import { PLANET } from '../src/engine/sceneSetup.js'
import { createPoleTerrain } from './lib/polePages.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const glueUrl = (path) => pathToFileURL(join(root, path)).href
const HIT_BOUND_M = 1e-3
const ORACLE_BOUND_M = 1e-4
const RAY_ALTITUDE_M = 50
const RAY_REACH_M = 100
const DOWN_RAYS = 600
const PAGE_CELLS = 2
const PLATEAU_M = 5
const FIELD_PEAK_M = 3.5
const BODY_RADIUS_M = 0.5
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const seeded = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const fieldHeight = (alongU, alongV, cx, cy) => {
  if (cx === 1 && cy === 1) return PLATEAU_M
  return 2 * Math.sin(alongU * 0.21 + 0.4) * Math.cos(alongV * 0.17 - 0.3) + 1.5 * Math.sin(alongU * 0.05 + alongV * 0.07)
}

const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k]
const copyHit = (hit) => (hit === null ? null : { distance: hit.distance, position: hit.position.slice(), normal: hit.normal.slice(), kind: hit.kind, handle: hit.handle })

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: BODY_RADIUS_M, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const terrain = createPoleTerrain(world, PLANET, { cells: PAGE_CELLS, heightOf: fieldHeight })
  world.follow([0, PLANET.radius, 0])
  const span = PAGE_CELLS * terrain.cellMetres
  const random = seeded(20261111)
  const cellPoint = () => {
    const cell = Math.floor(random() * 2 * PAGE_CELLS) - PAGE_CELLS
    return (cell + 0.02 + 0.96 * random()) * terrain.cellMetres
  }

  const down = []
  for (let i = 0; i < DOWN_RAYS; i++) {
    const alongU = cellPoint()
    const alongV = cellPoint()
    const up = terrain.direction(alongU, alongV)
    const origin = scale(up, PLANET.radius + RAY_ALTITUDE_M)
    const hit = copyHit(world.raycast(origin, scale(up, -1), RAY_REACH_M))
    const oracle = terrain.height(alongU, alongV)
    const engineHeight = world.height(up[0] * PLANET.radius, up[1] * PLANET.radius, up[2] * PLANET.radius)
    const hitHeight = hit === null ? NaN : world.height(hit.position[0], hit.position[1], hit.position[2])
    down.push({ alongU, alongV, hit, oracle, engineHeight, hitHeight })
  }

  const boxColumn = terrain.point(-10, -10, 0)
  const boxUp = terrain.direction(-10, -10)
  world.addBox([boxColumn[0] - 1, boxColumn[1] + 10, boxColumn[2] - 1, boxColumn[0] + 1, boxColumn[1] + 12, boxColumn[2] + 1])
  const buried = terrain.point(-25, 10, 0)
  world.addBox([buried[0] - 1, buried[1] - 8, buried[2] - 1, buried[0] + 1, buried[1] - 6, buried[2] + 1])
  const bodyAt = terrain.point(12, -12, 20)
  const bodyUp = terrain.direction(12, -12)
  const handle = world.spawn(bodyAt)
  world.markWarmup()

  const downFrom = (alongU, alongV) => copyHit(world.raycast(terrain.point(alongU, alongV, RAY_ALTITUDE_M), scale(terrain.direction(alongU, alongV), -1), RAY_REACH_M))
  const overBox = copyHit(world.raycast(scale(boxUp, PLANET.radius + RAY_ALTITUDE_M), scale(boxUp, -1), RAY_REACH_M))
  const besideBox = downFrom(-15, -10)
  const overBuried = downFrom(-25, 10)
  const overBody = copyHit(world.raycast(scale(bodyUp, PLANET.radius + RAY_ALTITUDE_M), scale(bodyUp, -1), RAY_REACH_M))

  const lane = 1.5 * terrain.cellMetres
  const grazeStart = (altitude) => terrain.point(-1.5 * terrain.cellMetres, lane, altitude)
  const grazeAim = (altitude) => {
    const from = grazeStart(altitude)
    const to = terrain.point(1.5 * terrain.cellMetres, lane, altitude)
    return [to[0] - from[0], to[1] - from[1], to[2] - from[2]]
  }
  const grazeAbove = copyHit(world.raycast(grazeStart(PLATEAU_M + 0.05), grazeAim(PLATEAU_M + 0.05), 3 * terrain.cellMetres))
  const grazeBelow = copyHit(world.raycast(grazeStart(PLATEAU_M - 0.05), grazeAim(PLATEAU_M - 0.05), 3 * terrain.cellMetres))
  const slant = copyHit(world.raycast(terrain.point(-30, -30, 30), [1, -0.2, 0.1], 400))
  const slantHeight = slant === null ? NaN : world.height(slant.position[0], slant.position[1], slant.position[2])

  const poleUp = terrain.direction(5, 5)
  const misses = [
    world.raycast(scale(poleUp, PLANET.radius + RAY_ALTITUDE_M), poleUp, RAY_REACH_M),
    world.raycast(scale(poleUp, PLANET.radius + 100), [1, 0, 0], 500),
    world.raycast(scale(poleUp, PLANET.radius + RAY_ALTITUDE_M), scale(poleUp, -1), 10),
    world.raycast(scale(poleUp, PLANET.radius + PLANET.maxHeight + 500), [0, 0, 1], 5000),
  ].map(copyHit)

  const below = scale(poleUp, PLANET.radius - 10)
  const insideUp = copyHit(world.raycast(below, poleUp, RAY_REACH_M))
  const insideDown = copyHit(world.raycast(below, scale(poleUp, -1), RAY_REACH_M))
  const insideSide = copyHit(world.raycast(below, [1, 0, 0], RAY_REACH_M))

  return {
    terrain: { span, sampleMetres: terrain.sampleMetres, pageCount: terrain.pageCount, along: terrain.along },
    down, overBox, besideBox, overBuried, overBody, handle, grazeAbove, grazeBelow, slant, slantHeight, misses, insideUp, insideDown, insideSide,
    allocations: world.allocationsSinceWarmup(), failures: world.allocationFailures(), residentPages: world.residentPages(),
  }
}

const flatten = (run) => {
  const out = []
  const push = (hit) => {
    if (hit === null) {
      out.push(-1)
      return
    }
    out.push(hit.distance, ...hit.position, ...hit.normal, hit.handle, hit.kind.length)
  }
  run.down.forEach((ray) => push(ray.hit))
  for (const hit of [run.overBox, run.besideBox, run.overBuried, run.overBody, run.grazeAbove, run.grazeBelow, run.slant, ...run.misses, run.insideUp, run.insideDown, run.insideSide]) push(hit)
  return new Float64Array(out)
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  const altitude = (position) => Math.hypot(position[0], position[1], position[2]) - PLANET.radius

  gate(tier.label + ': the pages are resident, so the terrain under the rays is not the bare sphere', () => {
    assert.equal(first.residentPages, first.terrain.pageCount)
    const spread = first.down.reduce((max, ray) => Math.max(max, Math.abs(ray.engineHeight)), 0)
    assert.ok(spread > 1, 'largest height under a ray is ' + spread + ' m')
  })
  gate(tier.label + ': the engine height under each ray matches the triangle interpolation of the written samples within ' + ORACLE_BOUND_M + ' m', () => {
    let worst = 0
    for (const ray of first.down) worst = Math.max(worst, Math.abs(ray.engineHeight - ray.oracle))
    console.log('  ' + tier.label + ' height oracle: worst difference ' + worst.toExponential(3) + ' m over ' + first.down.length + ' points')
    assert.ok(worst <= ORACLE_BOUND_M, 'worst difference ' + worst)
  })
  gate(tier.label + ': ' + DOWN_RAYS + ' seeded rays straight down hit the planet at the terrain height within ' + HIT_BOUND_M + ' m', () => {
    let worstSurface = 0
    let worstDistance = 0
    let worstOracle = 0
    for (const ray of first.down) {
      assert.ok(ray.hit !== null, 'ray at ' + ray.alongU + ',' + ray.alongV + ' missed')
      assert.equal(ray.hit.kind, 'planet')
      worstSurface = Math.max(worstSurface, Math.abs(altitude(ray.hit.position) - ray.hitHeight))
      worstDistance = Math.max(worstDistance, Math.abs(ray.hit.distance - (RAY_ALTITUDE_M - ray.engineHeight)))
      worstOracle = Math.max(worstOracle, Math.abs(altitude(ray.hit.position) - ray.oracle))
    }
    console.log('  ' + tier.label + ' down rays: hit point off the surface by at most ' + worstSurface.toExponential(3) + ' m, distance off by at most ' + worstDistance.toExponential(3) + ' m, off the written samples by at most ' + worstOracle.toExponential(3) + ' m')
    assert.ok(worstSurface <= HIT_BOUND_M, 'hit point is ' + worstSurface + ' m off the surface')
    assert.ok(worstDistance <= HIT_BOUND_M, 'hit distance is ' + worstDistance + ' m off')
    assert.ok(worstOracle <= HIT_BOUND_M, 'hit point is ' + worstOracle + ' m off the written samples')
  })
  gate(tier.label + ': a hit on flat terrain reports the radial normal, and every normal is a unit vector that faces up', () => {
    for (const ray of first.down) {
      const n = ray.hit.normal
      const p = ray.hit.position
      const length = Math.hypot(n[0], n[1], n[2])
      assert.ok(Math.abs(length - 1) <= 1e-5, 'normal length ' + length)
      const upward = (n[0] * p[0] + n[1] * p[1] + n[2] * p[2]) / Math.hypot(p[0], p[1], p[2])
      assert.ok(upward > 0, 'normal faces down: ' + upward)
      const [cellU, cellV] = first.terrain.along(p).map((v) => Math.floor(v / (first.terrain.span / PAGE_CELLS)))
      if (cellU === 1 && cellV === 1) assert.ok(upward >= 1 - 1e-6, 'plateau normal is ' + upward + ' from radial')
    }
  })
  gate(tier.label + ': a grazing ray 0.05 m above the plateau misses, and the same ray 0.05 m below it stops at the plateau wall', () => {
    assert.equal(first.grazeAbove, null, 'the ray above the plateau hit ' + JSON.stringify(first.grazeAbove))
    assert.ok(first.grazeBelow !== null, 'the ray below the plateau top missed')
    assert.equal(first.grazeBelow.kind, 'planet')
    const [alongU] = first.terrain.along(first.grazeBelow.position)
    const wall = first.terrain.span / PAGE_CELLS
    console.log('  ' + tier.label + ' grazing ray: stopped ' + (alongU - wall).toExponential(3) + ' m from the plateau wall after ' + first.grazeBelow.distance.toFixed(4) + ' m')
    assert.ok(Math.abs(alongU - wall) <= 0.01, 'stopped at ' + alongU + ' m, the wall is at ' + wall + ' m')
  })
  gate(tier.label + ': a slanted ray hits the terrain at a point on the surface within ' + HIT_BOUND_M + ' m', () => {
    assert.ok(first.slant !== null, 'the slanted ray missed')
    assert.equal(first.slant.kind, 'planet')
    const off = Math.abs(altitude(first.slant.position) - first.slantHeight)
    console.log('  ' + tier.label + ' slanted ray: hit after ' + first.slant.distance.toFixed(4) + ' m, ' + off.toExponential(3) + ' m off the surface')
    assert.ok(off <= HIT_BOUND_M, 'hit point is ' + off + ' m off the surface')
  })
  gate(tier.label + ': rays that point up, pass above the terrain, stop short of it or start above the height bound all miss', () => {
    first.misses.forEach((hit, index) => assert.equal(hit, null, 'miss ray ' + index + ' hit ' + JSON.stringify(hit)))
  })
  gate(tier.label + ': a ray that starts below the surface hits the planet at distance 0 in every direction', () => {
    for (const hit of [first.insideUp, first.insideDown, first.insideSide]) {
      assert.ok(hit !== null, 'a ray from below the surface missed')
      assert.equal(hit.kind, 'planet')
      assert.equal(hit.distance, 0)
    }
  })
  gate(tier.label + ': the nearest hit wins: a box above the terrain, the terrain above a buried box, and a body above the terrain', () => {
    assert.equal(first.overBox.kind, 'static')
    assert.ok(Math.abs(first.overBox.distance - (RAY_ALTITUDE_M - 12)) <= HIT_BOUND_M, 'box top hit at ' + first.overBox.distance)
    assert.equal(first.besideBox.kind, 'planet')
    assert.ok(first.besideBox.distance > first.overBox.distance + 5, 'terrain beside the box hit at ' + first.besideBox.distance)
    assert.equal(first.overBuried.kind, 'planet')
    assert.equal(first.overBody.kind, 'body')
    assert.equal(first.overBody.handle, first.handle)
    assert.ok(Math.abs(first.overBody.distance - (RAY_ALTITUDE_M - 20 - BODY_RADIUS_M)) <= HIT_BOUND_M, 'body hit at ' + first.overBody.distance)
  })
  gate(tier.label + ': the ray casts carve nothing from the arena after warm-up and no allocation fails', () => {
    assert.equal(first.allocations, 0)
    assert.equal(first.failures, 0)
  })
  gate(tier.label + ': two runs agree bit for bit on every hit distance, position, normal, kind and handle', () => {
    assert.deepEqual(new BigUint64Array(flatten(second).buffer), new BigUint64Array(flatten(first).buffer))
  })
}

finish()
