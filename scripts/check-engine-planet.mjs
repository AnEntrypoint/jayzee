import assert from 'node:assert/strict'
import { gate, finish } from './lib/gate.mjs'
import { createEngineWorld } from '../src/engine/EngineWorld.js'
import { worldToCell, resolveCell, packCellKey } from '../src/terrain-pure/cubeSphereCells.js'

const R = 1000
const CELL = 100
const N = Math.ceil((2 * R) / CELL)
const BALL = 0.35
const MAX_HEIGHT = 50
const SETTLE_TOLERANCE = 0.05

let seed = 7
const random = () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff
  return seed / 0x7fffffff
}

const unitVector = () => {
  for (;;) {
    const x = random() * 2 - 1
    const y = random() * 2 - 1
    const z = random() * 2 - 1
    const d = Math.hypot(x, y, z)
    if (d > 0.1 && d <= 1) return [x / d, y / d, z / d]
  }
}

const planetWorld = async () => {
  const world = await createEngineWorld({ capacity: 64 })
  world.configurePlanet({ radius: R, cellSize: CELL, gravity: 9.8, maxHeight: MAX_HEIGHT })
  return world
}

gate('locateCell matches worldToCell from cubeSphereCells.js for 400 points on the planet', async () => {
  const world = await planetWorld()
  for (let i = 0; i < 400; i++) {
    const point = unitVector().map((v) => v * R)
    assert.deepEqual(world.locateCell(point), worldToCell(point[0], point[1], point[2], R, CELL), 'point ' + point.join(','))
  }
})

gate('resolveCell matches resolveCell from cubeSphereCells.js for 300 cells, edges included', async () => {
  const world = await planetWorld()
  for (let i = 0; i < 300; i++) {
    const face = Math.floor(random() * 6)
    const cx = Math.floor(random() * (N + 2)) - 1
    const cy = Math.floor(random() * (N + 2)) - 1
    assert.deepEqual(world.resolveCell(face, cx, cy), resolveCell(face, cx, cy, N), 'cell ' + [face, cx, cy].join(','))
  }
})

gate('cellKey matches packCellKey for every resolved cell', async () => {
  const world = await planetWorld()
  for (let i = 0; i < 300; i++) {
    const face = Math.floor(random() * 6)
    const cx = Math.floor(random() * N)
    const cy = Math.floor(random() * N)
    assert.equal(world.cellKey(face, cx, cy), packCellKey(face, cx, cy, N), 'cell ' + [face, cx, cy].join(','))
  }
})

gate('a committed page is visible only after the next tick, and the height it gives is the sample', async () => {
  const world = await planetWorld()
  const point = [0, 0, R]
  const cell = world.locateCell(point)
  const key = world.cellKey(cell.face, cell.cx, cell.cy)
  const slot = world.writePage(key, new Float32Array(256).fill(5))
  assert.equal(world.pageSlot(key), -1, 'a pending commit must not be resident before the tick')
  assert.equal(world.height(...point), 0, 'height before the tick is the flat gap value')
  world.step()
  assert.equal(world.pageSlot(key), slot, 'the page is resident after the tick')
  assert.ok(Math.abs(world.height(...point) - 5) < 1e-9, 'height after the tick is the sample value')
})

gate('a released page leaves the table at the next tick', async () => {
  const world = await planetWorld()
  const cell = world.locateCell([0, 0, R])
  const key = world.cellKey(cell.face, cell.cx, cell.cy)
  world.writePage(key, new Float32Array(256))
  world.step()
  world.releasePage(key)
  assert.notEqual(world.pageSlot(key), -1, 'still visible until the tick applies the release')
  world.step()
  assert.equal(world.pageSlot(key), -1)
  assert.equal(world.residentPages(), 0)
})

gate('releasing a page that is not resident is refused', async () => {
  const world = await planetWorld()
  assert.throws(() => world.releasePage(12345), RangeError)
})

gate('a planet with a zero radius or a zero cell size is refused', async () => {
  const world = await createEngineWorld({ capacity: 8 })
  assert.throws(() => world.configurePlanet({ radius: 0, cellSize: CELL, gravity: 9.8, maxHeight: 0 }), RangeError)
  assert.throws(() => world.configurePlanet({ radius: R, cellSize: 0, gravity: 9.8, maxHeight: 0 }), RangeError)
})

gate('a sphere dropped above the planet settles at R plus its radius within 0.05 m', async () => {
  const world = await planetWorld()
  const handle = world.spawn([0, R + BALL + 3, 0])
  for (let t = 0; t < 1200; t++) world.step()
  const p = world.position(handle)
  const distance = Math.hypot(p[0], p[1], p[2])
  assert.ok(Math.abs(distance - (R + BALL)) <= SETTLE_TOLERANCE, 'settled at ' + distance + ', expected ' + (R + BALL))
})

gate('scripted flight after warm-up: zero allocations, unchanged body count and memory, pages streamed each 50 ticks', async () => {
  const world = await planetWorld()
  const handle = world.spawn([0, R + 50, 0], [30, 0, 0])
  world.markWarmup()
  const bodies = world.physicsBodies()
  const bytes = world.memoryBytes()
  let lastKey = null
  for (let t = 0; t < 2000; t++) {
    world.step()
    if (t % 50 === 0) {
      const p = world.position(handle)
      const cell = world.locateCell(p)
      const key = world.cellKey(cell.face, cell.cx, cell.cy)
      if (lastKey !== null) world.releasePage(lastKey)
      world.writePage(key, new Float32Array(256))
      lastKey = key
    }
  }
  assert.equal(world.allocationsSinceWarmup(), 0)
  assert.equal(world.physicsBodies(), bodies)
  assert.equal(world.memoryBytes(), bytes)
})

finish()
