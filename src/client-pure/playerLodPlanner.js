import { classifyPlayerTiers, PLAYER_LOD_FULL_COUNT } from './playerTierSplit.js'

const refuse = (message) => {
  throw new RangeError(message)
}

const checkOverride = (value) => {
  if (value === null || value === undefined) return null
  if (!Number.isInteger(value) || value < 0) refuse('the full count override must be a whole number of at least 0, or null to clear it')
  return value
}

export function chooseDotSource(serverDots, remoteEntries, tiers) {
  if (serverDots && serverDots.length) return { mode: 'server', list: serverDots }
  if (tiers.dot.size > 0) return { mode: 'fallback', list: remoteEntries.filter((e) => tiers.dot.has(e.id)) }
  return { mode: 'none', list: null }
}

const emptyTiers = () => ({ full: new Set(), reduced: new Set(), dot: new Set(), order: [], tierById: new Map() })

export function createPlayerLodPlanner() {
  let override = null
  let tiers = emptyTiers()
  return {
    setFullCountOverride(value) {
      override = checkOverride(value)
    },
    plan(remoteEntries, viewerPos, serverDots = null) {
      if (serverDots !== null && serverDots !== undefined && !Array.isArray(serverDots)) throw new TypeError('serverDots must be an array or null')
      tiers = classifyPlayerTiers(remoteEntries, viewerPos, override ?? PLAYER_LOD_FULL_COUNT)
      return { tiers, dots: chooseDotSource(serverDots ?? null, remoteEntries, tiers) }
    },
    getTiers() {
      return tiers
    },
  }
}
