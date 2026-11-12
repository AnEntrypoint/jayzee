import { gate, finish } from './lib/gate.mjs'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { instantiateKernel } from '../src/kernel/load.js'
import { random, insideBox } from './lib/oracle.mjs'

const KERNEL_BYTES_LIMIT = 32768

const load = ({ pos, vel, boxes = [], buckets = 64 }) => {
  const kernel = instantiateKernel({ capacity: pos.length / 3, boxCount: Math.max(1, boxes.length / 6), buckets, occupancyWords: Math.max(1, buckets / 4) })
  kernel.positions.set(pos)
  kernel.velocities.set(vel)
  kernel.boxes.set(boxes)
  return { run: kernel.run, pos: kernel.positions, vel: kernel.velocities }
}

const integrate = (pos, vel, count, gravity, drag, dt) => {
  const k = load({ pos, vel })
  k.run.integrate(count, gravity, drag, dt)
  pos.set(k.pos)
  vel.set(k.vel)
}

const resolveGround = (pos, vel, count, radius, restitution) => {
  const k = load({ pos, vel })
  k.run.resolveGround(count, radius, restitution)
  pos.set(k.pos)
  vel.set(k.vel)
}

const resolveBoxes = (pos, vel, count, radius, boxes, boxCount, restitution) => {
  const k = load({ pos, vel, boxes })
  k.run.resolveBoxes(count, radius, boxCount, restitution)
  pos.set(k.pos)
  vel.set(k.vel)
}

const resolvePairs = (pos, vel, count, radius, restitution, buckets = 64) => {
  const k = load({ pos, vel, buckets })
  k.run.resolvePairs(count, radius, restitution)
  pos.set(k.pos)
  vel.set(k.vel)
}

gate('integrate applies gravity then position with semi-implicit Euler', () => {
  const pos = Float64Array.from([0, 10, 0])
  const vel = Float64Array.from([0, 0, 0])
  integrate(pos, vel, 1, -10, 0, 0.1)
  assert.ok(Math.abs(vel[1] + 1) < 1e-12)
  assert.ok(Math.abs(pos[1] - 9.9) < 1e-12)
})

gate('integrate decays horizontal velocity by drag', () => {
  const pos = Float64Array.from([0, 0, 0])
  const vel = Float64Array.from([2, 0, 0])
  integrate(pos, vel, 1, 0, 1, 0.25)
  assert.ok(Math.abs(vel[0] - 1.5) < 1e-12)
})

gate('integrate with full drag stops horizontal motion', () => {
  const pos = Float64Array.from([0, 0, 0])
  const vel = Float64Array.from([3, 0, 0])
  integrate(pos, vel, 1, 0, 4, 0.5)
  assert.equal(vel[0], 0)
  assert.equal(pos[0], 0)
})

gate('integrate leaves bodies past count untouched', () => {
  const pos = Float64Array.from([0, 0, 0, 5, 5, 5])
  const vel = Float64Array.from([0, 0, 0, 1, 1, 1])
  integrate(pos, vel, 1, -10, 0, 0.1)
  assert.deepEqual(Array.from(pos.subarray(3)), [5, 5, 5])
  assert.deepEqual(Array.from(vel.subarray(3)), [1, 1, 1])
})

gate('resolveGround lifts a sinking body to its radius and reflects it', () => {
  const pos = Float64Array.from([0, 0.1, 0])
  const vel = Float64Array.from([0, -4, 0])
  resolveGround(pos, vel, 1, 0.35, 0.2)
  assert.ok(Math.abs(pos[1] - 0.35) < 1e-12)
  assert.ok(Math.abs(vel[1] - 0.8) < 1e-12)
})

gate('resolveGround ignores bodies above the radius', () => {
  const pos = Float64Array.from([0, 2, 0])
  const vel = Float64Array.from([0, -4, 0])
  resolveGround(pos, vel, 1, 0.35, 0.2)
  assert.equal(pos[1], 2)
  assert.equal(vel[1], -4)
})

