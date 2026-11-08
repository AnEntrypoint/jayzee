import { canon } from './canon.mjs'

const box = (cx, cy, cz, hx, hy, hz) => ({
  vertices: [
    -hx, -hy, -hz, hx, -hy, -hz, hx, hy, -hz, -hx, hy, -hz,
    -hx, -hy, hz, hx, -hy, hz, hx, hy, hz, -hx, hy, hz,
  ],
  indices: [0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 3, 0, 4, 3, 4, 7],
  position: [cx, cy, cz],
})

export const SCENE = [
  { vertices: [-40, 0, -40, 40, 0, -40, 40, 0, 40, -40, 0, 40], indices: [0, 2, 1, 0, 3, 2], position: [0, 0, 0] },
  box(5, 1, 5, 1, 1, 1),
  box(-20, 2, -3, 3, 2, 1.5),
]

const DOWN = [0, -1, 0]

export const CASES = [
  { label: 'floor from 10 m, no exclude', origin: [0, 10, 0], direction: DOWN, maxDistance: 100 },
  { label: 'box top from above, no exclude', origin: [5, 5, 5], direction: DOWN, maxDistance: 20 },
  { label: 'box top, excluded by a single id', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: 1 },
  { label: 'box top, excluded by an array of one id', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: [1] },
  { label: 'floor and box excluded by an array', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: [0, 1] },
  { label: 'exclude an id that is not in the world', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: ['missing'] },
  { label: 'exclude an unknown id beside the box id', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: ['missing', 1] },
  { label: 'parallel ray misses the floor', origin: [-30, 5, -30], direction: [1, 0, 1], maxDistance: 100 },
  { label: 'unnormalised direction hits the second box top', origin: [-20, 10, -3], direction: [0, -3, 0], maxDistance: 20 },
  { label: 'ray that stops short of the floor', origin: [0, 10, 0], direction: DOWN, maxDistance: 5 },
  { label: 'park box A as a dormant static', park: 1 },
  { label: 'parked box blocks a ray that reaches it', origin: [5, 5, 5], direction: DOWN, maxDistance: 20 },
  { label: 'parked box is clear of a ray that misses it', origin: [0, 10, 0], direction: DOWN, maxDistance: 100 },
  { label: 'parked box, box excluded, floor beyond its reach', origin: [5, 5, 5], direction: DOWN, maxDistance: 20, exclude: 1 },
  { label: 'drain every parked static', drain: true },
  { label: 'after the drain the box blocks the ray again', origin: [5, 5, 5], direction: DOWN, maxDistance: 20 },
]

export const RAYCAST_CASE_LABELS = CASES.map((c) => c.label)

function pick(r) {
  return { hit: r.hit, distance: r.distance, bodyId: r.bodyId, normal: r.normal, position: r.position, unavailable: r.unavailable ?? null }
}

export async function runRaycastScenario(adapter) {
  const ids = []
  for (const body of SCENE) ids.push(await adapter.addStatic(body.vertices, body.indices, body.position))
  const toId = (ref) => (ref === 'missing' ? 999999 : ids[ref])
  const rows = []
  for (const c of CASES) {
    let result
    try {
      if (c.park !== undefined) result = { parked: await adapter.park(ids[c.park], SCENE[c.park].position) }
      else if (c.drain) result = { drained: await adapter.drainAll() }
      else {
        const exclude = c.exclude === undefined ? null : Array.isArray(c.exclude) ? c.exclude.map(toId) : toId(c.exclude)
        result = pick(await adapter.cast(c.origin, c.direction, c.maxDistance, exclude))
      }
    } catch (error) {
      result = { threw: error.message }
    }
    rows.push(canon({ label: c.label, result }))
  }
  adapter.destroy()
  return { rows }
}
