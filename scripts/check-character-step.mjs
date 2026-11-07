import { gate, finish } from './lib/gate.mjs'
import {
  GROUND_FOLLOW_STEP_M,
  WALL_HEIGHT_REACH_M,
  WALL_UNPROVEN_REACH_M,
  verticalVelocity,
  predictCharacterStep,
} from '../src/motion-pure/characterStep.js'

const near = (a, b, what, eps = 1e-9) => {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const isNot = (a, b, what) => {
  if (Object.is(a, b)) throw new Error(`${what}: must not equal ${b}`)
}

const stubMove = (state, input, movement, dt) => ({ jumped: !!(input && input.jumped) })
const st = (over = {}) => ({ onGround: false, velocity: [0, 0, 0], position: [0, 0, 0], ...over })
const env = (over = {}) => ({ applyMovement: stubMove, gravityY: -10, ...over })

gate('constants: ground follow step 0.35 m, wall reach 1.5 m, unproven wall reach 0.3 m', () => {
  is(GROUND_FOLLOW_STEP_M, 0.35, 'GROUND_FOLLOW_STEP_M')
  is(WALL_HEIGHT_REACH_M, 1.5, 'WALL_HEIGHT_REACH_M')
  is(WALL_UNPROVEN_REACH_M, 0.3, 'WALL_UNPROVEN_REACH_M')
})

gate('verticalVelocity: grounded upward velocity is kept', () => {
  is(verticalVelocity(3, true, -10, 0.1), 3, 'grounded vy 3')
})
gate('verticalVelocity: grounded downward velocity is clamped to zero', () => {
  is(verticalVelocity(-3, true, -10, 0.1), 0, 'grounded vy -3')
  isNot(verticalVelocity(-3, true, -10, 0.1), -3, 'grounded vy -3 must not pass through')
})
gate('verticalVelocity: airborne velocity integrates gravity over dt', () => {
  near(verticalVelocity(2, false, -10, 0.1), 1, 'airborne vy 2 under g -10')
  near(verticalVelocity(2, false, 0, 0.1), 2, 'airborne vy 2 under zero gravity')
  isNot(verticalVelocity(2, false, 0, 0.1), 1, 'zero gravity must not apply the -10 result')
})

gate('predict: a falling body lands on flat ground and zeroes vertical velocity', () => {
  const s = st({ position: [0, 0.05, 0], velocity: [0, -1, 0] })
  const r = predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  near(s.position[1], 0, 'landed y')
  is(s.velocity[1], 0, 'landed vy')
  is(s.onGround, true, 'landed onGround')
  is(s.groundY, 0, 'landed groundY')
  is(r.jumped, false, 'result is the applyMovement result')
})
gate('predict: a falling body above the floor does not land (negative control)', () => {
  const s = st({ position: [0, 0.5, 0], velocity: [0, -1, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  near(s.position[1], 0.3, 'airborne y')
  is(s.onGround, false, 'airborne onGround')
})
gate('predict: a rising body below the floor does not land (negative control)', () => {
  const s = st({ position: [0, -0.5, 0], velocity: [0, 5, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  is(s.onGround, false, 'rising onGround')
})

gate('predict: grounded body within 0.35 m of the floor snaps to it', () => {
  const s = st({ onGround: true, position: [0, 0.35, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  is(s.onGround, true, 'step-down onGround at 0.35')
  near(s.position[1], 0, 'step-down y')
})
gate('predict: grounded body just past 0.35 m drops off the floor (negative control)', () => {
  const s = st({ onGround: true, position: [0, 0.36, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  is(s.onGround, false, 'step-down onGround at 0.36')
  near(s.position[1], 0.36, 'step-down y past reach')
})

gate('predict: an input that jumped suppresses ground follow', () => {
  const s = st({ onGround: true, position: [0, 0.3, 0], groundY: 0 })
  const r = predictCharacterStep(s, { jumped: true }, {}, 0.1, env({ ground: () => 0 }))
  is(r.jumped, true, 'jump result')
  is(s.onGround, false, 'jumped onGround')
})
gate('predict: without a jump the same grounded body stays grounded (negative control)', () => {
  const s = st({ onGround: true, position: [0, 0.3, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0 }))
  is(s.onGround, true, 'unjumped onGround')
})

gate('predict: the ground sampler receives (x, z, y) in that order', () => {
  const seen = []
  const s = st({ position: [1, 0.5, 2] })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: (x, z, y) => { seen.push([x, z, y]); return 0 } }))
  near(seen[0][0], 1, 'sampler x')
  near(seen[0][1], 2, 'sampler z')
  near(seen[0][2], 0.4, 'sampler y after the airborne step')
})
gate('predict: the sampled floor, not the start height, decides the landing (negative control)', () => {
  const s = st({ position: [0, 0.5, 0], velocity: [0, -1, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => 0.45 }))
  is(s.onGround, true, 'floor 0.45 landed')
  near(s.position[1], 0.45, 'floor 0.45 y')
})

gate('slope: a 50 degree walkable slope lowers the carried ground height', () => {
  const a = (50 * Math.PI) / 180
  const s = st({ onGround: true, position: [0, 0, 0], velocity: [1, 0, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ groundNormal: [Math.sin(a), Math.cos(a), 0] }))
  near(s.groundY, -Math.tan(a) * 0.1, 'groundY after 50 degree slope', 1e-9)
})
gate('slope: a 70 degree slope is not walkable and adds no rise (negative control)', () => {
  const a = (70 * Math.PI) / 180
  const s = st({ onGround: true, position: [0, 0, 0], velocity: [1, 0, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ groundNormal: [Math.sin(a), Math.cos(a), 0] }))
  near(s.groundY, 0, 'groundY after 70 degree slope')
})
gate('slope: normal y exactly 0.5 (60 degrees) is walkable, 0.4999 is not', () => {
  const at = st({ onGround: true, position: [0, 0, 0], velocity: [1, 0, 0], groundY: 0 })
  predictCharacterStep(at, null, {}, 0.1, env({ groundNormal: [0.5, 0.5, 0] }))
  near(at.groundY, -0.1, 'walkable boundary')
  const below = st({ onGround: true, position: [0, 0, 0], velocity: [1, 0, 0], groundY: 0 })
  predictCharacterStep(below, null, {}, 0.1, env({ groundNormal: [0.4999, 0.4999, 0] }))
  near(below.groundY, 0, 'just below boundary')
})
gate('slope: a normal with y below 0.5 adds no rise (negative control)', () => {
  const s = st({ onGround: true, position: [0, 0, 0], velocity: [1, 0, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ groundNormal: [0.6, 0.4, 0] }))
  near(s.groundY, 0, 'groundY under steep normal')
})

gate('walls: a body behind a wall plane is pushed back onto the front side', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const s = st({ position: [0.8, 0, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(s.position[0], 1, 'pushed x')
})
gate('walls: a body already in front of the plane is not moved (negative control)', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const s = st({ position: [1.2, 0, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(s.position[0], 1.2, 'front x')
})
gate('walls: a wall more than 1.5 m above the body is ignored', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const s = st({ position: [0.8, 2, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(s.position[0], 0.8, 'out-of-height x')
})
gate('walls: a body 1.4 m above the wall plane is still pushed (negative control)', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const s = st({ position: [0.8, 1.4, 0] })
  predictCharacterStep(s, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(s.position[0], 1, 'in-height x')
})
gate('walls: the span reach is tMax + 0.3 + span width, so 3.3 is out and 3.0 is in', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const out = st({ position: [0.8, 0, 3.5] })
  predictCharacterStep(out, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(out.position[0], 0.8, 'span-out x')
  const inn = st({ position: [0.8, 0, 3] })
  predictCharacterStep(inn, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(inn.position[0], 1, 'span-in x')
})
gate('walls: the caller extent clamps the reach, so 0.5 m rejects a body at t 1.6', () => {
  const walls = [{ nx: 1, nz: 0, d: 1, tMin: -1, tMax: 1, ay: 0 }]
  const clamped = st({ position: [0.8, 0, 1.6] })
  predictCharacterStep(clamped, null, {}, 0.1, env({ walls, wallExtentM: 0.5 }))
  near(clamped.position[0], 0.8, 'clamped extent x')
  const wide = st({ position: [0.8, 0, 1.6] })
  predictCharacterStep(wide, null, {}, 0.1, env({ walls, wallExtentM: 10 }))
  near(wide.position[0], 1, 'wide extent x')
})

gate('wedge: velocity into the wedge normal is removed', () => {
  const s = st({ velocity: [-2, 0, 3] })
  predictCharacterStep(s, null, {}, 0.1, env({ wedged: true, wedgeNormal: [1, 0] }))
  near(s.position[0], 0, 'wedged x')
  near(s.position[2], 0.3, 'wedged z')
})
gate('wedge: velocity away from the wedge normal passes through (negative control)', () => {
  const s = st({ velocity: [2, 0, 3] })
  predictCharacterStep(s, null, {}, 0.1, env({ wedged: true, wedgeNormal: [1, 0] }))
  near(s.position[0], 0.2, 'away x')
})
gate('wedge: a missing wedge normal removes nothing (negative control)', () => {
  const s = st({ velocity: [-2, 0, 3] })
  predictCharacterStep(s, null, {}, 0.1, env({ wedged: true }))
  near(s.position[0], -0.2, 'no-normal x')
})

gate('collider: an unwedged collider takes over the step and receives its arguments', () => {
  const calls = []
  const collider = { step: (state, input, dt, g, wg) => calls.push([dt, g, wg]) }
  const s = st({ onGround: true, position: [0, 0, 0] })
  const r = predictCharacterStep(s, null, {}, 0.1, env({ collider }))
  is(calls.length, 1, 'collider calls')
  near(calls[0][0], 0.1, 'collider dt')
  near(calls[0][1], -10, 'collider gravity')
  is(calls[0][2], true, 'collider wasGrounded')
  is(r.jumped, false, 'collider result')
  near(s.position[0], 0, 'collider leaves manual path unrun')
})
gate('collider: a wedged body bypasses the collider (negative control)', () => {
  let called = 0
  const collider = { step: () => { called++ } }
  predictCharacterStep(st(), null, {}, 0.1, env({ collider, wedged: true }))
  is(called, 0, 'wedged collider calls')
})

gate('input: crouch is recorded on the state and the crouch drop is reset', () => {
  const s = st({ _crouchDy: 9 })
  predictCharacterStep(s, { crouch: true }, {}, 0.1, env())
  is(s._physCrouch, true, '_physCrouch true')
  is(s._crouchDy, 0, '_crouchDy reset')
})
gate('input: a released crouch records false (negative control)', () => {
  const s = st()
  predictCharacterStep(s, { crouch: false }, {}, 0.1, env())
  is(s._physCrouch, false, '_physCrouch false')
})
gate('input: a null input leaves crouch bookkeeping untouched (negative control)', () => {
  const s = st()
  predictCharacterStep(s, null, {}, 0.1, env())
  is(s._physCrouch, undefined, '_physCrouch untouched')
})

gate('ground: a non-finite sample with a known groundY keeps a grounded body grounded', () => {
  const s = st({ onGround: true, position: [0, 0, 0], groundY: 0 })
  predictCharacterStep(s, null, {}, 0.1, env({ ground: () => NaN }))
  is(s.onGround, true, 'NaN sample grounded')
})
gate('ground: a non-finite sample and a jump drops the grounded flag (negative control)', () => {
  const s = st({ onGround: true, position: [0, 0, 0], groundY: 0 })
  predictCharacterStep(s, { jumped: true }, {}, 0.1, env({ ground: () => NaN }))
  is(s.onGround, false, 'NaN sample jumped')
})
gate('ground: applyMovement is called with the state, input, movement and dt it was given', () => {
  const seen = []
  const move = (state, input, movement, dt) => { seen.push([state, input, movement, dt]); return { jumped: false } }
  const s = st()
  const input = { forward: true }
  const movement = { maxSpeed: 7 }
  predictCharacterStep(s, input, movement, 0.25, env({ applyMovement: move }))
  is(seen[0][0], s, 'state argument')
  is(seen[0][1], input, 'input argument')
  is(seen[0][2], movement, 'movement argument')
  near(seen[0][3], 0.25, 'dt argument')
})

finish()
