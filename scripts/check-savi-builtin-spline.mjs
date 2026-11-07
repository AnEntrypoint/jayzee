import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { createSplineSet, SPLINE_NAMES } from '../src/savi-builtins/spline.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sectionPath = join(root, 'scripts', 'fixtures', 'savi', 'tome', 'sections', 'builtin-spline.md')
const sourcePath = join(root, 'src', 'savi-builtins', 'spline.js')

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
const near = (actual, expected, label, tolerance = 1e-9) => {
  assert(Math.abs(actual - expected) <= tolerance, label + ' is ' + actual + ', expected ' + expected)
}
const nearVec = (actual, expected, label, tolerance = 1e-9) => {
  assert(actual.length === 3 && expected.every((e, i) => Math.abs(actual[i] - e) <= tolerance), label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
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

const L = [[0, 0, 0], [3, 0, 0], [3, 4, 0]]

gate('the names and the signatures are the ones savi documents for spline', () => {
  const section = readFileSync(sectionPath, 'utf8')
  same(section.includes('splineLength returns meters, or 0 for a non-spline id.'), true, 'length sentence')
  same(section.includes('at is 0 to 1 by default; space: distance uses meters.'), true, 'at sentence')
  same(section.includes('splineLength(ctx, id: string): number'), true, 'splineLength signature')
  same(section.includes('sampleSpline(ctx, id: string, at: number, opts?: { space?: "normalized" | "distance", tangentAxis?: "x" | "z" }): { position, tangent, normal, lateral, rotation, distance, progress } | null'), true, 'sampleSpline signature')
  same(section.includes('projectToSpline(ctx, id: string, point: Vec3 | [x, y, z] | objectId, opts?): SplineSample | null'), true, 'projectToSpline signature')
  same(JSON.stringify(SPLINE_NAMES), JSON.stringify(['splineLength', 'sampleSpline', 'projectToSpline']), 'exported names')
})

gate('splineLength is the sum of the segment lengths in meters, and a non-spline id gives 0', () => {
  const set = createSplineSet({ road: { points: L } })
  near(set.splineLength('road'), 7, 'road length')
  near(set.splineLength('missing'), 0, 'unknown id')
  near(set.splineLength('constructor'), 0, 'prototype key is not a spline')
})

gate('normalized at runs 0 to 1 over the whole length, and progress matches it', () => {
  const set = createSplineSet({ road: { points: L } })
  const start = set.sampleSpline('road', 0)
  nearVec(start.position, [0, 0, 0], 'start position')
  near(start.progress, 0, 'start progress')
  const mid = set.sampleSpline('road', 0.5)
  nearVec(mid.position, [3, 0.5, 0], 'midpoint position')
  near(mid.distance, 3.5, 'midpoint distance')
  near(mid.progress, 0.5, 'midpoint progress')
  nearVec(mid.tangent, [0, 1, 0], 'tangent on the second segment')
  const end = set.sampleSpline('road', 1)
  nearVec(end.position, [3, 4, 0], 'end position')
  near(end.progress, 1, 'end progress')
  mustThrow(() => near(set.sampleSpline('road', 0.5).distance, 0.5, 'midpoint distance'))
})

gate('space distance takes meters, so at 3 is the corner and at 5 is two metres up the second segment', () => {
  const set = createSplineSet({ road: { points: L } })
  const corner = set.sampleSpline('road', 3, { space: 'distance' })
  nearVec(corner.position, [3, 0, 0], 'corner')
  near(corner.progress, 3 / 7, 'corner progress')
  const up = set.sampleSpline('road', 5, { space: 'distance' })
  nearVec(up.position, [3, 2, 0], 'two metres up')
  nearVec(up.tangent, [0, 1, 0], 'tangent after the corner')
})

gate('a non-spline id gives null from sampleSpline and projectToSpline', () => {
  const set = createSplineSet({ road: { points: L } })
  same(set.sampleSpline('missing', 0.5), null, 'sample of unknown id')
  same(set.projectToSpline('missing', [0, 0, 0]), null, 'projection of unknown id')
  same(set.sampleSpline('constructor', 0.5), null, 'prototype key sample')
})

gate('projectToSpline returns the nearest point on the polyline, given as an array or a {x, y, z} object', () => {
  const set = createSplineSet({ road: { points: L } })
  const near1 = set.projectToSpline('road', [1, 1, 0])
  nearVec(near1.position, [1, 0, 0], 'projection onto the first segment')
  near(near1.distance, 1, 'distance along the spline')
  near(near1.progress, 1 / 7, 'progress of the projection')
  const near2 = set.projectToSpline('road', { x: 5, y: 2, z: 0 })
  nearVec(near2.position, [3, 2, 0], 'projection onto the second segment')
  near(near2.distance, 5, 'distance along the spline after the corner')
})

gate('the sample record carries the position, tangent, distance and progress; normal, lateral and rotation are not produced, because savi gives their names only', () => {
  const set = createSplineSet({ road: { points: L } })
  same(JSON.stringify(Object.keys(set.sampleSpline('road', 0.5)).sort()), JSON.stringify(['distance', 'position', 'progress', 'tangent']), 'sample fields')
})

gate('scoped negatives: out-of-range at, unknown space, tangentAxis, projection options, and an object-id point are refused', () => {
  const set = createSplineSet({ road: { points: L } })
  mustThrow(() => set.sampleSpline('road', 1.5))
  mustThrow(() => set.sampleSpline('road', -0.1))
  mustThrow(() => set.sampleSpline('road', 8, { space: 'distance' }))
  mustThrow(() => set.sampleSpline('road', 0.5, { space: 'meters' }))
  mustThrow(() => set.sampleSpline('road', 0.5, { tangentAxis: 'z' }))
  mustThrow(() => set.sampleSpline('road', Number.NaN))
  mustThrow(() => set.projectToSpline('road', [0, 0, 0], { space: 'distance' }))
  mustThrow(() => set.projectToSpline('road', 'object-7'))
  mustThrow(() => set.projectToSpline('road', [0, Number.NaN, 0]))
})

gate('scoped negatives: closed, bezier and shape geometry, a short point list, and a zero-length segment are refused', () => {
  mustThrow(() => createSplineSet({ r: { points: L, closed: true } }))
  mustThrow(() => createSplineSet({ r: { points: L, beziers: [] } }))
  mustThrow(() => createSplineSet({ r: { points: L, shape: 'circle' } }))
  mustThrow(() => createSplineSet({ r: { points: [[0, 0, 0]] } }))
  mustThrow(() => createSplineSet({ r: { points: [[0, 0, 0], [0, 0, 0]] } }))
  const open = createSplineSet({ r: { points: L, closed: false } })
  near(open.splineLength('r'), 7, 'closed false is accepted')
})

const hostGlobals = ['process', 'performance', 'Date', 'setTimeout', 'clearTimeout', 'setImmediate', 'setInterval', 'console', 'window', 'globalThis', 'require', 'Buffer']

const findingsIn = (source) => {
  const found = []
  if (source.includes('//') || source.includes('/*')) found.push('comment marker')
  if (source.includes('Math.random')) found.push('uses Math.random')
  for (const piece of source.split("from '").slice(1)) {
    const specifier = piece.slice(0, piece.indexOf("'"))
    if (!specifier.startsWith('.')) found.push('bare import ' + specifier)
  }
  const words = new Set(source.split(/[^A-Za-z0-9_$]/))
  for (const token of hostGlobals) {
    if (words.has(token)) found.push('uses ' + token)
  }
  return found
}

gate('src/savi-builtins/spline.js is comment-free, imports nothing bare, reads no host global', () => {
  same(findingsIn(readFileSync(sourcePath, 'utf8')).join(','), '', 'findings')
  same(findingsIn('const t = performance.now() // x').length > 0, true, 'negative sample is caught')
})

finish()
