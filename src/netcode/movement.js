const VELOCITY_SCRATCH = [0, 0, 0]

export const applyMovement = (world, id, input, speed) => {
  const sin = Math.sin(input.yaw)
  const cos = Math.cos(input.yaw)
  const length = Math.hypot(input.moveX, input.moveZ)
  const scale = (length > 1 ? speed / length : speed)
  const dx = (cos * input.moveX - sin * input.moveZ) * scale
  const dz = (-sin * input.moveX - cos * input.moveZ) * scale
  const velocity = world.velocity(id, VELOCITY_SCRATCH)
  velocity[0] = dx
  velocity[2] = dz
  world.setVelocity(id, velocity)
}
