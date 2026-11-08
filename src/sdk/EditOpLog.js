export const MAX_OPS = 10000
export const PRUNE_HEADROOM = 1000

export function createEditOpLog({ now, onBroadcastError } = {}) {
  if (typeof now !== 'function') throw new TypeError('createEditOpLog requires now, a clock returning milliseconds')
  if (onBroadcastError !== undefined && typeof onBroadcastError !== 'function') throw new TypeError('createEditOpLog onBroadcastError must be a function when given')

  let ops = []
  let seq = 0

  function record(type, payload, editorId, broadcastFn) {
    seq++
    const op = { seq, type, payload, editorId, ts: now() }
    ops.push(op)

    if (ops.length > MAX_OPS) {
      ops = ops.slice(-PRUNE_HEADROOM)
    }

    if (typeof broadcastFn === 'function') {
      try {
        broadcastFn(seq, op)
      } catch (error) {
        if (onBroadcastError) onBroadcastError(error, op)
      }
    }

    return seq
  }

  function getOpsSince(sinceSeq) {
    const since = typeof sinceSeq === 'number' && sinceSeq >= 0 ? sinceSeq : 0
    return { ops: ops.filter(op => op.seq > since), latestSeq: seq }
  }

  function latestSeq() {
    return seq
  }

  function opCount() {
    return ops.length
  }

  function clear() {
    ops = []
    seq = 0
  }

  return { record, getOpsSince, latestSeq, opCount, clear }
}
