import { gate, finish } from './lib/gate.mjs'
import { rotateByQuat, flightForces } from '../src/motion-pure/flightModel.js'

const IDENTITY = [0, 0, 0, 1]
const pitch = (theta) => [Math.sin(theta / 2), 0, 0, Math.cos(theta / 2)]
const yaw = (theta) => [0, Math.sin(theta / 2), 0, Math.cos(theta / 2)]
const NOSE_UP = pitch(-0.2)
const NOSE_DOWN = pitch(0.2)
const LEVEL_FLIGHT = [0, 0, 10]

const near = (a, b, what, eps = 1e-9) => {
  if (!(Math.abs(a - b) <= eps)) throw new Error(`${what}: expected ${b}, got ${a}`)
}
const vecNear = (a, b, what, eps = 1e-9) => {
  for (let i = 0; i < 3; i++) near(a[i], b[i], `${what}[${i}]`, eps)
}
const allFinite = (a, what) => {
  if (!a.every(Number.isFinite)) throw new Error(`${what}: non-finite ${JSON.stringify(a)}`)
}
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]

gate('rotateByQuat: the identity quaternion leaves a vector unchanged', () => {
  vecNear(rotateByQuat(IDENTITY, [1, 2, 3]), [1, 2, 3], 'identity')
})
gate('rotateByQuat: a 90 degree turn about Y maps +Z to +X', () => {
  vecNear(rotateByQuat(yaw(Math.PI / 2), [0, 0, 1]), [1, 0, 0], 'yaw90 forward', 1e-12)
})
gate('rotateByQuat: the identity does not map +Z to +X (negative control)', () => {
  const r = rotateByQuat(IDENTITY, [0, 0, 1])
  if (Math.abs(r[0] - 1) < 1e-9) throw new Error('identity mapped +Z to +X')
})
gate('rotateByQuat: the conjugate quaternion turns +Z to -X (negative control)', () => {
  vecNear(rotateByQuat([0, -Math.sin(Math.PI / 4), 0, Math.cos(Math.PI / 4)], [0, 0, 1]), [-1, 0, 0], 'conjugate yaw90', 1e-12)
})

gate('pitch convention: a negative pitch angle gives a nose-up forward vector', () => {
  vecNear(rotateByQuat(NOSE_UP, [0, 0, 1]), [0, Math.sin(0.2), Math.cos(0.2)], 'nose-up forward', 1e-12)
})
gate('pitch convention: a positive pitch angle gives a nose-down forward vector (negative control)', () => {
  vecNear(rotateByQuat(NOSE_DOWN, [0, 0, 1]), [0, -Math.sin(0.2), Math.cos(0.2)], 'nose-down forward', 1e-12)
})

gate('zero velocity: every output is finite, speed is zero and no force is produced', () => {
  const r = flightForces({ velocity: [0, 0, 0], rotation: IDENTITY })
  allFinite(r.force, 'force')
  near(r.speed, 0, 'speed')
  vecNear(r.force, [0, 0, 0], 'force', 1e-12)
})
gate('zero velocity: a non-zero speed reports that speed (negative control)', () => {
  const r = flightForces({ velocity: [0, 0, 1], rotation: IDENTITY })
  near(r.speed, 1, 'speed')
})

gate('level flight: drag opposes the velocity and lift is absent', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: IDENTITY })
  vecNear(r.force, [0, 0, -18.375], 'level drag', 1e-9)
  near(r.liftCoeff, 0, 'level liftCoeff', 1e-12)
  near(r.aoa, 0, 'level aoa', 1e-12)
})
gate('level flight: drag grows with the square of speed (negative control: doubled speed is four times the drag)', () => {
  const slow = flightForces({ velocity: [0, 0, 10], rotation: IDENTITY })
  const fast = flightForces({ velocity: [0, 0, 20], rotation: IDENTITY })
  near(fast.force[2] / slow.force[2], 4, 'drag ratio', 1e-9)
  if (Math.abs(fast.force[2] / slow.force[2] - 1) < 1e-6) throw new Error('drag did not change with speed')
})

