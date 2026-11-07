const CAP = 20
const BATCH_WINDOW_MS = 50
const TRANSPORT_OPS = 'ops'
const TRANSPORT_SEND = 'send'

let seq = 0

function transportOf(record) {
  if (!record || typeof record !== 'object') return null
  const hasUndo = typeof record.undoOp === 'function'
  const hasRedo = typeof record.redoOp === 'function'
  if (hasUndo !== hasRedo) return null
  return hasUndo ? TRANSPORT_OPS : TRANSPORT_SEND
}

function describeRecord(r) {
  if (r.desc) return r.desc
  const after = r.after || {}
  const keys = Object.keys(after)
  if (keys.length === 1 && keys[0] === 'custom' && after.custom && typeof after.custom === 'object') {
    const ck = Object.keys(after.custom)
    return ck.length ? 'custom.' + ck.join(',') : 'custom'
  }
  return keys.length ? keys.join(',') : (r.kind || 'change')
}

function describeGroup(group) {
  const ids = [...new Set(group.map(r => r.entityId))]
  if (ids.length === 1) return ids[0] + ' ' + describeRecord(group[0])
  return ids.length + ' entities ' + describeRecord(group[0])
}

export function createEditHistory({ send, onToast, onChange, onPush, now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()), wallClock = () => Date.now() } = {}) {
  const undoStack = []
  const redoStack = []
  let lastPushAt = null
  const toast = msg => { try { onToast && onToast(msg) } catch (_) {} }
  const notify = () => { try { onChange && onChange() } catch (_) {} }

  function apply(r, direction) {
    if (r.transport === TRANSPORT_OPS) (direction === 'undo' ? r.undoOp : r.redoOp)(r)
    else send(r.entityId, direction === 'undo' ? r.before : r.after)
  }

  function undo() {
    const entry = undoStack.pop()
    if (!entry) return false
    lastPushAt = null
    redoStack.push(entry)
    for (let i = entry.records.length - 1; i >= 0; i--) apply(entry.records[i], 'undo')
    toast('Undid: ' + entry.name)
    notify()
    return true
  }

  function redo() {
    const entry = redoStack.pop()
    if (!entry) return false
    lastPushAt = null
    undoStack.push(entry)
    for (const r of entry.records) apply(r, 'redo')
    toast('Redid: ' + entry.name)
    notify()
    return true
  }

  function push(record) {
    const transport = transportOf(record)
    if (transport === null) {
      toast('Refused history record: undoOp and redoOp are either both functions or both absent')
      return false
    }
    record.transport = transport
    const t = now()
    const top = undoStack[undoStack.length - 1]
    if (top && lastPushAt !== null && (t - lastPushAt) <= BATCH_WINDOW_MS) {
      top.records.push(record)
      top.name = describeGroup(top.records)
    } else {
      const entry = { txnId: ++seq, records: [record], name: describeGroup([record]), at: wallClock() }
      undoStack.push(entry)
      if (undoStack.length > CAP) undoStack.shift()
      try { onPush && onPush(entry) } catch (_) {}
    }
    lastPushAt = t
    redoStack.length = 0
    notify()
    return true
  }

  function list() {
    const done = undoStack.map((e, i) => ({ txnId: e.txnId, name: e.name, at: e.at, count: e.records.length, state: 'done', depth: undoStack.length - 1 - i }))
    const undone = redoStack.map((e, i) => ({ txnId: e.txnId, name: e.name, at: e.at, count: e.records.length, state: 'undone', depth: redoStack.length - 1 - i }))
    return [...undone.slice().reverse(), ...done.slice().reverse()]
  }

  function jumpTo(txnId) {
    const undoIdx = undoStack.findIndex(e => e.txnId === txnId)
    if (undoIdx !== -1) {
      const stepsBack = undoStack.length - 1 - undoIdx
      for (let i = 0; i < stepsBack; i++) undo()
      return true
    }
    const redoIdx = redoStack.findIndex(e => e.txnId === txnId)
    if (redoIdx !== -1) {
      const stepsForward = redoStack.length - redoIdx
      for (let i = 0; i < stepsForward; i++) redo()
      return true
    }
    return false
  }

  return {
    push,
    undo,
    redo,
    list,
    jumpTo,
    get undoDepth() { return undoStack.length },
    get redoDepth() { return redoStack.length },
  }
}
