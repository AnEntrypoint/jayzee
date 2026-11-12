import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { finish, gate } from './lib/gate.mjs'
import { makeScenarios, runAll, EXACT_INDEX, COINCIDENT_INDEX } from './lib/playerCollisionScenario.mjs'
import { CollisionSystem } from '../src/netcode/CollisionSystem.js'
import { applyPlayerCollisions } from '../src/netcode/playerCollisions.js'

const fixture = JSON.parse(readFileSync(new URL('./fixtures/spoint/player-collisions.json', import.meta.url), 'utf8'))
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)

const systems = new Map()
const viaSystem = (players, grid, gridCells, cellSz, minDist2, minDist, dt, physicsIntegration) => {
  let system = systems.get(grid)
  if (!system) {
    system = new CollisionSystem({ capacity: 64, cellSize: cellSz, minDist })
    systems.set(grid, system)
  }
  system.apply(players, dt, physicsIntegration)
}
const ran = runAll(viaSystem)

const mulberry = (seed) => () => {
  seed = (seed + 0x6D2B79F5) | 0
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296
}

const crowd = (count, spread, seed) => {
  const random = mulberry(seed)
  return Array.from({ length: count }, (_, i) => ({ id: i + 1, state: { position: [(random() - 0.5) * spread, random(), (random() - 0.5) * spread], velocity: [random() - 0.5, 0, random() - 0.5] } }))
}

const clone = (players) => players.map((p) => ({ id: p.id, state: { position: [...p.state.position], velocity: [...p.state.velocity] } }))

gate('the CollisionSystem class leaves every player at the same position and velocity as spoint, frame by frame, over the 38 recorded scenarios', () => {
  assert.equal(fixture.scenarios.length, makeScenarios().length)
  const got = ran.map((s) => s.frames.map((f) => f.state))
  const want = fixture.scenarios.map((s) => s.frames.map((f) => f.state))
  assert.ok(same(got, want), 'player states differ from spoint')
})

gate('the class issues the same setPlayerPosition calls as spoint, in the same order, on every frame', () => {
  const got = ran.map((s) => s.frames.map((f) => f.calls))
  const want = fixture.scenarios.map((s) => s.frames.map((f) => f.calls))
  assert.ok(same(got, want), 'physics position calls differ from spoint')
  assert.ok(got.flat(2).length > 100, 'the scenarios pushed too few pairs to tell')
})

gate('a pair at exactly the minimum distance, and a coincident pair, are left alone', () => {
  for (const index of [EXACT_INDEX, COINCIDENT_INDEX]) {
    const got = ran.find((s) => s.index === index)
    assert.equal(got.frames[0].calls.length, 0)
  }
})

gate('a crowd of 1500 over 40 frames matches the Map-based function exactly, across negative cells and a table with hash collisions', () => {
  const a = crowd(1500, 60, 9)
  const b = clone(a)
  const system = new CollisionSystem({ capacity: 1500, cellSize: 1.2, minDist: 0.8 })
  const grid = new Map(), cells = new Map()
  const callsA = [], callsB = []
  let pushed = 0
  for (let frame = 0; frame < 40; frame++) {
    pushed += system.apply(a, 1 / 60, { setPlayerPosition: (id, p) => callsA.push(id, p[0], p[2]) })
    applyPlayerCollisions(b, grid, cells, 1.2, 0.64, 0.8, 1 / 60, { setPlayerPosition: (id, p) => callsB.push(id, p[0], p[2]) })
    for (const list of [a, b]) for (const p of list) for (let k = 0; k < 3; k++) p.state.position[k] += p.state.velocity[k] / 60
  }
  assert.ok(pushed > 1000, 'only ' + pushed + ' pairs were pushed')
  assert.equal(system.stats.pairsPushed, pushed)
  assert.ok(same(a, b), 'the class and the function left different states')
  assert.ok(same(callsA, callsB), 'the class and the function made different position calls')
})

gate('the grid is sized once: 2000 passes over a moving crowd keep every typed array and the quietest 500-pass round grows the heap by less than 1 MB', () => {
  const players = crowd(400, 40, 3)
  const system = new CollisionSystem({ capacity: 400, cellSize: 1.2, minDist: 0.8 })
  const arrays = [system.slotStamp, system.slotCx, system.slotCz, system.slotHead, system.slotTail, system.next]
  const sink = { setPlayerPosition() {} }
  for (let pass = 0; pass < 200; pass++) system.apply(players, 1 / 60, sink)
  const measure = (run) => {
    let least = Infinity
    for (let round = 0; round < 4; round++) {
      const before = process.memoryUsage().heapUsed
      run()
      least = Math.min(least, process.memoryUsage().heapUsed - before)
    }
    return least
  }
  const grown = measure(() => {
    for (let pass = 0; pass < 500; pass++) {
      system.apply(players, 1 / 60, sink)
      for (const p of players) { p.state.position[0] += p.state.velocity[0] / 60; p.state.position[2] += p.state.velocity[2] / 60 }
    }
  })
  const kept = []
  const controlGrown = measure(() => {
    for (let pass = 0; pass < 500; pass++) kept.push(Array.from({ length: 400 }, (_, i) => [i, pass]))
  })
  assert.ok(controlGrown > 1 << 20, 'negative control: an allocating loop of the same length grew the heap by only ' + controlGrown + ' bytes')
  assert.deepEqual([system.slotStamp, system.slotCx, system.slotCz, system.slotHead, system.slotTail, system.next].map((x, i) => x === arrays[i]), [true, true, true, true, true, true])
  assert.ok(grown < 1 << 20, 'heap grew by ' + grown + ' bytes')
  assert.equal(system.stats.passes, 2200)
  assert.equal(kept.length, 2000)
})

gate('the class refuses a crowd above its capacity, a bad cell size, a bad distance and a bad dt', () => {
  const system = new CollisionSystem({ capacity: 2, cellSize: 1, minDist: 0.8 })
  assert.throws(() => system.apply(crowd(3, 1, 1), 1 / 60, { setPlayerPosition() {} }), /holds 2 players, got 3/)
  assert.throws(() => system.apply(crowd(2, 1, 1), 0, { setPlayerPosition() {} }), /dt must be/)
  const far = crowd(2, 1, 1)
  far[1].state.position[0] = NaN
  assert.throws(() => system.apply(far, 1 / 60, { setPlayerPosition() {} }), /outside the grid/)
  assert.throws(() => new CollisionSystem({ capacity: 0, cellSize: 1, minDist: 1 }), /capacity/)
  assert.throws(() => new CollisionSystem({ capacity: 4, cellSize: 0, minDist: 1 }), /cellSize/)
  assert.throws(() => new CollisionSystem({ capacity: 4, cellSize: 1, minDist: NaN }), /minDist/)
})

gate('negative control: a system with a smaller minimum distance than the scenario leaves different states', () => {
  const short = runAll((players, grid, gridCells, cellSz, minDist2, minDist, dt, physicsIntegration) => new CollisionSystem({ capacity: 64, cellSize: cellSz, minDist: minDist * 0.5 }).apply(players, dt, physicsIntegration))
  assert.ok(!same(short.map((s) => s.frames.map((f) => f.state)), fixture.scenarios.map((s) => s.frames.map((f) => f.state))), 'the halved distance matched spoint')
})

finish()
