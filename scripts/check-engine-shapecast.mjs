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
const CAST_BOUND_M = 1e-3
const NORMAL_BOUND = 1e-4
const START_ALTITUDE_M = 12
const REACH_M = 30
const PAGE_CELLS = 2
const PLATEAU_M = 5
const RAMP_GRADIENT = 0.5
const RAMP_COSINE = 1 / Math.hypot(1, RAMP_GRADIENT)
const RAMP_SINK_M = 0.05
const SHAPES = Object.freeze([
  { name: 'capsule', radius: 0.4, halfHeight: 0.6 },
  { name: 'sphere', radius: 0.5, halfHeight: 0 },
])
const TIERS = Object.freeze([
  { label: '64 MiB fixed', glue: 'engine/out/engine-core-64mib.mjs', players: 64, workers: 1, budgetBytes: 64 * 1024 * 1024 },
  { label: '512 MiB threaded, 2 workers', glue: 'engine/out/engine-core-512mib-threads.mjs', players: 1024, workers: 2, budgetBytes: 512 * 1024 * 1024 },
])

const terrainHeight = (alongU, alongV, cx, cy) => {
  if (cx === 1 && cy === 1) return PLATEAU_M
  if (cx === 0 && cy === 0) return RAMP_GRADIENT * alongU
  return 0
}

const copyHit = (hit) => (hit === null ? null : { distance: hit.distance, position: hit.position.slice(), normal: hit.normal.slice(), kind: hit.kind, handle: hit.handle })
const scale = (v, k) => [v[0] * k, v[1] * k, v[2] * k]

const scenario = async (tier) => {
  const world = await createEngineWorld({ capacity: bodyPoolCapacity(tier.players), tickRate: 60, gravity: -9.8, drag: 0, radius: 0.5, restitution: 0, players: tier.players, workers: tier.workers, budgetBytes: tier.budgetBytes }, glueUrl(tier.glue))
  world.configurePlanet(PLANET)
  const terrain = createPoleTerrain(world, PLANET, { cells: PAGE_CELLS, heightOf: terrainHeight })
  world.follow([0, PLANET.radius, 0])
  const boxAt = terrain.point(-10, -10, 0)
  world.addBox([boxAt[0] - 1, boxAt[1] + 3, boxAt[2] - 1, boxAt[0] + 1, boxAt[1] + 4, boxAt[2] + 1])
  world.markWarmup()

  const plateauSpots = [[25, 25], [30, 33], [36, 27]]
  const rampSpots = [[4, 6], [9, 10], [14, 15]]
  const flatSpots = [[-12, 8], [-30, -25]]
  const out = { shapes: [] }
  for (const shape of SHAPES) {
    const down = (spot) => {
      const up = terrain.direction(spot[0], spot[1])
      return { spot, hit: copyHit(world.shapeCast(shape, scale(up, PLANET.radius + START_ALTITUDE_M), scale(up, -1), REACH_M)) }
    }
    const slantStart = terrain.point(2, 10, START_ALTITUDE_M)
    const slantEnd = terrain.point(14, 10, 0)
    const slantAim = [slantEnd[0] - slantStart[0], slantEnd[1] - slantStart[1], slantEnd[2] - slantStart[2]]
    const upDirection = terrain.direction(30, 30)
    const probeAt = (spot, altitude, planetFirst, maxSeparation = 0) => copyHit(world.probePlanet(shape, terrain.point(spot[0], spot[1], altitude), { planetFirst, maxSeparation }))
    const bottom = shape.radius + shape.halfHeight
    out.shapes.push({
      shape,
      plateau: plateauSpots.map(down),
      ramp: rampSpots.map(down),
      flat: flatSpots.map(down),
      slant: copyHit(world.shapeCast(shape, slantStart, slantAim, REACH_M)),
      slantStart,
      slantAim,
      overBox: down([-10, -10]),
      missUp: copyHit(world.shapeCast(shape, scale(upDirection, PLANET.radius + START_ALTITUDE_M), upDirection, REACH_M)),
      missShort: copyHit(world.shapeCast(shape, scale(upDirection, PLANET.radius + START_ALTITUDE_M), scale(upDirection, -1), 2)),
      embedded: copyHit(world.shapeCast(shape, terrain.point(30, 30, PLATEAU_M + 0.5 * bottom), scale(upDirection, -1), 1)),
      probes: {
        plateau: [true, false].map((planetFirst) => probeAt([30, 30], PLATEAU_M + bottom - 0.1, planetFirst)),
        ramp: [true, false].map((planetFirst) => probeAt([9, 10], RAMP_GRADIENT * 9 + bottom - RAMP_SINK_M, planetFirst)),
        near: [true, false].map((planetFirst) => probeAt([30, 30], PLATEAU_M + bottom + 0.05, planetFirst, 0.1)),
        clear: [true, false].map((planetFirst) => probeAt([30, 30], PLATEAU_M + bottom + 0.05, planetFirst)),
      },
    })
  }
  out.along = terrain.along
  out.allocations = world.allocationsSinceWarmup()
  out.failures = world.allocationFailures()
  return out
}

