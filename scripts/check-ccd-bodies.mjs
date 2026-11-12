import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { createBodySweep, sweepSphereOverSphere } from '../src/physics-pure/ccd.js'
import { createSettler } from '../src/physics-pure/settler.js'

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

const RADIUS = 0.35
const TICK_RATE = 64
const SPEED = 60
const FAST = 200
const HEIGHT = 50

const runPair = ({ a, b, bodySweep, steps = 1 }) => {
  const world = new World({ capacity: 4, tickRate: TICK_RATE, gravity: 0, drag: 0, radius: RADIUS, restitution: 0, solverIterations: 4 })
  const ia = world.spawn(a.position, a.velocity)
  const ib = world.spawn(b.position, b.velocity)
  const settler = createSettler(world, { radius: RADIUS, bodySweep })
  for (let i = 0; i < steps; i++) settler.step()
  return { pa: world.position(ia), pb: world.position(ib), va: world.velocity(ia), vb: world.velocity(ib), stops: settler.bodyStops, hash: world.hash() }
}

const HEAD_ON = {
  a: { position: [-0.6, HEIGHT, 0], velocity: [SPEED, 0, 0] },
  b: { position: [0.6, HEIGHT, 0], velocity: [-SPEED, 0, 0] },
}

gate('two bodies closing head on cover more than their combined radii in one step, so they can cross in one step', () => {
  const closing = (2 * SPEED) / TICK_RATE
  assert(closing > HEAD_ON.b.position[0] - HEAD_ON.a.position[0], 'closing distance ' + closing + ' m per step does not carry one body past the other')
})

gate('negative control: without the body sweep the two bodies pass through each other in one step', () => {
  const { pa, pb, stops } = runPair({ ...HEAD_ON, bodySweep: false })
  assert(pa[0] > pb[0], 'the bodies did not cross; a is at ' + pa[0] + ' and b is at ' + pb[0])
  same(stops, 0, 'body stops')
})

gate('with the body sweep the two bodies stop touching at the meeting point and lose their closing velocity', () => {
  const { pa, pb, va, vb, stops } = runPair({ ...HEAD_ON, bodySweep: true })
  near(pb[0] - pa[0], 2 * RADIUS, 'distance between centres')
  near(pa[0] + pb[0], 0, 'meeting point is the midpoint')
  near(va[0], 0, 'velocity of the first body along the normal')
  near(vb[0], 0, 'velocity of the second body along the normal')
  same(stops, 1, 'body stops')
})

gate('a fast body is stopped by a body at rest and the pair leaves with the shared velocity', () => {
  const { pa, pb, va, vb } = runPair({ a: { position: [-1, HEIGHT, 0], velocity: [FAST, 0, 0] }, b: { position: [0.5, HEIGHT, 0], velocity: [0, 0, 0] }, bodySweep: true })
  assert(-1 + FAST / TICK_RATE > 0.5 + 2 * RADIUS, 'the fast body does not clear the resting body in one step')
  near(pb[0], 0.5, 'the resting body stays where it was at the hit')
  near(pb[0] - pa[0], 2 * RADIUS, 'distance between centres')
  near(va[0], FAST / 2, 'first body keeps half the closing speed')
  near(vb[0], FAST / 2, 'second body takes half the closing speed')
})

gate('two fast bodies whose paths are further apart than their combined radii are not stopped', () => {
  const { pa, pb, va, stops } = runPair({ a: { position: [-0.6, HEIGHT, 0], velocity: [SPEED, 0, 0] }, b: { position: [0.6, HEIGHT, 2 * RADIUS + 0.01], velocity: [-SPEED, 0, 0] }, bodySweep: true })
  assert(pa[0] > pb[0], 'the bodies did not pass each other')
  near(va[0], SPEED, 'velocity of the first body')
  same(stops, 0, 'body stops')
})

gate('a glancing hit removes only the velocity along the contact normal', () => {
  const offset = RADIUS
  const { pa, pb, va, vb } = runPair({ a: { position: [-0.8, HEIGHT, 0], velocity: [SPEED, 0, 0] }, b: { position: [0.8, HEIGHT, offset], velocity: [-SPEED, 0, 0] }, bodySweep: true })
  near(Math.hypot(pb[0] - pa[0], pb[1] - pa[1], pb[2] - pa[2]), 2 * RADIUS, 'distance between centres')
  const nx = (pb[0] - pa[0]) / (2 * RADIUS)
  const nz = (pb[2] - pa[2]) / (2 * RADIUS)
  near((vb[0] - va[0]) * nx + (vb[2] - va[2]) * nz, 0, 'closing velocity along the normal')
  near(va[0] + vb[0], 0, 'momentum along x is kept')
  near(va[2] + vb[2], 0, 'momentum along z is kept')
  assert(Math.abs(va[2]) > 1, 'the glancing hit left no tangential deflection')
})

gate('the sweep reports the time and normal of first touch, and nothing for a pair that starts in overlap, separates or never meets', () => {
  const hit = sweepSphereOverSphere([0, 0, 0], [4, 0, 0], [3, 0, 0], [3, 0, 0], 1)
  near(hit.t, 0.5, 'time of first touch')
  near(hit.nx, 1, 'normal x, from the first body to the second')
  same(sweepSphereOverSphere([0, 0, 0], [4, 0, 0], [0.5, 0, 0], [0.5, 0, 0], 1), null, 'pair that starts in overlap')
  same(sweepSphereOverSphere([0, 0, 0], [-4, 0, 0], [3, 0, 0], [3, 0, 0], 1), null, 'pair that separates')
  same(sweepSphereOverSphere([0, 0, 0], [1, 0, 0], [3, 0, 0], [3, 0, 0], 1), null, 'pair that stops short')
  same(sweepSphereOverSphere([0, 0, 0], [4, 0, 0], [2, 3, 0], [2, 3, 0], 1), null, 'pair that never meets')
})

gate('with three bodies in a line the earliest pair is resolved first and the third body is stopped against the result', () => {
  const sweep = createBodySweep(3, 0.5)
  const from = Float64Array.from([0, 0, 0, 3, 0, 0, 20, 0, 0])
  const to = Float64Array.from([10, 0, 0, 3, 0, 0, 2, 0, 0])
  const vel = Float64Array.from([10, 0, 0, 0, 0, 0, -18, 0, 0])
  const applied = sweep.resolve(from, to, vel)
  same(applied, 1, 'pairs resolved in the step')
  near(to[0], 2, 'first body stops one diameter before the second')
  near(to[3], 3, 'second body position')
  same(sweep.stopped(0) && sweep.stopped(1), true, 'first pair is marked stopped')
  same(sweep.stopped(2), false, 'third body is left for the contact solver')
})

gate('the same fast scene gives the same world hash on two runs', () => {
  const first = runPair({ ...HEAD_ON, bodySweep: true, steps: 30 })
  const second = runPair({ ...HEAD_ON, bodySweep: true, steps: 30 })
  same(first.hash, second.hash, 'world hash')
  assert(first.pb[0] - first.pa[0] >= 2 * RADIUS - 1e-6, 'the bodies overlap after 30 steps')
})

gate('the body sweep refuses a negative count and a radius of zero', () => {
  mustReject(() => createBodySweep(-1, 0.5))
  mustReject(() => createBodySweep(2, 0))
})

finish()
