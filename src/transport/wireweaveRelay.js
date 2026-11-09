import { RelayPool } from 'wireweave/relay-pool'
import { fragment, Reassembler, maxPayloadBytes, MTU_DEFAULT } from './wireweaveFrame.js'

export const WIRE_KIND = 20001
const SUBSCRIPTION_PREFIX = 'jayzee-wireweave-'
const UNLIMITED_BUDGET = { burstCap: 1000000, refillPerSec: 1000000 }

const toBytes = (payload) => {
  if (payload instanceof Uint8Array) return payload
  if (payload instanceof ArrayBuffer) return new Uint8Array(payload)
  if (ArrayBuffer.isView(payload)) return new Uint8Array(payload.buffer, payload.byteOffset, payload.byteLength)
  throw new TypeError('wireweave send takes an ArrayBuffer or a view of bytes')
}

const BASE64_CHUNK_BYTES = 0x8000

const toBase64 = (bytes) => {
  let binary = ''
  for (let i = 0; i < bytes.length; i += BASE64_CHUNK_BYTES) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_BYTES))
  }
  return btoa(binary)
}

const fromBase64 = (text) => {
  const binary = atob(text)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

export function createWireweaveRelay({ relays, WebSocketImpl, verifyEvent, sign, pubkey, room, kind = WIRE_KIND, mtu = MTU_DEFAULT }) {
  if (!Array.isArray(relays) || relays.length === 0) throw new TypeError('createWireweaveRelay needs a non-empty relays array')
  if (typeof verifyEvent !== 'function') throw new TypeError('createWireweaveRelay needs a verifyEvent(event) function')
  if (typeof sign !== 'function') throw new TypeError('createWireweaveRelay needs a sign(template) function that returns a signed event')
  if (typeof pubkey !== 'string' || pubkey.length === 0) throw new TypeError('createWireweaveRelay needs the local pubkey')
  if (typeof room !== 'string' || room.length === 0) throw new TypeError('createWireweaveRelay needs a room name')
  const limit = maxPayloadBytes(mtu)
  const pool = new RelayPool({
    relays,
    verifyEvent,
    WebSocketImpl,
    storage: null,
    fallbackRelays: [],
    autoRotate: false,
    publishBudget: UNLIMITED_BUDGET,
  })
  const readers = new Map()
  const subId = SUBSCRIPTION_PREFIX + room
  let messageId = 0
  let onMessage = null

  const receive = (event) => {
    if (event.pubkey === pubkey || typeof event.content !== 'string') return
    let bytes
    try { bytes = fromBase64(event.content) } catch { return }
    let reader = readers.get(event.pubkey)
    if (!reader) {
      reader = new Reassembler()
      readers.set(event.pubkey, reader)
    }
    const payload = reader.feed(bytes)
    if (payload !== null && onMessage !== null) onMessage(payload, event.pubkey)
  }

  pool.subscribe(subId, [{ kinds: [kind], '#r': [room] }], receive)

  return {
    pool,
    connect() { pool.connect() },
    isConnected() { return pool.isConnected() },
    onMessage(handler) { onMessage = handler },
    send(payload) {
      const bytes = toBytes(payload)
      if (bytes.byteLength > limit) return { ok: false, reason: 'payload-too-large', maxBytes: limit, byteLength: bytes.byteLength }
      const id = messageId
      messageId = (messageId + 1) & 0xffff
      const frames = fragment(bytes, { messageId: id, mtu })
      let published = 0
      for (const frame of frames) {
        const event = sign({
          kind,
          created_at: Math.floor(Date.now() / 1000),
          tags: [['r', room]],
          content: toBase64(new Uint8Array(frame)),
        })
        if (pool.publish(event)) published++
      }
      return { ok: true, fragments: frames.length, published }
    },
    close() { pool.disconnect() },
  }
}
