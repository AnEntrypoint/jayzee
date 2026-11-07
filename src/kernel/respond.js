const RESTING_SPEED = 1

export const bounceFor = (vn, restitution) => (vn < -RESTING_SPEED ? restitution : 0)

export const respond = (pos, vel, o, nx, ny, nz, depth, restitution) => {
  pos[o] = pos[o] + nx * depth
  pos[o + 1] = pos[o + 1] + ny * depth
  pos[o + 2] = pos[o + 2] + nz * depth
  const vn = vel[o] * nx + vel[o + 1] * ny + vel[o + 2] * nz
  if (vn < 0) {
    const j = (1 + bounceFor(vn, restitution)) * vn
    vel[o] = vel[o] - j * nx
    vel[o + 1] = vel[o + 1] - j * ny
    vel[o + 2] = vel[o + 2] - j * nz
  }
}
