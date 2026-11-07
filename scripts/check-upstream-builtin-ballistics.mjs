import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { solveShot, elevation, BALLISTICS_NAMES } from '../src/upstream-builtins/ballistics.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-ballistics.md')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const sameJson = (actual, expected, label = 'value') => same(JSON.stringify(actual), JSON.stringify(expected), label)
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const mustThrow = (check) => {
  let thrown = false
  try {
    check()
  } catch (_) {
    thrown = true
  }
  assert(thrown, 'negative control was accepted')
}

const landsOn = (from, to, shot, g, label) => {
  const t = shot.time
  const x = from[0] + shot.vel[0] * t
  const y = from[1] + shot.vel[1] * t - 0.5 * g * t * t
  const z = from[2] + shot.vel[2] * t
  near(x, to[0], label + ' x at impact')
  near(y, to[1], label + ' y at impact')
  near(z, to[2], label + ' z at impact')
}

gate('the names and the documented sentences and signatures are the ones upstream gives for ballistics', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('solveShot returns launch velocity and flight time, or null for an unreachable target.'), true, 'result sentence')
  same(section.includes('speed is meters per second; g is the magnitude of acceleration.'), true, 'units sentence')
  same(section.includes('elevation returns the low angle in radians.'), true, 'low angle sentence')
  same(section.includes('solveShot(from: Vec3, to: Vec3, speed: number, g: number, lead?: { x, z } | Vec3 | null): { vel: Vec3, time: number } | null'), true, 'solveShot signature')
  same(section.includes('elevation(speed: number, g: number, distance: number, rise: number): number | null'), true, 'elevation signature')
  sameJson(BALLISTICS_NAMES, ['solveShot', 'elevation'], 'exported names')
})

gate('a flat shot at 30 degrees has the low angle, and the high angle is not returned', () => {
  const d = (10 * 10 * Math.sin(Math.PI / 3)) / 10
  near(elevation(10, 10, d, 0), Math.PI / 6, 'low angle')
  near(elevation(10, 10, d, 0) - Math.PI / 3, -Math.PI / 6, 'low is below the high angle')
})

gate('solveShot on the flat 30 degree case gives the launch velocity and the one-second flight', () => {
  const d = (10 * 10 * Math.sin(Math.PI / 3)) / 10
  const shot = solveShot([0, 0, 0], [d, 0, 0], 10, 10)
  near(shot.vel[0], 10 * Math.cos(Math.PI / 6), 'vx')
  near(shot.vel[1], 5, 'vy')
  near(shot.vel[2], 0, 'vz')
  near(shot.time, 1, 'flight time')
  landsOn([0, 0, 0], [d, 0, 0], shot, 10, 'flat shot')
})

gate('the launch speed is the given speed, and the shot lands on the target for a raised and a turned target', () => {
  const from = [1, 2, 3]
  const to = [11, 7, -4]
  const shot = solveShot(from, to, 15, 9.81)
  near(Math.hypot(...shot.vel), 15, 'launch speed')
  landsOn(from, to, shot, 9.81, 'raised and turned target')
  const down = solveShot([0, 0, 0], [5, -3, 0], 10, 9.81)
  landsOn([0, 0, 0], [5, -3, 0], down, 9.81, 'target below the shooter')
})

gate('an unreachable target gives null, from both solveShot and elevation', () => {
  same(solveShot([0, 0, 0], [100, 0, 0], 10, 10), null, 'out of range')
  same(solveShot([0, 0, 0], [10, 50, 0], 10, 10), null, 'too high to reach')
  same(elevation(10, 10, 100, 0), null, 'elevation out of range')
})

gate('a lead of null or none is accepted; a non-null lead is a scoped negative, because upstream gives its shape only', () => {
  const plain = solveShot([0, 0, 0], [8.660254037844386, 0, 0], 10, 10)
  near(plain.time, 1, 'no lead')
  near(solveShot([0, 0, 0], [8.660254037844386, 0, 0], 10, 10, null).time, 1, 'null lead')
  mustThrow(() => solveShot([0, 0, 0], [8.660254037844386, 0, 0], 10, 10, { x: 1, z: 0 }))
  mustThrow(() => solveShot([0, 0, 0], [8.660254037844386, 0, 0], 10, 10, [1, 0, 0]))
})

gate('negative controls: a target straight above or below, a bad speed, a bad g, a bad distance and a bad vector are refused', () => {
  mustThrow(() => solveShot([0, 0, 0], [0, 5, 0], 10, 10))
  mustThrow(() => solveShot([0, 0, 0], [5, 0, 0], 0, 10))
  mustThrow(() => solveShot([0, 0, 0], [5, 0, 0], 10, 0))
  mustThrow(() => solveShot([0, 0, 0], [5, 0, 0], 10, -9.8))
  mustThrow(() => solveShot([0, 0, 0], [Number.NaN, 0, 0], 10, 10))
  mustThrow(() => solveShot([0, 0], [5, 0, 0], 10, 10))
  mustThrow(() => elevation(10, 10, 0, 0))
  mustThrow(() => elevation(10, 10, 5, Number.NaN))
})

finish()
