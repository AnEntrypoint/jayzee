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
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.id === undefined) {
      for (const listener of listeners.get(message.method) ?? []) listener(message.params)
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
    const id = ++nextId
    const timer = setTimeout(() => {
      waiting.delete(id)
      rejectSend(new CdpTimeoutError(method, timeoutMs))
    }, timeoutMs)
    waiting.set(id, { resolve: resolveSend, reject: rejectSend, timer })
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
