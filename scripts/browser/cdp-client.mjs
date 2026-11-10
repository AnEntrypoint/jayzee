export const DEFAULT_SEND_TIMEOUT_MS = 60000

export class CdpTimeoutError extends Error {
  constructor(method, timeoutMs) {
    super('no reply to ' + method + ' within ' + timeoutMs + ' ms')
    this.name = 'CdpTimeoutError'
    this.code = 'CDP_TIMEOUT'
    this.method = method
    this.timeoutMs = timeoutMs
  }
}

export class CdpTargetCrashedError extends Error {
  constructor(method, sessionId) {
    super('the page crashed, so ' + method + ' has no reply (session ' + sessionId + ')')
    this.name = 'CdpTargetCrashedError'
    this.code = 'CDP_TARGET_CRASHED'
    this.method = method
    this.sessionId = sessionId
  }
}

export const OPEN_MODES = Object.freeze(['direct', 'navigate'])
const PAGE_EVENT_LIMIT = 40
const EVENT_TEXT_LIMIT = 300

export const openPage = async (send, { url, mode = 'direct', browserContextId = null }) => {
  if (!OPEN_MODES.includes(mode)) throw new TypeError('mode must be direct or navigate: ' + mode)
  const scope = browserContextId ? { browserContextId } : {}
  const { targetId } = await send('Target.createTarget', { url: mode === 'direct' ? url : 'about:blank', ...scope })
  const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true })
  if (mode === 'navigate') await send('Page.navigate', { url }, sessionId)
  return { targetId, sessionId }
}

export const recordPageEvents = async ({ send, on, off }, sessionId, limit = PAGE_EVENT_LIMIT) => {
  const events = []
  const keep = (kind, text) => {
    events.push({ t: Date.now(), kind, text: String(text).slice(0, EVENT_TEXT_LIMIT) })
    if (events.length > limit) events.shift()
  }
  const handlers = {
    'Runtime.consoleAPICalled': (params) => keep('console.' + params.type, params.args.map((arg) => arg.value ?? arg.description ?? arg.type).join(' ')),
    'Runtime.exceptionThrown': (params) => keep('exception', params.exceptionDetails.exception?.description ?? params.exceptionDetails.text),
    'Log.entryAdded': (params) => keep('log.' + params.entry.source + '.' + params.entry.level, params.entry.text),
    'Page.lifecycleEvent': (params) => keep('lifecycle', params.name),
  }
  const bound = Object.entries(handlers).map(([name, handler]) => [name, (params, from) => {
    if (from === sessionId) handler(params)
  }])
  for (const [name, listener] of bound) on(name, listener)
  await send('Runtime.enable', {}, sessionId)
  await send('Log.enable', {}, sessionId)
  await send('Page.enable', {}, sessionId)
  await send('Page.setLifecycleEventsEnabled', { enabled: true }, sessionId)
  return {
    events: () => events.slice(),
    stop: () => {
      for (const [name, listener] of bound) off(name, listener)
    },
  }
}

export const connectCdp = async (debugPort, { sendTimeoutMs = DEFAULT_SEND_TIMEOUT_MS } = {}) => {
  if (!(sendTimeoutMs > 0)) throw new RangeError('sendTimeoutMs must be positive: ' + sendTimeoutMs)
  const version = await (await fetch('http://127.0.0.1:' + debugPort + '/json/version')).json()
  const socket = new WebSocket(version.webSocketDebuggerUrl)
  await new Promise((open, failed) => {
    socket.addEventListener('open', open, { once: true })
    socket.addEventListener('error', () => failed(new Error('no devtools socket on port ' + debugPort)), { once: true })
  })
  let nextId = 0
  const waiting = new Map()
  const listeners = new Map()
  const crashed = new Set()
  const failSession = (sessionId) => {
    crashed.add(sessionId)
    for (const [id, settle] of waiting) {
      if (settle.sessionId !== sessionId) continue
      waiting.delete(id)
      clearTimeout(settle.timer)
      settle.reject(new CdpTargetCrashedError(settle.method, sessionId))
    }
  }
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) {
      if (message.method === 'Inspector.targetCrashed' && message.sessionId) failSession(message.sessionId)
      for (const listener of listeners.get(message.method) ?? []) listener(message.params, message.sessionId)
      return
    }
    const settle = waiting.get(message.id)
    if (!settle) return
    waiting.delete(message.id)
    clearTimeout(settle.timer)
    if (message.error) settle.reject(new Error(message.error.message))
    else settle.resolve(message.result)
  })
  const send = (method, params = {}, sessionId, timeoutMs = sendTimeoutMs) => new Promise((resolveSend, rejectSend) => {
    if (sessionId && crashed.has(sessionId)) {
      rejectSend(new CdpTargetCrashedError(method, sessionId))
      return
    }
    const id = ++nextId
    const timer = setTimeout(() => {
      waiting.delete(id)
      rejectSend(new CdpTimeoutError(method, timeoutMs))
    }, timeoutMs)
    waiting.set(id, { resolve: resolveSend, reject: rejectSend, timer, method, sessionId })
    socket.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }))
  })
  const on = (name, listener) => listeners.set(name, [...(listeners.get(name) ?? []), listener])
  const off = (name, listener) => listeners.set(name, (listeners.get(name) ?? []).filter((kept) => kept !== listener))
  const close = () => {
    for (const settle of waiting.values()) clearTimeout(settle.timer)
    waiting.clear()
    socket.close()
  }
  return { send, on, off, close }
}
