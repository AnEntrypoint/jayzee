import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { createQueries } from '../src/world/query.js'
import { createTriangleMesh, rayCapsule, rayTriangle } from '../src/world/rayShapes.js'

const assert = (condition, message) => {
  if (!condition) throw new Error(message)
}
const same = (actual, expected, label = 'value') => {
  assert(actual === expected, label + ' is ' + JSON.stringify(actual) + ', expected ' + JSON.stringify(expected))
}
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

const QUAD = { positions: Float32Array.from([0, 0, 0, 4, 0, 0, 4, 0, 4, 0, 0, 4]), indices: Uint16Array.from([0, 2, 1, 0, 3, 2]) }

const lcg = (seed) => {
  let state = seed >>> 0
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    return state / 4294967296
  }
}

const terrain = (cells) => {
  const side = cells + 1
  const positions = new Float32Array(side * side * 3)
  const random = lcg(7)
  for (let z = 0; z < side; z++) {
    for (let x = 0; x < side; x++) {
      const o = (z * side + x) * 3
      positions[o] = x
      positions[o + 1] = random() * 3
      positions[o + 2] = z
    }
  }
  const indices = new Uint32Array(cells * cells * 6)
  let w = 0
  for (let z = 0; z < cells; z++) {
    for (let x = 0; x < cells; x++) {
      const a = z * side + x
      const b = a + 1
      const c = a + side
      const d = c + 1
      indices[w++] = a
      indices[w++] = c
      indices[w++] = b
      indices[w++] = b
      indices[w++] = c
      indices[w++] = d
    }
  }
  return { positions, indices }
}

const bruteForce = (mesh, origin, direction, maxDistance) => {
  let best = -1
  let triangle = -1
  for (let t = 0; t < mesh.indices.length / 3; t++) {
    const d = rayTriangle(origin, direction, mesh.positions, mesh.indices[t * 3] * 3, mesh.indices[t * 3 + 1] * 3, mesh.indices[t * 3 + 2] * 3, maxDistance)
    if (d < 0) continue
    if (best < 0 || d < best) {
      best = d
      triangle = t
    }
  }
  return { distance: best, triangle }
}

const unit = (v) => {
  const length = Math.hypot(v[0], v[1], v[2])
  return [v[0] / length, v[1] / length, v[2] / length]
}

gate('a ray straight down hits a triangle at the height above it, and one outside the triangle misses', () => {
  near(rayTriangle([3, 5, 1], [0, -1, 0], QUAD.positions, 0, 6, 3, Infinity), 5, 'distance to the first triangle')
  same(rayTriangle([-1, 5, 2], [0, -1, 0], QUAD.positions, 0, 6, 3, Infinity), -1, 'ray outside the triangle')
  same(rayTriangle([3, 5, 1], [0, -1, 0], QUAD.positions, 0, 6, 3, 4), -1, 'ray that stops short')
  same(rayTriangle([3, 5, 1], [0, 1, 0], QUAD.positions, 0, 6, 3, Infinity), -1, 'ray pointing away')
})

gate('with back faces off a ray reaching the triangle from behind misses, and with them on it hits', () => {
  near(rayTriangle([3, -5, 1], [0, 1, 0], QUAD.positions, 0, 6, 3, Infinity, true), 5, 'two-sided hit from below')
  same(rayTriangle([3, -5, 1], [0, 1, 0], QUAD.positions, 0, 6, 3, Infinity, false), -1, 'culled hit from below')
  near(rayTriangle([3, 5, 1], [0, -1, 0], QUAD.positions, 0, 6, 3, Infinity, false), 5, 'front face is still hit with culling on')
})

