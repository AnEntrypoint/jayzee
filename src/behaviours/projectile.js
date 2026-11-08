import { readVec3 } from '../physics-extras/math.js'

function refusal(code, message) {
  const err = new TypeError(`[projectile] ${code}: ${message}`)
  err.reasonCode = code
  return err
}

export function sweepProjectile(raycast, from, velocity, dt) {
  if (typeof raycast !== 'function') throw refusal('projectile-raycast-invalid', 'raycast must be a function')
  readVec3(from, 'from')
  readVec3(velocity, 'velocity')
  if (!Number.isFinite(dt) || dt < 0) throw refusal('projectile-dt-invalid', 'dt must be a finite non-negative number')
  const speed = Math.hypot(velocity[0], velocity[1], velocity[2])
  const reach = speed * dt
  if (reach === 0) return { position: [...from], hit: null }
  const dir = velocity.map((component) => component / speed)
  const result = raycast(from, dir, reach)
  if (result && result.hit) {
    readVec3(result.position, 'raycast hit position')
    return { position: [...result.position], hit: { point: [...result.position], entityId: result.entityId ?? null } }
  }
  return { position: from.map((component, i) => component + dir[i] * reach), hit: null }
}
