import { gate, finish } from './lib/gate.mjs'
import { World } from '../src/world/World.js'
import { sweepSphereOverBox } from '../src/physics-pure/ccd.js'
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
const BOX = { min: [0, -10, -10], max: [0.05, 10, 10] }
const PAST_BOX = BOX.max[0] + RADIUS

const runOne = ({ x, y = RADIUS, boxes }) => {
  const world = new World({ capacity: 4, tickRate: TICK_RATE, gravity: 0, drag: 0, radius: RADIUS, restitution: 0, solverIterations: 4 })
  const id = world.spawn([x, y, 0], [SPEED, 0, 0])
  const settler = createSettler(world, { radius: RADIUS, boxes })
  settler.step()
  return { position: world.position(id), velocity: world.velocity(id) }
}

gate('the witness body moves more than its radius in one step, so a thin box can be crossed in one step', () => {
  const perStep = SPEED / TICK_RATE
  assert(perStep > RADIUS, 'speed ' + perStep + ' m per step is not above the radius ' + RADIUS + ' m')
  assert(perStep > (BOX.max[0] - BOX.min[0]) + 2 * RADIUS, 'one step cannot cross the expanded box')
})

gate('a body moving faster than its radius per step is stopped at the near face of a thin box', () => {
  const { position, velocity } = runOne({ x: -0.5, boxes: [BOX] })
  near(position[0], -RADIUS, 'stop position x')
  near(position[1], RADIUS, 'stop position y, the body rests on the ground at its radius')
  near(velocity[0], 0, 'normal velocity after the stop')
})

gate('negative control: without the sweep the same body passes through the thin box in one step', () => {
  const { position } = runOne({ x: -0.5, boxes: [] })
  assert(position[0] > PAST_BOX, 'the no-sweep run did not pass the box; x is ' + position[0])
})

gate('a body that passes outside the box footprint keeps its velocity and is not stopped', () => {
  const { position, velocity } = runOne({ x: -0.5, y: 20, boxes: [BOX] })
  near(velocity[0], SPEED, 'velocity x after the pass')
  assert(position[0] > PAST_BOX, 'a body outside the footprint was stopped; x is ' + position[0])
})

gate('a body that starts inside the expanded box is pushed back to its nearest face and loses its velocity into the box', () => {
  const { position, velocity } = runOne({ x: 0, boxes: [BOX] })
  near(position[0], -RADIUS, 'pushed-out x, the nearest face')
  near(velocity[0], 0, 'velocity into the box after the push')
})

gate('a body resting on the near face and pushed into it stays on that face', () => {
  const { position, velocity } = runOne({ x: -RADIUS, boxes: [BOX] })
  near(position[0], -RADIUS, 'x at the face')
  near(velocity[0], 0, 'velocity into the box')
})

gate('the sweep reports the entry time and face of a crossing, and nothing for a segment that stops short or misses', () => {
  const hit = sweepSphereOverBox([-0.5, 0, 0], [0.5, 0, 0], RADIUS, BOX)
  near(hit.t, 0.15, 'entry time')
  same(hit.axis, 0, 'entry axis')
  same(hit.sign, -1, 'entry face sign')
  assert(sweepSphereOverBox([-0.5, 0, 0], [-0.4, 0, 0], RADIUS, BOX) === null, 'a segment that stops short was reported')
  assert(sweepSphereOverBox([-0.5, 20, 0], [0.5, 21, 0], RADIUS, BOX) === null, 'a segment that misses the footprint was reported')
})

gate('the settler refuses a box whose min corner is above its max corner', () => {
  const world = new World({ capacity: 4, tickRate: TICK_RATE, gravity: 0, drag: 0, radius: RADIUS, restitution: 0, solverIterations: 4 })
  mustReject(() => createSettler(world, { radius: RADIUS, boxes: [{ min: [1, 0, 0], max: [0, 0, 0] }] }))
})

finish()
