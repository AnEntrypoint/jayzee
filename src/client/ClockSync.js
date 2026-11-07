export class ClockSync {
  #maxSamples
  #driftAlpha
  #minDriftIntervalMs
  #samples = []
  #offset = 0
  #oneWayDelay = 0
  #driftRate = 0
  #lastDriftUpdateTs = 0
  #lastDriftOffset = 0

  constructor({ maxSamples = 8, driftAlpha = 0.05, minDriftIntervalMs = 2000 } = {}) {
    this.#maxSamples = maxSamples
    this.#driftAlpha = driftAlpha
    this.#minDriftIntervalMs = minDriftIntervalMs
  }

  addSample(t0, t2, t3, t1 = t2) {
    if (![t0, t1, t2, t3].every(Number.isFinite)) return false
    const rtt = (t3 - t0) - (t2 - t1)
    if (!(rtt >= 0)) return false
    const offset = ((t1 - t0) + (t2 - t3)) / 2
    this.#samples.push({ t0, t1, t2, t3, rtt, offset, ts: t3 })
    if (this.#samples.length > this.#maxSamples) this.#samples.shift()
    this.#recompute()
    return true
  }

  #recompute() {
    if (this.#samples.length === 0) return
    let best = this.#samples[0]
    for (const sample of this.#samples) {
      if (sample.rtt < best.rtt) best = sample
    }
    this.#offset = best.offset
    this.#oneWayDelay = best.rtt / 2
    if (this.#lastDriftUpdateTs === 0) {
      this.#lastDriftUpdateTs = best.ts
      this.#lastDriftOffset = best.offset
      return
    }
    const elapsed = best.ts - this.#lastDriftUpdateTs
    if (elapsed < this.#minDriftIntervalMs) return
    const instantRate = (best.offset - this.#lastDriftOffset) / elapsed
    this.#driftRate = this.#driftRate * (1 - this.#driftAlpha) + instantRate * this.#driftAlpha
    this.#lastDriftUpdateTs = best.ts
    this.#lastDriftOffset = best.offset
  }

  getEstimatedServerTime(localNow) {
    const sinceLastSample = this.#lastDriftUpdateTs ? localNow - this.#lastDriftUpdateTs : 0
    return localNow + this.#offset + this.#driftRate * sinceLastSample
  }

  getOffset() {
    return this.#offset
  }

  getOneWayDelay() {
    return this.#oneWayDelay
  }

  getDriftRate() {
    return this.#driftRate
  }

  getSampleCount() {
    return this.#samples.length
  }

  estimateAgeMs(clientSendTime, localNow) {
    if (!Number.isFinite(clientSendTime)) return 0
    const serverNow = this.getEstimatedServerTime(localNow)
    const serverSendTime = clientSendTime + this.#offset
    const age = serverNow - serverSendTime
    if (!Number.isFinite(age) || age < 0) return this.#oneWayDelay
    return age
  }

  reset() {
    this.#samples.length = 0
    this.#offset = 0
    this.#oneWayDelay = 0
    this.#driftRate = 0
    this.#lastDriftUpdateTs = 0
    this.#lastDriftOffset = 0
  }
}
