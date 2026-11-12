import { pos, vel } from './state.js'

export const integrate = (count, gravity, drag, dt) => {
  const keep = drag * dt >= 1 ? 0 : 1 - drag * dt
  const fall = gravity * dt
  const words = count * 3
  for (let o = 0; o < words; o += 3) {
    const vx = vel[o] * keep
    const vy = vel[o + 1] * keep + fall
    const vz = vel[o + 2] * keep
    vel[o] = vx
    vel[o + 1] = vy
    vel[o + 2] = vz
    pos[o] = pos[o] + vx * dt
    pos[o + 1] = pos[o + 1] + vy * dt
    pos[o + 2] = pos[o + 2] + vz * dt
  }
}
