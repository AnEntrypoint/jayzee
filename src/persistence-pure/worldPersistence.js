import { canonicalJSON } from '../rollback-pure/canonicalJSON.js'
import { createChecksumFold } from '../anticheat/LockstepChecksum.js'
import { createReexpressPass, sameChart } from '../client/chartReexpress.js'
import { createChartTransfer } from '../client/chartTransfer.js'
import { snapshotChart } from './chartSnapshot.js'

export const WORLD_SNAPSHOT_FORMAT_VERSION = 1
export const WORLD_SNAPSHOT_KEY = 'world-snapshot'

const LOG_PREFIX = '[world-persistence]'
const LEGACY_UNNAMED_WORLD = null

function reexpressSnapshotEntity(pass, state, body) {
  pass.point(state.position)
  pass.rotation(state.rotation)
  pass.vector(state.velocity)
  if (!body) return
  pass.point(body.position)
  pass.rotation(body.rotation)
  pass.vector(body.velocity)
  pass.vector(body.angularVelocity)
}

function chartPassFromSnapshot(snap, physics) {
  const frame = physics?._planetFrame
  if (!snap.chart || !frame) return null
  const live = snapshotChart(frame)
  return sameChart(snap.chart, live) ? null : createReexpressPass(createChartTransfer(snap.chart, live))
}

function mapToEntries(m) {
  return m ? [...m.entries()] : []
}

function entriesToMap(entries) {
  return new Map(entries || [])
}

function yieldToEventLoop() {
  return new Promise((resolve) => (typeof setImmediate === 'function' ? setImmediate(resolve) : setTimeout(resolve, 0)))
}

function envWorldName(env) {
  return env ? env.WORLD : undefined
}

function loggerOf(ctx) {
  return ctx.logger ?? console
}

export function worldDefFingerprint(worldDef) {
  const fold = createChecksumFold()
  const text = canonicalJSON(worldDef)
  for (let i = 0; i < text.length; i++) fold.pushInt(text.charCodeAt(i))
  return 'def-' + fold.digest()
}

export function resolveWorldName(ctx) {
  return ctx.currentWorldDef?.name || ctx.worldName || envWorldName(ctx.env) || null
}

export function buildWorldSnapshot(appRuntime, physics, worldName, savedAt, worldDef = null) {
  const game = appRuntime.snapshotGameState({ includeStatic: true })
  const entities = []
  for (const [id, s] of game.entities) {
    const e = appRuntime.entities.get(id)
    const bodyId = e && e._physicsBodyId !== undefined ? e._physicsBodyId : undefined
    let body = null
    if (bodyId !== undefined && physics && typeof physics.getBodyVelocity === 'function') {
      if (e.bodyType !== 'static') {
        body = {
          position: physics.getBodyPosition(bodyId),
          rotation: physics.getBodyRotation(bodyId),
          velocity: physics.getBodyVelocity(bodyId),
          angularVelocity: physics.getBodyAngularVelocity ? physics.getBodyAngularVelocity(bodyId) : [0, 0, 0],
        }
      }
    }
    entities.push({ id, ...s, body })
  }
  return {
    version: WORLD_SNAPSHOT_FORMAT_VERSION,
    world: worldName || null,
    defFingerprint: worldDef ? worldDefFingerprint(worldDef) : null,
    chart: physics?._planetFrame ? snapshotChart(physics._planetFrame) : null,
    tick: game.tick,
    elapsed: game.elapsed,
    savedAt,
    entities,
    respawnTimers: mapToEntries(game.respawnTimers),
    timers: mapToEntries(game.timers).map(([id, list]) => [id, list.map((t) => ({ remaining: t.remaining, repeat: t.repeat, interval: t.interval }))]),
    interactCooldowns: mapToEntries(game.interactCooldowns),
  }
}

