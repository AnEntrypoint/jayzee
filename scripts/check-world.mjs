import { gate, finish } from './lib/gate.mjs'
import assert from 'node:assert/strict'
import { World } from '../src/world/World.js'

gate('a spawned body falls under gravity and comes to rest on the ground at its radius', () => {
  const world = new World({ radius: 0.35 })
  const id = world.spawn([0, 10, 0])
  for (let i = 0; i < 64 * 4; i++) world.step()
  const [, y] = world.position(id)
  assert.ok(Math.abs(y - 0.35) < 1e-9, 'resting height ' + y)
  assert.ok(Math.abs(world.velocity(id)[1]) < 1e-9)
})

gate('a body lands on a box top rather than falling through it', () => {
  const world = new World({ radius: 0.35, boxes: [[-1, 0, -1, 1, 2, 1]] })
  const id = world.spawn([0, 6, 0])
  for (let i = 0; i < 64 * 4; i++) world.step()
  const [, y] = world.position(id)
  assert.ok(Math.abs(y - 2.35) < 1e-9, 'resting height ' + y)
})

gate('advance steps by whole fixed ticks and carries the remainder', () => {
  const world = new World({ tickRate: 64 })
  world.spawn([0, 50, 0])
  assert.equal(world.advance(3.5 / 64), 3)
  assert.equal(world.tick, 3)
  assert.equal(world.advance(0.5 / 64), 1)
  assert.equal(world.tick, 4)
})

gate('advance caps the catch-up after a long stall instead of spiralling', () => {
  const world = new World({ tickRate: 64 })
  world.spawn([0, 50, 0])
  assert.equal(world.advance(10), 8)
})

gate('two worlds driven by the same schedule reach the same state and hash', () => {
  const run = () => {
    const world = new World({ boxes: [[-2, 0, -2, 2, 1, 2]] })
    world.spawn([0, 4, 0], [0.5, 0, 0])
    world.spawn([0.3, 6, 0.1], [-0.5, 0, 0])
    world.spawn([0.1, 8, -0.2])
    for (let i = 0; i < 300; i++) world.step()
    return world
  }
  const a = run()
  const b = run()
  assert.equal(a.hash(), b.hash())
  assert.deepEqual(a.snapshot().positions, b.snapshot().positions)
})

gate('a different schedule gives a different hash', () => {
  const a = new World()
  const b = new World()
  a.spawn([0, 4, 0])
  b.spawn([0, 4.001, 0])
  for (let i = 0; i < 10; i++) {
    a.step()
    b.step()
  }
  assert.notEqual(a.hash(), b.hash())
})

gate('snapshot copies positions so later steps do not change it', () => {
  const world = new World()
  world.spawn([0, 4, 0])
  const before = world.snapshot()
  world.step()
  assert.equal(before.tick, 0)
  assert.equal(before.positions.length, 3)
  assert.notEqual(world.snapshot().positions[1], before.positions[1])
})

gate('spawn rejects a full world and bad input', () => {
  const world = new World({ capacity: 1 })
  world.spawn([0, 1, 0])
  assert.throws(() => world.spawn([0, 1, 0]), RangeError)
  assert.throws(() => new World({ restitution: 2 }), RangeError)
  assert.throws(() => new World({ boxes: [[1, 0, 0, -1, 1, 1]] }), RangeError)
  assert.throws(() => new World().position(0), RangeError)
})

gate('hash changes for a velocity change far below the old quantum', () => {
  const world = new World()
  world.spawn([0, 4, 0])
  const before = world.hash()
  world.setVelocity(0, [0, 0, 1e-12])
  assert.notEqual(world.hash(), before)
})

gate('hash is a uint32 and matches for identical runs', () => {
  const world = new World()
  world.spawn([1, 2, 3], [0.1, 0.2, 0.3])
  const digest = world.hash()
  assert.ok(Number.isInteger(digest) && digest >= 0 && digest <= 0xffffffff)
  assert.equal(world.hash(), digest)
})

gate('worlds own separate memory, so one world does not change another', () => {
  const a = new World()
  const b = new World()
  a.spawn([0, 4, 0])
  b.spawn([0, 9, 0])
  for (let i = 0; i < 20; i++) a.step()
  assert.equal(b.position(0)[1], 9)
  assert.equal(b.tick, 0)
})

gate('more solver iterations separate a stack of overlapping bodies further', () => {
  const stack = (iterations) => {
    const world = new World({ gravity: 0, drag: 0, solverIterations: iterations, radius: 0.35 })
    for (let i = 0; i < 4; i++) world.spawn([0, 5 + i * 0.5, 0])
    world.step()
    let gap = Infinity
    for (let i = 0; i < 3; i++) gap = Math.min(gap, world.position(i + 1)[1] - world.position(i)[1])
    return gap
  }
  assert.ok(stack(8) > stack(1))
})

gate('solverIterations and drag and restitution are validated', () => {
  assert.throws(() => new World({ solverIterations: 0 }), RangeError)
  assert.throws(() => new World({ solverIterations: 33 }), RangeError)
  assert.throws(() => new World({ solverIterations: 1.5 }), RangeError)
  assert.throws(() => new World({ drag: -1 }), RangeError)
})

finish()
