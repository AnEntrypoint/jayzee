function clampMagnitude(value, limit) {
  if (!Number.isFinite(limit)) return value
  return value > limit ? limit : value < -limit ? -limit : value
}

export const NEUTRAL_BUFF = 1

export function createBuffStack(spec = {}) {
  if (spec !== null && typeof spec !== 'object') throw new TypeError('[buffs] spec must be an object')
  const maxStack = Number.isFinite(spec.maxStack) ? spec.maxStack : Infinity
  const decayPerSec = Number.isFinite(spec.decayPerSec) ? spec.decayPerSec : 0
  const decayTarget = Number.isFinite(spec.decayTarget) ? spec.decayTarget : NEUTRAL_BUFF
  const buffsByPlayer = new Map()

  function buffsFor(playerId, create) {
    let buffs = buffsByPlayer.get(playerId)
    if (!buffs && create) {
      buffs = new Map()
      buffsByPlayer.set(playerId, buffs)
    }
    return buffs
  }

  return {
    apply(playerId, buffKey, delta) {
      if (playerId == null || !buffKey) return NEUTRAL_BUFF
      const buffs = buffsFor(playerId, true)
      const current = buffs.has(buffKey) ? buffs.get(buffKey) : NEUTRAL_BUFF
      const next = clampMagnitude(current + delta, maxStack)
      buffs.set(buffKey, next)
      return next
    },
    set(playerId, buffKey, value) {
      if (playerId == null || !buffKey) return NEUTRAL_BUFF
      const buffs = buffsFor(playerId, true)
      const next = clampMagnitude(value, maxStack)
      buffs.set(buffKey, next)
      return next
    },
    get(playerId, buffKey) {
      const buffs = buffsFor(playerId, false)
      if (!buffs || !buffs.has(buffKey)) return NEUTRAL_BUFF
      return buffs.get(buffKey)
    },
    getAll(playerId) {
      const buffs = buffsFor(playerId, false)
      if (!buffs) return {}
      return Object.fromEntries(buffs)
    },
    clear(playerId, buffKey) {
      const buffs = buffsFor(playerId, false)
      if (!buffs) return
      if (buffKey) buffs.delete(buffKey)
      else buffs.clear()
    },
    clearAll() {
      buffsByPlayer.clear()
    },
    tick(dt) {
      if (decayPerSec <= 0) return
      const step = decayPerSec * dt
      for (const buffs of buffsByPlayer.values()) {
        for (const [key, value] of buffs) {
          if (value > decayTarget) buffs.set(key, Math.max(decayTarget, value - step))
          else if (value < decayTarget) buffs.set(key, Math.min(decayTarget, value + step))
        }
      }
    }
  }
}

export default createBuffStack