gate('resolveGround cancels a slow contact instead of bouncing it', () => {
  const pos = Float64Array.from([0, 0.1, 0])
  const vel = Float64Array.from([0, -0.5, 0])
  resolveGround(pos, vel, 1, 0.35, 0.9)
  assert.equal(vel[1], 0)
})

gate('resolveBoxes lands a body on the top face of a box', () => {
  const pos = Float64Array.from([0, 2.2, 0])
  const vel = Float64Array.from([0, -3, 0])
  const boxes = Float64Array.from([-1, 0, -1, 1, 2, 1])
  resolveBoxes(pos, vel, 1, 0.35, boxes, 1, 0)
  assert.ok(Math.abs(pos[1] - 2.35) < 1e-12)
  assert.ok(Math.abs(vel[1]) < 1e-12)
})

gate('resolveBoxes pushes a body whose centre is inside a box to the nearest face', () => {
  const pos = Float64Array.from([0, 1.9, 0])
  const vel = Float64Array.from([0, 0, 0])
  const boxes = Float64Array.from([-5, 0, -5, 5, 2, 5])
  resolveBoxes(pos, vel, 1, 0.35, boxes, 1, 0)
  assert.ok(Math.abs(pos[1] - 2.35) < 1e-12)
  assert.equal(pos[0], 0)
  assert.equal(pos[2], 0)
})

gate('resolveBoxes leaves every body outside every box it was given', () => {
  const rand = random(11)
  const count = 200
  const radius = 0.4
  const boxes = Float64Array.from([-3, -1, -3, -1, 2, 3, 1, 0, -2, 4, 1.5, 2])
  const pos = Float64Array.from({ length: count * 3 }, () => rand() * 12 - 6)
  const vel = Float64Array.from({ length: count * 3 }, () => rand() * 4 - 2)
  resolveBoxes(pos, vel, count, radius, boxes, 2, 0.3)
  for (let i = 0; i < count; i++) {
    for (let b = 0; b < 2; b++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
      assert.equal(insideBox(p, boxes.subarray(b * 6, b * 6 + 6), radius), false, 'body ' + i + ' inside box ' + b)
    }
  }
})

