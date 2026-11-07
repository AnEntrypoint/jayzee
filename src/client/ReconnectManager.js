import { MSG } from '../protocol/messages.js'

const BASE_DELAY_MS = 1000
const BACKOFF_FACTOR = 1.5
const DEFAULT_MAX_DELAY_MS = 5000

const TRANSITIONS = {
  idle: { CONNECT: 'connected' },
  connected: { DISCONNECT: 'waiting', DESTROY: 'destroyed' },
  waiting: { RETRY: 'reconnecting', DESTROY: 'destroyed' },
  reconnecting: { CONNECTED: 'connected', DISCONNECT: 'waiting', DESTROY: 'destroyed' },
  destroyed: {},
}

export const reconnectDelayMs = (attempts, maxDelayMs = DEFAULT_MAX_DELAY_MS) =>
  Math.min(BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempts - 1), maxDelayMs)

export class ReconnectManager {
  #maxDelayMs
  #setTimer
  #clearTimer
  #state = 'idle'
  #attempts = 0
  #timer = null
  #token = null

  constructor({
    maxReconnectDelay = DEFAULT_MAX_DELAY_MS,
    setTimer = (callback, delayMs) => setTimeout(callback, delayMs),
    clearTimer = (handle) => clearTimeout(handle),
  } = {}) {
    this.#maxDelayMs = maxReconnectDelay
    this.#setTimer = setTimer
    this.#clearTimer = clearTimer
  }

  get state() {
    return this.#state
  }

  get attempts() {
    return this.#attempts
  }

  setSessionToken(token) {
    this.#token = token
  }

  isReconnecting() {
    return this.#state === 'waiting' || this.#state === 'reconnecting'
  }

  sendReconnectMessage(transport) {
    if (!this.#token || !this.isReconnecting() || !transport.isOpen()) return false
    transport.send({ type: MSG.RECONNECT, payload: { sessionToken: this.#token } })
    return true
  }

  beginMigration() {
    if (this.#state === 'destroyed') return
    this.#cancelTimer()
    this.#fire('DISCONNECT')
    this.#fire('RETRY')
  }

  onConnected() {
    this.#cancelTimer()
    if (this.#state === 'reconnecting') this.#fire('CONNECTED')
    else if (this.#state === 'idle') this.#fire('CONNECT')
  }

  onDisconnected(callback) {
    if (this.#state === 'destroyed' || this.#timer !== null) return
    this.#fire('DISCONNECT')
    const delayMs = reconnectDelayMs(this.#attempts, this.#maxDelayMs)
    this.#timer = this.#setTimer(() => {
      this.#timer = null
      if (this.#state === 'destroyed') return
      this.#fire('RETRY')
      callback()
    }, delayMs)
  }

  clear() {
    this.#fire('DESTROY')
    this.#cancelTimer()
    this.#token = null
  }

  invalidateSession() {
    this.#token = null
    if (this.isReconnecting()) this.#cancelTimer()
  }

  #fire(event) {
    const next = TRANSITIONS[this.#state]?.[event]
    if (next === undefined) return
    this.#state = next
    if (next === 'connected') this.#attempts = 0
    else if (next === 'waiting') this.#attempts++
  }

  #cancelTimer() {
    if (this.#timer === null) return
    this.#clearTimer(this.#timer)
    this.#timer = null
  }
}
