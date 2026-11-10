import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { finish, gate } from './lib/gate.mjs'
import { GRAVITY_M_PER_S2, PLANET_RADIUS_M, altitudeOf, frameOnSurface, gravityAt, normalise, surfacePoint, upAt, wrapAngle } from '../src/engine/sphere.js'
import { capAreaKm2, mulberry32, placePopulation } from '../src/engine/population.js'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
const length = (v) => Math.hypot(v[0], v[1], v[2])
const SPOINT_RADIUS = join('/workspace/spoint/packages/mapspinner/src/planet-radius.js')
const MAPSPINNER_RADIUS = join(root, 'src/packages/mapspinner/planet-radius.js')

gate('the planet radius is 6,360,000 m, equal to spoint and to the mapspinner port', () => {
  assert.equal(PLANET_RADIUS_M, 6360000)
  assert.match(readFileSync(MAPSPINNER_RADIUS, 'utf8'), /PLANET_RADIUS_M = 6360000\.0/)
  if (existsSync(SPOINT_RADIUS)) assert.match(readFileSync(SPOINT_RADIUS, 'utf8'), /PLANET_RADIUS_M = 6360000\.0/)
})

gate('a surface point at height zero sits on the sphere, and a height offset moves it radially', () => {
  const p = surfacePoint(0.3, 1.1)
  assert.ok(Math.abs(length(p) - PLANET_RADIUS_M) < 1e-6)
  const q = surfacePoint(0.3, 1.1, 25)
  assert.ok(Math.abs(altitudeOf(q) - 25) < 1e-6)
})

gate('the up vector is the unit surface normal, and gravity points to the planet centre at 9.8 m/s2', () => {
  const p = surfacePoint(-0.7, 2.4, 3)
  const up = upAt(p)
  assert.ok(Math.abs(length(up) - 1) < 1e-12)
  const g = gravityAt(p)
  assert.ok(Math.abs(length(g) - GRAVITY_M_PER_S2) < 1e-9)
  assert.ok(Math.abs(dot(g, p) / (length(g) * length(p)) + 1) < 1e-12)
})

gate('the surface frame is orthonormal with up along the normal, at any yaw', () => {
  for (const yaw of [0, 0.7, 2.9, 5.5]) {
    const { up, forward, side } = frameOnSurface([0.2, 0.9, -0.4], yaw)
    assert.ok(Math.abs(dot(up, forward)) < 1e-12)
    assert.ok(Math.abs(dot(up, side)) < 1e-12)
    assert.ok(Math.abs(dot(forward, side)) < 1e-12)
    assert.ok(Math.abs(length(forward) - 1) < 1e-12 && Math.abs(length(side) - 1) < 1e-12)
  }
})

gate('the population has the density times the cap area, every object sits on the surface, and its up is the normal', () => {
  const capRad = 0.02
  const pop = placePopulation({ seed: 7, densityPerKm2: 50, centreLatRad: 0.4, centreLonRad: 1.0, capRad })
  assert.equal(pop.count, Math.round(50 * capAreaKm2(capRad)))
  for (let i = 0; i < pop.count; i++) {
    const p = [pop.positions[i * 3], pop.positions[i * 3 + 1], pop.positions[i * 3 + 2]]
    const n = [pop.normals[i * 3], pop.normals[i * 3 + 1], pop.normals[i * 3 + 2]]
    assert.ok(Math.abs(altitudeOf(p)) < 1e-6, 'object ' + i + ' is off the surface')
    assert.ok(Math.abs(length(n) - 1) < 1e-12)
    assert.ok(Math.abs(dot(normalise(p), n) - 1) < 1e-12, 'object ' + i + ' up is not the normal')
  }
})

gate('every object lies inside the cap around its centre', () => {
  const capRad = 0.03
  const centre = normalise(surfacePoint(0.4, 1.0))
  const pop = placePopulation({ seed: 11, densityPerKm2: 80, centreLatRad: 0.4, centreLonRad: 1.0, capRad })
  for (let i = 0; i < pop.count; i++) {
    const n = [pop.normals[i * 3], pop.normals[i * 3 + 1], pop.normals[i * 3 + 2]]
    assert.ok(Math.acos(Math.min(1, dot(n, centre))) <= capRad + 1e-9, 'object ' + i + ' is outside the cap')
  }
})

gate('the same seed reproduces the population bit for bit, and another seed does not', () => {
  const args = { densityPerKm2: 40, centreLatRad: 0.1, centreLonRad: 0.2, capRad: 0.01 }
  const a = placePopulation({ seed: 3, ...args })
  const b = placePopulation({ seed: 3, ...args })
  const c = placePopulation({ seed: 4, ...args })
  assert.deepEqual(a.positions, b.positions)
  assert.deepEqual(a.yaws, b.yaws)
  assert.notDeepEqual(a.positions, c.positions)
})

gate('a height function places each object at its own altitude', () => {
  const pop = placePopulation({ seed: 5, densityPerKm2: 30, centreLatRad: 0, centreLonRad: 0, capRad: 0.01, heightAt: (n) => 10 * n[1] + 2 })
  for (let i = 0; i < pop.count; i++) {
    const n = [pop.normals[i * 3], pop.normals[i * 3 + 1], pop.normals[i * 3 + 2]]
    assert.ok(Math.abs(altitudeOf([pop.positions[i * 3], pop.positions[i * 3 + 1], pop.positions[i * 3 + 2]]) - (10 * n[1] + 2)) < 1e-6)
  }
})

gate('zero density places nothing, and the yaw of every object is in [0, 2 pi)', () => {
  assert.equal(placePopulation({ seed: 1, densityPerKm2: 0, centreLatRad: 0, centreLonRad: 0, capRad: 0.01 }).count, 0)
  const pop = placePopulation({ seed: 2, densityPerKm2: 60, centreLatRad: 0, centreLonRad: 0, capRad: 0.02 })
  for (const yaw of pop.yaws) assert.ok(yaw >= 0 && yaw < 2 * Math.PI && yaw === wrapAngle(yaw))
})

gate('bad input is refused: a non-integer seed, a negative or non-finite density, a cap outside (0, pi)', () => {
  const base = { densityPerKm2: 1, centreLatRad: 0, centreLonRad: 0, capRad: 0.1 }
  assert.throws(() => placePopulation({ ...base, seed: 1.5 }), TypeError)
  assert.throws(() => placePopulation({ ...base, seed: 1, densityPerKm2: -1 }), RangeError)
  assert.throws(() => placePopulation({ ...base, seed: 1, densityPerKm2: Infinity }), RangeError)
  assert.throws(() => placePopulation({ ...base, seed: 1, capRad: 0 }), RangeError)
  assert.throws(() => placePopulation({ ...base, seed: 1, capRad: Math.PI }), RangeError)
})

gate('the seeded generator is uniform on [0, 1) and repeats for the same seed', () => {
  const r = mulberry32(42)
  const values = Array.from({ length: 4000 }, () => r())
  assert.ok(values.every((v) => v >= 0 && v < 1))
  const mean = values.reduce((s, v) => s + v, 0) / values.length
  assert.ok(Math.abs(mean - 0.5) < 0.03, 'mean ' + mean)
  assert.deepEqual(Array.from({ length: 3 }, () => mulberry32(42)()), [mulberry32(42)(), mulberry32(42)(), mulberry32(42)()])
})

finish()