gate('nose-up: lift is upward, sized by 4.5 * sin(aoa), and the aoa is 0.2 rad', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP })
  near(r.aoa, 0.2, 'nose-up aoa', 1e-9)
  near(r.liftCoeff, 4.5 * Math.sin(0.2), 'nose-up liftCoeff', 1e-9)
  near(r.force[1], r.liftCoeff * 0.5 * 1.225 * 100 * 10, 'nose-up lift y', 1e-6)
  if (!(r.force[1] > 0)) throw new Error('nose-up lift is not upward')
})
gate('nose-down: lift is downward (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_DOWN })
  near(r.liftCoeff, -4.5 * Math.sin(0.2), 'nose-down liftCoeff', 1e-9)
  if (!(r.force[1] < 0)) throw new Error('nose-down lift is not downward')
})
gate('nose-up: lift is perpendicular to the velocity, so the drag along it is the whole z force', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP })
  const cd = 0.03 + 0.04 * r.liftCoeff * r.liftCoeff
  near(r.force[2], -cd * 0.5 * 1.225 * 100 * 10, 'z force equals drag', 1e-6)
  near(r.force[0], 0, 'lateral force', 1e-9)
})
gate('nose-up: a thrust term breaks the z-only force (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP }, { thrust: 100 })
  const cd = 0.03 + 0.04 * r.liftCoeff * r.liftCoeff
  const dragOnly = -cd * 0.5 * 1.225 * 100 * 10
  if (Math.abs(r.force[2] - dragOnly) < 1e-6) throw new Error('thrust did not change the z force')
})

gate('lift cap: liftCoeff is held at maxLiftCoeff', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP }, { maxLiftCoeff: 0.5 })
  near(r.liftCoeff, 0.5, 'capped liftCoeff', 1e-12)
})
gate('lift cap: the default cap of 1.4 does not clip a 0.894 coefficient (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP })
  if (Math.abs(r.liftCoeff - 0.5) < 1e-9) throw new Error('default cap clipped to 0.5')
})

gate('thrust: at rest, thrust pushes along the forward vector', () => {
  const r = flightForces({ velocity: [0, 0, 0], rotation: IDENTITY }, { thrust: 100 })
  vecNear(r.force, [0, 0, 100], 'thrust forward', 1e-9)
})
gate('thrust: with thrust at zero, nothing pushes at rest (negative control)', () => {
  const r = flightForces({ velocity: [0, 0, 0], rotation: IDENTITY })
  vecNear(r.force, [0, 0, 0], 'no thrust', 1e-12)
})

gate('stall: speed below stallSpeed sets stalled', () => {
  const r = flightForces({ velocity: [0, 0, 4], rotation: IDENTITY }, { stallSpeed: 5 })
  if (r.stalled !== true) throw new Error('slow flight not stalled')
})
gate('stall: speed at or above stallSpeed clears stalled (negative control)', () => {
  const r = flightForces({ velocity: [0, 0, 6], rotation: IDENTITY }, { stallSpeed: 5 })
  if (r.stalled !== false) throw new Error('fast flight stalled')
})

gate('wing area: zero wing area removes lift and drag', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP }, { wingArea: 0 })
  vecNear(r.force, [0, 0, 0], 'zero wing', 1e-9)
})
gate('wing area: the default wing area produces a non-zero force (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: NOSE_UP })
  if (Math.abs(r.force[1]) < 1) throw new Error('default wing produced no lift')
})
gate('air density: zero density removes the aerodynamic force', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: IDENTITY }, { airDensity: 0 })
  vecNear(r.force, [0, 0, 0], 'zero density', 1e-12)
})
gate('air density: the default density gives the level drag (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: IDENTITY })
  near(r.force[2], -18.375, 'default density drag', 1e-9)
})

gate('defaults: an opts override does not leak into the next call', () => {
  flightForces({ velocity: [0, 0, 0], rotation: IDENTITY }, { thrust: 50 })
  const r = flightForces({ velocity: [0, 0, 0], rotation: IDENTITY })
  vecNear(r.force, [0, 0, 0], 'leaked thrust', 1e-12)
})
gate('defaults: an opts override does apply within its own call (negative control)', () => {
  const r = flightForces({ velocity: [0, 0, 0], rotation: IDENTITY }, { thrust: 50 })
  near(r.force[2], 50, 'override thrust', 1e-12)
})
gate('defaults: an explicit undefined in opts replaces the default with NaN, as spoint does', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: IDENTITY }, { wingArea: undefined })
  if (!Number.isNaN(r.force[2])) throw new Error(`expected NaN, got ${r.force[2]}`)
})
gate('defaults: a defined opts value replaces the default cleanly (negative control)', () => {
  const r = flightForces({ velocity: LEVEL_FLIGHT, rotation: IDENTITY }, { wingArea: 1 })
  allFinite(r.force, 'force with wingArea 1')
  near(r.force[2], -1.8375, 'wingArea 1 drag', 1e-9)
})

finish()
