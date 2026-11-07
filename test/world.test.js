import { test } from 'node:test'
import assert from 'node:assert/strict'
import { World } from '../src/world/World.js'

test('a spawned body falls under gravity and comes to rest on the ground at its radius', () => {
  const world = new World({ radius: 0.35 })
  const id = world.spawn([0, 10, 0])
  for (let i = 0; i < 64 * 4; i++) world.step()
  const [, y] = world.position(id)
  assert.ok(Math.abs(y - 0.35) < 1e-9, 'resting height ' + y)
  assert.ok(Math.abs(world.velocity(id)[1]) < 1e-9)
})

test('a body lands on a box top rather than falling through it', () => {
  const world = new World({ radius: 0.35, boxes: [[-1, 0, -1, 1, 2, 1]] })
  const id = world.spawn([0, 6, 0])
  for (let i = 0; i < 64 * 4; i++) world.step()
  const [, y] = world.position(id)
  assert.ok(Math.abs(y - 2.35) < 1e-9, 'resting height ' + y)
})

test('advance steps by whole fixed ticks and carries the remainder', () => {
  const world = new World({ tickRate: 64 })
  world.spawn([0, 50, 0])
  assert.equal(world.advance(3.5 / 64), 3)
  assert.equal(world.tick, 3)
  assert.equal(world.advance(0.5 / 64), 1)
  assert.equal(world.tick, 4)
})

test('advance caps the catch-up after a long stall instead of spiralling', () => {
  const world = new World({ tickRate: 64 })
  world.spawn([0, 50, 0])
  assert.equal(world.advance(10), 8)
})

test('two worlds driven by the same schedule reach the same state and hash', () => {
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

test('a different schedule gives a different hash', () => {
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

test('snapshot copies positions so later steps do not change it', () => {
  const world = new World()
  world.spawn([0, 4, 0])
  const before = world.snapshot()
  world.step()
  assert.equal(before.tick, 0)
  assert.equal(before.positions.length, 3)
  assert.notEqual(world.snapshot().positions[1], before.positions[1])
})

test('spawn rejects a full world and bad input', () => {
  const world = new World({ capacity: 1 })
  world.spawn([0, 1, 0])
  assert.throws(() => world.spawn([0, 1, 0]), RangeError)
  assert.throws(() => new World({ restitution: 2 }), RangeError)
  assert.throws(() => new World({ boxes: [[1, 0, 0, -1, 1, 1]] }), RangeError)
  assert.throws(() => new World().position(0), RangeError)
})
