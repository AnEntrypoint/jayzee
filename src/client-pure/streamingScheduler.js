const MIN_SCREEN_SIZE = 0.01
const OUT_OF_FRUSTUM_PENALTY = 8
const DEFAULT_BUDGET_MS = 2
const DEFAULT_MAX_STARTS_PER_DRAIN = 32
const DISPATCH_LOG_CAP = 256

export function scoreRequest(features = {}) {
  const distance = Number.isFinite(features.distance) && features.distance >= 0 ? features.distance : Infinity
  const screenSize = Number.isFinite(features.screenSize) && features.screenSize > 0 ? features.screenSize : 1
  const inFrustum = features.inFrustum !== false
  const gameplayBoost = Number.isFinite(features.gameplayBoost) ? Math.min(1, Math.max(0, features.gameplayBoost)) : 0

  let score = distance / Math.max(screenSize, MIN_SCREEN_SIZE)
  if (!inFrustum) score *= OUT_OF_FRUSTUM_PENALTY
  score = score * (1 - gameplayBoost)
  return score
}

function less(a, b) { return a.score !== b.score ? a.score < b.score : a.seq < b.seq }

function swap(a, i, j) {
  const t = a[i]
  a[i] = a[j]
  a[j] = t
}

class MinHeap {
  constructor() { this.items = [] }
  get size() { return this.items.length }
  push(item) {
    const a = this.items
    a.push(item)
    this.siftUp(a.length - 1)
  }
  pop() {
    const a = this.items
    if (a.length === 0) return undefined
    const top = a[0]
    const last = a.pop()
    if (a.length > 0) {
      a[0] = last
      this.siftDown(0)
    }
    return top
  }
  removeById(id) {
    const a = this.items
    const idx = a.findIndex(it => it.id === id)
    if (idx === -1) return false
    const last = a.pop()
    if (idx < a.length) {
      a[idx] = last
      this.siftDown(this.siftUp(idx))
    }
    return true
  }
  siftUp(start) {
    const a = this.items
    let i = start
    while (i > 0) {
      const p = (i - 1) >> 1
      if (less(a[i], a[p])) {
        swap(a, i, p)
        i = p
      } else break
    }
    return i
  }
  siftDown(start) {
    const a = this.items
    let i = start
    for (;;) {
      const l = i * 2 + 1, r = l + 1
      let smallest = i
      if (l < a.length && less(a[l], a[smallest])) smallest = l
      if (r < a.length && less(a[r], a[smallest])) smallest = r
      if (smallest === i) break
      swap(a, i, smallest)
      i = smallest
    }
  }
}

export function createStreamingScheduler(opts = {}) {
  const budgetMs = Number.isFinite(opts.budgetMs) && opts.budgetMs > 0 ? opts.budgetMs : DEFAULT_BUDGET_MS
  const maxStartsPerDrain = Number.isFinite(opts.maxStartsPerDrain) && opts.maxStartsPerDrain > 0 ? opts.maxStartsPerDrain : DEFAULT_MAX_STARTS_PER_DRAIN
  const now = typeof opts.now === 'function' ? opts.now : (typeof performance !== 'undefined' ? () => performance.now() : () => Date.now())

  const heap = new MinHeap()
  const byId = new Map()
  let seq = 0
  const kindStats = new Map()
  const dispatchLog = []

  function statsFor(kind) {
    let s = kindStats.get(kind)
    if (!s) {
      s = { enqueued: 0, dispatched: 0, cancelled: 0 }
      kindStats.set(kind, s)
    }
    return s
  }

  function enqueue({ id, kind = 'unknown', features = {}, run, cancel } = {}) {
    if (!id || typeof run !== 'function') return false
    const score = scoreRequest(features)
    const existing = byId.get(id)
    if (existing) {
      heap.removeById(id)
      existing.score = score
      existing.kind = kind
      existing.run = run
      existing.cancel = cancel
      existing.seq = seq++
      heap.push(existing)
      return true
    }
    const rec = { id, kind, score, run, cancel, seq: seq++ }
    byId.set(id, rec)
    heap.push(rec)
    statsFor(kind).enqueued++
    return true
  }

  function cancelRequest(id) {
    const rec = byId.get(id)
    if (!rec) return false
    heap.removeById(id)
    byId.delete(id)
    statsFor(rec.kind).cancelled++
    if (typeof rec.cancel === 'function') {
      try { rec.cancel() } catch (_) {}
    }
    return true
  }

  function drain() {
    const deadline = now() + budgetMs
    const dispatched = []
    let starts = 0
    while (starts < maxStartsPerDrain && heap.size > 0 && now() < deadline) {
      const rec = heap.pop()
      byId.delete(rec.id)
      statsFor(rec.kind).dispatched++
      starts++
      const entry = { id: rec.id, kind: rec.kind, score: rec.score, dispatchedAtMs: now() }
      dispatched.push(entry)
      dispatchLog.push(entry)
      if (dispatchLog.length > DISPATCH_LOG_CAP) dispatchLog.shift()
      try { rec.run() } catch (_) {}
    }
    return dispatched
  }

  function getStats() {
    const perKind = {}
    for (const [kind, s] of kindStats) perKind[kind] = { ...s }
    return { queued: heap.size, budgetMs, maxStartsPerDrain, kinds: perKind }
  }

  return {
    enqueue,
    cancel: cancelRequest,
    has: id => byId.has(id),
    size: () => heap.size,
    drain,
    getStats,
    getDispatchLog: () => dispatchLog.slice(),
    scoreRequest,
  }
}
