export function createEventIds({ now, random, uuid = null }) {
  if (typeof now !== 'function') throw new TypeError('createEventIds needs a now() clock in milliseconds')
  if (typeof random !== 'function') throw new TypeError('createEventIds needs a random() source in [0, 1)')
  if (uuid !== null && typeof uuid !== 'function') throw new TypeError('createEventIds uuid must be a function when given')
  return function nextEventId() {
    if (uuid !== null) return uuid()
    const ts = now().toString(36)
    const rand = random().toString(36).slice(2, 10)
    return `${ts}-${rand}`
  }
}

export function emitEnvelope(bus, channel, data, meta = {}, nextId) {
  if (typeof channel !== 'string' || !channel) throw new TypeError('[envelope] emitEnvelope requires a non-empty channel')
  if (typeof nextId !== 'function') throw new TypeError('[envelope] emitEnvelope needs an nextId() function')
  const event = bus.emit(channel, data, meta)
  return {
    id: nextId(),
    ts: event.meta.timestamp,
    source: meta.source || `spoint:entity:${meta.sourceEntity || 'unknown'}`,
    kind: channel,
    payload: data,
  }
}

export function validateEnvelope(env) {
  const errors = []
  if (!env || typeof env !== 'object') return { valid: false, errors: ['envelope must be an object'] }
  if (typeof env.id !== 'string' || !env.id) errors.push('id is required (string)')
  if (typeof env.ts !== 'number') errors.push('ts is required (number)')
  if (typeof env.source !== 'string' || !env.source) errors.push('source is required (string)')
  if (typeof env.kind !== 'string' || !env.kind) errors.push('kind is required (string)')
  if (!('payload' in env)) errors.push('payload is required')
  return errors.length === 0 ? { valid: true } : { valid: false, errors }
}