const flatten = (run) => {
  const words = []
  const push = (hit) => {
    if (hit === null) {
      words.push(-1)
      return
    }
    words.push(hit.distance, ...hit.position, ...hit.normal, hit.handle, hit.kind.length)
  }
  for (const entry of run.shapes) {
    for (const cast of [...entry.plateau, ...entry.ramp, ...entry.flat, entry.overBox]) push(cast.hit)
    for (const hit of [entry.slant, entry.missUp, entry.missShort, entry.embedded, ...entry.probes.plateau, ...entry.probes.ramp, ...entry.probes.near, ...entry.probes.clear]) push(hit)
  }
  return new Float64Array(words)
}

const runs = new Map()
for (const tier of TIERS) {
  runs.set(tier.label, { first: await scenario(tier), second: await scenario(tier) })
}

const altitude = (position) => Math.hypot(position[0], position[1], position[2]) - PLANET.radius
const radialPart = (normal, position) => (normal[0] * position[0] + normal[1] * position[1] + normal[2] * position[2]) / Math.hypot(position[0], position[1], position[2])

for (const tier of TIERS) {
  const { first, second } = runs.get(tier.label)
  for (const entry of first.shapes) {
    const { shape } = entry
    const bottom = shape.radius + shape.halfHeight
    const label = tier.label + ', ' + shape.name + ' moving against the planet'

    gate(label + ': a sweep straight down stops on flat ground and on the plateau where the shape first touches the height function, within ' + CAST_BOUND_M + ' m', () => {
      let worst = 0
      for (const [casts, height] of [[entry.plateau, PLATEAU_M], [entry.flat, 0]]) {
        for (const cast of casts) {
          assert.ok(cast.hit !== null, 'the sweep at ' + cast.spot + ' missed')
          assert.equal(cast.hit.kind, 'planet')
          worst = Math.max(worst, Math.abs(cast.hit.distance - (START_ALTITUDE_M - height - bottom)))
          worst = Math.max(worst, Math.abs(altitude(cast.hit.position) - height))
          assert.ok(radialPart(cast.hit.normal, cast.hit.position) >= 1 - NORMAL_BOUND, 'flat normal is not radial')
        }
      }
      console.log('  ' + label + ': flat sweeps off by at most ' + worst.toExponential(3) + ' m')
      assert.ok(worst <= CAST_BOUND_M, 'worst error ' + worst)
    })
    gate(label + ': a sweep straight down onto the 0.5 gradient ramp stops at the plane distance radius over the slope cosine, within ' + CAST_BOUND_M + ' m, with the ramp normal', () => {
      let worst = 0
      for (const cast of entry.ramp) {
        assert.ok(cast.hit !== null, 'the sweep at ' + cast.spot + ' missed')
        assert.equal(cast.hit.kind, 'planet')
        const expected = START_ALTITUDE_M - RAMP_GRADIENT * cast.spot[0] - shape.halfHeight - shape.radius / RAMP_COSINE
        worst = Math.max(worst, Math.abs(cast.hit.distance - expected))
        const [touchU] = first.along(cast.hit.position)
        worst = Math.max(worst, Math.abs(altitude(cast.hit.position) - RAMP_GRADIENT * touchU))
        assert.ok(Math.abs(radialPart(cast.hit.normal, cast.hit.position) - RAMP_COSINE) <= NORMAL_BOUND, 'ramp normal has radial part ' + radialPart(cast.hit.normal, cast.hit.position))
        assert.ok(cast.hit.normal[0] < 0, 'ramp normal leans uphill: ' + cast.hit.normal[0])
      }
      console.log('  ' + label + ': ramp sweeps off by at most ' + worst.toExponential(3) + ' m')
      assert.ok(worst <= CAST_BOUND_M, 'worst error ' + worst)
    })
    gate(label + ': a slanted sweep onto the ramp stops where the shape first touches the ramp plane, within ' + CAST_BOUND_M + ' m', () => {
      assert.ok(entry.slant !== null, 'the slanted sweep missed')
      const length = Math.hypot(...entry.slantAim)
      const unit = entry.slantAim.map((v) => v / length)
      const [startU] = first.along(entry.slantStart)
      const startAltitude = altitude(entry.slantStart) - shape.halfHeight
      const normal = [-RAMP_GRADIENT * RAMP_COSINE, RAMP_COSINE]
      const gap = (startU * normal[0] + startAltitude * normal[1]) - shape.radius
      const [endU] = first.along([entry.slantStart[0] + entry.slantAim[0], entry.slantStart[1] + entry.slantAim[1], entry.slantStart[2] + entry.slantAim[2]])
      const run = (endU - startU) / length
      const fall = (altitude([entry.slantStart[0] + entry.slantAim[0], entry.slantStart[1] + entry.slantAim[1], entry.slantStart[2] + entry.slantAim[2]]) - altitude(entry.slantStart)) / length
      const closing = -(run * normal[0] + fall * normal[1])
      const expected = gap / closing
      const off = Math.abs(entry.slant.distance - expected)
      console.log('  ' + label + ': slanted sweep stopped after ' + entry.slant.distance.toFixed(5) + ' m, expected ' + expected.toFixed(5) + ' m (unit ' + unit.map((v) => v.toFixed(3)).join(',') + ')')
      assert.ok(off <= CAST_BOUND_M, 'slanted sweep is ' + off + ' m off')
    })
    gate(label + ': a box above the ground is hit before the ground, a sweep upward misses, a 2 m sweep from 12 m misses, and a sweep that starts inside the ground hits at distance 0', () => {
      assert.equal(entry.overBox.hit.kind, 'static')
      assert.ok(Math.abs(entry.overBox.hit.distance - (START_ALTITUDE_M - 4 - bottom)) <= 0.02, 'box top hit at ' + entry.overBox.hit.distance)
      assert.equal(entry.missUp, null)
      assert.equal(entry.missShort, null)
      assert.ok(entry.embedded !== null, 'the embedded sweep missed')
      assert.equal(entry.embedded.distance, 0)
      assert.equal(entry.embedded.kind, 'planet')
    })
  }

  const capsule = first.shapes[0]
  const sphere = first.shapes[1]
  gate(tier.label + ': the capsule collide dispatch answers in both orders (planet first and capsule first) with the same depth, point and normal', () => {
    for (const [name, expected] of [['plateau', 0.1], ['ramp', capsule.shape.radius - (capsule.shape.radius - RAMP_SINK_M) * RAMP_COSINE], ['near', -0.05]]) {
      const [planetFirst, capsuleFirst] = capsule.probes[name]
      assert.ok(planetFirst !== null && capsuleFirst !== null, name + ': one order reported no contact')
      assert.ok(Math.abs(planetFirst.distance - expected) <= CAST_BOUND_M, name + ': depth ' + planetFirst.distance + ', expected ' + expected)
      assert.equal(capsuleFirst.distance, planetFirst.distance)
      assert.deepEqual(capsuleFirst.normal, planetFirst.normal)
      for (let k = 0; k < 3; k++) assert.ok(Math.abs(capsuleFirst.position[k] - planetFirst.position[k]) <= 1e-6, name + ': contact points differ')
    }
    assert.deepEqual(capsule.probes.clear, [null, null])
    const rampNormal = capsule.probes.ramp[0].normal
    assert.ok(Math.abs(radialPart(rampNormal, capsule.probes.ramp[0].position) - RAMP_COSINE) <= NORMAL_BOUND, 'ramp contact normal is not the ramp normal')
  })
  gate(tier.label + ': the sphere collide dispatch answers in both orders with the same depth and normal, and it measures the radial gap (so the ramp contact is radial)', () => {
    for (const [name, expected] of [['plateau', 0.1], ['ramp', RAMP_SINK_M], ['near', -0.05]]) {
      const [planetFirst, sphereFirst] = sphere.probes[name]
      assert.ok(planetFirst !== null && sphereFirst !== null, name + ': one order reported no contact')
      assert.ok(Math.abs(planetFirst.distance - expected) <= CAST_BOUND_M, name + ': depth ' + planetFirst.distance + ', expected ' + expected)
      assert.equal(sphereFirst.distance, planetFirst.distance)
      assert.deepEqual(sphereFirst.normal, planetFirst.normal)
      assert.ok(radialPart(planetFirst.normal, planetFirst.position) >= 1 - NORMAL_BOUND, name + ': sphere contact normal is not radial')
    }
    assert.deepEqual(sphere.probes.clear, [null, null])
  })
  gate(tier.label + ': the sweeps and probes carve nothing from the arena after warm-up and no allocation fails', () => {
    assert.equal(first.allocations, 0)
    assert.equal(first.failures, 0)
  })
  gate(tier.label + ': two runs agree bit for bit on every sweep and probe result', () => {
    assert.deepEqual(new BigUint64Array(flatten(second).buffer), new BigUint64Array(flatten(first).buffer))
  })
}

finish()
