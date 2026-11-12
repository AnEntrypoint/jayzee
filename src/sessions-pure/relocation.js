import { spawnSurfaceY } from './spawnSurface.js'
import { resolveTarget } from './relocationTarget.js'

const SNAP_RAY_START_ABOVE = 20
const SNAP_RAY_LENGTH = 2000
const PROBE_RAY_START_ABOVE = 50
const PROBE_RAY_LENGTH = 4000
export const SPAWN_CLEARANCE = 2
const FALLBACK_STANDING_OFFSET = 1.4
const SPAWN_STATIC_WAIT_RADIUS = 256
export const SPAWN_HOLD_MAX_MS = 20000
export const SPAWN_HOLD_MOVED_EPS = 0.01
const SPAWN_WALKABLE_CLEARANCE_M = 6
const SPAWN_CLEARANCE_PROBE_M = 30
const SPAWN_CLEARANCE_DIRS = (() => {
  const dirs = []
  for (let i = 0; i < 8; i++) dirs.push([Math.cos((i * Math.PI) / 4), Math.sin((i * Math.PI) / 4)])
  return dirs
})()

export const SPAWN_HOLD_REASON = Object.freeze({
  HEIGHTFIELD_NOT_LANDED: 'heightfield-collider-not-landed',
  STATIC_COLLIDERS_PENDING: 'static-colliders-pending-near',
  NO_RAYCAST: 'no-raycast-capability',
  RAY_MISSED_GROUND: 'ray-missed-ground',
})

function terrainY(physics, x, z) {
  const y = typeof physics?.terrainHeightAt === 'function' ? physics.terrainHeightAt(x, z) : null
  return Number.isFinite(y) ? y : null
}

export function snapToGround(ctx, x, hintY, z, clearance, snap = 'first') {
  const physics = ctx.physics
  const liveY = terrainY(physics, x, z)
  if (snap === 'terrain' && liveY !== null) return [x, liveY + clearance, z]
  if (physics && typeof physics.raycast === 'function') {
    const heightHint = liveY !== null ? Math.max(hintY, liveY) : hintY
    if (Number.isFinite(heightHint)) {
      const hit = physics.raycast([x, heightHint + SNAP_RAY_START_ABOVE, z], [0, -1, 0], SNAP_RAY_LENGTH)
      if (hit && hit.hit && Number.isFinite(hit.position?.[1])) return [x, hit.position[1] + clearance, z]
    }
  }
  if (liveY !== null) return [x, liveY + clearance, z]
  return Number.isFinite(hintY) ? [x, hintY, z] : null
}

function spawnHoldOutcome(y, reason) {
  if (Number.isFinite(y)) return { y, reason: null }
  if (!reason) throw new Error('spawn hold: a groundless outcome must name its reason')
  return { y: null, reason }
}

export function probeSpawnHoldGround(ctx, sp, { rejoin = false } = {}) {
  if (terrainFieldMissingAt(ctx, sp)) return spawnHoldOutcome(null, SPAWN_HOLD_REASON.HEIGHTFIELD_NOT_LANDED)
  if (staticCollidersPendingNear(ctx, sp)) return spawnHoldOutcome(null, SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING)
  return rejoin ? spawnRejoinGround(ctx, sp) : spawnSurfaceGround(ctx, sp)
}

function spawnSurfaceGround(ctx, sp) {
  const physics = ctx.physics
  if (!physics || typeof physics.raycast !== 'function') return spawnHoldOutcome(null, SPAWN_HOLD_REASON.NO_RAYCAST)
  const standingOffset = ctx.physicsIntegration?.standingCentreY?.(0)
  const y = spawnSurfaceY((o, d, l) => physics.raycast(o, d, l), sp, {
    standingOffset: standingOffset > 0 ? standingOffset : FALLBACK_STANDING_OFFSET,
    terrainY: terrainY(physics, sp[0], sp[2]),
    radius: ctx.physicsIntegration?.config?.capsuleRadius || 0,
  })
  return spawnHoldOutcome(y, SPAWN_HOLD_REASON.RAY_MISSED_GROUND)
}

function spawnRejoinGround(ctx, sp) {
  const physics = ctx.physics
  if (!physics || typeof physics.raycast !== 'function') return spawnHoldOutcome(null, SPAWN_HOLD_REASON.NO_RAYCAST)
  const r = physics.raycast([sp[0], sp[1], sp[2]], [0, -1, 0], SNAP_RAY_LENGTH)
  return spawnHoldOutcome(r && r.hit ? r.position?.[1] : null, SPAWN_HOLD_REASON.RAY_MISSED_GROUND)
}

export function probeSpawnGround(ctx, sp) {
  return probeSpawnHoldGround(ctx, sp)
}

export function probeSpawnGroundY(ctx, sp) {
  return probeSpawnGround(ctx, sp).y
}

export function spawnClearanceM(ctx, x, y, z) {
  const physics = ctx.physics
  if (!physics || typeof physics.raycast !== 'function') return SPAWN_CLEARANCE_PROBE_M
  let min = SPAWN_CLEARANCE_PROBE_M
  for (const [dx, dz] of SPAWN_CLEARANCE_DIRS) {
    const r = physics.raycast([x, y, z], [dx, 0, dz], SPAWN_CLEARANCE_PROBE_M)
    if (r && r.hit && r.distance < min) min = r.distance
  }
  return min
}

