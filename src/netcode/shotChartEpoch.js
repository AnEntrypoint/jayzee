import { DEFAULT_HITBOX, normalizeShotDirection, resolveFireRequest } from './hitscan.js'

export const SHOT_EPOCH_REFUSAL = Object.freeze({
  EPOCH_SHAPE: 'shot_chart_epoch_not_integer',
  AHEAD: 'shot_chart_epoch_ahead',
  NOT_RETAINED: 'shot_chart_epoch_not_retained',
  DIRECTION: 'shot_direction_invalid',
})

const LEDGER_METHODS = ['chartAt', 'transferToCurrent']

const isVec3 = (v) => Array.isArray(v) && v.length === 3 && Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2])

export function createShotEpochResolver({ ledger, lagComp = null, hitbox = DEFAULT_HITBOX }) {
  const missing = LEDGER_METHODS.filter((name) => typeof ledger?.[name] !== 'function')
  if (missing.length > 0) throw new TypeError('createShotEpochResolver needs a chart epoch ledger with ' + missing.join(', '))
  if (lagComp !== null && typeof lagComp.validateShotOrigin !== 'function') throw new TypeError('createShotEpochResolver needs a LagCompensator or null')

  const stats = { resolved: 0, reexpressed: 0, refused: 0 }
  let cachedFrom = -1
  let cachedTo = -1
  let cachedTransfer = null

  function transferFrom(epoch) {
    const current = ledger.currentEpoch
    if (cachedTransfer !== null && cachedFrom === epoch && cachedTo === current) return cachedTransfer
    try {
      ledger.chartAt(epoch)
    } catch {
      return null
    }
    cachedTransfer = ledger.transferToCurrent(epoch)
    cachedFrom = epoch
    cachedTo = current
    return cachedTransfer
  }

  function refuse(reason, msgEpoch) {
    stats.refused++
    return { ok: false, reason, chartEpoch: ledger.currentEpoch, shotEpoch: msgEpoch }
  }

  function reexpress(msg) {
    const current = ledger.currentEpoch
    const stamped = msg?.chartEpoch
    const epoch = stamped === undefined || stamped === null ? current : stamped
    if (!Number.isInteger(epoch)) return refuse(SHOT_EPOCH_REFUSAL.EPOCH_SHAPE, stamped)
    if (epoch > current) return refuse(SHOT_EPOCH_REFUSAL.AHEAD, epoch)
    const unit = normalizeShotDirection(msg.direction)
    if (!unit) return refuse(SHOT_EPOCH_REFUSAL.DIRECTION, epoch)
    const origin = isVec3(msg.origin) ? [msg.origin[0], msg.origin[1], msg.origin[2]] : null
    if (epoch === current) return { ok: true, origin, direction: unit, viewTick: msg.viewTick, chartEpoch: current, shotEpoch: epoch, reexpressed: false }
    const transfer = transferFrom(epoch)
    if (transfer === null) return refuse(SHOT_EPOCH_REFUSAL.NOT_RETAINED, epoch)
    if (origin !== null) transfer.point(origin, origin)
    transfer.vec(unit, unit)
    stats.reexpressed++
    return { ok: true, origin, direction: unit, viewTick: msg.viewTick, chartEpoch: current, shotEpoch: epoch, reexpressed: true }
  }

  function resolve(shooterId, shooterPosition, msg) {
    const shot = reexpress(msg)
    if (!shot.ok) return shot
    const fire = resolveFireRequest(lagComp, shooterId, shooterPosition, shot, hitbox)
    stats.resolved++
    return { ok: true, origin: fire.origin, direction: shot.direction, viewTick: fire.viewTick, chartEpoch: shot.chartEpoch, shotEpoch: shot.shotEpoch, reexpressed: shot.reexpressed }
  }

  return {
    reexpress,
    resolve,
    getStats() { return { ...stats } },
  }
}
