import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createPath, PATH_NAMES } from '../src/upstream-builtins/path.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'upstream', 'tome', 'sections', 'builtin-path.md')

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

const L = [[0, 0], [3, 0], [3, 4]]
const SQUARE = [[0, 0], [4, 0], [4, 4], [0, 4]]

gate('the name and the documented sentences and signatures are the ones upstream gives for path', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('Distances and spacing use meters. spacing defaults to 2.'), true, 'spacing sentence')
  same(section.includes('closed adds the return segment; do not repeat the first point.'), true, 'closed sentence')
  same(section.includes('distance returns Infinity and nearest returns null beyond within.'), true, 'within sentence')
  same(section.includes('at wraps for a closed path and clamps for an open path.'), true, 'wrap sentence')
  same(section.includes('createPath(points: ([x, z] | [x, y, z] | { x, y?, z })[], opts?: { closed?: boolean, smooth?: boolean, spacing?: number }): PathHandle'), true, 'createPath signature')
  same(section.includes('PathHandle.nearest(x, z, within?: number): { x, y, z, distance, arcLength, t, segmentIndex, tx, tz } | null'), true, 'nearest signature')
  sameJson(PATH_NAMES, ['createPath'], 'exported names')
})

gate('an open path reports its length, points as [x, z], closed false and the default spacing 2', () => {
  const path = createPath(L)
  near(path.length, 7, 'length')
  same(path.closed, false, 'closed')
  same(path.spacing, 2, 'spacing default')
  sameJson(path.points, [[0, 0], [3, 0], [3, 4]], 'points')
  same(Object.isFrozen(path.points), true, 'points are read-only')
  same(createPath(L, { spacing: 5 }).spacing, 5, 'spacing option')
})

gate('distance is the nearest planar gap, and Infinity beyond within', () => {
  const path = createPath(L)
  near(path.distance(1, 1), 1, 'above the first segment')
  near(path.distance(5, 2), 2, 'beside the second segment')
  near(path.distance(5, 2, 2), 2, 'within reaches exactly')
  same(path.distance(5, 2, 1), Infinity, 'beyond within is Infinity')
})

gate('nearest gives the foot point, distance, arc length, segment fraction and tangent, and null beyond within', () => {
  const path = createPath(L)
  const first = path.nearest(1, 1)
  near(first.x, 1, 'first foot x')
  near(first.z, 0, 'first foot z')
  near(first.distance, 1, 'first distance')
  near(first.arcLength, 1, 'first arc length')
  near(first.t, 1 / 3, 'first fraction')
  same(first.segmentIndex, 0, 'first segment')
  near(first.tx, 1, 'first tangent x')
  near(first.tz, 0, 'first tangent z')
  const second = path.nearest(5, 2)
  near(second.x, 3, 'second foot x')
  near(second.z, 2, 'second foot z')
  near(second.arcLength, 5, 'second arc length')
  near(second.t, 0.5, 'second fraction')
  same(second.segmentIndex, 1, 'second segment')
  near(second.tz, 1, 'second tangent z')
  same(path.nearest(5, 2, 1), null, 'nearest is null beyond within')
})

gate('at walks the arc length, clamps on an open path, and returns the segment tangent', () => {
  const path = createPath(L)
  const mid = path.at(5)
  near(mid.x, 3, 'arc 5 x')
  near(mid.z, 2, 'arc 5 z')
  near(mid.tz, 1, 'arc 5 tangent')
  const start = path.at(-3)
  near(start.x, 0, 'before the start clamps to the start')
  near(start.z, 0, 'before the start clamps to the start z')
  const end = path.at(100)
  near(end.x, 3, 'past the end clamps to the end')
  near(end.z, 4, 'past the end clamps to the end z')
})

gate('a closed path adds the return segment, and at wraps it', () => {
  const path = createPath(SQUARE, { closed: true })
  near(path.length, 16, 'perimeter')
  same(path.closed, true, 'closed')
  const wrapped = path.at(16)
  near(wrapped.x, 0, 'a full lap is the start x')
  near(wrapped.z, 0, 'a full lap is the start z')
  const past = path.at(18)
  near(past.x, 2, 'past the lap wraps forward')
  near(past.z, 0, 'past the lap wraps forward z')
  const back = path.at(-2)
  near(back.x, 0, 'a negative arc wraps backward x')
  near(back.z, 2, 'a negative arc wraps backward z')
  near(path.distance(0, 2), 0, 'the return segment is part of the path')
})

gate('the y of a point is carried into nearest and at, interpolated along the segment', () => {
  const path = createPath([{ x: 0, y: 0, z: 0 }, { x: 4, y: 2, z: 0 }])
  const mid = path.at(2)
  near(mid.x, 2, 'midpoint x')
  near(mid.y, 1, 'midpoint y')
  const near2 = path.nearest(2, 3)
  near(near2.y, 1, 'nearest y')
  sameJson(path.points, [[0, 0], [4, 0]], 'points drop y')
})

gate('scoped negatives: smooth, unknown options, a bad spacing, a closed path that repeats its first point, a zero-length segment and a bad point are refused', () => {
  mustThrow(() => createPath(L, { smooth: true }))
  mustThrow(() => createPath(L, { simplify: true }))
  mustThrow(() => createPath(L, { spacing: 0 }))
  mustThrow(() => createPath(L, { spacing: -1 }))
  mustThrow(() => createPath(L, { closed: 1 }))
  mustThrow(() => createPath([[0, 0], [0, 0]]))
  mustThrow(() => createPath([[0, 0], [3, 0], [3, 0]]))
  mustThrow(() => createPath([[0, 0], [4, 0], [4, 4], [0, 0]], { closed: true }))
  mustThrow(() => createPath([[0, 0]]))
  mustThrow(() => createPath([[1, 2, 3, 4]]))
  mustThrow(() => createPath([{ x: 1 }, [0, 0]]))
  mustThrow(() => createPath(L).at(Number.NaN))
  mustThrow(() => createPath(L).distance(0, 0, -1))
  mustThrow(() => createPath(L).nearest(Number.NaN, 0))
})

gate('smooth false is accepted, since it asks for the default', () => {
  near(createPath(L, { smooth: false }).length, 7, 'smooth false length')
})

finish()
