const HEADSHOT_WINDOW_SIZE = 20
const HEADSHOT_MIN_SAMPLES = 10
const HEADSHOT_RATIO_THRESHOLD = 0.75
const FAST_STREAK_INTERVAL_MS = 100
const FAST_STREAK_MIN_LENGTH = 4
const FLAG_COOLDOWN_MS = 5000

const shooterWindows = new Map()

const windowFor = (shooterId) => {
  let shooterWindow = shooterWindows.get(shooterId)
  if (!shooterWindow) {
    shooterWindow = { hits: [], lastHeadshotAt: 0, fastStreak: 0, lastFlagAt: 0 }
    shooterWindows.set(shooterId, shooterWindow)
  }
  return shooterWindow
}

const requireTimestamp = (timestampMs) => {
  if (!Number.isFinite(timestampMs)) throw new TypeError('[OutlierDetector] timestampMs must be a finite number of milliseconds')
}

const cooledDown = (shooterWindow, timestampMs) => timestampMs - shooterWindow.lastFlagAt > FLAG_COOLDOWN_MS

export function recordHit(eventLog, shooterId, { headshot, timestampMs, targetId } = {}) {
  if (shooterId == null) return
  requireTimestamp(timestampMs)
  const shooterWindow = windowFor(shooterId)

  shooterWindow.hits.push(!!headshot)
  if (shooterWindow.hits.length > HEADSHOT_WINDOW_SIZE) shooterWindow.hits.shift()
  if (shooterWindow.hits.length >= HEADSHOT_MIN_SAMPLES) {
    const headshotCount = shooterWindow.hits.reduce((count, hit) => count + (hit ? 1 : 0), 0)
    const ratio = headshotCount / shooterWindow.hits.length
    if (ratio >= HEADSHOT_RATIO_THRESHOLD && cooledDown(shooterWindow, timestampMs)) {
      shooterWindow.lastFlagAt = timestampMs
      eventLog?.record('anticheat_outlier', { shooterId, kind: 'high_headshot_ratio', ratio: Math.round(ratio * 1000) / 1000, sampleSize: shooterWindow.hits.length }, { actor: shooterId, reason: 'statistical_outlier' })
    }
  }

  if (headshot) {
    const gap = timestampMs - shooterWindow.lastHeadshotAt
    if (shooterWindow.lastHeadshotAt > 0 && gap < FAST_STREAK_INTERVAL_MS) shooterWindow.fastStreak++
    else shooterWindow.fastStreak = 1
    shooterWindow.lastHeadshotAt = timestampMs
    if (shooterWindow.fastStreak >= FAST_STREAK_MIN_LENGTH && cooledDown(shooterWindow, timestampMs)) {
      shooterWindow.lastFlagAt = timestampMs
      eventLog?.record('anticheat_outlier', { shooterId, kind: 'suspiciously_fast_headshot_streak', streakLength: shooterWindow.fastStreak, intervalMs: gap, targetId: targetId ?? null }, { actor: shooterId, reason: 'statistical_outlier' })
    }
  } else {
    shooterWindow.fastStreak = 0
  }
}

export function clearOutlierWindow(shooterId) {
  shooterWindows.delete(shooterId)
}
