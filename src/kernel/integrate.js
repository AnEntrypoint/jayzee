export const integrate = (pos, vel, count, gravity, drag, dt) => {
  const keep = drag * dt >= 1 ? 0 : 1 - drag * dt
  for (let i = 0; i < count; i++) {
    const o = i * 3
    vel[o] = vel[o] * keep
    vel[o + 1] = vel[o + 1] * keep + gravity * dt
    vel[o + 2] = vel[o + 2] * keep
    pos[o] = pos[o] + vel[o] * dt
    pos[o + 1] = pos[o + 1] + vel[o + 1] * dt
    pos[o + 2] = pos[o + 2] + vel[o + 2] * dt
  }
}
