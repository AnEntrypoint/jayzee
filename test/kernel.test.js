import { test } from 'node:test'
import assert from 'node:assert/strict'
import { loadKernel } from '../src/kernel/load.js'
import { random, insideBox } from './oracle.js'

const kernel = loadKernel()

test('integrate applies gravity then position with semi-implicit Euler', () => {
  const pos = Float64Array.from([0, 10, 0])
  const vel = Float64Array.from([0, 0, 0])
  kernel.integrate(pos, vel, 1, -10, 0, 0.1)
  assert.ok(Math.abs(vel[1] + 1) < 1e-12)
  assert.ok(Math.abs(pos[1] - 9.9) < 1e-12)
})

test('integrate decays horizontal velocity by drag', () => {
  const pos = Float64Array.from([0, 0, 0])
  const vel = Float64Array.from([2, 0, 0])
  kernel.integrate(pos, vel, 1, 0, 1, 0.25)
  assert.ok(Math.abs(vel[0] - 1.5) < 1e-12)
})

test('integrate with full drag stops horizontal motion', () => {
  const pos = Float64Array.from([0, 0, 0])
  const vel = Float64Array.from([3, 0, 0])
  kernel.integrate(pos, vel, 1, 0, 4, 0.5)
  assert.equal(vel[0], 0)
  assert.equal(pos[0], 0)
})

test('integrate leaves bodies past count untouched', () => {
  const pos = Float64Array.from([0, 0, 0, 5, 5, 5])
  const vel = Float64Array.from([0, 0, 0, 1, 1, 1])
  kernel.integrate(pos, vel, 1, -10, 0, 0.1)
  assert.deepEqual(Array.from(pos.subarray(3)), [5, 5, 5])
  assert.deepEqual(Array.from(vel.subarray(3)), [1, 1, 1])
})

test('resolveGround lifts a sinking body to its radius and reflects it', () => {
  const pos = Float64Array.from([0, 0.1, 0])
  const vel = Float64Array.from([0, -4, 0])
  kernel.resolveGround(pos, vel, 1, 0.35, 0.2)
  assert.ok(Math.abs(pos[1] - 0.35) < 1e-12)
  assert.ok(Math.abs(vel[1] - 0.8) < 1e-12)
})

test('resolveGround ignores bodies above the radius', () => {
  const pos = Float64Array.from([0, 2, 0])
  const vel = Float64Array.from([0, -4, 0])
  kernel.resolveGround(pos, vel, 1, 0.35, 0.2)
  assert.equal(pos[1], 2)
  assert.equal(vel[1], -4)
})

test('resolveBoxes lands a body on the top face of a box', () => {
  const pos = Float64Array.from([0, 2.2, 0])
  const vel = Float64Array.from([0, -3, 0])
  const boxes = Float64Array.from([-1, 0, -1, 1, 2, 1])
  kernel.resolveBoxes(pos, vel, 1, 0.35, boxes, 1, 0)
  assert.ok(Math.abs(pos[1] - 2.35) < 1e-12)
  assert.ok(Math.abs(vel[1]) < 1e-12)
})

test('resolveBoxes pushes a body whose centre is inside a box to the nearest face', () => {
  const pos = Float64Array.from([0, 1.9, 0])
  const vel = Float64Array.from([0, 0, 0])
  const boxes = Float64Array.from([-5, 0, -5, 5, 2, 5])
  kernel.resolveBoxes(pos, vel, 1, 0.35, boxes, 1, 0)
  assert.ok(Math.abs(pos[1] - 2.35) < 1e-12)
  assert.equal(pos[0], 0)
  assert.equal(pos[2], 0)
})

test('resolveBoxes leaves every body outside every box it was given', () => {
  const rand = random(11)
  const count = 200
  const radius = 0.4
  const boxes = Float64Array.from([-3, -1, -3, -1, 2, 3, 1, 0, -2, 4, 1.5, 2])
  const pos = Float64Array.from({ length: count * 3 }, () => rand() * 12 - 6)
  const vel = Float64Array.from({ length: count * 3 }, () => rand() * 4 - 2)
  kernel.resolveBoxes(pos, vel, count, radius, boxes, 2, 0.3)
  for (let i = 0; i < count; i++) {
    for (let b = 0; b < 2; b++) {
      const p = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]]
      assert.equal(insideBox(p, boxes.subarray(b * 6, b * 6 + 6), radius), false, 'body ' + i + ' inside box ' + b)
    }
  }
})

test('resolvePairs separates two overlapping bodies to touching distance', () => {
  const pos = Float64Array.from([0, 5, 0, 0.5, 5, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  kernel.resolvePairs(pos, vel, 2, 0.35, 0.2, 0.7, 16)
  const gap = Math.hypot(pos[3] - pos[0], pos[4] - pos[1], pos[5] - pos[2])
  assert.ok(Math.abs(gap - 0.7) < 1e-12)
  assert.ok(Math.abs(pos[0] + 0.1) < 1e-12)
  assert.ok(Math.abs(pos[3] - 0.6) < 1e-12)
})

test('resolvePairs reflects approach velocity by restitution and conserves momentum', () => {
  const pos = Float64Array.from([0, 5, 0, 0.5, 5, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  kernel.resolvePairs(pos, vel, 2, 0.35, 0.2, 0.7, 16)
  assert.ok(Math.abs(vel[0] + 0.2) < 1e-12)
  assert.ok(Math.abs(vel[3] - 0.2) < 1e-12)
  assert.ok(Math.abs(vel[0] + vel[3]) < 1e-12)
})

test('resolvePairs finds a pair straddling a grid cell boundary', () => {
  const pos = Float64Array.from([-0.01, 5, 0, 0.01, 5, 0])
  const vel = Float64Array.from([0, 0, 0, 0, 0, 0])
  kernel.resolvePairs(pos, vel, 2, 0.35, 0, 0.7, 16)
  const gap = pos[3] - pos[0]
  assert.ok(Math.abs(gap - 0.7) < 1e-12)
})

test('resolvePairs finds a pair far outside the grid by clamping to edge cells', () => {
  const pos = Float64Array.from([-1000, 5, 0, -1000.3, 5, 0])
  const vel = Float64Array.from([0, 0, 0, 0, 0, 0])
  kernel.resolvePairs(pos, vel, 2, 0.35, 0, 0.7, 16)
  const gap = Math.abs(pos[3] - pos[0])
  assert.ok(Math.abs(gap - 0.7) < 1e-12)
})

test('resolvePairs leaves bodies that do not touch alone', () => {
  const pos = Float64Array.from([0, 0, 0, 3, 0, 0])
  const vel = Float64Array.from([1, 0, 0, -1, 0, 0])
  kernel.resolvePairs(pos, vel, 2, 0.35, 0.2, 0.7, 16)
  assert.deepEqual(Array.from(pos), [0, 0, 0, 3, 0, 0])
  assert.deepEqual(Array.from(vel), [1, 0, 0, -1, 0, 0])
})

test('hashState is stable for equal state and sensitive to a single bit of motion', () => {
  const pos = Float64Array.from([1.25, -2.5, 3])
  const vel = Float64Array.from([0.5, 0, -0.75])
  const first = kernel.hashState(pos, vel, 1)
  assert.equal(kernel.hashState(Float64Array.from(pos), Float64Array.from(vel), 1), first)
  vel[2] = -0.751
  assert.notEqual(kernel.hashState(pos, vel, 1), first)
})