gate('resolvePairs separates two overlapping bodies to touching distance', () => {
  const pos = Float64Array.from([0, 5, 0, 0.5, 5, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  resolvePairs(pos, vel, 2, 0.35, 0.2)
  const gap = Math.hypot(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2])
  assert.ok(Math.abs(gap - 0.7) < 1e-12)
  assert.ok(Math.abs(pos[0] + 0.1) < 1e-12)
  assert.ok(Math.abs(pos[3] - 0.6) < 1e-12)
})

gate('resolvePairs reflects approach velocity by restitution and conserves momentum', () => {
  const pos = Float64Array.from([0, 5, 0, 0.5, 5, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  resolvePairs(pos, vel, 2, 0.35, 0.2)
  assert.ok(Math.abs(vel[0] + 0.2) < 1e-12)
  assert.ok(Math.abs(vel[3] - 0.2) < 1e-12)
  assert.ok(Math.abs(vel[0] + vel[3]) < 1e-12)
})

gate('resolvePairs finds a pair straddling the origin', () => {
  const pos = Float64Array.from([-0.01, 5, 0, 0.01, 5, 0])
  const vel = Float64Array.from([0, 0, 0, 0, 0, 0])
  resolvePairs(pos, vel, 2, 0.35, 0)
  assert.ok(Math.abs(pos[3] - pos[0] - 0.7) < 1e-12)
})

gate('resolvePairs finds a pair far from the origin, with no grid bounds', () => {
  const pos = Float64Array.from([-1000, 5, 0, -1000.3, 5, 0])
  const vel = Float64Array.from([0, 0, 0, 0, 0, 0])
  resolvePairs(pos, vel, 2, 0.35, 0)
  assert.ok(Math.abs(Math.abs(pos[3] - pos[0]) - 0.7) < 1e-12)
})

gate('resolvePairs leaves bodies that do not touch alone', () => {
  const pos = Float64Array.from([0, 0, 0, 3, 0, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  resolvePairs(pos, vel, 2, 0.35, 0.2)
  assert.deepEqual(Array.from(pos), [0, 0, 0, 3, 0, 0])
  assert.deepEqual(Array.from(vel), [1, 0, 0, -1, 0, 0])
})

gate('step with more solver iterations separates a stack further than one iteration', () => {
  const stack = () => Float64Array.from([0, 5, 0, 0, 5.5, 0, 0, 6, 0, 0, 6.5, 0, 0, 7, 0])
  const minGap = (pos) => {
    let gap = Infinity
    for (let i = 0; i < 4; i++) gap = Math.min(gap, pos[(i + 1) * 3 + 1] - pos[i * 3 + 1])
    return gap
  }
  const run = (iterations) => {
    const pos = stack()
    const vel = new Float64Array(15)
    const k = load({ pos, vel })
    k.run.step(5, 0, 0, 0, 1 / 64, 0.35, 0, iterations)
    return minGap(k.pos)
  }
  const one = run(1)
  const eight = run(8)
  const thirtyTwo = run(32)
  assert.ok(eight > one, 'iterations did not improve the stack: ' + one + ' vs ' + eight)
  assert.ok(thirtyTwo > 0.7 - 1e-4, 'stack still overlaps after 32 iterations: ' + thirtyTwo)
})

gate('bucket collisions do not change which pairs are resolved', () => {
  const rand = random(3)
  const count = 40
  const base = Float64Array.from({ length: count * 3 }, () => rand() * 3 - 1.5)
  const minDistance = (pos) => {
    let best = Infinity
    for (let i = 0; i < count; i++) {
      for (let j = i + 1; j < count; j++) {
        best = Math.min(best, Math.hypot(pos[j * 3] - pos[i * 3], pos[j * 3 + 1] - pos[i * 3 + 1], pos[j * 3 + 2] - pos[i * 3 + 2]))
      }
    }
    return best
  }
  const settle = (buckets) => {
    const pos = Float64Array.from(base)
    const vel = new Float64Array(count * 3)
    for (let pass = 0; pass < 64; pass++) resolvePairs(pos, vel, count, 0.35, 0, buckets)
    return minDistance(pos)
  }
  assert.ok(settle(1) > 0.7 - 1e-3)
  assert.ok(settle(64) > 0.7 - 1e-3)
})

gate('a pass on one bucket resolves the pairs a pass on 4096 buckets resolves, bit for bit', () => {
  const rand = random(5)
  const count = 300
  const base = Float64Array.from({ length: count * 3 }, () => rand() * 6 - 3)
  const settle = (buckets) => {
    const pos = Float64Array.from(base)
    const vel = Float64Array.from({ length: count * 3 }, (_, i) => Math.sin(i))
    for (let pass = 0; pass < 8; pass++) resolvePairs(pos, vel, count, 0.35, 0.2, buckets)
    return [pos, vel]
  }
  const [onePos, oneVel] = settle(1)
  const [manyPos, manyVel] = settle(4096)
  for (let i = 0; i < count * 3; i++) {
    assert.ok(Object.is(onePos[i], manyPos[i]), 'position word ' + i + ' differs')
    assert.ok(Object.is(oneVel[i], manyVel[i]), 'velocity word ' + i + ' differs')
  }
})

const pile = () => {
  const count = 48
  const pos = new Float64Array(count * 3)
  const vel = new Float64Array(count * 3)
  for (let i = 0; i < count; i++) {
    pos[i * 3] = (i % 4) * 0.9
    pos[i * 3 + 1] = 0.5 + Math.floor(i / 16) * 0.9
    pos[i * 3 + 2] = (Math.floor(i / 4) % 4) * 0.9
    vel[i * 3 + 1] = -0.3 - (i % 5) * 0.1
  }
  return { count, pos, vel }
}
const bitsOf = (values) => Buffer.from(values.buffer, values.byteOffset, values.byteLength).toString('hex')

gate('a pair pass that finds every body in the cell it had reuses its grid, and resolves what a fresh kernel resolves, bit for bit', () => {
  const { count, pos, vel } = pile()
  const kept = load({ pos, vel })
  kept.run.resolvePairs(count, 0.5, 0.2)
  const between = { pos: Float64Array.from(kept.pos), vel: Float64Array.from(kept.vel) }
  kept.run.resolvePairs(count, 0.5, 0.2)
  const fresh = load(between)
  fresh.run.resolvePairs(count, 0.5, 0.2)
  assert.equal(bitsOf(kept.pos), bitsOf(fresh.pos))
  assert.equal(bitsOf(kept.vel), bitsOf(fresh.vel))
})

gate('a body the host moves into another cell between two pair passes is found in its new cell', () => {
  const k = load({ pos: Float64Array.from([0, 5, 0, 20, 5, 0]), vel: new Float64Array(6) })
  k.run.resolvePairs(2, 0.5, 0)
  assert.deepEqual(Array.from(k.pos), [0, 5, 0, 20, 5, 0])
  k.pos[3] = 0.6
  k.run.resolvePairs(2, 0.5, 0)
  assert.ok(Math.abs(k.pos[3] - k.pos[0] - 1) < 1e-12, 'the moved body was not separated: ' + Array.from(k.pos))
})

gate('stepMany runs the ticks one step call each would run, bit for bit', () => {
  const { count, pos, vel } = pile()
  const args = [count, 1, -9.8, 0.1, 1 / 60, 0.5, 0.2, 4]
  const single = load({ pos, vel })
  for (let tick = 0; tick < 7; tick++) single.run.step(...args)
  const batched = load({ pos, vel })
  batched.run.stepMany(7, ...args)
  assert.equal(bitsOf(batched.pos), bitsOf(single.pos))
  assert.equal(bitsOf(batched.vel), bitsOf(single.vel))
})

gate('the views the kernel hands out are its own storage, so a step copies nothing', () => {
  const k = load({ pos: Float64Array.from([0, 10, 0]), vel: new Float64Array(3) })
  const buffer = k.pos.buffer
  k.run.integrate(1, -10, 0, 0.1)
  assert.ok(Math.abs(k.pos[1] - 9.9) < 1e-12)
  assert.equal(k.pos.buffer, buffer)
  assert.equal(k.pos.buffer.byteLength, buffer.byteLength)
})

gate('the loader refuses a bucket count or an occupancy size that is not a power of two', () => {
  const sizes = { capacity: 4, boxCount: 1, buckets: 64, occupancyWords: 16 }
  assert.throws(() => instantiateKernel({ ...sizes, buckets: 48 }), RangeError)
  assert.throws(() => instantiateKernel({ ...sizes, occupancyWords: 3 }), RangeError)
  assert.throws(() => instantiateKernel({ ...sizes, capacity: 0 }), RangeError)
  assert.equal(instantiateKernel(sizes).positions.length, 12)
})

gate('the kernel imports nothing from the host and stays under ' + KERNEL_BYTES_LIMIT + ' bytes, so no access took the dynamic path', () => {
  const bytes = readFileSync(new URL('../dist/kernel.wasm', import.meta.url))
  assert.deepEqual(WebAssembly.Module.imports(new WebAssembly.Module(bytes)), [])
  assert.ok(bytes.byteLength < KERNEL_BYTES_LIMIT, 'kernel.wasm is ' + bytes.byteLength + ' bytes')
})

finish()
