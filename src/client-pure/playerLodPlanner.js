import { createTierScratch, PLAYER_LOD_FULL_COUNT, rankPlayerTiers, TIER_DOT, tierSetsOf } from './playerTierSplit.js'

const TIER_STATES = 4

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

export function createPlayerLodPlanner() {
  let override = null
  let entries = []
  let sets = null
  let serial = 0
  const scratch = createTierScratch()
  const stamped = new Map()
  const fallback = []
  const dots = { mode: 'none', list: null }
  const materialised = () => sets ?? (sets = tierSetsOf(scratch, entries))
  const tiers = {
    get full() { return materialised().full },
    get reduced() { return materialised().reduced },
    get dot() { return materialised().dot },
    get order() { return materialised().order },
    get tierById() { return materialised().tierById },
  }
  const planned = { tiers, dots }
  const dropStale = (stamp, id) => {
    if (Math.floor(stamp / TIER_STATES) !== serial) stamped.delete(id)
  }
  const chooseDots = (serverDots) => {
    if (serverDots && serverDots.length) {
      dots.mode = 'server'
      dots.list = serverDots
      return
    }
    fallback.length = 0
    for (let i = 0; i < scratch.count; i++) {
      if (scratch.tiers[i] === TIER_DOT) fallback.push(entries[i])
    }
    dots.mode = fallback.length > 0 ? 'fallback' : 'none'
    dots.list = fallback.length > 0 ? fallback : null
  }
  return {
    setFullCountOverride(value) {
      override = checkOverride(value)
    },
    plan(remoteEntries, viewerPos, serverDots = null) {
      if (serverDots !== null && serverDots !== undefined && !Array.isArray(serverDots)) throw new TypeError('serverDots must be an array or null')
      rankPlayerTiers(scratch, remoteEntries, viewerPos, override ?? PLAYER_LOD_FULL_COUNT)
      entries = remoteEntries
      sets = null
      serial += 1
      for (let i = 0; i < scratch.count; i++) stamped.set(remoteEntries[i].id, serial * TIER_STATES + scratch.tiers[i])
      if (stamped.size > scratch.count) stamped.forEach(dropStale)
      chooseDots(serverDots ?? null)
      return planned
    },
    tierOf(id) {
      const stamp = stamped.get(id)
      return stamp !== undefined && Math.floor(stamp / TIER_STATES) === serial ? stamp % TIER_STATES : undefined
    },
    getTiers() {
      return tiers
    },
  }
}
