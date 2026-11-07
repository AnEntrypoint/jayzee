import { createSeededRandom } from './seededRandom.js'

export const SIM_MAX_DELAY_MS = 2147483647

export const SIM_PROFILE_RANGES = Object.freeze({
  lossPct: [0, 100],
  latencyMs: [0, SIM_MAX_DELAY_MS],
  jitterMs: [0, SIM_MAX_DELAY_MS],
  reorderPct: [0, 100]
})

export const SIM_PROFILE_KEYS = Object.freeze(Object.keys(SIM_PROFILE_RANGES))

export const SIM_PROFILE_BASE = Object.freeze({ lossPct: 0, latencyMs: 0, jitterMs: 0, reorderPct: 0 })

export const NETWORK_SIM_PRESETS = Object.freeze({
  clean: { lossPct: 0, latencyMs: 0, jitterMs: 0, reorderPct: 0 },
  broadbandGood: { lossPct: 0, latencyMs: 20, jitterMs: 5, reorderPct: 0 },
  wifiTypical: { lossPct: 0.5, latencyMs: 40, jitterMs: 15, reorderPct: 0.5 },
  cellular4g: { lossPct: 1, latencyMs: 60, jitterMs: 30, reorderPct: 1 },
  roadmapTarget: { lossPct: 3, latencyMs: 150, jitterMs: 20, reorderPct: 2 },
  degradedWan: { lossPct: 5, latencyMs: 200, jitterMs: 60, reorderPct: 5 },
  brutal: { lossPct: 10, latencyMs: 300, jitterMs: 100, reorderPct: 10 }
})

const describeValue = (value) => (typeof value === 'string' ? JSON.stringify(value) : String(value))

export const normalizeSimProfile = (partial, label = 'profile') => {
  if (partial === null || typeof partial !== 'object') {
    throw new TypeError(`[network-sim] ${label}: profile must be an object, got ${describeValue(partial)}`)
  }
  for (const key of Object.keys(partial)) {
    if (!Object.hasOwn(SIM_PROFILE_RANGES, key)) {
      throw new TypeError(`[network-sim] ${label}: unknown profile field "${key}", expected one of ${SIM_PROFILE_KEYS.join(', ')}`)
    }
  }
  const profile = { ...SIM_PROFILE_BASE, ...partial }
  for (const key of SIM_PROFILE_KEYS) {
    const [low, high] = SIM_PROFILE_RANGES[key]
    const value = profile[key]
    if (typeof value !== 'number' || !Number.isFinite(value) || value < low || value > high) {
      throw new TypeError(`[network-sim] ${label}: ${key} must be a finite number in [${low}, ${high}], got ${describeValue(value)}`)
    }
  }
  if (profile.latencyMs + profile.jitterMs > SIM_MAX_DELAY_MS) {
    throw new TypeError(`[network-sim] ${label}: latencyMs + jitterMs must be <= ${SIM_MAX_DELAY_MS}, got ${profile.latencyMs + profile.jitterMs}`)
  }
  return Object.freeze(profile)
}

const byDeliveryOrder = (a, b) => a.deliverAt - b.deliverAt || a.order - b.order

const swapPayloads = (earlier, later) => {
  const { index, payload, sentAt } = earlier
  earlier.index = later.index
  earlier.payload = later.payload
  earlier.sentAt = later.sentAt
  later.index = index
  later.payload = payload
  later.sentAt = sentAt
}

export const createSimLink = ({ seed = 1, profile: partial = {} } = {}) => {
  const random = createSeededRandom(seed)
  let profile = normalizeSimProfile(partial, 'createSimLink')
  let open = true
  let sendCount = 0
  let scheduleCount = 0
  let lastDeliveredIndex = 0
  const inFlight = []
  const ready = []
  const stats = { sent: 0, dropped: 0, delivered: 0, reordered: 0 }

  const drawDelay = () => {
    const jitter = profile.jitterMs > 0 ? (random() * 2 - 1) * profile.jitterMs : 0
    return Math.max(0, profile.latencyMs + jitter)
  }

  const settle = (now) => {
    const due = inFlight.filter((entry) => entry.deliverAt <= now).sort(byDeliveryOrder)
    for (const entry of due) {
      inFlight.splice(inFlight.indexOf(entry), 1)
      ready.push(entry)
    }
  }

  const takeReady = () => ready.splice(0).map((entry) => {
    if (entry.index < lastDeliveredIndex) stats.reordered++
    if (entry.index > lastDeliveredIndex) lastDeliveredIndex = entry.index
    stats.delivered++
    return { index: entry.index, payload: entry.payload, sentAt: entry.sentAt, deliveredAt: entry.deliverAt }
  })

  const send = (payload, now) => {
    if (!open) return false
    settle(now)
    stats.sent++
    const index = ++sendCount
    if (profile.lossPct > 0 && random() * 100 < profile.lossPct) {
      stats.dropped++
      return true
    }
    const entry = { index, payload, sentAt: now, deliverAt: now + drawDelay(), order: ++scheduleCount }
    inFlight.push(entry)
    if (profile.reorderPct > 0 && inFlight.length >= 2 && random() * 100 < profile.reorderPct) {
      swapPayloads(inFlight[inFlight.length - 2], entry)
    }
    return true
  }

  const advance = (now) => {
    settle(now)
    return takeReady()
  }

  const configure = (partial) => {
    profile = normalizeSimProfile({ ...profile, ...partial }, 'configure')
  }

  const close = () => {
    open = false
    inFlight.length = 0
    ready.length = 0
  }

  return {
    send,
    advance,
    configure,
    close,
    isOpen: () => open,
    getProfile: () => ({ ...profile }),
    getStats: () => ({ ...stats })
  }
}
