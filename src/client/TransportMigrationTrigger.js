const RTT_POLL_MS = 1000
const BACKOFF_FACTOR = 1.5

export class TransportMigrationTrigger {
  #client
  #connection
  #rttSpikeThresholdMs
  #rttSpikeStreakNeeded
  #baseBackoffMs
  #maxBackoffMs
  #now
  #startInterval
  #stopInterval
  #rttStreak = 0
  #attempts = 0
  #cooldownUntil = 0
  #migrating = false
  #pollHandle = null
  #connectionListener = null
  #started = false
  #lastResult = null

  constructor(client, {
    rttSpikeThresholdMs = 300,
    rttSpikeStreakNeeded = 3,
    baseBackoffMs = 1000,
    maxBackoffMs = 30000,
    connection = null,
    now = () => Date.now(),
    startInterval = (callback, periodMs) => setInterval(callback, periodMs),
    stopInterval = (handle) => clearInterval(handle),
  } = {}) {
    this.#client = client
    this.#connection = connection
    this.#rttSpikeThresholdMs = rttSpikeThresholdMs
    this.#rttSpikeStreakNeeded = rttSpikeStreakNeeded
    this.#baseBackoffMs = baseBackoffMs
    this.#maxBackoffMs = maxBackoffMs
    this.#now = now
    this.#startInterval = startInterval
    this.#stopInterval = stopInterval
  }

  start() {
    if (this.#started) return
    this.#started = true
    if (typeof this.#connection?.addEventListener === 'function') {
      const connection = this.#connection
      this.#connectionListener = () => this.#attemptMigration('connection-change', { effectiveType: connection.effectiveType, type: connection.type })
      connection.addEventListener('change', this.#connectionListener)
    }
    this.#pollHandle = this.#startInterval(() => this.#pollRtt(), RTT_POLL_MS)
  }

  stop() {
    this.#started = false
    if (this.#connectionListener && typeof this.#connection?.removeEventListener === 'function') {
      this.#connection.removeEventListener('change', this.#connectionListener)
    }
    this.#connectionListener = null
    if (this.#pollHandle !== null) {
      this.#stopInterval(this.#pollHandle)
      this.#pollHandle = null
    }
    this.#rttStreak = 0
  }

  #inCooldown() {
    return this.#now() < this.#cooldownUntil
  }

  #pollRtt() {
    const rtt = this.#client.getRTT?.() || 0
    if (rtt <= this.#rttSpikeThresholdMs) {
      this.#rttStreak = 0
      return
    }
    this.#rttStreak++
    if (this.#rttStreak < this.#rttSpikeStreakNeeded) return
    this.#rttStreak = 0
    this.#attemptMigration('rtt-spike', { rtt })
  }

  async #attemptMigration(reason, detail) {
    if (this.#migrating || this.#inCooldown()) return null
    if (typeof this.#client.migrateTransport !== 'function') return null
    if (typeof this.#client.isOpen === 'function' && !this.#client.isOpen()) return null
    this.#migrating = true
    let result = 'failed'
    try {
      result = await this.#client.migrateTransport()
    } catch {
      result = 'failed'
    } finally {
      this.#migrating = false
    }
    this.#lastResult = { reason, detail, result, at: this.#now() }
    if (result === 'migrated') {
      this.#attempts = 0
      this.#cooldownUntil = 0
    } else {
      this.#attempts++
      const delayMs = Math.min(this.#baseBackoffMs * Math.pow(BACKOFF_FACTOR, this.#attempts - 1), this.#maxBackoffMs)
      this.#cooldownUntil = this.#now() + delayMs
    }
    return result
  }

  getStats() {
    return {
      attempts: this.#attempts,
      cooldownUntil: this.#cooldownUntil,
      migrating: this.#migrating,
      lastResult: this.#lastResult,
      rttStreak: this.#rttStreak,
    }
  }
}
