import { parseDefineSpec } from './specBoundary.js'

const BUOYANCY_SCHEMA = Object.freeze({
  halfHeight: { type: 'number', min: 0, exclusiveMin: true, default: 0.5 },
  floatFactor: { type: 'number', min: 0, default: 1.2 },
  linearDrag: { type: 'number', min: 0, default: 2.0 },
  buoyantForce: { type: 'number', min: 0, nullable: true, default: null },
})

const DEFAULT_GRAVITY = 9.81

export function defineBuoyancy(spec = {}, body = null) {
  const config = parseDefineSpec('defineBuoyancy', spec, BUOYANCY_SCHEMA)
  if (!body) throw new TypeError('[buoyancy] a body accessor object is required')

  let lastSubmersionFrac = 0

  return {
    get submersionFrac() { return lastSubmersionFrac },
    get submerged() { return lastSubmersionFrac > 0 },

    tick(dt) {
      const waterlineY = body.seaLevel()
      if (waterlineY == null || !(dt > 0)) { lastSubmersionFrac = 0; return }
      const bottomY = body.bodyY() - config.halfHeight
      const submersionFrac = Math.max(0, Math.min(1, (waterlineY - bottomY) / (2 * config.halfHeight)))
      lastSubmersionFrac = submersionFrac
      if (submersionFrac <= 0) return

      const worldGravityY = body.gravityY()
      const gravityY = worldGravityY == null ? DEFAULT_GRAVITY : Math.abs(worldGravityY)
      const mass = body.mass() ?? 1
      const fullForce = config.buoyantForce ?? mass * gravityY * config.floatFactor
      const upward = fullForce * submersionFrac * dt
      if (upward > 0) body.addForce([0, upward, 0])

      if (config.linearDrag > 0) {
        const v = body.getVelocity()
        const damp = Math.max(0, 1 - config.linearDrag * submersionFrac * dt)
        body.setVelocity([v[0] * damp, v[1] * damp, v[2] * damp])
      }
    },
  }
}

export default defineBuoyancy
