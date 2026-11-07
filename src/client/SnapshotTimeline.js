import { slerpQuat } from './interpolation.js'
import { reexpressPlayerRecord } from './reexpressRecords.js'

const MAX_BUFFERED_SNAPSHOTS = 32
const OFFSET_WINDOW = 90
const JITTER_PERCENTILE = 0.8
const DELAY_INTERVALS = 1.5
const MAX_DELAY_MS = 400
const RESYNC_ERROR_MS = 200
const CONVERGE_PER_S = 4
const MAX_EXTRAPOLATE_MS = 100
const DISPLAY_STALE_MS = 250
const TAU = 2 * Math.PI

const lerp = (a, b, t) => a + (b - a) * t

const lerpAngle = (a, b, t) => {
  let delta = (b - a) % TAU
  if (delta > Math.PI) delta -= TAU
  else if (delta < -Math.PI) delta += TAU
  return a + delta * t
}

const makePlayerOut = () => ({
  id: 0,
  position: [0, 0, 0],
  rotation: [0, 0, 0, 1],
  velocity: [0, 0, 0],
  onGround: false,
  health: 100,
  crouch: 0,
  lookPitch: 0,
  lookYaw: 0,
  expr: 0,
  weapon: 0,
})

const writePlayer = (out, from, to, t, extraSeconds) => {
  out.id = to.id
  for (let i = 0; i < 3; i++) out.position[i] = lerp(from.position[i], to.position[i], t) + to.velocity[i] * extraSeconds
  slerpQuat(out.rotation, from.rotation, to.rotation, t)
  for (let i = 0; i < 3; i++) out.velocity[i] = lerp(from.velocity[i], to.velocity[i], t)
  out.onGround = to.onGround
  out.health = to.health
  out.crouch = to.crouch
  out.expr = to.expr
  out.weapon = to.weapon
  out.lookPitch = lerp(from.lookPitch || 0, to.lookPitch || 0, t)
  out.lookYaw = lerpAngle(from.lookYaw || 0, to.lookYaw || 0, t)
}

export class SnapshotTimeline {
  tickMs
  stats = { extrapolatedSamples: 0, heldSamples: 0, resyncs: 0, samples: 0 }
  #snaps = []
  #offsets = new Float64Array(OFFSET_WINDOW)
  #offsetCount = 0
  #offsetIndex = 0
  #sorted = new Float64Array(OFFSET_WINDOW)
  #baseOffsetMs = 0
  #jitterMs = 0
  #intervalMs = 0
  #renderMs = NaN
  #lastSampleNow = 0
  #out = { tick: 0, renderMs: 0, players: [] }
  #playerPool = []
  #byIdA = new Map()

  constructor({ tickRate = 60 } = {}) {
    this.tickMs = 1000 / tickRate
  }

  setTickRate(rate) {
    if (rate > 0) this.tickMs = 1000 / rate
  }

  #recordOffset(offset) {
    this.#offsets[this.#offsetIndex] = offset
    this.#offsetIndex = (this.#offsetIndex + 1) % OFFSET_WINDOW
    if (this.#offsetCount < OFFSET_WINDOW) this.#offsetCount++
    const count = this.#offsetCount
    const sorted = this.#sorted
    for (let i = 0; i < count; i++) sorted[i] = this.#offsets[i]
    const view = sorted.subarray(0, count).sort()
    this.#baseOffsetMs = view[0]
    this.#jitterMs = view[Math.min(count - 1, Math.ceil(count * JITTER_PERCENTILE) - 1)] - view[0]
  }

  addSnapshot(snapshot, arrivalMs) {
    const tick = snapshot.tick || 0
    const snaps = this.#snaps
    const newest = snaps[snaps.length - 1]
    if (newest && tick <= newest.tick) return false
    if (newest) {
      const gap = (tick - newest.tick) * this.tickMs
      this.#intervalMs = this.#intervalMs ? this.#intervalMs * 0.9 + gap * 0.1 : gap
    }
    this.#recordOffset(arrivalMs - tick * this.tickMs)
    snaps.push({ tick, serverMs: tick * this.tickMs, players: snapshot.players || [] })
    if (snaps.length > MAX_BUFFERED_SNAPSHOTS) snaps.shift()
    return true
  }

