export const CONSENSUS_CTRL_PREFIX = 'wwconsensus:'
export const ROLLBACK_CTRL_PREFIX = 'wwrollback:'
export const LOCKSTEP_CTRL_PREFIX = 'wwlockstep:'

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value)
const isTruthy = (value) => !!value
const isInteger = (value) => Number.isInteger(value)
const isPositiveInteger = (value) => Number.isInteger(value) && value >= 1
const isText = (value) => typeof value === 'string'
const isList = (value) => Array.isArray(value)

const FRAME_CONTRACTS = new Map([
  [CONSENSUS_CTRL_PREFIX, new Map([
    ['checksum', new Map([['tick', isFiniteNumber], ['pubkey', isTruthy], ['checksum', isTruthy]])],
  ])],
  [ROLLBACK_CTRL_PREFIX, new Map([
    ['input', new Map([['tick', isInteger]])],
    ['checksum', new Map([['tick', isInteger]])],
  ])],
  [LOCKSTEP_CTRL_PREFIX, new Map([
    ['input', new Map([['tick', isPositiveInteger]])],
    ['drop', new Map([['peer', isText], ['have', isInteger], ['tail', isList]])],
  ])],
])

const contractsOf = (prefix) => FRAME_CONTRACTS.get(prefix)

export function encodeControlFrame(prefix, frame) {
  const kinds = contractsOf(prefix)
  if (!kinds) throw new Error(`encodeControlFrame: no control protocol registered for prefix "${prefix}"`)
  if (!kinds.has(frame?.type)) throw new Error(`encodeControlFrame: ${JSON.stringify(frame?.type)} is not a ${prefix} control frame kind`)
  return prefix + JSON.stringify(frame)
}

export function parseControlFrame(prefix, data) {
  const kinds = contractsOf(prefix)
  if (!kinds) return { status: 'unregistered-prefix' }
  if (typeof data !== 'string' || !data.startsWith(prefix)) return { status: 'foreign-prefix' }
  let frame
  try {
    frame = JSON.parse(data.slice(prefix.length))
  } catch {
    return { status: 'malformed-payload' }
  }
  if (frame === null || typeof frame !== 'object') return { status: 'malformed-payload' }
  const contract = kinds.get(frame.type)
  if (!contract) return { status: 'unknown-kind', kind: frame.type }
  for (const [field, admits] of contract) {
    if (!admits(frame[field])) return { status: 'invalid-field', kind: frame.type, field }
  }
  return { status: 'accepted', frame }
}

export function controlFrameHandlers(prefix, handlers) {
  const kinds = contractsOf(prefix)
  if (!kinds) throw new Error(`controlFrameHandlers: no control protocol registered for prefix "${prefix}"`)
  const arms = new Map(Object.entries(handlers))
  for (const kind of kinds.keys()) {
    if (!arms.has(kind)) throw new Error(`controlFrameHandlers: ${prefix} admits control frame kind "${kind}" but no handler arm was supplied`)
  }
  for (const kind of arms.keys()) {
    if (!kinds.has(kind)) throw new Error(`controlFrameHandlers: handler arm "${kind}" is not a ${prefix} control frame kind`)
  }
  return arms
}

export const countReject = (stats) => (parsed) => {
  const rejects = stats.rejects ?? (stats.rejects = {})
  rejects[parsed.status] = (rejects[parsed.status] ?? 0) + 1
  if (parsed.status === 'unknown-kind') stats.unknownKind = (stats.unknownKind ?? 0) + 1
}

export const countOrder = (stats) => (order) => {
  const counts = stats.order ?? (stats.order = {})
  counts[order] = (counts[order] ?? 0) + 1
}

export const createFrameClock = () => new Map()

export function advanceFrameClock(clock, sender, tick) {
  const last = clock.get(sender)
  if (last === undefined || tick > last) {
    clock.set(sender, tick)
    return 'in-order'
  }
  return tick === last ? 'duplicate-frame' : 'stale-frame'
}

export function dispatchControlFrame(prefix, arms, data, onReject = null, origin = null) {
  const parsed = parseControlFrame(prefix, data)
  if (parsed.status !== 'accepted') {
    if (onReject) onReject(parsed)
    return null
  }
  const { frame } = parsed
  if (!origin) return { frame, apply: arms.get(frame.type), from: null, order: null }
  const from = origin.from ?? null
  const refuse = (status, extra = null) => {
    if (onReject) onReject({ status, kind: frame.type, from, ...(extra ?? {}) })
    return null
  }
  if (!from) return refuse('unattributed-sender')
  if (from === origin.selfId) return refuse('self-echo')
  const claimed = origin.senderOf ? origin.senderOf(frame) : null
  if (claimed != null && claimed !== from) return refuse('misattributed-sender', { claimed })
  let order = null
  if (origin.tickOf) {
    if (!origin.clock) throw new Error('dispatchControlFrame: a tick reader needs a frame clock')
    const tick = origin.tickOf(frame)
    if (Number.isFinite(tick)) {
      order = advanceFrameClock(origin.clock, from, tick)
      if (origin.onOrder) origin.onOrder(order)
    }
  }
  return { frame, apply: arms.get(frame.type), from, order }
}
