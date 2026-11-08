import { gate, finish } from './lib/gate.mjs'
import { applyMovement, DEFAULT_MOVEMENT } from '../src/motion-pure/movement.js'
import { predictCharacterStep } from '../src/motion-pure/characterStep.js'

const close = (a, b, what, eps = 1e-9) => {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const is = (a, b, what) => {
  if (!Object.is(a, b)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const ground = (over = {}) => ({ position: [0, 0, 0], velocity: [0, 0, 0], onGround: true, groundY: 0, ...over })
const DT = 0.01

gate('the defaults are spoint\'s: speed 7, ground accel 150, air accel 15, friction 10, stop speed 2, jump 5.5', () => {
  is(DEFAULT_MOVEMENT.maxSpeed, 7, 'maxSpeed')
  is(DEFAULT_MOVEMENT.groundAccel, 150, 'groundAccel')
  is(DEFAULT_MOVEMENT.airAccel, 15, 'airAccel')
  is(DEFAULT_MOVEMENT.friction, 10, 'friction')
  is(DEFAULT_MOVEMENT.stopSpeed, 2, 'stopSpeed')
  is(DEFAULT_MOVEMENT.jumpImpulse, 5.5, 'jumpImpulse')
})

gate('standing still on the ground with no input keeps the velocity at zero and reports no movement', () => {
  const s = ground()
  const r = applyMovement(s, { forward: false }, DEFAULT_MOVEMENT, DT)
  is(s.velocity[0], 0, 'vx')
  is(s.velocity[2], 0, 'vz')
  is(r.wishSpeed, 0, 'wishSpeed')
  is(r.jumped, false, 'jumped')
})

gate('forward input from rest on the ground is capped by the wish speed, with the wish along +z at yaw 0', () => {
  const s = ground()
  const r = applyMovement(s, { forward: true }, DEFAULT_MOVEMENT, DT)
  close(r.wishZ, 1, 'wishZ')
  close(r.wishX, 0, 'wishX')
  close(r.wishSpeed, 7, 'wishSpeed')
  close(s.velocity[2], 7, 'vz after one step (accel capped at the wish speed)')
})

gate('forward input in the air from rest adds groundless air acceleration, not the ground cap', () => {
  const s = ground({ onGround: false })
  applyMovement(s, { forward: true }, DEFAULT_MOVEMENT, DT)
  close(s.velocity[2], 15 * 7 * DT, 'vz after one air step')
})

gate('friction brings a moving ground body down, and stop speed sets the drop when the speed is low', () => {
  const s = ground({ velocity: [0, 0, 1] })
  applyMovement(s, null, DEFAULT_MOVEMENT, DT)
  close(s.velocity[2], 1 - 2 * 10 * DT, 'vz after friction at stop speed')
})

gate('analog input below full deflection scales the wish speed by the deflection', () => {
  const s = ground()
  const r = applyMovement(s, { analogForward: 0.5, analogRight: 0 }, DEFAULT_MOVEMENT, DT)
  close(r.wishSpeed, 3.5, 'wishSpeed at half deflection')
  close(s.velocity[2], 3.5, 'vz at half deflection')
})

gate('yaw turns the wish direction: forward at a quarter turn points along +x', () => {
  const s = ground()
  const r = applyMovement(s, { forward: true, yaw: Math.PI / 2 }, DEFAULT_MOVEMENT, DT)
  close(r.wishX, 1, 'wishX at quarter turn')
  close(r.wishZ, 0, 'wishZ at quarter turn', 1e-12)
  close(s.velocity[0], 7, 'vx at quarter turn')
})

gate('an override replaces the field it names, and only that field', () => {
  const s = ground()
  const r = applyMovement(s, { forward: true }, DEFAULT_MOVEMENT, DT, { maxSpeed: 2 })
  close(r.wishSpeed, 2, 'wishSpeed with maxSpeed 2')
  close(s.velocity[2], 2, 'vz with maxSpeed 2')
})

gate('a jump edge on the ground sets the vertical velocity to the impulse and clears the grounded flag', () => {
  const s = ground()
  const r = applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  is(r.jumped, true, 'jumped')
  is(s.onGround, false, 'onGround after jump')
  is(s.velocity[1], 5.5, 'vertical velocity after jump')
})

gate('holding jump does not jump again on the next tick (the edge is needed)', () => {
  const s = ground()
  applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  s.onGround = true
  const r = applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  is(r.jumped, false, 'jumped while held')
})

gate('coyote time: a jump edge just after leaving the ground still jumps', () => {
  const s = ground()
  applyMovement(s, null, DEFAULT_MOVEMENT, 0.01)
  s.onGround = false
  const r = applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, 0.05)
  is(r.jumped, true, 'coyote jump')
})

gate('coyote time ends: after 0.12 s in the air a jump edge does not jump', () => {
  const s = ground()
  applyMovement(s, null, DEFAULT_MOVEMENT, 0.01)
  s.onGround = false
  applyMovement(s, null, DEFAULT_MOVEMENT, 0.2)
  const r = applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  is(r.jumped, false, 'jump after coyote window')
})

gate('a jump pressed in the air is buffered and fires on landing', () => {
  const s = ground({ onGround: false })
  applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  is(s.bufferRemaining > 0, true, 'buffer armed')
  s.onGround = true
  const r = applyMovement(s, {}, DEFAULT_MOVEMENT, DT)
  is(r.jumped, true, 'buffered jump on landing')
})

gate('a buffered jump fires only on a tick that carries an input object, as spoint does (null input skips it)', () => {
  const s = ground({ onGround: false })
  applyMovement(s, { jump: true }, DEFAULT_MOVEMENT, DT)
  s.onGround = true
  const r = applyMovement(s, null, DEFAULT_MOVEMENT, DT)
  is(r.jumped, false, 'buffered jump with null input')
})

gate('a crouch edge at sliding speed starts a slide and forces crouch', () => {
  const s = ground({ velocity: [0, 0, 10] })
  const r = applyMovement(s, { crouch: true }, DEFAULT_MOVEMENT, DT)
  is(r.sliding, true, 'sliding')
  is(r.forceCrouch, true, 'forceCrouch')
})

gate('a crouch edge below sliding speed does not start a slide', () => {
  const s = ground({ velocity: [0, 0, 1] })
  const r = applyMovement(s, { crouch: true }, DEFAULT_MOVEMENT, DT)
  is(r.sliding, false, 'sliding below the threshold')
})

gate('end to end: walking forward on flat ground through predictCharacterStep ramps to the speed cap and stays grounded', () => {
  const state = ground()
  const env = { applyMovement, gravityY: -10, ground: () => 0 }
  for (let i = 0; i < 60; i++) predictCharacterStep(state, { forward: true }, DEFAULT_MOVEMENT, 1 / 60, env)
  if (!(state.position[2] > 6.5 && state.position[2] < 7.01)) throw new Error('z after one second is ' + state.position[2])
  close(state.position[1], 0, 'y on flat ground', 1e-9)
  is(state.onGround, true, 'grounded at the end')
})

gate('end to end: a jump through predictCharacterStep leaves the ground and comes back down onto the floor', () => {
  const state = ground()
  const env = { applyMovement, gravityY: -10, ground: () => 0 }
  predictCharacterStep(state, { jump: true }, DEFAULT_MOVEMENT, 1 / 60, env)
  is(state.onGround, false, 'airborne after the jump')
  let peak = 0
  for (let i = 0; i < 120 && !state.onGround; i++) {
    predictCharacterStep(state, {}, DEFAULT_MOVEMENT, 1 / 60, env)
    peak = Math.max(peak, state.position[1])
  }
  is(state.onGround, true, 'landed')
  if (!(peak > 0.5)) throw new Error('peak height ' + peak)
  close(state.position[1], 0, 'y after landing', 1e-9)
})

finish()
