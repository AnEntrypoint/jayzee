import { createReexpressPass } from '../../client/chartReexpress.js'

const TRANSFER_METHODS = ['point', 'look']

export function createWorldAnchorMigrator({ ctx, stageLoader }) {
  if (!ctx || typeof ctx !== 'object') throw new TypeError('createWorldAnchorMigrator needs a ctx object')
  if (typeof stageLoader?.allStages !== 'function') throw new TypeError('createWorldAnchorMigrator needs a stageLoader with allStages()')

  return function migrateWorldAnchors(event, pass = createReexpressPass(event?.transfer)) {
    const transfer = event?.transfer
    const missing = TRANSFER_METHODS.filter((name) => typeof transfer?.[name] !== 'function')
    if (missing.length > 0) throw new TypeError(`createWorldAnchorMigrator needs a chart transfer with ${missing.join(', ')}`)

    const counts = { spawnPoints: 0, stageSpawnPoints: 0, rejoinStates: 0 }
    if (Array.isArray(ctx.worldSpawnPoints)) {
      ctx.worldSpawnPoints = ctx.worldSpawnPoints.map((point) => transfer.point(point))
      if (ctx.worldSpawnPoints.length > 0) ctx.worldSpawnPoint = ctx.worldSpawnPoints[0]
      else if (ctx.worldSpawnPoint != null) ctx.worldSpawnPoint = transfer.point(ctx.worldSpawnPoint)
      counts.spawnPoints = ctx.worldSpawnPoints.length
    }
    for (const stage of stageLoader.allStages()) {
      if (!Array.isArray(stage.spawnPoint)) continue
      stage.spawnPoint = transfer.point(stage.spawnPoint)
      counts.stageSpawnPoints++
    }
    const rejoinStates = [...(ctx.pendingRejoinState?.values() ?? [])]
    if (ctx.localRejoinState) rejoinStates.push(ctx.localRejoinState)
    for (const rejoin of rejoinStates) {
      pass.point(rejoin.position)
      if (Array.isArray(rejoin.rotation)) pass.yawRotation(rejoin.rotation)
      counts.rejoinStates++
    }
    return counts
  }
}