  targetDelayMs() {
    const interval = this.#intervalMs || this.tickMs
    return Math.max(this.tickMs, Math.min(MAX_DELAY_MS, DELAY_INTERVALS * interval + this.#jitterMs))
  }

  #advanceRenderTime(now) {
    const desired = now - this.#baseOffsetMs - this.targetDelayMs()
    if (!Number.isFinite(this.#renderMs)) {
      this.#renderMs = desired
      this.#lastSampleNow = now
      return
    }
    const dt = Math.max(0, now - this.#lastSampleNow)
    this.#lastSampleNow = now
    this.#renderMs += dt
    const error = desired - this.#renderMs
    if (Math.abs(error) > RESYNC_ERROR_MS) {
      this.#renderMs = desired
      this.stats.resyncs++
      return
    }
    this.#renderMs += error * Math.min(1, (dt / 1000) * CONVERGE_PER_S)
  }

  sample(now) {
    const out = this.#out
    const snaps = this.#snaps
    if (!snaps.length) {
      out.players.length = 0
      return out
    }
    this.#advanceRenderTime(now)
    this.stats.samples++
    const renderMs = this.#renderMs
    while (snaps.length > 2 && snaps[1].serverMs <= renderMs) snaps.shift()
    let a = snaps[0], b = snaps[snaps.length > 1 ? 1 : 0], t = 0, extraS = 0
    if (snaps.length > 1 && renderMs >= a.serverMs && renderMs <= b.serverMs) {
      t = (renderMs - a.serverMs) / (b.serverMs - a.serverMs || 1)
    } else if (renderMs > b.serverMs) {
      const overrunS = (renderMs - b.serverMs) / 1000
      extraS = Math.min(MAX_EXTRAPOLATE_MS, renderMs - b.serverMs) / 1000
      a = b
      t = 1
      if (extraS < overrunS) this.stats.heldSamples++
      else this.stats.extrapolatedSamples++
    } else {
      b = a
      t = 0
    }
    out.tick = b.tick
    out.renderMs = renderMs
    const byIdA = this.#byIdA, pool = this.#playerPool, dst = out.players
    byIdA.clear()
    for (const player of a.players) byIdA.set(player.id, player)
    dst.length = 0
    for (const playerB of b.players) {
      if (!playerB.position) continue
      const playerA = byIdA.get(playerB.id) || playerB
      while (pool.length <= dst.length) pool.push(makePlayerOut())
      const o = pool[dst.length]
      writePlayer(o, playerA, playerB, playerA === playerB ? 1 : t, extraS)
      dst.push(o)
    }
    return out
  }

  displayedTick(now) {
    if (!Number.isFinite(this.#renderMs) || now - this.#lastSampleNow > DISPLAY_STALE_MS) return null
    return this.#renderMs / this.tickMs
  }

  applyChartTransfer(pass) {
    for (const snap of this.#snaps) {
      for (const player of snap.players) reexpressPlayerRecord(pass, player)
    }
  }

  resync() {
    this.#renderMs = NaN
  }

  reset() {
    this.#snaps.length = 0
    this.#offsetCount = 0
    this.#offsetIndex = 0
    this.#intervalMs = 0
    this.#renderMs = NaN
  }

  get bufferedAhead() {
    let ahead = 0
    for (const snap of this.#snaps) {
      if (snap.serverMs > this.#renderMs) ahead++
    }
    return ahead
  }

  getStats() {
    return {
      ...this.stats,
      delayMs: this.targetDelayMs(),
      jitterMs: this.#jitterMs,
      intervalMs: this.#intervalMs,
      buffered: this.#snaps.length,
      ahead: this.bufferedAhead,
      renderMs: this.#renderMs,
    }
  }
}
