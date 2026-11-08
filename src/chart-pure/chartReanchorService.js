import { createChartAnchorLattice, reanchorChartFor, CHART_ANCHORS_PER_FACE } from './chartAnchor.js'
import { chartAnchorDecision, CHART_REANCHOR_HYSTERESIS_DEG } from './chartReanchorPolicy.js'

const ignoreWarning = () => {}

export class ChartReanchorNoMigratorError extends Error {
  constructor() {
    super('chart reanchor stepped with no registered state migrator: rotating the frame alone would leave every chart-local position, collider and client on the old chart')
    this.name = 'ChartReanchorNoMigratorError'
  }
}

export function createChartReanchorService({ frame, radius, playerDirs, anchorsPerFace = CHART_ANCHORS_PER_FACE, hysteresisDeg = CHART_REANCHOR_HYSTERESIS_DEG, warn = ignoreWarning }) {
  const lattice = createChartAnchorLattice(radius, anchorsPerFace)
  const migrators = []
  const terrainMigrators = []
  let reanchorCount = 0, refusalCount = 0, lastRefusal = null
  const refusalTally = new Map()
  const tally = reason => refusalTally.set(reason, (refusalTally.get(reason) || 0) + 1)

  function onReanchor(migrate) {
    migrators.push(migrate)
    return () => { const i = migrators.indexOf(migrate); if (i >= 0) migrators.splice(i, 1) }
  }

  function addTerrainMigrator(terrainMigrator) {
    terrainMigrators.push(terrainMigrator)
    return () => { const i = terrainMigrators.indexOf(terrainMigrator); if (i >= 0) terrainMigrators.splice(i, 1) }
  }

  function refusalOf(decision) {
    for (const { gate } of terrainMigrators) {
      const reason = gate({ decision, epoch: frame.chartEpoch })
      if (reason) return reason
    }
    return null
  }

  function step(dirs = playerDirs()) {
    if (!migrators.length) throw new ChartReanchorNoMigratorError()
    const decision = chartAnchorDecision({ lattice, frame, dirs, hysteresisDeg })
    if (decision.kind === 'refusal') {
      refusalCount++
      tally(decision.reason)
      const detail = decision.reason === 'party-spread-exceeds-walkable-chart'
        ? ` (worst player ${decision.worstPlayerAngleDeg.toFixed(2)} deg from the anchor, walkable limit ${decision.walkableLimitDeg.toFixed(2)} deg)`
        : ''
      if (lastRefusal?.reason !== decision.reason) warn(`[chart-reanchor] refusing to re-anchor: ${decision.reason}${detail}; players this far apart need per-cluster charts`)
      lastRefusal = { reason: decision.reason, decision, epoch: frame.chartEpoch }
      return null
    }
    if (decision.kind === 'stay') return null
    const reason = refusalOf(decision)
    if (reason) {
      refusalCount++
      tally(reason)
      lastRefusal = { reason, decision, epoch: frame.chartEpoch }
      return null
    }
    const shift = reanchorChartFor({ frame, lattice, dir: decision.centroidDir, cellTrigger: true })
    if (!shift) return null
    reanchorCount++
    const event = { ...shift, decision, epoch: frame.chartEpoch }
    for (const { migrate } of terrainMigrators) migrate(event)
    for (const migrate of migrators) migrate(event)
    return event
  }

  return {
    lattice, onReanchor, addTerrainMigrator, step,
    get reanchorCount() { return reanchorCount },
    get migratorCount() { return migrators.length },
    get refusalCount() { return refusalCount },
    get lastRefusal() { return lastRefusal },
    get refusalsByReason() { return Object.fromEntries(refusalTally) },
  }
}