export function rankSpawnPointsByWalkingRoom(ctx, candidates) {
  if (!Array.isArray(candidates) || candidates.length < 2) return candidates
  const scored = candidates.map(sp => {
    const groundY = probeSpawnGroundY(ctx, sp)
    if (groundY === null) return { sp, clearance: -1 }
    const standingY = ctx.physicsIntegration?.standingCentreY?.(groundY)
    if (!Number.isFinite(standingY)) return { sp, clearance: -1 }
    return { sp, clearance: spawnClearanceM(ctx, sp[0], standingY, sp[2]) }
  })
  scored.sort((a, b) => b.clearance - a.clearance)
  const walkable = scored.filter(s => s.clearance >= SPAWN_WALKABLE_CLEARANCE_M)
  const pool = walkable.length > 0 ? walkable : scored.slice(0, 1)
  return pool.map(s => s.sp)
}

export function groundSnapSpawnPoint(ctx, sp) {
  const groundY = probeSpawnGroundY(ctx, sp)
  return groundY !== null ? [sp[0], groundY + SPAWN_CLEARANCE, sp[2]] : sp
}

export function resolveSpawnPointOnGround(ctx, sp) {
  if (!Array.isArray(sp) || sp.length < 3) return sp
  const groundY = probeSpawnGroundY(ctx, sp)
  if (groundY === null) return [...sp]
  const standingY = ctx.physicsIntegration?.standingCentreY?.(groundY)
  return Number.isFinite(standingY) ? [sp[0], standingY, sp[2]] : [...sp]
}

function staticCollidersPendingNear(ctx, p) {
  const runtime = ctx.appRuntime
  if (runtime?._pendingTrimeshBuilds?.size > 0) return true
  const pending = runtime?._pendingTrimeshEntities
  if (!pending || pending.size === 0) return false
  for (const ent of pending.values()) {
    const e = ent.position || [0, 0, 0]
    if (Math.hypot(e[0] - p[0], e[2] - p[2]) <= SPAWN_STATIC_WAIT_RADIUS) return true
  }
  return false
}

function streamerOf(ctx) {
  return ctx._terrainStreamer || ctx.physics?._terrainStreamer || null
}

function terrainFieldMissingAt(ctx, p) {
  const streamer = streamerOf(ctx)
  if (!streamer || typeof streamer.coversPosition !== 'function') return false
  return !streamer.coversPosition(p[0], p[2])
}

export function holdReasonText(ctx, playerId, sp, reason) {
  const at = `(${sp[0].toFixed(0)}, ${sp[2].toFixed(0)})`
  if (reason === SPAWN_HOLD_REASON.HEIGHTFIELD_NOT_LANDED) return `[terrain] holding player ${playerId} at chart-local ${at}: no heightfield collider covers it yet, so it is held until its field lands (groundless players now: ${JSON.stringify(streamerOf(ctx).groundlessPlayers.map(p => [Math.round(p[0]), Math.round(p[1])]))})`
  if (reason === SPAWN_HOLD_REASON.STATIC_COLLIDERS_PENDING) return `[spawn-hold] holding player ${playerId} at chart-local ${at}: ${reason} -- static colliders are still pending within ${SPAWN_STATIC_WAIT_RADIUS} m, so the ground under it is not final yet`
  if (reason === SPAWN_HOLD_REASON.NO_RAYCAST) return `[spawn-hold] holding player ${playerId} at chart-local ${at}: ${reason} -- physics exposes no raycast, so no ground height can be probed`
  return `[spawn-hold] holding player ${playerId} at chart-local ${at}: ${reason} -- the ground probe found no walkable surface under it`
}

export function movedDuringHold(position, sp) {
  return Math.abs(position[0] - sp[0]) + Math.abs(position[1] - sp[1]) + Math.abs(position[2] - sp[2]) > SPAWN_HOLD_MOVED_EPS
}

export function probeGround(ctx, x, z, fromY) {
  const physics = ctx.physics
  if (!physics || typeof physics.raycast !== 'function') return { hit: false, error: 'physics not ready' }
  const liveY = terrainY(physics, x, z)
  const startY = Number.isFinite(fromY) ? fromY : (liveY ?? 0) + PROBE_RAY_START_ABOVE
  const r = physics.raycast([x, startY, z], [0, -1, 0], PROBE_RAY_LENGTH)
  return { hit: !!(r && r.hit), y: r && r.hit ? r.position[1] : null, terrainY: liveY }
}

export function teleportTarget(ctx, spec) {
  const physics = ctx.physics
  const frame = physics?._planetFrame || null
  const heightAt = physics && typeof physics.terrainHeightAt === 'function' ? (x, z) => physics.terrainHeightAt(x, z) : undefined
  return resolveTarget(spec, { frame, heightAt })
}

export function teleportPlacement(ctx, target) {
  const probe = target.standNearY !== null ? probeSpawnGround(ctx, [target.x, target.standNearY, target.z]) : null
  if (target.y !== null) return { position: [target.x, target.y, target.z], holdReason: null }
  if (probe !== null && probe.y !== null) return { position: [target.x, ctx.physicsIntegration.standingCentreY(probe.y), target.z], holdReason: null }
  if (probe !== null) return { position: [target.x, target.standNearY, target.z], holdReason: probe.reason }
  const position = snapToGround(ctx, target.x, Number.NEGATIVE_INFINITY, target.z, target.clearance, target.snap)
  if (!position) throw new Error('teleport: no terrain height at target and no explicit y')
  return { position, holdReason: null }
}

export function teleportPosition(ctx, target) {
  return teleportPlacement(ctx, target).position
}
