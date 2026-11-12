import { pos, vel } from './state.js'

const RESTING_SPEED = 1

export const bounceFor = (vn, restitution) => (vn < -RESTING_SPEED ? restitution : 0)

export const respond = (o, nx, ny, nz, depth, restitution) => {
  pos[o] = pos[o] + nx * depth
  pos[o + 1] = pos[o + 1] + ny * depth
  pos[o + 2] = pos[o + 2] + nz * depth
  const vx = vel[o]
  const vy = vel[o + 1]
  const vz = vel[o + 2]
  const vn = vx * nx + vy * ny + vz * nz
  if (vn < 0) {
    const j = (1 + bounceFor(vn, restitution)) * vn
    vel[o] = vx - j * nx
    vel[o + 1] = vy - j * ny
    vel[o + 2] = vz - j * nz
  }
}
