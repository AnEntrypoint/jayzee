const DEFAULT_TELEPORT_THRESHOLD_GROUNDED = 5.0
const DEFAULT_TELEPORT_THRESHOLD_AIRBORNE = 8.0
const DEFAULT_SMOOTHING_TIME_CONSTANT_S = 0.08
const SETTLE_EPSILON_M = 0.002
const MAX_DECAY_STEP_S = 0.1

export class ReconciliationEngine {
  timeConstantS
  groundedTeleportThreshold
  airborneTeleportThreshold
  #errorOffset = [0, 0, 0]
  #lastDecayMs = 0

  constructor(config = {}) {
    this.timeConstantS = config.timeConstantS ?? DEFAULT_SMOOTHING_TIME_CONSTANT_S
    this.groundedTeleportThreshold = config.groundedTeleportThreshold ?? config.teleportThreshold ?? DEFAULT_TELEPORT_THRESHOLD_GROUNDED
    this.airborneTeleportThreshold = config.airborneTeleportThreshold ?? DEFAULT_TELEPORT_THRESHOLD_AIRBORNE
  }

  get teleportThreshold() {
    return this.groundedTeleportThreshold
  }

  teleportThresholdFor(onGround) {
    return onGround ? this.groundedTeleportThreshold : this.airborneTeleportThreshold
  }

  absorb(dx, dy, dz, onGround) {
    const offset = this.#errorOffset
    offset[0] += dx
    offset[1] += dy
    offset[2] += dz
    if (Math.hypot(offset[0], offset[1], offset[2]) >= this.teleportThresholdFor(onGround)) this.reset()
  }

  decay(nowMs) {
    const offset = this.#errorOffset
    const elapsedS = this.#lastDecayMs ? Math.min(MAX_DECAY_STEP_S, Math.max(0, (nowMs - this.#lastDecayMs) / 1000)) : 0
    this.#lastDecayMs = nowMs
    if (offset[0] === 0 && offset[1] === 0 && offset[2] === 0) return offset
    const keep = Math.exp(-elapsedS / this.timeConstantS)
    offset[0] *= keep
    offset[1] *= keep
    offset[2] *= keep
    if (offset[0] * offset[0] + offset[1] * offset[1] + offset[2] * offset[2] < SETTLE_EPSILON_M * SETTLE_EPSILON_M) {
      offset[0] = 0
      offset[1] = 0
      offset[2] = 0
    }
    return offset
  }

  getErrorOffset() {
    return this.#errorOffset
  }

  reset() {
    this.#errorOffset[0] = 0
    this.#errorOffset[1] = 0
    this.#errorOffset[2] = 0
  }
}
