import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { createQueries } from '../src/world/query.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourcePath = join(root, 'src', 'world', 'query.js')

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
const mustReject = (check) => {
  let rejected = false
  try {
    check()
  } catch (_) {
    rejected = true
  }
  assert(rejected, 'negative control was accepted')
}
const mustThrow = mustReject

const worldWith = (bodies) => {
  const world = new World({ capacity: 16, gravity: 0, drag: 0, radius: 1, restitution: 0.2, solverIterations: 1 })
  for (const p of bodies) world.spawn(p)
  return world
}

gate('a ray along +x hits a body sphere on its near surface, with the outward normal and the hit point', () => {
  const queries = createQueries(worldWith([[5, 0, 0]]), { radius: 1 })
  const hit = queries.raycast([0, 0, 0], [1, 0, 0])
  same(hit.hit, true, 'hit')
  same(hit.kind, 'body', 'kind')
  same(hit.id, 0, 'id')
  near(hit.distance, 4, 'distance')
  sameJson(hit.normal.map((x) => Math.round(x)), [-1, 0, 0], 'normal')
  near(hit.position[0], 4, 'hit point x')
  mustReject(() => same(hit.distance, 5, 'distance'))
})

gate('a ray that misses, or stops short of the body, reports no hit', () => {
  const queries = createQueries(worldWith([[5, 0, 0]]), { radius: 1 })
  same(queries.raycast([0, 0, 0], [0, 1, 0]).hit, false, 'miss sideways')
  same(queries.raycast([0, 0, 0], [1, 0, 0], 3).hit, false, 'stops short')
  mustReject(() => same(queries.raycast([0, 0, 0], [1, 0, 0], 3).hit, true, 'stops short'))
})

gate('a ray origin inside a body sphere hits at distance zero, and the direction is normalised', () => {
  const queries = createQueries(worldWith([[5, 0, 0]]), { radius: 1 })
  const inside = queries.raycast([5, 0, 0], [1, 0, 0])
  same(inside.hit, true, 'inside hit')
  near(inside.distance, 0, 'inside distance')
  near(queries.raycast([0, 0, 0], [2, 0, 0]).distance, 4, 'distance for a scaled direction')
  mustThrow(() => queries.raycast([0, 0, 0], [0, 0, 0]))
  mustThrow(() => queries.raycast([0, 0, 0], [1, 0, 0], 0))
})

gate('an excluded body is skipped, and the next body along the ray is hit', () => {
  const queries = createQueries(worldWith([[5, 0, 0], [8, 0, 0]]), { radius: 1 })
  const hit = queries.raycast([0, 0, 0], [1, 0, 0], Infinity, { exclude: [0] })
  same(hit.id, 1, 'id after exclusion')
  near(hit.distance, 7, 'distance after exclusion')
  mustReject(() => same(queries.raycast([0, 0, 0], [1, 0, 0], Infinity, { exclude: [0] }).id, 0, 'excluded id'))
})

gate('a box is hit on its near face with the normal facing the ray, and the nearer of a box and a body wins', () => {
  const boxes = [[2, -1, -1, 3, 1, 1]]
  const queries = createQueries(worldWith([[5, 0, 0]]), { radius: 1, boxes })
  const hit = queries.raycast([0, 0, 0], [1, 0, 0])
  same(hit.kind, 'box', 'kind')
  same(hit.id, 0, 'box index')
  near(hit.distance, 2, 'distance')
  sameJson(hit.normal, [-1, 0, 0], 'normal')
  same(queries.raycast([0, 0, 0], [1, 0, 0], Infinity, { boxes: false }).kind, 'body', 'boxes disabled')
  same(queries.raycast([0, 0, 0], [-1, 0, 0]).hit, false, 'ray away from both')
  same(createQueries(worldWith([]), { radius: 1, boxes }).raycast([0, 2, 0], [1, 0, 0]).hit, false, 'ray parallel to the slab outside it')
  mustReject(() => same(createQueries(worldWith([]), { radius: 1, boxes }).raycast([0, 2, 0], [1, 0, 0]).hit, true, 'parallel miss'))
})

gate('an origin inside a box is a hit at distance zero with no normal', () => {
  const queries = createQueries(worldWith([]), { radius: 1, boxes: [[2, -1, -1, 3, 1, 1]] })
  const hit = queries.raycast([2.5, 0, 0], [1, 0, 0])
  same(hit.kind, 'box', 'kind')
  near(hit.distance, 0, 'distance')
  sameJson(hit.normal, [0, 0, 0], 'normal')
})

gate('overlapSphere includes a body exactly at its reach and excludes one beyond it, in index order', () => {
  const queries = createQueries(worldWith([[5, 0, 0], [6.5, 0, 0], [0, 3, 0]]), { radius: 1 })
  sameJson(queries.overlapSphere([0, 0, 0], 4), [0, 2], 'ids within reach')
  mustReject(() => sameJson(queries.overlapSphere([0, 0, 0], 4), [0, 1, 2], 'ids within reach'))
})

gate('overlapBox includes a body touching a face and excludes one a radius away, and a filter drops ids', () => {
  const queries = createQueries(worldWith([[1.5, 0.5, 0.5], [2.5, 0.5, 0.5], [2, 0.5, 0.5]]), { radius: 1 })
  sameJson(queries.overlapBox([0, 0, 0], [1, 1, 1]), [0, 2], 'ids touching the box')
  sameJson(queries.overlapBox([0, 0, 0], [1, 1, 1], { filter: (id) => id !== 0 }), [2], 'filtered ids')
  mustReject(() => sameJson(queries.overlapBox([0, 0, 0], [1, 1, 1]), [0, 1, 2], 'ids touching the box'))
})

gate('the queries read the world after kernel steps, and see a body only once it has landed', () => {
  const world = worldWith([])
  world.spawn([0, 3, 0])
  const queries = createQueries(world, { radius: 0.35 })
  sameJson(queries.overlapSphere([0, 0.35, 0], 0), [], 'before the fall')
  for (let t = 0; t < 120; t++) world.step()
  sameJson(queries.overlapSphere([0, 0.35, 0], 0), [], 'after the world step with no ground')
  const ground = new World({ capacity: 4, gravity: -18, drag: 0.1, radius: 0.35, restitution: 0.2, solverIterations: 8 })
  ground.spawn([0, 3, 0])
  const landed = createQueries(ground, { radius: 0.35 })
  for (let t = 0; t < 120; t++) ground.step()
  sameJson(landed.overlapSphere([0, 0.35, 0], 0), [0], 'landed body on the ground')
  mustReject(() => sameJson(landed.overlapSphere([0, 0.35, 0], 0), [], 'landed body on the ground'))
})

gate('a query refuses malformed input: a zero radius, an inverted box, a bad origin or reach', () => {
  const world = worldWith([[5, 0, 0]])
  mustThrow(() => createQueries(world, { radius: 0 }))
  mustThrow(() => createQueries(world, { radius: 1, boxes: [[1, 0, 0, 0, 1, 1]] }))
  const queries = createQueries(world, { radius: 1 })
  mustThrow(() => queries.raycast([0, 0], [1, 0, 0]))
  mustThrow(() => queries.overlapSphere([0, 0, 0], -1))
  mustThrow(() => queries.overlapBox([1, 0, 0], [0, 1, 1]))
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

gate('src/world/query.js is comment-free, imports nothing bare, reads no host clock or random source', () => {
  sameJson(findingsIn(readFileSync(sourcePath, 'utf8')), [], 'findings')
  mustReject(() => assert(findingsIn("import fs from 'node:fs'\nconst t = performance.now() // x").length === 0, 'negative sample'))
})

finish()
