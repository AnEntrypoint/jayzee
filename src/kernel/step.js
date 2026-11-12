import { integrate } from './integrate.js'
import { resolveGround, resolveBoxes } from './collide.js'
import { resolvePairs } from './pairs.js'

export const step = (count, boxCount, gravity, drag, dt, radius, restitution, iterations) => {
  integrate(count, gravity, drag, dt)
  for (let k = 0; k < iterations; k++) {
    resolveGround(count, radius, restitution)
    resolveBoxes(count, radius, boxCount, restitution)
    resolvePairs(count, radius, restitution)
  }
}

export const stepMany = (ticks, count, boxCount, gravity, drag, dt, radius, restitution, iterations) => {
  for (let t = 0; t < ticks; t++) step(count, boxCount, gravity, drag, dt, radius, restitution, iterations)
}
