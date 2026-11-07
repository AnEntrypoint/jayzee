const SUM_KEYS = ['candidates', 'queriedThisFrame', 'resolved', 'occluded', 'failOpens', 'anomalyTrips', 'flips']
const MAX_KEYS = ['oldestPendingFrames']

export function createCullingHub() {
  const systems = new Map()

  function register(name, getStats) { systems.set(name, getStats) }

  function unregister(name) { systems.delete(name) }

  function aggregate() {
    const per = {}
    const totals = {}
    for (const k of SUM_KEYS) totals[k] = 0
    for (const k of MAX_KEYS) totals[k] = 0
    for (const [name, get] of systems) {
      let s
      try { s = get() } catch (e) { s = { error: e.message } }
      per[name] = s || null
      if (!s) continue
      for (const k of SUM_KEYS) if (Number.isFinite(s[k])) totals[k] += s[k]
      for (const k of MAX_KEYS) if (Number.isFinite(s[k]) && s[k] > totals[k]) totals[k] = s[k]
    }
    return { systems: per, totals }
  }

  return { register, unregister, aggregate }
}
