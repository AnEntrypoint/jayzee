import { mintPlayerOwner, playerIdOf, isPlayerOwner, UNBOUND_OWNER } from './playerOwner.js'

const DEFAULT_TTL_MS = 30000
const TOKEN_BYTES = 16
const PROTOTYPE_POLLUTION_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

const defaultRandomFill = (bytes) => globalThis.crypto.getRandomValues(bytes)

export function randomHex16(fill = defaultRandomFill) {
  const arr = new Uint8Array(TOKEN_BYTES)
  fill(arr)
  return Array.from(arr).map(b => b.toString(16).padStart(2, '0')).join('')
}

export class SessionStore {
  constructor(options = {}) {
    this.ttl = options.ttl || DEFAULT_TTL_MS
    this.now = options.now || Date.now
    this.randomFill = options.randomFill || defaultRandomFill
    this.sessions = new Map()
  }

  create(playerId, state) {
    const token = randomHex16(this.randomFill)
    const at = this.now()
    const session = {
      token,
      _owner: playerId == null ? UNBOUND_OWNER : mintPlayerOwner(playerId),
      get playerId() { return playerIdOf(this._owner) },
      state: state ? { ...state } : {},
      createdAt: at,
      lastTouched: at,
      pinned: false
    }
    this.sessions.set(token, session)
    return token
  }

  update(token, data) {
    const session = this._live(token)
    if (!session) return false
    if (data && data.state && typeof data.state === 'object' && !Array.isArray(data.state)) {
      for (const k of Object.keys(data.state)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(k)) continue
        session.state[k] = data.state[k]
      }
    }
    this._touch(session)
    return true
  }

  rebindOwner(token, owner) {
    const session = this._live(token)
    if (!session) return false
    if (!isPlayerOwner(owner)) throw new TypeError('[SessionStore] rebindOwner requires a PlayerOwner minted by the player boundary')
    session._owner = owner
    this._touch(session)
    return true
  }

  pin(token) {
    const session = this._live(token)
    if (!session) return false
    session.pinned = true
    return true
  }

  release(token) {
    const session = this._live(token)
    if (!session) return false
    session.pinned = false
    this._touch(session)
    return true
  }

  get(token) {
    const session = this._live(token)
    if (!session) return null
    this._touch(session)
    return session
  }

  destroy(token) {
    this.sessions.delete(token)
  }

  getActiveCount() {
    for (const [token, session] of this.sessions) {
      if (this._expired(session)) this.sessions.delete(token)
    }
    return this.sessions.size
  }

  destroyAll() {
    this.sessions.clear()
  }

  _live(token) {
    const session = this.sessions.get(token)
    if (!session) return null
    if (this._expired(session)) {
      this.sessions.delete(token)
      return null
    }
    return session
  }

  _expired(session) {
    return !session.pinned && this.now() - session.lastTouched > this.ttl
  }

  _touch(session) {
    session.lastTouched = this.now()
  }
}
