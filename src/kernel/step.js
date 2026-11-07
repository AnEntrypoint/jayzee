import { integrate } from './integrate.js'
import { resolveGround, resolveBoxes } from './collide.js'
import { resolvePairs } from './pairs.js'

export const step = (pos, vel, count, boxes, boxCount, gravity, drag, dt, radius, restitution, iterations, head, next, cells) => {
  integrate(pos, vel, count, gravity, drag, dt)
  for (let k = 0; k < iterations; k++) {
    resolveGround(pos, vel, count, radius, restitution)
    resolveBoxes(pos, vel, count, radius, boxes, boxCount, restitution)
    resolvePairs(pos, vel, count, radius, restitution, head, next, cells)
  }
}
