import {
  DEFAULT_TICK_RATE_HZ,
  SNAP_COST_EMA_ALPHA,
  SNAP_COST_HIGH_FRAC,
  SNAP_COST_LOW_FRAC,
  SNAP_RATE_ADJUST_INTERVAL,
  SNAP_RATE_MIN_HZ,
  SNAP_STALL_ENTER,
  SNAP_STALL_EMA_ALPHA,
  SNAP_STALL_EXIT,
  SNAP_STALL_MAX_INTERVAL,
} from './constants.js'

export function createSnapshotRateController({ tickRate = DEFAULT_TICK_RATE_HZ, getNetcodeConfig = () => undefined } = {}) {
  let snapshotInterval = 1
  let snapRateAdjustTick = 0
  let lastSnapRate = tickRate
  let snapCostEmaMs = 0
  let stallEma = 0
  let stallInterval = 1

  const configuredHz = () => {
    const hz = getNetcodeConfig()?.snapshotRate
    return Number.isFinite(hz) && hz > 0 ? Math.min(tickRate, hz) : tickRate
  }

  const updateStall = (players) => {
    if (getNetcodeConfig()?.adaptiveSnapshotRate === false) {
      stallEma = 0
      stallInterval = 1
      return
    }
    if (!players.length) return
    let starved = 0
    for (const player of players) if ((player.starvedTicks || 0) > 0) starved++
    stallEma += (starved / players.length - stallEma) * SNAP_STALL_EMA_ALPHA
    if (stallEma > SNAP_STALL_ENTER) stallInterval = Math.min(SNAP_STALL_MAX_INTERVAL, stallInterval + 1)
    else if (stallEma < SNAP_STALL_EXIT) stallInterval = Math.max(1, stallInterval - 1)
  }

  const computeInterval = () => {
    let targetHz = configuredHz()
    const tickBudgetMs = 1000 / tickRate
    if (snapCostEmaMs > tickBudgetMs * SNAP_COST_HIGH_FRAC) targetHz = targetHz * 0.5
    else if (snapCostEmaMs > tickBudgetMs * SNAP_COST_LOW_FRAC) targetHz = targetHz * 0.75
    const base = Math.max(1, Math.round(tickRate / Math.max(SNAP_RATE_MIN_HZ, targetHz)))
    const maxInterval = Math.max(1, Math.round(tickRate / SNAP_RATE_MIN_HZ))
    return Math.min(maxInterval, Math.max(1, base * stallInterval))
  }

  const recordSnapshotCost = (ms) => {
    snapCostEmaMs = snapCostEmaMs === 0 ? ms : (snapCostEmaMs * (1 - SNAP_COST_EMA_ALPHA) + ms * SNAP_COST_EMA_ALPHA)
  }

  const beginTick = (tick, players, connected = true) => {
    updateStall(players)
    if (tick - snapRateAdjustTick < SNAP_RATE_ADJUST_INTERVAL) return null
    snapRateAdjustTick = tick
    snapshotInterval = computeInterval()
    if (players.length === 0 || !connected) return null
    lastSnapRate = Math.round(tickRate / snapshotInterval)
    return { rate: lastSnapRate, tick, interval: snapshotInterval }
  }

  return {
    beginTick,
    recordSnapshotCost,
    updateStall,
    computeInterval,
    configuredHz,
    get interval() {
      return snapshotInterval
    },
    get rate() {
      return lastSnapRate
    },
  }
}