gate('a ray across a capsule hits the cylinder side at the radius, and a ray along the axis hits the end cap', () => {
  const side = rayCapsule([-5, 1, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity)
  near(side.distance, 4.5, 'side distance')
  near(side.normal[0], -1, 'side normal x')
  near(side.normal[1], 0, 'side normal y')
  const cap = rayCapsule([0, 10, 0], [0, -1, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity)
  near(cap.distance, 7.5, 'cap distance')
  near(cap.normal[1], 1, 'cap normal y')
  const low = rayCapsule([-5, -0.3, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity)
  near(low.distance, 5 - Math.sqrt(0.25 - 0.09), 'distance to the lower cap sphere')
})

gate('a ray that passes a capsule further out than its radius, stops short or starts inside is answered as a miss, a miss and distance zero', () => {
  same(rayCapsule([-5, 1, 0.51], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity), null, 'ray beside the capsule')
  same(rayCapsule([-5, 2.6, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity), null, 'ray above the cap')
  same(rayCapsule([-5, 1, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, 4), null, 'ray that stops short')
  same(rayCapsule([0.1, 1, 0], [1, 0, 0], [0, 0, 0], [0, 2, 0], 0.5, Infinity).distance, 0, 'origin inside')
})

gate('a capsule whose two ends coincide is hit as a sphere', () => {
  const hit = rayCapsule([-5, 0, 0], [1, 0, 0], [0, 0, 0], [0, 0, 0], 1, Infinity)
  near(hit.distance, 4, 'distance')
  near(hit.normal[0], -1, 'normal x')
})

gate('a mesh ray reports the nearest triangle, its index and a unit normal facing the ray', () => {
  const mesh = createTriangleMesh(QUAD)
  const hit = mesh.raycast([3, 5, 1], [0, -1, 0])
  near(hit.distance, 5, 'distance')
  same(hit.triangle, 0, 'triangle index')
  near(hit.normal[1], 1, 'normal y faces up toward the ray origin')
  const under = mesh.raycast([3, -5, 1], [0, 1, 0])
  near(under.normal[1], -1, 'normal y faces down toward a ray from below')
  same(mesh.raycast([3, -5, 1], [0, 1, 0], Infinity, false), null, 'culled ray from below')
  same(mesh.raycast([9, 5, 1], [0, -1, 0]), null, 'ray beside the mesh')
})

gate('on a 4802-triangle terrain the tree answers 400 seeded rays exactly as a test of every triangle does', () => {
  const data = terrain(49)
  const mesh = createTriangleMesh(data)
  same(mesh.triangleCount, 4802, 'triangle count')
  const random = lcg(99)
  let hits = 0
  for (let i = 0; i < 400; i++) {
    const origin = [random() * 60 - 5, 6 + random() * 4, random() * 60 - 5]
    const direction = unit([random() - 0.5, -random() - 0.05, random() - 0.5])
    const expected = bruteForce(data, origin, direction, 200)
    const actual = mesh.raycast(origin, direction, 200)
    if (expected.triangle === -1) {
      same(actual, null, 'ray ' + i)
      continue
    }
    hits += 1
    same(actual.distance, expected.distance, 'distance of ray ' + i)
    same(actual.triangle, expected.triangle, 'triangle of ray ' + i)
  }
  assert(hits > 200, 'only ' + hits + ' of 400 rays hit the terrain')
})

gate('the tree visits far fewer nodes than there are triangles for one ray', () => {
  const mesh = createTriangleMesh(terrain(49))
  mesh.raycast([25, 20, 25], [0, -1, 0], 100)
  assert(mesh.visited < 200, 'the ray visited ' + mesh.visited + ' nodes')
  assert(mesh.depth < 30, 'tree depth is ' + mesh.depth)
})

gate('negative control: a test that checks every triangle and keeps the first hit, not the nearest, disagrees with the tree', () => {
  const data = terrain(49)
  const mesh = createTriangleMesh(data)
  const origin = [2, 8, 2]
  const direction = unit([1, -0.12, 1])
  let firstFound = -1
  for (let t = 0; t < data.indices.length / 3 && firstFound < 0; t++) {
    if (rayTriangle(origin, direction, data.positions, data.indices[t * 3] * 3, data.indices[t * 3 + 1] * 3, data.indices[t * 3 + 2] * 3, 200) >= 0) firstFound = t
  }
  const nearest = bruteForce(data, origin, direction, 200)
  same(mesh.raycast(origin, direction, 200).triangle, nearest.triangle, 'tree answer')
  let disagreements = 0
  const random = lcg(5)
  for (let i = 0; i < 200; i++) {
    const o = [random() * 40, 7 + random() * 2, random() * 40]
    const d = unit([random() - 0.5, -0.08, random() - 0.5])
    let any = -1
    let last = -1
    for (let t = 0; t < data.indices.length / 3; t++) {
      if (rayTriangle(o, d, data.positions, data.indices[t * 3] * 3, data.indices[t * 3 + 1] * 3, data.indices[t * 3 + 2] * 3, 200) >= 0) {
        if (any < 0) any = t
        last = t
      }
    }
    const hit = mesh.raycast(o, d, 200)
    if (hit && (hit.triangle !== any || hit.triangle !== last)) disagreements += 1
  }
  assert(disagreements > 0, 'every ray crossed one triangle only, so the control shows nothing')
})

gate('a world query returns the nearest of a body, a box, a capsule and a mesh along one ray', () => {
  const world = new World({ capacity: 4, gravity: 0, drag: 0, radius: 1, restitution: 0, solverIterations: 1 })
  world.spawn([30, 1, 2])
  const queries = createQueries(world, {
    radius: 1,
    boxes: [[20, 0, 0, 21, 4, 4]],
    capsules: [{ a: [10, 0, 2], b: [10, 3, 2], radius: 0.5 }],
    meshes: [createTriangleMesh({ positions: Float32Array.from([5, 0, 0, 5, 4, 0, 5, 0, 4, 5, 4, 4]), indices: Uint16Array.from([0, 1, 2, 2, 1, 3]) })],
  })
  const all = queries.raycast([0, 1, 2], [1, 0, 0])
  same(all.kind, 'mesh', 'nearest kind')
  near(all.distance, 5, 'mesh distance')
  near(all.normal[0], -1, 'mesh normal faces the ray')
  same(typeof all.triangle, 'number', 'triangle index is reported')
  const noMesh = queries.raycast([0, 1, 2], [1, 0, 0], Infinity, { meshes: false })
  same(noMesh.kind, 'capsule', 'kind without meshes')
  near(noMesh.distance, 9.5, 'capsule distance')
  const noShapes = queries.raycast([0, 1, 2], [1, 0, 0], Infinity, { meshes: false, capsules: false })
  same(noShapes.kind, 'box', 'kind without meshes and capsules')
  near(noShapes.distance, 20, 'box distance')
  const bodyOnly = queries.raycast([0, 1, 2], [1, 0, 0], Infinity, { meshes: false, capsules: false, boxes: false })
  same(bodyOnly.kind, 'body', 'kind with statics off')
  near(bodyOnly.distance, 29, 'body distance')
})

gate('a mesh refuses positions that are not triples, an index past the last vertex and an empty index list, and the queries refuse a capsule with no radius', () => {
  mustReject(() => createTriangleMesh({ positions: Float32Array.from([0, 0]), indices: Uint16Array.from([0, 0, 0]) }))
  mustReject(() => createTriangleMesh({ positions: QUAD.positions, indices: Uint16Array.from([0, 1, 9]) }))
  mustReject(() => createTriangleMesh({ positions: QUAD.positions, indices: new Uint16Array(0) }))
  mustReject(() => createTriangleMesh({ positions: Float32Array.from([0, 0, NaN, 1, 0, 0, 0, 1, 0]), indices: Uint16Array.from([0, 1, 2]) }))
  const world = new World({ capacity: 2, gravity: 0, drag: 0, radius: 1, restitution: 0, solverIterations: 1 })
  mustReject(() => createQueries(world, { radius: 1, capsules: [{ a: [0, 0, 0], b: [0, 1, 0], radius: 0 }] }))
  mustReject(() => createQueries(world, { radius: 1, meshes: [{}] }))
})

finish()
