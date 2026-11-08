const RAD_TO_DEG = 180 / Math.PI

export const LATTICE_RESET_FORCED_TILT_DEG = 12
export const LATTICE_FOLLOW_TILT_DEG = 7.5
export const RESET_SURFACE_STEP_BOUND_M = 0.02

export function tiltDegBetween(upA, upB) {
  const d = upA[0] * upB[0] + upA[1] * upB[1] + upA[2] * upB[2]
  return Math.acos(Math.max(-1, Math.min(1, d))) * RAD_TO_DEG
}