export async function saveWorldSnapshot(ctx) {
  const { appRuntime, physics, storage } = ctx
  if (!appRuntime || !storage) return false
  if (typeof ctx.now !== 'function') throw new TypeError('saveWorldSnapshot needs ctx.now, a clock function')
  const log = loggerOf(ctx)
  try {
    await yieldToEventLoop()
    const snap = buildWorldSnapshot(appRuntime, physics, resolveWorldName(ctx), ctx.now(), ctx.currentWorldDef ?? null)
    await storage.set(WORLD_SNAPSHOT_KEY, snap)
    log.log(`${LOG_PREFIX} saved snapshot: tick=${snap.tick} entities=${snap.entities.length}`)
    return true
  } catch (e) {
    log.error(`${LOG_PREFIX} save error:`, e.message)
    return false
  }
}

export async function restoreWorldSnapshot(ctx) {
  const { appRuntime, physics, storage } = ctx
  const log = loggerOf(ctx)
  if (!appRuntime || !storage) return { restored: false, reason: 'no-runtime' }
  let snap
  try {
    snap = await storage.get(WORLD_SNAPSHOT_KEY)
  } catch (e) {
    log.error(`${LOG_PREFIX} load error:`, e.message)
    return { restored: false, reason: 'load-error' }
  }
  if (!snap) return { restored: false, reason: 'no-snapshot' }
  if (snap.version !== WORLD_SNAPSHOT_FORMAT_VERSION) {
    log.warn(`${LOG_PREFIX} snapshot format version mismatch (saved=${snap.version} current=${WORLD_SNAPSHOT_FORMAT_VERSION}) -- discarding, booting clean`)
    return { restored: false, reason: 'version-mismatch' }
  }
  const worldName = resolveWorldName(ctx)
  const legacyUnnamedMatch = snap.world === LEGACY_UNNAMED_WORLD && ctx.config?.worldLocatedByDefault === true
  if (snap.world !== worldName && !legacyUnnamedMatch) {
    log.warn(`${LOG_PREFIX} snapshot world mismatch (saved="${snap.world}" current="${worldName}") -- discarding, booting clean`)
    return { restored: false, reason: 'world-mismatch' }
  }
  if (typeof snap.defFingerprint === 'string' && ctx.currentWorldDef) {
    const current = worldDefFingerprint(ctx.currentWorldDef)
    if (snap.defFingerprint !== current) {
      log.warn(`${LOG_PREFIX} snapshot world definition mismatch (saved=${snap.defFingerprint} current=${current}) -- discarding, booting clean`)
      return { restored: false, reason: 'def-mismatch' }
    }
  }
  const chartPass = chartPassFromSnapshot(snap, physics)
  const entities = new Map()
  const bodyStateByLiveBodyId = new Map()
  let bodiesRestored = 0
  let bodiesSkippedNotFound = 0
  for (const e of snap.entities) {
    const { id, body, ...s } = e
    if (chartPass) reexpressSnapshotEntity(chartPass, s, body)
    entities.set(id, s)
    if (body) {
      const live = appRuntime.entities.get(id)
      const liveBodyId = live && live._physicsBodyId !== undefined ? live._physicsBodyId : undefined
      if (liveBodyId !== undefined) {
        bodyStateByLiveBodyId.set(liveBodyId, body)
        bodiesRestored++
      } else {
        bodiesSkippedNotFound++
      }
    }
  }
  const elapsedFinite = Number.isFinite(snap.elapsed)
  appRuntime.restoreGameState({
    tick: snap.tick,
    elapsed: elapsedFinite ? snap.elapsed : undefined,
    entities,
    respawnTimers: elapsedFinite ? entriesToMap(snap.respawnTimers) : new Map(),
    timers: new Map(),
    interactCooldowns: entriesToMap(snap.interactCooldowns),
  })
  if (physics && typeof physics.restoreBodies === 'function' && bodyStateByLiveBodyId.size) physics.restoreBodies(bodyStateByLiveBodyId)
  log.log(`${LOG_PREFIX} restored snapshot: tick=${snap.tick} entities=${entities.size} bodies=${bodiesRestored}${bodiesSkippedNotFound ? ` (skipped ${bodiesSkippedNotFound}, body not yet created)` : ''}`)
  return { restored: true, tick: snap.tick, entityCount: entities.size, bodiesRestored, bodiesSkippedNotFound }
}
