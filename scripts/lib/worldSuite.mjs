import assert from 'node:assert/strict'
import { gate } from './gate.mjs'

const refuses = async (action, ErrorType) => {
  let caught = null
  try {
    await action()
  } catch (error) {
    caught = error
  }
  assert.ok(caught instanceof ErrorType, 'expected ' + ErrorType.name + ', got ' + (caught && caught.name))
}

export const worldGates = (make, tolerance = 1e-9) => {
  gate('a spawned body falls under gravity and comes to rest on the ground at its radius', async () => {
    const world = await make({ radius: 0.35 })
    const id = world.spawn([0, 10, 0])
    for (let i = 0; i < 64 * 4; i++) world.step()
    const [, y] = world.position(id)
    assert.ok(Math.abs(y - 0.35) < tolerance, 'resting height ' + y)
    assert.ok(Math.abs(world.velocity(id)[1]) < tolerance)
  })

  gate('a body lands on a box top rather than falling through it', async () => {
    const world = await make({ radius: 0.35, boxes: [[-1, 0, -1, 1, 2, 1]] })
    const id = world.spawn([0, 6, 0])
    for (let i = 0; i < 64 * 4; i++) world.step()
    const [, y] = world.position(id)
    assert.ok(Math.abs(y - 2.35) < tolerance, 'resting height ' + y)
  })

  gate('advance steps by whole fixed ticks and carries the remainder', async () => {
    const world = await make({ tickRate: 64 })
    world.spawn([0, 50, 0])
    assert.equal(world.advance(3.5 / 64), 3)
    assert.equal(world.tick, 3)
    assert.equal(world.advance(0.5 / 64), 1)
    assert.equal(world.tick, 4)
  })

  gate('advance caps the catch-up after a long stall instead of spiralling', async () => {
    const world = await make({ tickRate: 64 })
    world.spawn([0, 50, 0])
    assert.equal(world.advance(10), 8)
  })

  gate('two worlds driven by the same schedule reach the same state and hash', async () => {
    const run = async () => {
      const world = await make({ boxes: [[-2, 0, -2, 2, 1, 2]] })
      world.spawn([0, 4, 0], [0.5, 0, 0])
      world.spawn([0.3, 6, 0.1], [-0.5, 0, 0])
      world.spawn([0.1, 8, -0.2])
      for (let i = 0; i < 300; i++) world.step()
      return world
    }
    const a = await run()
    const b = await run()
    assert.equal(a.hash(), b.hash())
    assert.deepEqual(a.snapshot().positions, b.snapshot().positions)
  })

  gate('a different schedule gives a different hash', async () => {
    const a = await make()
    const b = await make()
    a.spawn([0, 4, 0])
    b.spawn([0, 4.001, 0])
    for (let i = 0; i < 10; i++) {
      a.step()
      b.step()
    }
    assert.notEqual(a.hash(), b.hash())
  })

  gate('snapshot copies positions so later steps do not change it', async () => {
    const world = await make()
    world.spawn([0, 4, 0])
    const before = world.snapshot()
    world.step()
    assert.equal(before.tick, 0)
    assert.equal(before.positions.length, 3)
    assert.notEqual(world.snapshot().positions[1], before.positions[1])
  })

  gate('spawn rejects a full world and bad input', async () => {
    const world = await make({ capacity: 1 })
    world.spawn([0, 1, 0])
    assert.throws(() => world.spawn([0, 1, 0]), RangeError)
    await refuses(() => make({ restitution: 2 }), RangeError)
    await refuses(() => make({ boxes: [[1, 0, 0, -1, 1, 1]] }), RangeError)
    const empty = await make()
    assert.throws(() => empty.position(0), RangeError)
  })

  gate('hash changes for a velocity change far below the old quantum', async () => {
    const world = await make()
    world.spawn([0, 4, 0])
    const before = world.hash()
    world.setVelocity(0, [0, 0, 1e-12])
    assert.notEqual(world.hash(), before)
  })

  gate('hash is a uint32 and matches for identical runs', async () => {
    const world = await make()
    world.spawn([1, 2, 3], [0.1, 0.2, 0.3])
    const digest = world.hash()
    assert.ok(Number.isInteger(digest) && digest >= 0 && digest <= 0xffffffff)
    assert.equal(world.hash(), digest)
  })

  gate('worlds own separate memory, so one world does not change another', async () => {
    const a = await make()
    const b = await make()
    a.spawn([0, 4, 0])
    b.spawn([0, 9, 0])
    for (let i = 0; i < 20; i++) a.step()
    assert.equal(b.position(0)[1], 9)
    assert.equal(b.tick, 0)
  })

  gate('more solver iterations separate a stack of overlapping bodies further', async () => {
    const stack = async (iterations) => {
      const world = await make({ gravity: 0, drag: 0, solverIterations: iterations, radius: 0.35 })
      for (let i = 0; i < 4; i++) world.spawn([0, 5 + i * 0.5, 0])
      world.step()
      let gap = Infinity
      for (let i = 0; i < 3; i++) gap = Math.min(gap, world.position(i + 1)[1] - world.position(i)[1])
      return gap
    }
    assert.ok((await stack(8)) > (await stack(1)))
  })

  gate('solverIterations and drag and restitution are validated', async () => {
    await refuses(() => make({ solverIterations: 0 }), RangeError)
    await refuses(() => make({ solverIterations: 33 }), RangeError)
    await refuses(() => make({ solverIterations: 1.5 }), RangeError)
    await refuses(() => make({ drag: -1 }), RangeError)
  })
}
