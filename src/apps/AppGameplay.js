import { DEFAULT_HITBOX } from '../netcode/hitscan.js'

const VOID_PROBE_DEPTH_M = 1.5
const PROBE_SKIN_M = 0.02
const FOOTPRINT_RING_FRACTIONS = [0.5, 1]
const FOOTPRINT_DIR_COUNT = 8
const FALLBACK_CAPSULE_RADIUS_M = 0.6

export const MAX_FOOTPRINT_INTRUSION_M = 0.15

const FOOTPRINT_OFFSETS = (() => {
  const offsets = [[0, 0]]
  for (const fraction of FOOTPRINT_RING_FRACTIONS) {
    for (let i = 0; i < FOOTPRINT_DIR_COUNT; i++) {
      const angle = (i * 2 * Math.PI) / FOOTPRINT_DIR_COUNT
      offsets.push([Math.cos(angle) * fraction, Math.sin(angle) * fraction])
    }
  }
  return offsets
})()

export function capsuleRadiusM(hitbox) {
  return Number.isFinite(hitbox?.radiusSq) && hitbox.radiusSq > 0
    ? Math.sqrt(hitbox.radiusSq)
    : FALLBACK_CAPSULE_RADIUS_M
}

export function capsuleHeightM(hitbox) {
  if (Number.isFinite(hitbox?.height) && hitbox.height > 0) return hitbox.height
  const derived = 2 * (Number.isFinite(hitbox?.centerHeight) ? hitbox.centerHeight : DEFAULT_HITBOX.centerHeight)
  return derived > 0 ? derived : DEFAULT_HITBOX.height
}

function capsuleBottomRiseM(distanceM, radiusM) {
  if (!(distanceM > 0)) return 0
  if (distanceM >= radiusM) return radiusM
  return radiusM - Math.sqrt(radiusM * radiusM - distanceM * distanceM)
}

function surfaceYOf(hit) {
  return hit && hit.hit && Number.isFinite(hit.position?.[1]) ? hit.position[1] : null
}

export function footprintBlockers(raycast, sp, feetY, hitbox = DEFAULT_HITBOX) {
  const radiusM = capsuleRadiusM(hitbox)
  const heightM = capsuleHeightM(hitbox)
  const blockers = []
  for (const [unitX, unitZ] of FOOTPRINT_OFFSETS) {
    const offsetX = unitX * radiusM
    const offsetZ = unitZ * radiusM
    const distanceM = Math.hypot(offsetX, offsetZ)
    const riseM = capsuleBottomRiseM(distanceM, radiusM)
    const bottomY = feetY + riseM
    const topY = feetY + heightM - riseM
    const sampleX = sp[0] + offsetX
    const sampleZ = sp[2] + offsetZ
    const probeLengthM = topY - bottomY + VOID_PROBE_DEPTH_M
    if (!(probeLengthM > 0)) continue
    const supportY = surfaceYOf(raycast([sampleX, topY - PROBE_SKIN_M, sampleZ], [0, -1, 0], probeLengthM))
    if (supportY === null) {
      if (distanceM < radiusM) {
        blockers.push({ kind: 'void', x: sampleX, z: sampleZ, offsetM: distanceM, surfaceY: null, intrusionM: null })
      }
      continue
    }
    if (supportY > bottomY + MAX_FOOTPRINT_INTRUSION_M) {
      blockers.push({ kind: 'intruding', x: sampleX, z: sampleZ, offsetM: distanceM, surfaceY: supportY, intrusionM: supportY - bottomY })
    }
  }
  return blockers
}
