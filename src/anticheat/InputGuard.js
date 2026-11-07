const INPUT_BUCKET_CAPACITY = 120
const INPUT_BUCKET_REFILL_PER_SEC = 90
const inputBuckets = new Map()

const requireTime = (nowMs) => {
  if (!Number.isFinite(nowMs)) throw new TypeError('[InputGuard] nowMs must be a finite number of milliseconds')
}

export function isInputRateLimited(clientId, nowMs) {
  requireTime(nowMs)
  let bucket = inputBuckets.get(clientId)
  if (!bucket) {
    bucket = { tokens: INPUT_BUCKET_CAPACITY, lastRefillMs: nowMs, droppedSinceLog: 0, totalDropped: 0 }
    inputBuckets.set(clientId, bucket)
  }
  const elapsedSec = (nowMs - bucket.lastRefillMs) / 1000
  if (elapsedSec > 0) {
    bucket.tokens = Math.min(INPUT_BUCKET_CAPACITY, bucket.tokens + elapsedSec * INPUT_BUCKET_REFILL_PER_SEC)
    bucket.lastRefillMs = nowMs
  }
  if (bucket.tokens < 1) {
    bucket.droppedSinceLog++
    bucket.totalDropped++
    return true
  }
  bucket.tokens -= 1
  return false
}

export function clearInputBucket(clientId) {
  inputBuckets.delete(clientId)
}

const NUMERIC_INPUT_FIELDS = ['yaw', 'pitch', 'analogForward', 'analogRight']
const MAX_ABS_ANGLE = 1e6

export function sanitizeInputPayload(input) {
  if (!input || typeof input !== 'object') return input
  for (const field of NUMERIC_INPUT_FIELDS) {
    const value = input[field]
    if (value === undefined) continue
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > MAX_ABS_ANGLE) input[field] = 0
  }
  return input
}

const ENVELOPE_HEADROOM_MULT = 3
const ENVELOPE_MIN_CAP = 20

export function envelopeSpeedCap(movement) {
  const candidates = [movement?.maxSpeed, movement?.sprintSpeed, movement?.airSpeedCap, movement?.slideMinSpeed]
    .filter(v => typeof v === 'number' && Number.isFinite(v) && v > 0)
  const base = candidates.length ? Math.max(...candidates) : ENVELOPE_MIN_CAP
  return Math.max(ENVELOPE_MIN_CAP, base * ENVELOPE_HEADROOM_MULT)
}

export function enforceMovementEnvelope(state, movement) {
  const velocity = state.velocity
  if (!velocity || !Number.isFinite(velocity[0]) || !Number.isFinite(velocity[1]) || !Number.isFinite(velocity[2])) return false
  const speed = Math.sqrt(velocity[0] * velocity[0] + velocity[1] * velocity[1] + velocity[2] * velocity[2])
  const cap = envelopeSpeedCap(movement)
  if (speed <= cap) return false
  const scale = cap / speed
  velocity[0] *= scale
  velocity[1] *= scale
  velocity[2] *= scale
  return true
}
